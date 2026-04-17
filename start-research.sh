#!/bin/bash
# 연구 자동화 파이프라인 — 진입점
#
# 사용법:
#   ./start-research.sh <mode> [--agent <claude|codex|gemini>] [--name <slug>]
#
# 모드:
#   deep            — 심층 참고문헌 조사 (처음부터)
#   trend           — 동향 탐구 (처음부터)
#   run             — 기존 prd.json으로 바로 실행
#   resume          — 중단된 세션 재개
#   library         — 아카이브된 프로젝트 목록 보기
#   restore <slug>  — 아카이브된 프로젝트를 루트로 복원 (현재 상태는 자동 보존)
#
# --agent 옵션을 주면 .env 의 AGENT 값을 이 실행에서만 덮어쓴다.
# --agent 와 AGENT 환경변수, .env 의 AGENT 가 모두 없으면
# 실행 초반에 어떤 에이전트를 쓸지 대화형으로 물어본다(기본 선택: codex).
# --name 옵션은 deep/trend 에서 기존 프로젝트를 자동 아카이브할 때
# 자동 생성될 slug 를 원하는 이름으로 덮어쓴다.
#
# tmux에서 실행 권장:
#   tmux new -s research
#   ./start-research.sh deep
#   # Ctrl+B, D → detach (백그라운드 유지)
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS_DIR="$PROJECT_DIR/scripts"
CONFIG_FILE="$PROJECT_DIR/research-config.json"
PRD_FILE="$PROJECT_DIR/prd.json"
RALPH_BIN="$HOME/.bun/bin/ralph-tui"

# ── 인자 파싱 (모드 + --agent + --name) ────────────────────────────
MODE=""
AGENT_OVERRIDE=""
NAME_FLAG=""
RESTORE_SLUG=""

show_usage() {
    cat <<'USAGE'
==========================================
 연구 자동화 파이프라인
==========================================

사용법:
  ./start-research.sh <mode> [--agent <name>] [--name <slug>]

모드:
  deep            — 키워드 조합 완전탐색 + 실험 설계 지원 (처음부터)
  trend           — 리뷰 논문 기반 동향 파악 + 최신 트렌드 (처음부터)
  run             — research-config.json + prd.json 이 이미 있을 때 바로 실행
  resume          — 중단된 세션을 이어서 실행
  library         — 아카이브된 프로젝트 목록 보기
  restore <slug>  — 아카이브된 프로젝트를 루트로 복원 (현재 상태는 자동 보존)

옵션:
  --agent <name>   claude | codex | gemini — 지정하면 이번 실행에 한해 고정.
                   미지정이면 AGENT 환경변수 → .env AGENT → 대화형 선택 순으로 결정.
  --name <slug>    deep/trend 에서 새 주제를 시작할 때, 기존 프로젝트를
                   자동 아카이브할 슬러그를 지정 (없으면 첫 키워드에서 자동 생성)

예시:
  ./start-research.sh deep
  ./start-research.sh deep --agent codex
  ./start-research.sh deep --name 4d-qsar-pampa-v1   # 기존 작업을 이 이름으로 보존
  ./start-research.sh library
  ./start-research.sh restore 4d-qsar-pampa-v1-20260416-185530
  AGENT=gemini ./start-research.sh run
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        deep|trend|run|resume|library)
            MODE="$1"
            shift
            ;;
        restore)
            MODE="restore"
            shift
            # restore 다음에 slug 가 오는 것이 정상 사용법. 다음 토큰이 옵션이면 비워둠(아래에서 에러 처리).
            if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
                RESTORE_SLUG="$1"
                shift
            fi
            ;;
        --agent)
            AGENT_OVERRIDE="${2:-}"
            if [ -z "$AGENT_OVERRIDE" ]; then
                echo "❌ --agent 옵션에 값이 없습니다." >&2
                exit 1
            fi
            shift 2
            ;;
        --agent=*)
            AGENT_OVERRIDE="${1#*=}"
            shift
            ;;
        --name)
            NAME_FLAG="${2:-}"
            if [ -z "$NAME_FLAG" ]; then
                echo "❌ --name 옵션에 값이 없습니다." >&2
                exit 1
            fi
            shift 2
            ;;
        --name=*)
            NAME_FLAG="${1#*=}"
            shift
            ;;
        -h|--help|help)
            show_usage
            exit 0
            ;;
        *)
            echo "❌ 알 수 없는 인자: '$1'" >&2
            echo ""
            show_usage
            exit 1
            ;;
    esac
