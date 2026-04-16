#!/bin/bash
# Playwright 최초 인증 설정
# 도서관/EZproxy에 로그인하여 쿠키를 storageState에 저장한다.
# 프록시 설정(.env)이 비어있으면 먼저 setup-proxy.sh로 입력받는다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 프록시 비활성화 모드면 인증 자체가 불필요하므로 즉시 종료
PROXY_ENABLED_VAL=""
if [ -f "$PROJECT_DIR/.env" ]; then
    PROXY_ENABLED_VAL="$(grep -E '^PROXY_ENABLED=' "$PROJECT_DIR/.env" 2>/dev/null | head -n 1 | cut -d'=' -f2- || true)"
fi
if [ "$PROXY_ENABLED_VAL" = "false" ]; then
    echo "✓ PROXY_ENABLED=false — EZproxy 인증을 스킵합니다."
    exit 0
fi

# 프록시 설정이 없으면 먼저 setup-proxy.sh를 띄워 .env를 채운다
if [ ! -f "$PROJECT_DIR/.env" ] || ! grep -qE '^PROXY_BASE_URL=.+' "$PROJECT_DIR/.env" 2>/dev/null; then
    bash "$SCRIPT_DIR/setup-proxy.sh"
fi

echo "=== Playwright 인증 설정 ==="
echo ""
echo "브라우저가 열리면 본인 학교/기관 계정으로 도서관/EZproxy에 로그인하세요."
echo "로그인 완료 후 터미널에서 Enter를 누르면 쿠키가 자동 저장됩니다."
echo ""

cd "$PROJECT_DIR"
node "$SCRIPT_DIR/setup-auth.js"
