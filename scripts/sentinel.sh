#!/bin/bash
# Sentinel 워치독 — Ralph 프로세스 모니터링 및 자동 재시작
# Rate limit 감지 시 리셋 시간까지 자동 대기 후 재개
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RALPH_BIN="$HOME/.bun/bin/ralph-tui"
PRD_FILE="$PROJECT_DIR/prd.json"
LOG_DIR="$PROJECT_DIR/logs"
SENTINEL_LOG="$LOG_DIR/sentinel.log"
# TUI 모드에서는 stdout 이 curses 에 점유되므로 sentinel 이 tee 로 가로챌 수 없다.
# 대신 ralph-tui 가 기록하는 per-iteration 로그(.ralph-tui/iterations/*.log)를
# 스캔하여 rate-limit/미완료 신호를 감지한다.
ITERATIONS_DIR="$PROJECT_DIR/.ralph-tui/iterations"

# ── 에이전트 선택 로드 ─────────────────────────────────────────────
# start-research.sh 에서 export 된 AGENT 가 우선, 없으면 .env 에서 읽고,
# 그것도 없으면 claude 를 기본값으로 사용한다.
# config.toml 의 agent 설정은 --agent 플래그로 항상 override 한다.
if [ -z "${AGENT:-}" ] && [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$PROJECT_DIR/.env"
    set +a
fi
AGENT="${AGENT:-claude}"
case "$AGENT" in
    claude|codex) ;;
    *)
        echo "❌ 지원하지 않는 AGENT 값: '$AGENT' (claude|codex)" >&2
        exit 1
        ;;
esac

MAX_RESTARTS=10
CONSECUTIVE_FAIL_LIMIT=3
COOLDOWN_SECONDS=360
CHECK_INTERVAL=60
FALLBACK_RESET_HOUR=6   # 파싱 실패 시 폴백: 오전 6시
MAX_WAIT_CEILING=86400  # 단일 대기의 상한 (24시간) — 파싱 버그로 무한 대기에 빠지는 것을 방지

mkdir -p "$LOG_DIR"

restart_count=0
consecutive_fails=0
session_id=""

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$SENTINEL_LOG"
}

# SIGINT/SIGTERM 처리 — 사용자가 Ctrl+C를 누르면 즉시 종료 로그를 남기고 빠져나간다.
trap 'log "⚠ 사용자 인터럽트 감지 — Sentinel 종료"; exit 130' INT TERM

# 취소 가능한 대기 루프.
# 인자: 총 대기 초, 표시 라벨
# - 30초 단위로 쪼개서 sleep 하므로 Ctrl+C 에 빠르게 반응한다.
# - 10분마다 남은 시간을 로그로 출력해 사용자에게 진행 상황을 보여 준다.
# - 상한(MAX_WAIT_CEILING)을 넘는 입력은 상한으로 강제한다.
interruptible_sleep() {
    local total="$1"
    local label="${2:-대기}"

    # 입력 검증 — 숫자가 아니면 기본값(60초)
    if ! [[ "$total" =~ ^[0-9]+$ ]]; then
        log "⚠ interruptible_sleep: 비정상 대기 시간 '$total' → 60초로 대체"
        total=60
    fi

    if [ "$total" -gt "$MAX_WAIT_CEILING" ]; then
        log "⚠ 대기 시간이 상한(${MAX_WAIT_CEILING}초=24시간)을 초과하여 상한으로 제한"
        total="$MAX_WAIT_CEILING"
    fi

    local remaining="$total"
    local last_progress_log=0
    local chunk=30

    while [ "$remaining" -gt 0 ]; do
        local step="$chunk"
        [ "$remaining" -lt "$chunk" ] && step="$remaining"
        sleep "$step"
        remaining=$(( remaining - step ))
        local elapsed=$(( total - remaining ))
        # 10분마다 또는 마지막 직전에 진행 로그
        if [ $(( elapsed - last_progress_log )) -ge 600 ] || [ "$remaining" -eq 0 ]; then
            local rm=$(( remaining / 60 ))
            local rs=$(( remaining % 60 ))
            log "⏳ ${label} 진행 중 — 남은 시간: ${rm}분 ${rs}초 (Ctrl+C로 중단 가능)"
            last_progress_log="$elapsed"
        fi
    done
}