done

if [ -z "$MODE" ]; then
    show_usage
    exit 1
fi

# ── library / restore: 파일 작업만 수행하고 즉시 종료 ─────────────
# 프록시/인증/Ralph 블록을 거치지 않는다.
if [ "$MODE" = "library" ]; then
    node "$SCRIPTS_DIR/lib/project-archive.mjs" list
    exit $?
fi

if [ "$MODE" = "restore" ]; then
    if [ -z "$RESTORE_SLUG" ]; then
        echo "❌ restore 모드는 복원할 slug 가 필요합니다." >&2
        echo "   사용법: ./start-research.sh restore <slug>" >&2
        echo "   목록:   ./start-research.sh library" >&2
        exit 1
    fi
    node "$SCRIPTS_DIR/lib/project-archive.mjs" restore "$RESTORE_SLUG"
    exit $?
fi

# ── 에이전트 설정 (--agent > env AGENT > .env AGENT > 대화형 선택) ─
# run-agent.sh 와 Ralph TUI 가 같은 AGENT 값을 보도록 export 한다.
# 우선순위:
#   1) --agent 플래그  (명시적 의지가 제일 강함)
#   2) 현재 쉘의 AGENT 환경변수
#   3) .env 에 저장된 AGENT= 값
#   4) 위 셋 다 없으면: stdin 이 TTY 이면 사용자에게 물어보고,
#      비대화형(파이프/CI)이면 claude 로 폴백한다.
if [ -n "$AGENT_OVERRIDE" ]; then
    case "$AGENT_OVERRIDE" in
        claude|codex|gemini)
            export AGENT="$AGENT_OVERRIDE"
            ;;
        *)
            echo "❌ 지원하지 않는 --agent 값: '$AGENT_OVERRIDE' (claude|codex|gemini)" >&2
            exit 1
            ;;
    esac
fi

# 현재 쉘의 AGENT 가 없으면 .env 의 값을 먼저 읽어 본다.
AGENT_FROM_ENV_FILE=""
if [ -z "${AGENT:-}" ] && [ -f "$PROJECT_DIR/.env" ]; then
    # grep 이 매치 못하면 exit 1 → pipefail + set -e 로 스크립트가 조용히 종료되므로
    # `|| true` 로 파이프 실패를 흡수해야 한다 (.env 에 AGENT= 라인이 없는 게 정상 케이스).
    AGENT_FROM_ENV_FILE="$(grep -E '^AGENT=' "$PROJECT_DIR/.env" 2>/dev/null | head -n 1 | cut -d'=' -f2- || true)"
    AGENT_FROM_ENV_FILE="${AGENT_FROM_ENV_FILE//\"/}"
    AGENT_FROM_ENV_FILE="${AGENT_FROM_ENV_FILE//\'/}"
fi

if [ -z "${AGENT:-}" ] && [ -n "$AGENT_FROM_ENV_FILE" ]; then
    case "$AGENT_FROM_ENV_FILE" in
        claude|codex|gemini)
            export AGENT="$AGENT_FROM_ENV_FILE"
            ;;
        *)
            echo "⚠ .env 의 AGENT='$AGENT_FROM_ENV_FILE' 은 지원되지 않는 값입니다. 무시합니다." >&2
            ;;
    esac
fi

