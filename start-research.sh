#!/bin/bash
# 연구 자동화 파이프라인 — 진입점
#
# 사용법:
#   ./start-research.sh deep    # 심층 참고문헌 조사 (처음부터)
#   ./start-research.sh trend   # 동향 탐구 (처음부터)
#   ./start-research.sh run     # 기존 prd.json으로 바로 실행
#   ./start-research.sh resume  # 중단된 세션 재개
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

MODE="${1:-}"

if [ -z "$MODE" ] || { [ "$MODE" != "deep" ] && [ "$MODE" != "trend" ] && [ "$MODE" != "run" ] && [ "$MODE" != "resume" ]; }; then
    echo "=========================================="
    echo " 연구 자동화 파이프라인"
    echo "=========================================="
    echo ""
    echo "사용법:"
    echo "  ./start-research.sh deep    # 심층 참고문헌 조사 (처음부터)"
    echo "  ./start-research.sh trend   # 동향 탐구 (처음부터)"
    echo "  ./start-research.sh run     # 기존 prd.json으로 바로 실행"
    echo "  ./start-research.sh resume  # 중단된 세션 재개"
    echo ""
    echo "모드 설명:"
    echo "  deep   — 연구 주제의 키워드 조합 완전탐색 + 실험 설계 지원"
    echo "  trend  — 리뷰 논문 기반 동향 파악 + 최신 트렌드"
    echo "  run    — research-config.json + prd.json이 이미 있을 때 바로 실행"
    echo "  resume — 중단된 세션을 이어서 실행"
    echo ""
    exit 1
fi

echo "=========================================="
echo " 연구 자동화 파이프라인"
echo " 모드: $MODE"
echo " 시작: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# === Playwright 인증 확인 ===
echo ""
echo "────────────────────────────────────────"
echo " Playwright 인증 확인"
echo "────────────────────────────────────────"

PLAYWRIGHT_PROFILE="$PROJECT_DIR/.playwright-profile"

if [ -d "$PLAYWRIGHT_PROFILE" ]; then
    echo "✓ Playwright persistent profile 존재"
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
    echo "Claude와 대화하여 연구 주제를 설정합니다."
    echo "대화가 끝나면 /exit 또는 Ctrl+C로 종료하세요."
    echo ""
    claude --dangerously-skip-permissions --append-system-prompt "$(cat "$INTAKE_PROMPT")"

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
claude --dangerously-skip-permissions -p "/research-tasks $MODE"

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