# === Playwright persistent profile 확인 (논문 전문 접근용) ===
ensure_playwright_profile() {
    local profile_dir="$PROJECT_DIR/.playwright-profile"
    if [ -d "$profile_dir" ]; then
        log "✓ Playwright persistent profile 존재: $profile_dir"
    else
        log "⚠ Playwright persistent profile 없음 — 최초 인증이 필요합니다"
        log "   실행: bash scripts/setup-auth.sh"
    fi
}

# 최근 N 개 iteration 로그의 본문을 합쳐서 표준출력으로 내보낸다.
# TUI 모드에선 sentinel 이 ralph-tui 의 stdout 을 tee 할 수 없으므로
# ralph-tui 가 스스로 기록하는 per-iteration 파일에서 신호를 읽어야 한다.
# 파일명에 타임스탬프가 박혀 있으므로 mtime 기준으로 최신 N 개만 뽑는다.
recent_iterations_text() {
    local n="${1:-8}"
    [ -d "$ITERATIONS_DIR" ] || return 0
    # shellcheck disable=SC2012 — ls -1t 정렬이 목적이라 그대로 둔다
    ls -1t "$ITERATIONS_DIR"/*.log 2>/dev/null | head -n "$n" | while IFS= read -r f; do
        [ -f "$f" ] && cat "$f"
    done
}

# Rate limit 감지: 최근 iteration 로그에서 rate_limit 신호 확인
check_rate_limit() {
    if recent_iterations_text 8 | grep -q "rate_limit\|hit your limit"; then
        return 0  # rate limit 감지됨
    fi
    return 1  # rate limit 아님
}

# 미완료 태스크 감지: 최근 iteration 로그에 INTERRUPTED/Max retries 여부
check_incomplete() {
    if recent_iterations_text 5 | grep -q "INTERRUPTED\|Skipping.*Max retries"; then
        return 0  # 미완료 태스크 있음
    fi
    return 1
}

# iteration 로그에서 리셋 시간 파싱 (예: "resets 6am", "resets 2pm", "resets 12:30pm")
# stdout으로 시간(0~23)만 출력한다. 호출자는 종료 코드로 파싱 성공/폴백을 구분한다.
#   return 0 = 로그에서 실제 리셋 시간을 파싱함
#   return 1 = 파싱 실패 → FALLBACK_RESET_HOUR 반환 (대기가 예상보다 길 수 있음)
parse_reset_hour_from_log() {
    local reset_str reset_hour
    reset_str=$(recent_iterations_text 8 | grep -o "resets [0-9:]*[ap]m" | tail -1 || echo "")

    if [ -z "$reset_str" ]; then
        echo "$FALLBACK_RESET_HOUR"
        return 1
    fi

    # 시간 추출 (예: "resets 6am" → 6, "resets 2pm" → 14, "resets 12:30pm" → 12)
    # set -e + pipefail 환경이라 grep 미스매치 시 sentinel 전체가 조용히 죽지 않도록 `|| true` 로 흡수.
    reset_hour=$(echo "$reset_str" | grep -o '[0-9]*' | head -1 || true)

    if echo "$reset_str" | grep -q "pm" && [ "$reset_hour" -ne 12 ]; then
        reset_hour=$(( reset_hour + 12 ))
    elif echo "$reset_str" | grep -q "am" && [ "$reset_hour" -eq 12 ]; then
        reset_hour=0
    fi

    echo "$reset_hour"
    return 0
}

# 다음 리셋 시간까지 남은 초 계산 (로그에서 리셋 시간을 자동 감지)
seconds_until_reset() {
    local reset_hour now_hour now_min now_sec total_now total_reset parse_rc

    reset_hour=$(parse_reset_hour_from_log)
    parse_rc=$?
    if [ "$parse_rc" -eq 0 ]; then
        log "   감지된 리셋 시간: 오전/오후 ${reset_hour}시"
    else
        log "   ⚠ iteration 로그에서 'resets Xam/pm' 패턴을 찾지 못해 폴백(오전 ${FALLBACK_RESET_HOUR}시)을 사용합니다."
        log "   ⚠ 실제 리셋 시간과 다르면 대기가 의도보다 길 수 있습니다. Ctrl+C 로 중단 후 FALLBACK_RESET_HOUR 를 조정해 재실행하세요."
    fi

    now_hour=$(date '+%H' | sed 's/^0//')
    now_min=$(date '+%M' | sed 's/^0//')
    now_sec=$(date '+%S' | sed 's/^0//')

    total_now=$(( now_hour * 3600 + now_min * 60 + now_sec ))
    total_reset=$(( reset_hour * 3600 ))

    if [ "$total_now" -ge "$total_reset" ]; then
        # 이미 리셋 시간 지남 → 다음날 리셋까지
        echo $(( 86400 - total_now + total_reset + 300 ))  # +5분 여유
    else
        # 아직 리셋 전
        echo $(( total_reset - total_now + 300 ))  # +5분 여유
    fi
}

# 마지막 세션 ID 가져오기
get_latest_session_id() {
    "$RALPH_BIN" resume --list 2>/dev/null | grep -E '^\d+\.' | head -1 | awk '{print $2}' || echo ""
}

log "=== Sentinel 시작 ==="
log "프로젝트: $PROJECT_DIR"
log "에이전트: $AGENT"
log "최대 재시작: $MAX_RESTARTS"
log "Rate limit 폴백 리셋 시간: 오전 ${FALLBACK_RESET_HOUR}시"

# === prd.json 스키마 사전 검증 ===
# ralph-tui 가 stricter 한 스키마 검증을 하므로(status 필드 금지 등),
# 위반이 있으면 Ralph 가 "Total tasks: 0" 으로 즉시 종료되어 파이프라인이 사실상 실행되지 않는다.
# 여기서 먼저 잡아 명확한 에러 메시지와 함께 중단하는 편이 훨씬 낫다.
#
# 자동 청소 전략:
#   1차 검증에서 실패하면 `--fix` 로 금지 필드(status/subtasks/estimated_hours/files) 자동 제거 시도.
#   청소 후 재검증 통과 시 진행 (원본은 이미 에이전트가 생성한 것이므로 내용 손실 없음).
#   청소로도 해결 불가(name 누락 등 구조적 오류) 시에만 중단한다.
#   이 루프는 에이전트(특히 Claude)가 습관적으로 `status: "pending"` 을 넣는 실수를
#   사용자에게 "다시 돌리세요"로 떠넘기지 않고 파이프라인 안에서 흡수한다.
if [ -f "$PRD_FILE" ]; then
    log "prd.json 스키마 검증 중..."
    if node "$PROJECT_DIR/scripts/lib/validate-prd.mjs" "$PRD_FILE" 2>&1 | tee -a "$SENTINEL_LOG"; then
        log "✓ prd.json 스키마 검증 통과"
    else
        log "⚠ prd.json 스키마 검증 실패 — 자동 청소(--fix) 를 시도합니다."
        if node "$PROJECT_DIR/scripts/lib/validate-prd.mjs" --fix "$PRD_FILE" 2>&1 | tee -a "$SENTINEL_LOG"; then
            log "✓ prd.json 자동 청소 후 스키마 검증 통과 — Ralph 실행을 계속합니다."
        else
            log "❌ 자동 청소로도 해결 불가 — Sentinel 을 중단합니다."
            log "   위 오류 메시지를 참고해 prd.json 을 고친 뒤 ./start-research.sh run 으로 재시도하세요."
            log "=== Sentinel 종료 (prd.json 스키마 오류) ==="
            exit 2
        fi
    fi
else
    log "❌ prd.json 이 존재하지 않습니다: $PRD_FILE"
    log "=== Sentinel 종료 (prd.json 없음) ==="
    exit 2
fi

# Chrome 디버깅 모드 확인/실행 (매 시작 시)
ensure_playwright_profile

while true; do
    log "Ralph 실행 시작 (시도 $((restart_count + 1))/$MAX_RESTARTS)"

    cd "$PROJECT_DIR"
    # TUI 모드로 foreground 실행 — curses 가 터미널을 점유하므로 tee/pipe 금지.
    # per-iteration 로그는 ralph-tui 가 .ralph-tui/iterations/ 에 스스로 기록한다.
    # `set -e` 가 non-zero 종료에 트리거되지 않도록 `|| EXIT_CODE=$?` 로 흡수한다.
    EXIT_CODE=0
    if [ "$restart_count" -eq 0 ] && [ -z "$session_id" ]; then
        # 첫 실행 — --agent 로 config.toml 의 agent 설정을 명시적으로 override
        "$RALPH_BIN" run --agent "$AGENT" --prd "$PRD_FILE" || EXIT_CODE=$?
    else
        # 재시작 — resume (세션에 저장된 agent 가 이어짐)
        if [ -n "$session_id" ]; then
            "$RALPH_BIN" resume "$session_id" || EXIT_CODE=$?
        else
            "$RALPH_BIN" resume || EXIT_CODE=$?
        fi
    fi

    # 세션 ID 기록 (다음 resume용)
    new_session=$(get_latest_session_id)
    if [ -n "$new_session" ]; then
        session_id="$new_session"
    fi

    # 정상 종료 확인
    #
    # 중요: Ralph TUI 는 "exit code 0" 으로 끝나도 실제로는 완료가 아닌 경우가 있다.
    #   (A) 사용자 Ctrl+C → graceful shutdown → exit 0 + status: "interrupted"
    #   (B) prd.json 스키마 거부 → totalTasks:0 으로 즉시 종료 → exit 0 + tasksCompleted:0
    # 과거에 exit 0 만 보고 "✅ 모든 태스크 완료" 라고 찍어서, 실제로는 단 한 태스크도
    # 진행되지 않았는데 사용자에게 성공 메시지를 주는 사고가 반복됐다 (2026-04-17).
    # session-meta.json 의 status / totalTasks / tasksCompleted 를 함께 확인해 실제로 완료됐는지
    # 판정한다.
    if [ "$EXIT_CODE" -eq 0 ]; then
        # Rate limit 또는 미완료 태스크 확인
        if check_rate_limit || check_incomplete; then
            if check_rate_limit; then
                wait_secs=$(seconds_until_reset)
                wait_mins=$(( wait_secs / 60 ))
                reset_time=$(date -v+"${wait_secs}S" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "+${wait_secs} seconds" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "약 ${wait_mins}분 후")

                log "⏳ Rate limit 감지! 리셋 시간까지 대기합니다."
                log "   대기 시간: ${wait_mins}분 (${wait_secs}초)"
                log "   예상 재개: ${reset_time}"

                interruptible_sleep "$wait_secs" "Rate limit 리셋 대기"

                log "⏰ Rate limit 리셋 완료. 재개합니다."
                ensure_playwright_profile
            else
                log "⚠ 미완료 태스크 감지. ${CHECK_INTERVAL}초 후 재개..."
                interruptible_sleep "$CHECK_INTERVAL" "미완료 태스크 재시도 대기"
                ensure_playwright_profile
            fi

            restart_count=$((restart_count + 1))
            consecutive_fails=0
            continue
        fi

        # session-meta.json 로 실제 종료 상태 검증
        local_meta="$PROJECT_DIR/.ralph-tui/session-meta.json"
        if [ -f "$local_meta" ]; then
            meta_status=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$local_meta','utf8')).status||'')}catch(e){}" 2>/dev/null || echo "")
            meta_total=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$local_meta','utf8')).totalTasks||0)}catch(e){console.log(0)}" 2>/dev/null || echo "0")
            meta_done=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$local_meta','utf8')).tasksCompleted||0)}catch(e){console.log(0)}" 2>/dev/null || echo "0")

            log "   session-meta 판정: status=${meta_status}, tasks=${meta_done}/${meta_total}"

            # Ralph 가 interrupted 로 마감됐거나, totalTasks 자체가 0 이면 "완료" 라고 선언하지 않는다.
            if [ "$meta_status" = "interrupted" ]; then
                log "⚠ Ralph 가 interrupted 상태로 종료됐습니다 (graceful shutdown). 실제 완료 아님."
                log "   재실행이 필요하면 ./start-research.sh run 또는 ./start-research.sh resume 으로 이어가세요."
                break
            fi
            if [ "$meta_total" = "0" ]; then
                log "⚠ Ralph 가 totalTasks=0 으로 종료됐습니다. prd.json 이 비정상이거나 이미 모든 passes=true 인 상태."
                log "   prd.json 의 passes 필드와 userStories 를 확인하세요."
                break
            fi
            if [ "$meta_done" != "$meta_total" ]; then
                log "⚠ 완료된 태스크가 전체보다 적습니다 (${meta_done}/${meta_total}). interrupted 아닌데 완료 선언은 보류."
                log "   재시도하려면 ./start-research.sh run 으로 다시 실행하세요."
                break
            fi

            log "✅ Ralph 정상 종료. 모든 태스크 완료 (${meta_done}/${meta_total})."
            break
        fi

        # session-meta.json 이 없으면 (Ralph 가 너무 빨리 끝나서 못 쓴 경우 등) 보수적으로 표시
        log "⚠ Ralph 가 exit 0 으로 끝났으나 session-meta.json 이 없어 실제 완료 여부를 확정할 수 없습니다."
        break
    fi

    restart_count=$((restart_count + 1))
    consecutive_fails=$((consecutive_fails + 1))

    log "⚠ Ralph 비정상 종료 (exit code $EXIT_CODE)"

    # Rate limit 확인
    if check_rate_limit; then
        wait_secs=$(seconds_until_reset)
        wait_mins=$(( wait_secs / 60 ))
        log "⏳ Rate limit 감지! ${wait_mins}분 대기 후 재개..."
        interruptible_sleep "$wait_secs" "Rate limit 리셋 대기 (비정상 종료 이후)"
        log "⏰ Rate limit 리셋 완료. 재개합니다."
        consecutive_fails=0
        continue
    fi

    # 최대 재시작 초과
    if [ "$restart_count" -ge "$MAX_RESTARTS" ]; then
        log "❌ 최대 재시작 횟수($MAX_RESTARTS) 초과. Sentinel 종료."
        break
    fi

    # 연속 실패 시 쿨다운
    if [ "$consecutive_fails" -ge "$CONSECUTIVE_FAIL_LIMIT" ]; then
        log "⚠ 연속 $CONSECUTIVE_FAIL_LIMIT회 실패. ${COOLDOWN_SECONDS}초 쿨다운..."
        interruptible_sleep "$COOLDOWN_SECONDS" "연속 실패 쿨다운"
        consecutive_fails=0
    else
        log "${CHECK_INTERVAL}초 후 재시작..."
        interruptible_sleep "$CHECK_INTERVAL" "재시작 대기"
    fi
done

log "=== Sentinel 종료 ==="
log "총 재시작 횟수: $restart_count"