# 여전히 AGENT 가 비어 있으면 대화형으로 고른다.
# - TTY 가 있으면 사용자에게 묻는다 (기본 선택지는 Codex).
# - 비대화형이면 claude 로 폴백한다 (CI/파이프 호환).
if [ -z "${AGENT:-}" ]; then
    if [ -t 0 ] && [ -t 1 ]; then
        echo ""
        echo "────────────────────────────────────────"
        echo " 연구 에이전트 선택"
        echo "────────────────────────────────────────"
        echo "  1) codex   — OpenAI Codex CLI   (GPT 계열)"
        echo "  2) claude  — Claude Code"
        echo "  3) gemini  — Google Gemini CLI"
        echo ""
        echo "기본값을 고정하려면 .env 에 AGENT=codex 처럼 적어 두거나,"
        echo "실행 시 --agent <이름> 플래그를 사용하세요."
        echo ""
        AGENT_CHOICE=""
        while [ -z "$AGENT_CHOICE" ]; do
            read -r -p "어떤 에이전트로 진행할까요? [1-3, 기본=1] " AGENT_INPUT </dev/tty || AGENT_INPUT=""
            # macOS 기본 bash 3.2 는 ${VAR,,} (소문자 변환) 을 지원하지 않으므로 tr 로 대체한다.
            AGENT_INPUT="$(printf '%s' "$AGENT_INPUT" | tr '[:upper:]' '[:lower:]')"
            case "${AGENT_INPUT:-1}" in
                1|codex)   AGENT_CHOICE="codex" ;;
                2|claude)  AGENT_CHOICE="claude" ;;
                3|gemini)  AGENT_CHOICE="gemini" ;;
                *)
                    echo "   '$AGENT_INPUT' 은 지원되지 않습니다. 1/2/3 또는 claude/codex/gemini 중 하나를 입력하세요." >&2
                    ;;
            esac
        done
        export AGENT="$AGENT_CHOICE"
        echo "✓ 선택: $AGENT"
    else
        # 비대화형 실행(CI 등): 명시 설정이 없으면 claude 로 폴백.
        export AGENT="claude"
        echo "ℹ 비대화형 실행이라 AGENT 를 'claude' 로 폴백합니다. (원하는 값을 --agent 또는 AGENT 환경변수로 지정하세요)" >&2
    fi
fi

AGENT_DISPLAY="$AGENT"

# ── 선행 CLI 존재 검증 ─────────────────────────────────────────────
# 파이프라인이 의존하는 외부 CLI가 모두 설치되어 있는지 미리 확인한다.
# 없으면 sentinel 이 exit 127 로 10회 재시도하면서 4분마다 같은 로그만 쌓이는 문제를
# 방지한다(개선 이전의 가장 흔한 "왜 안 돼?" UX 함정이었음).
missing=0
require_cli() {
    local cmd="$1"
    local hint="$2"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "❌ 필수 CLI 누락: '$cmd'" >&2
        [ -n "$hint" ] && echo "   설치 안내: $hint" >&2
        missing=1
    fi
}

require_cli node "https://nodejs.org/ (또는 nvm/asdf 로 설치)"

# Ralph TUI — 절대경로($RALPH_BIN) 또는 PATH 중 하나에만 있어도 OK.
if [ ! -x "$RALPH_BIN" ] && ! command -v ralph-tui >/dev/null 2>&1; then
    echo "❌ Ralph TUI 를 찾지 못했습니다." >&2
    echo "   확인한 경로: $RALPH_BIN (파일 없음/실행 권한 없음)" >&2
    echo "   그리고 \$PATH 에서도 'ralph-tui' 를 찾지 못했습니다." >&2
    echo "   설치 안내: bun 으로 ralph-tui 를 설치하거나, RALPH_BIN 환경변수로 실제 경로를 지정하세요." >&2
    missing=1
fi

# 선택한 에이전트 CLI
case "$AGENT_DISPLAY" in
    claude) require_cli claude "https://claude.com/claude-code" ;;
    codex)  require_cli codex "https://github.com/openai/codex" ;;
    gemini) require_cli gemini-cli "npm i -g @google/gemini-cli" ;;
