#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
# 에이전트 중립 실행 래퍼
#
# 사용법:
#   scripts/run-agent.sh interactive [--system-prompt <file>]
#       대화형 세션을 연다. 시스템 프롬프트 파일이 주어지면 그 내용을
#       사전 컨텍스트로 주입한다.
#
#   scripts/run-agent.sh exec "<prompt>"
#       프롬프트 한 번 실행 후 종료(non-interactive).
#
# 환경변수 AGENT 로 사용할 CLI를 지정한다 (.env 에서 로드).
#   claude  — Anthropic Claude Code CLI
#   codex   — OpenAI Codex CLI
#
# 두 에이전트 모두 .claude/skills/ → sync-agent-assets.mjs 파생물 또는
# AGENTS.md 를 자동으로 로드하므로, 같은 슬래시 커맨드로 동작한다.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# .env 로드 (있으면)
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$PROJECT_DIR/.env"
    set +a
fi

AGENT="${AGENT:-claude}"

# ── 세이프 모드 옵트아웃 ─────────────────────────────────────────────
# CLAUDE_SAFE_MODE=1 이면 Claude Code의 --dangerously-skip-permissions 를 제거하고
# .claude/settings.json 의 permissions.allow/deny 가 적용되도록 한다.
# 기본값은 "빠른 자동화 우선" — 즉 skip-permissions 사용. 신규 사용자나 공용 머신에서
# 돌릴 때는 CLAUDE_SAFE_MODE=1 ./start-research.sh ... 형태로 호출하길 권장한다.
CLAUDE_FLAGS=()
if [ "${CLAUDE_SAFE_MODE:-0}" != "1" ]; then
    CLAUDE_FLAGS+=(--dangerously-skip-permissions)
fi

# ── Codex 세이프 모드 옵트아웃 ───────────────────────────────────────
# Codex 기본 sandbox(--full-auto = workspace-write)는 외부 API DNS 와
# Playwright Chromium launch 를 모두 차단해 Tier 1/2 전문 수집이 실패한다.
# 이 파이프라인은 본질적으로 네트워크·브라우저를 요구하므로, 기본값을
# --dangerously-bypass-approvals-and-sandbox 로 잡고 CODEX_SAFE_MODE=1
# 로만 표준 sandbox 로 되돌릴 수 있게 한다.
# ⚠ 보안 주의: README.md "Codex 실행 시 보안 모델" 참조.
CODEX_FLAGS=()
if [ "${CODEX_SAFE_MODE:-0}" = "1" ]; then
    # 안전 모드: 표준 sandbox. Tier 1/2 는 실패하지만 Tier 3(Playwright MCP) 로 우회됨.
    CODEX_FLAGS+=(--full-auto)
else
    # 기본 모드: sandbox 완전 해제. 네트워크·브라우저 전면 허용.
    CODEX_FLAGS+=(--dangerously-bypass-approvals-and-sandbox)
fi

# ── 에이전트별 대화형 실행 ───────────────────────────────────────────
#
# intake-prompt-<mode>.md 전체를 "초기 유저 메시지"로 주입하면 Codex UI 에
# 길고 기계적인 지시문이 사용자가 친 것처럼 그대로 뿌려진다 (2026-04-17 사고).
# Claude 의 `--append-system-prompt` 는 시스템 영역으로 들어가 UI 에 안 보이지만,
# Codex CLI 에는 동등한 비노출 주입 기능이 없다.
#
# 해결 전략: 상세 지시문 원문은 .codex/skills/research-intake/ 에 이미 복사되어
# 있으므로, Codex 에는 **스킬을 바로 호출하라는 아주 짧은 트리거 메시지만**
# 유저 메시지로 주입한다. 긴 지시서는 스킬 SKILL.md 가 담당한다.
# 파일명에서 모드(deep/trend)를 추출해 올바른 슬래시 커맨드를 주입한다.
run_interactive() {
    local sys_prompt_file="$1"

    case "$AGENT" in
        claude)
            if [ -n "$sys_prompt_file" ] && [ -f "$sys_prompt_file" ]; then
                exec claude "${CLAUDE_FLAGS[@]}" \
                    --append-system-prompt "$(cat "$sys_prompt_file")"
            else
                exec claude "${CLAUDE_FLAGS[@]}"
            fi
            ;;

        codex)
            # 스크립트 파일명(intake-prompt-deep.md / intake-prompt-trend.md)에서
            # 모드를 추출해 `/research-intake <mode>` 형태의 트리거를 만든다.
            # 실패 시 모드 미지정으로 호출 — 스킬이 사용자에게 모드를 물어본다.
            if [ -n "$sys_prompt_file" ] && [ -f "$sys_prompt_file" ]; then
                local base mode trigger
                base="$(basename "$sys_prompt_file" .md)"  # intake-prompt-deep
                mode="${base#intake-prompt-}"              # deep / trend
                case "$mode" in
                    deep|trend) trigger="/research-intake $mode" ;;
                    *)          trigger="/research-intake" ;;
                esac
                # 너무 길거나 지시투로 적힌 원문을 유저 메시지로 노출하지 않는다.
                # 대신 스킬을 호출하라는 한 줄만 넣는다. 스킬 본문(.codex/skills/
                # research-intake/SKILL.md)이 이후 모든 대화 흐름을 안내한다.
                exec codex "${CODEX_FLAGS[@]}" "$trigger"
            else
                exec codex "${CODEX_FLAGS[@]}"
            fi
            ;;

        *)
            echo "❌ 지원하지 않는 AGENT 값: '$AGENT' (claude|codex 중 하나여야 합니다)" >&2
            exit 1
            ;;
    esac
}

