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

# ── 에이전트별 대화형 실행 ───────────────────────────────────────────
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
            # Codex CLI는 AGENTS.md 를 자동 로드하므로 베이스 컨텍스트는 이미 주어진다.
            # 추가 인테이크 지시서는 `codex [PROMPT]` 위치 인자로 초기 유저 메시지에
            # 직접 주입한다 — 사용자에게 원문을 노출하지 않고 에이전트가 바로 처리한다.
            # (`codex --help` 의 `[PROMPT]  Optional user prompt to start the session`)
            if [ -n "$sys_prompt_file" ] && [ -f "$sys_prompt_file" ]; then
                exec codex "$(cat "$sys_prompt_file")"
            else
                exec codex
            fi
            ;;

        *)
            echo "❌ 지원하지 않는 AGENT 값: '$AGENT' (claude|codex 중 하나여야 합니다)" >&2
            exit 1
            ;;
    esac
}

# ── 에이전트별 일회성 실행 ───────────────────────────────────────────
run_exec() {
    local prompt="$1"

    case "$AGENT" in
        claude)
            exec claude "${CLAUDE_FLAGS[@]}" -p "$prompt"
            ;;

        codex)
            # Codex CLI 의 non-interactive 실행
            exec codex exec --full-auto "$prompt"
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