esac

if [ "$missing" -eq 1 ]; then
    echo "" >&2
    echo "위 CLI 를 설치한 뒤 다시 실행해 주세요. (그 외 단계는 CLI 가 모두 준비된 뒤에야 의미가 있습니다.)" >&2
    exit 1
fi

echo "=========================================="
echo " 연구 자동화 파이프라인"
echo " 모드:    $MODE"
echo " 에이전트: $AGENT_DISPLAY"
echo " 시작:    $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# === EZproxy/도서관 프록시 초기 설정 ===
# .env가 비어있으면 대화형으로 PROXY_BASE_URL/PROXY_LOGIN_URL 등을 입력받는다.
# 이미 설정되어 있으면 아무 일도 하지 않고 즉시 반환한다.
echo ""
echo "────────────────────────────────────────"
echo " EZproxy 설정 확인"
echo "────────────────────────────────────────"
bash "$SCRIPTS_DIR/setup-proxy.sh"

# === Playwright 인증 확인 ===
echo ""
echo "────────────────────────────────────────"
echo " Playwright 인증 확인"
echo "────────────────────────────────────────"

PROXY_ENABLED_VAL=""
if [ -f "$PROJECT_DIR/.env" ]; then
    PROXY_ENABLED_VAL="$(grep -E '^PROXY_ENABLED=' "$PROJECT_DIR/.env" 2>/dev/null | head -n 1 | cut -d'=' -f2- || true)"
fi

PLAYWRIGHT_AUTH_JSON="$PROJECT_DIR/.playwright-auth.json"
PLAYWRIGHT_PROFILE="$PROJECT_DIR/.playwright-profile"

if [ "$PROXY_ENABLED_VAL" = "false" ]; then
    echo "✓ PROXY_ENABLED=false — EZproxy 인증 스킵 (오픈액세스 논문만 시도)"
elif [ -f "$PLAYWRIGHT_AUTH_JSON" ] || [ -d "$PLAYWRIGHT_PROFILE" ]; then
    echo "✓ Playwright 인증 상태 존재"
else
    echo "⚠ Playwright 인증이 필요합니다."
    echo "  최초 1회 EZproxy 로그인이 필요합니다."
    echo ""
    bash "$SCRIPTS_DIR/setup-auth.sh"
fi

# === resume 모드 ===
if [ "$MODE" = "resume" ]; then
    echo ""
    echo "────────────────────────────────────────"
    echo " 중단된 세션 재개"
    echo "────────────────────────────────────────"
    bash "$SCRIPTS_DIR/sentinel.sh"
    exit 0
fi

# === run 모드: 바로 실행 ===
if [ "$MODE" = "run" ]; then
    if [ ! -f "$PRD_FILE" ]; then
        echo "❌ prd.json이 없습니다. deep 또는 trend 모드로 먼저 설정하세요."
        exit 1
    fi
    echo ""
    echo "✓ 기존 prd.json 사용"
    mkdir -p "$PROJECT_DIR/findings" "$PROJECT_DIR/findings/raw_texts" "$PROJECT_DIR/logs"
    echo ""
    echo "────────────────────────────────────────"
    echo " Ralph 무인 실행 (Sentinel)"
    echo "────────────────────────────────────────"
    bash "$SCRIPTS_DIR/sentinel.sh"
    exit 0
fi

# === deep/trend 모드: 인테이크 → 태스크 생성 → 실행 ===

# Phase 0: 인테이크
echo ""
echo "────────────────────────────────────────"
echo " Phase 0: 인테이크 — 연구 주제 설정"
echo "────────────────────────────────────────"