# ── 에이전트별 일회성 실행 ───────────────────────────────────────────
# Codex exec 은 기본적으로 agentic 과정(모든 bash 호출과 결과, 스킬 본문,
# 파일 읽기 결과 등)을 stdout 에 그대로 쏟아내 사용자 터미널을 오염시킨다.
# 이 래퍼에서는 그 raw 출력을 로그 파일로 리다이렉트하고, 에이전트의 최종
# 응답만 --output-last-message 로 분리해 간결히 보여 준다.
# Claude 쪽은 -p 플래그가 이미 non-interactive 출력을 깔끔히 내 주므로
# 기존 동작을 유지한다.
run_exec() {
    local prompt="$1"
    local log_dir="$PROJECT_DIR/logs"
    mkdir -p "$log_dir"
    local ts
    ts="$(date +%Y%m%d-%H%M%S)"

    case "$AGENT" in
        claude)
            exec claude "${CLAUDE_FLAGS[@]}" -p "$prompt"
            ;;

        codex)
            local log_file="$log_dir/codex-exec-${ts}.log"
            local last_msg="$log_dir/codex-exec-${ts}-last.txt"

            echo "▶ Codex exec 실행 중 — 상세 로그: $log_file" >&2
            echo "  (에이전트가 스킬을 따라 작업하는 동안 기다려 주세요. 보통 1~3분)" >&2

            # CODEX_FLAGS 에 이미 --full-auto 또는
            # --dangerously-bypass-approvals-and-sandbox 가 들어 있으므로
            # 여기서는 중복 지정하지 않는다.
            local rc=0
            codex exec "${CODEX_FLAGS[@]}" --color never \
                -o "$last_msg" \
                "$prompt" >"$log_file" 2>&1 || rc=$?

            # 최종 응답만 깔끔히 노출 — 이 블록이 사용자에게 실제로 보이는 Phase 결과다.
            if [ -f "$last_msg" ] && [ -s "$last_msg" ]; then
                echo ""
                echo "─── 에이전트 최종 응답 ─────────────────────────────"
                cat "$last_msg"
                echo "────────────────────────────────────────────────────"
                echo ""
            fi

            if [ "$rc" -ne 0 ]; then
                echo "✗ Codex exec 실패 (exit $rc)" >&2
                echo "  상세 로그: $log_file" >&2
                echo "  (마지막 50줄을 참고용으로 표시합니다)" >&2
                tail -n 50 "$log_file" >&2 || true
            fi

            # run-agent.sh 는 start-research.sh 가 spawn 하는 서브쉘이므로
            # exec 대신 exit 로 종료 코드를 caller 에게 그대로 전달한다.
            exit "$rc"
            ;;

        *)
            echo "❌ 지원하지 않는 AGENT 값: '$AGENT' (claude|codex 중 하나여야 합니다)" >&2
            exit 1
            ;;
    esac
}

# ── 메인 분기 ────────────────────────────────────────────────────────
MODE="${1:-}"
shift || true

case "$MODE" in
    interactive)
        SYS_PROMPT_FILE=""
        while [ $# -gt 0 ]; do
            case "$1" in
                --system-prompt)
                    SYS_PROMPT_FILE="$2"
                    shift 2
                    ;;
                *)
                    echo "⚠ 알 수 없는 인자: $1 (무시)" >&2
                    shift
                    ;;
            esac
        done
        run_interactive "$SYS_PROMPT_FILE"
        ;;

    exec)
        PROMPT="${1:-}"
        if [ -z "$PROMPT" ]; then
            echo "❌ exec 모드는 프롬프트 인자가 필요합니다." >&2
            echo "   예: $0 exec \"/research-tasks deep\"" >&2
            exit 1
        fi
        run_exec "$PROMPT"
        ;;

    ""|-h|--help|help)
        cat <<USAGE
에이전트 중립 실행 래퍼

사용법:
  $0 interactive [--system-prompt <file>]
  $0 exec "<prompt>"

환경변수 AGENT 값 (.env 또는 shell 에서 설정):
  claude | codex
  현재: ${AGENT}

예시:
  AGENT=claude $0 interactive --system-prompt scripts/intake-prompt-deep.md
  AGENT=codex  $0 exec "/research-tasks deep"
USAGE
        exit 0
        ;;

    *)
        echo "❌ 알 수 없는 모드: '$MODE' (interactive|exec 중 하나)" >&2
        exit 1
        ;;
esac
