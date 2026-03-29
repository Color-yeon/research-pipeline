#!/bin/bash
# Playwright 최초 인증 설정
# 고려대 EZproxy에 로그인하여 쿠키를 persistent profile에 저장
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Playwright 인증 설정 ==="
echo ""
echo "브라우저가 열리면 고려대 EZproxy에 로그인하세요."
echo "로그인 완료 후 브라우저를 닫으면 쿠키가 자동 저장됩니다."
echo ""

cd "$PROJECT_DIR"
node "$SCRIPT_DIR/setup-auth.js"