# deep/trend 모드는 "새 주제 시작" 이라는 명확한 정신모델을 따른다.
# 기존 활성 프로젝트(research-config.json / prd.json / findings/ 등)가 남아있으면
# 무조건 archive/{slug}-{ts}/ 로 자동 보존한 뒤 깨끗한 상태에서 인테이크를 시작한다.
# 기존 작업을 그대로 이어가려면 ./start-research.sh run 또는 resume 을 사용하라.
ARCHIVE_ARGS=(archive --reason "new-topic-start")
if [ -n "$NAME_FLAG" ]; then
    ARCHIVE_ARGS+=(--name "$NAME_FLAG")
fi
echo "deep/trend 모드는 새 주제 시작입니다."
echo "기존 활성 프로젝트가 있으면 archive/ 로 자동 보존합니다."
echo "(기존 작업을 이어가려면 ./start-research.sh run 또는 resume 을 사용하세요.)"
echo ""
if ! node "$SCRIPTS_DIR/lib/project-archive.mjs" "${ARCHIVE_ARGS[@]}"; then
    echo ""
    read -p "⚠ 자동 아카이브 실패. 그래도 계속할까요? 기존 파일이 덮어쓰일 수 있습니다. (y/N) " FORCE_CONTINUE
    if [[ ! "$FORCE_CONTINUE" =~ ^[Yy] ]]; then
        echo "중단했습니다."
        exit 1
    fi
fi
echo ""
echo "새로운 인테이크를 시작합니다."

INTAKE_PROMPT="$SCRIPTS_DIR/intake-prompt-${MODE}.md"
if [ ! -f "$INTAKE_PROMPT" ]; then
    echo "❌ 인테이크 프롬프트를 찾을 수 없습니다: $INTAKE_PROMPT"
    exit 1
fi
cd "$PROJECT_DIR"
echo "에이전트($AGENT_DISPLAY)와 대화하여 연구 주제를 설정합니다."
echo ""
echo "▶ 대화 종료 방법:"
echo "  에이전트가 research-config.json 생성을 알리고, 더 지시하실 내용이"
echo "  없다면 Ctrl+C(또는 /exit)를 눌러 대화를 종료하세요."
echo "  종료 즉시 Phase 1(태스크 자동 생성)과 Phase 2(Ralph 무인 실행)가"
echo "  자동으로 이어집니다."
echo ""
bash "$SCRIPTS_DIR/run-agent.sh" interactive --system-prompt "$INTAKE_PROMPT"

if [ ! -f "$CONFIG_FILE" ]; then
    echo ""
    echo "❌ research-config.json이 생성되지 않았습니다."
    exit 1
fi
echo ""
echo "✓ research-config.json 생성 완료"

# Phase 1: 태스크 생성 (스킬 기반)
echo ""
echo "────────────────────────────────────────"
echo " Phase 1: 태스크 생성 (/research-tasks)"
echo "────────────────────────────────────────"

cd "$PROJECT_DIR"
bash "$SCRIPTS_DIR/run-agent.sh" exec "/research-tasks $MODE"

if [ ! -f "$PRD_FILE" ]; then
    echo "❌ prd.json이 생성되지 않았습니다."
    exit 1
fi

echo ""
echo "✓ prd.json 생성 완료"

# findings 디렉토리 초기화
mkdir -p "$PROJECT_DIR/findings" "$PROJECT_DIR/findings/raw_texts" "$PROJECT_DIR/logs"

# Phase 2: Ralph 무인 실행 (Sentinel)
echo ""
echo "────────────────────────────────────────"
echo " Phase 2: Ralph 무인 실행 (Sentinel)"
echo "────────────────────────────────────────"
echo ""
echo "Sentinel이 Ralph를 모니터링합니다."
echo "프로세스 사망 시 자동 재시작됩니다."
echo ""

bash "$SCRIPTS_DIR/sentinel.sh"

echo ""
echo "=========================================="
echo " 파이프라인 완료"
echo " 종료: $(date '+%Y-%m-%d %H:%M:%S')"
echo " 결과: $PROJECT_DIR/findings/"
echo " Notion 보고서: findings/notion_pages.txt 참조"
echo "=========================================="
