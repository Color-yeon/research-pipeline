#!/bin/bash
# 연구 자동화 파이프라인 — 진입점
#
# 사용법:
#   ./start-research.sh deep    # 심층 참고문헌 조사
#   ./start-research.sh trend   # 동향 탐구
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

if [ -z "$MODE" ] || { [ "$MODE" != "deep" ] && [ "$MODE" != "trend" ]; }; then
    echo "=========================================="
    echo " 연구 자동화 파이프라인"
    echo "=========================================="
    echo ""
    echo "사용법:"
    echo "  ./start-research.sh deep    # 심층 참고문헌 조사"
    echo "  ./start-research.sh trend   # 동향 탐구"
    echo ""
    echo "모드 설명:"
    echo "  deep  — 연구 주제의 키워드 조합 완전탐색 + 실험 설계 지원"
    echo "  trend — 리뷰 논문 기반 동향 파악 + 최신 트렌드"
    echo ""
    exit 1
fi

echo "=========================================="
echo " 연구 자동화 파이프라인"
echo " 모드: $MODE"
echo " 시작: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# === Playwright MCP 인증 확인 (논문 전문 접근용) ===
echo ""
echo "────────────────────────────────────────"
echo " Playwright MCP 인증 확인"
echo "────────────────────────────────────────"

PLAYWRIGHT_PROFILE="$PROJECT_DIR/.playwright-profile"

if [ -d "$PLAYWRIGHT_PROFILE" ]; then
    echo "✓ Playwright persistent profile 존재 — 자동 인증 사용"
else
    echo "⚠ Playwright 인증이 필요합니다."
    echo "  최초 1회 EZproxy 로그인이 필요합니다."
    echo ""
    bash "$SCRIPTS_DIR/setup-auth.sh"
fi

# === Phase 0: 인테이크 대화 ===
echo ""
echo "────────────────────────────────────────"
echo " Phase 0: 인테이크 — 연구 주제 설정"
echo "────────────────────────────────────────"
echo ""

INTAKE_PROMPT="$SCRIPTS_DIR/intake-prompt-${MODE}.md"

if [ ! -f "$INTAKE_PROMPT" ]; then
    echo "❌ 인테이크 프롬프트를 찾을 수 없습니다: $INTAKE_PROMPT"
    exit 1
fi

# Claude Code를 대화 모드로 실행하여 인테이크 수행
# --append-system-prompt로 인테이크 프롬프트 추가 (CLAUDE.md도 함께 로드)
# 사용자와 대화 후 research-config.json을 생성하면 종료
cd "$PROJECT_DIR"
echo "Claude와 대화하여 연구 주제를 설정합니다."
echo "대화가 끝나면 /exit 또는 Ctrl+C로 종료하세요."
echo ""
claude --dangerously-skip-permissions --append-system-prompt "$(cat "$INTAKE_PROMPT")"

# research-config.json 생성 확인
if [ ! -f "$CONFIG_FILE" ]; then
    echo ""
    echo "❌ research-config.json이 생성되지 않았습니다."
    echo "   인테이크 대화에서 설정 파일이 생성되어야 합니다."
    exit 1
fi

echo ""
echo "✓ research-config.json 생성 완료"

# === Phase 1: 태스크 생성 ===
echo ""
echo "────────────────────────────────────────"
echo " Phase 1: 태스크 생성"
echo "────────────────────────────────────────"

GENERATE_SCRIPT="$SCRIPTS_DIR/generate-tasks-${MODE}.sh"
bash "$GENERATE_SCRIPT" "$CONFIG_FILE" "$PRD_FILE"

echo ""
echo "✓ prd.json 생성 완료"

# findings 디렉토리 초기화
mkdir -p "$PROJECT_DIR/findings" "$PROJECT_DIR/logs"

# === Phase 2: Ralph 무인 실행 (Sentinel 포함) ===
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
