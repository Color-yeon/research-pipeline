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
# 옵션이 없으면 .env 의 AGENT (기본 claude)를 사용한다.
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
  --agent <name>   claude | codex | gemini (.env의 AGENT를 1회용 덮어쓰기)
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

# ── 에이전트 설정 (--agent > .env AGENT > 기본 claude) ──────────────
# run-agent.sh 와 Ralph TUI 가 같은 AGENT 값을 보도록 export 한다.
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
# .env 의 AGENT 는 run-agent.sh / sentinel.sh 가 로드할 때 반영됨.
# AGENT_OVERRIDE 가 없고 환경변수 AGENT 도 없다면 여기서 기본값을 표기만 해둔다.
AGENT_DISPLAY="${AGENT:-$(grep -E '^AGENT=' "$PROJECT_DIR/.env" 2>/dev/null | head -n 1 | cut -d'=' -f2- || echo claude)}"
AGENT_DISPLAY="${AGENT_DISPLAY:-claude}"

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

if [ -f "$CONFIG_FILE" ]; then
    echo "✓ research-config.json이 이미 존재합니다."
    echo ""
    read -p "기존 설정을 사용할까요? (Y/n) " USE_EXISTING
    USE_EXISTING="${USE_EXISTING:-Y}"
    if [[ "$USE_EXISTING" =~ ^[Nn] ]]; then
        echo "새로운 인테이크를 시작하기 전에 기존 프로젝트를 라이브러리로 보존합니다."
        echo ""
        # 자동 아카이브 — --name 이 주어졌으면 그 이름으로, 없으면 config.keywords[0] 기반 자동 슬러그
        if [ -n "$NAME_FLAG" ]; then
            if ! node "$SCRIPTS_DIR/lib/project-archive.mjs" archive --name "$NAME_FLAG" --reason "new-topic-start"; then
                echo ""
                read -p "⚠ 자동 아카이브 실패. 그래도 계속할까요? 기존 파일이 덮어쓰일 수 있습니다. (y/N) " FORCE_CONTINUE
                if [[ ! "$FORCE_CONTINUE" =~ ^[Yy] ]]; then
                    echo "중단했습니다."
                    exit 1
                fi
            fi
        else
            if ! node "$SCRIPTS_DIR/lib/project-archive.mjs" archive --reason "new-topic-start"; then
                echo ""
                read -p "⚠ 자동 아카이브 실패. 그래도 계속할까요? 기존 파일이 덮어쓰일 수 있습니다. (y/N) " FORCE_CONTINUE
                if [[ ! "$FORCE_CONTINUE" =~ ^[Yy] ]]; then
                    echo "중단했습니다."
                    exit 1
                fi
            fi
        fi
        echo ""
        echo "새로운 인테이크를 시작합니다."
    else
        echo "기존 설정을 사용합니다."
        SKIP_INTAKE=true
    fi
fi

if [ "${SKIP_INTAKE:-false}" != "true" ]; then
    INTAKE_PROMPT="$SCRIPTS_DIR/intake-prompt-${MODE}.md"
    if [ ! -f "$INTAKE_PROMPT" ]; then
        echo "❌ 인테이크 프롬프트를 찾을 수 없습니다: $INTAKE_PROMPT"
        exit 1
    fi
    cd "$PROJECT_DIR"
    echo "에이전트($AGENT_DISPLAY)와 대화하여 연구 주제를 설정합니다."
    echo "대화가 끝나면 /exit 또는 Ctrl+C로 종료하세요."
    echo ""
    bash "$SCRIPTS_DIR/run-agent.sh" interactive --system-prompt "$INTAKE_PROMPT"

    if [ ! -f "$CONFIG_FILE" ]; then
        echo ""
        echo "❌ research-config.json이 생성되지 않았습니다."
        exit 1
    fi
    echo ""
    echo "✓ research-config.json 생성 완료"
fi

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
