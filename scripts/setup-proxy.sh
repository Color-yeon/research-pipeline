#!/bin/bash
# 도서관 EZproxy 초기 설정 스크립트
#
# .env 파일이 없거나 PROXY_BASE_URL이 비어있을 때 대화형으로 .env를 생성한다.
# 이미 설정이 완료되어 있으면 아무 일도 하지 않고 즉시 종료한다.
#
# 사용법:
#   bash scripts/setup-proxy.sh         # 자동 감지 (이미 설정되어 있으면 스킵)
#   bash scripts/setup-proxy.sh --force # 강제로 재설정

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

FORCE="${1:-}"

# .env에서 키 값 읽기 (대상 키가 없으면 빈 문자열)
read_env_value() {
    local key="$1"
    [ -f "$ENV_FILE" ] || { echo ""; return; }
    grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -n 1 | cut -d'=' -f2- || true
}

# .env에 키-값 쓰기 (기존 키가 있으면 교체, 없으면 추가)
# 파일 생성/수정 이후에는 항상 chmod 600 으로 소유자 전용 권한을 강제한다.
write_env_value() {
    local key="$1"
    local value="$2"
    if [ ! -f "$ENV_FILE" ]; then
        touch "$ENV_FILE"
        chmod 600 "$ENV_FILE" 2>/dev/null || true
    fi
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        # macOS/BSD sed와 GNU sed 모두 호환되도록 임시 파일 사용
        local tmp
        tmp="$(mktemp)"
        # shellcheck disable=SC2016
        awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} { if ($1==k) { print k"="v } else { print } }' "$ENV_FILE" > "$tmp"
        mv "$tmp" "$ENV_FILE"
    else
        echo "${key}=${value}" >> "$ENV_FILE"
    fi
    # 기존 .env 파일이 세계-읽기 가능 상태였을 수 있으므로 매번 재강제
    chmod 600 "$ENV_FILE" 2>/dev/null || true
}

# 이미 충분히 설정되어 있는지 확인
PROXY_ENABLED_CUR="$(read_env_value PROXY_ENABLED)"
PROXY_BASE_URL_CUR="$(read_env_value PROXY_BASE_URL)"

if [ "$FORCE" != "--force" ]; then
    if [ "$PROXY_ENABLED_CUR" = "false" ]; then
        echo "✓ 프록시 비활성 모드(.env: PROXY_ENABLED=false) — 설정 단계 스킵"
        exit 0
    fi
    if [ -n "$PROXY_BASE_URL_CUR" ]; then
        echo "✓ EZproxy 설정이 이미 존재합니다(.env: PROXY_BASE_URL)"
        echo "  재설정하려면: bash scripts/setup-proxy.sh --force"
        exit 0
    fi
fi

cat <<'EOF'

────────────────────────────────────────
 EZproxy / 도서관 프록시 초기 설정
────────────────────────────────────────

이 파이프라인은 유료 저널 전문에 접근하기 위해 학교/기관의 EZproxy
(혹은 동등한 프록시 시스템)를 경유할 수 있습니다.

본인이 속한 기관에서 제공하는 프록시 정보를 입력해 주세요.
프록시가 없거나 오픈액세스 논문만 다룰 거라면 비활성화로 진행할 수 있습니다.

EOF

read -r -p "프록시를 사용하시겠습니까? (Y/n): " USE_PROXY
USE_PROXY="${USE_PROXY:-Y}"

if [[ "$USE_PROXY" =~ ^[Nn] ]]; then
    write_env_value "PROXY_ENABLED" "false"
    echo ""
    echo "✓ PROXY_ENABLED=false 로 설정했습니다. 오픈액세스 논문만 시도합니다."
    echo "  나중에 프록시를 추가하려면: bash scripts/setup-proxy.sh --force"
    exit 0
fi

cat <<'EOF'

▸ 프록시 베이스 URL을 입력하세요.
  원본 논문 URL을 이 뒤에 그대로 붙여 사용합니다.
  도서관 안내에서 정확한 형식을 확인하세요.
  예시(형식 참고용 — 실제 도메인은 본인 학교 것을 입력):
    https://ezproxy.<학교도메인>/login?url=
    https://<도서관도메인>/proxy?url=
    https://<프록시도메인>/link?url=

EOF
read -r -p "PROXY_BASE_URL: " PROXY_BASE_URL_INPUT
while [ -z "$PROXY_BASE_URL_INPUT" ]; do
    read -r -p "비어있을 수 없습니다. PROXY_BASE_URL: " PROXY_BASE_URL_INPUT
done

cat <<'EOF'

▸ 프록시/도서관 로그인 페이지 URL을 입력하세요.
  자동 재로그인 시 이 페이지로 이동합니다.
  예시: https://<도서관도메인>/login

EOF
read -r -p "PROXY_LOGIN_URL: " PROXY_LOGIN_URL_INPUT
while [ -z "$PROXY_LOGIN_URL_INPUT" ]; do
    read -r -p "비어있을 수 없습니다. PROXY_LOGIN_URL: " PROXY_LOGIN_URL_INPUT
done

cat <<'EOF'

▸ 자동 로그인용 자격 증명을 입력하세요.
  (입력값은 .env 파일에만 저장되며 .gitignore에 포함되어 커밋되지 않습니다.)

EOF
read -r -p "PROXY_PORTAL_ID: " PROXY_PORTAL_ID_INPUT
read -r -s -p "PROXY_PORTAL_PW: " PROXY_PORTAL_PW_INPUT
echo ""

cat <<'EOF'

▸ (선택) 로그인 폼 커스터마이징
  기본 셀렉터(#user-id, #user-pw, button[type="submit"])로 안 되는 경우만
  본인 학교 로그인 페이지의 HTML을 보고 입력하세요. 비워두면 기본값 사용.

EOF
read -r -p "PROXY_LOGIN_ID_SELECTOR (Enter=기본값): " PROXY_LOGIN_ID_SELECTOR_INPUT
read -r -p "PROXY_LOGIN_PW_SELECTOR (Enter=기본값): " PROXY_LOGIN_PW_SELECTOR_INPUT
read -r -p "PROXY_LOGIN_SUBMIT_SELECTOR (Enter=기본값): " PROXY_LOGIN_SUBMIT_SELECTOR_INPUT
read -r -p "PROXY_LOGIN_PRECLICK_SELECTOR (Enter=없음, 예: 사용자 유형 라디오 버튼): " PROXY_LOGIN_PRECLICK_SELECTOR_INPUT

# .env에 일괄 저장
write_env_value "PROXY_ENABLED" "true"
write_env_value "PROXY_BASE_URL" "$PROXY_BASE_URL_INPUT"
write_env_value "PROXY_LOGIN_URL" "$PROXY_LOGIN_URL_INPUT"
write_env_value "PROXY_PORTAL_ID" "$PROXY_PORTAL_ID_INPUT"
write_env_value "PROXY_PORTAL_PW" "$PROXY_PORTAL_PW_INPUT"
write_env_value "PROXY_LOGIN_ID_SELECTOR" "$PROXY_LOGIN_ID_SELECTOR_INPUT"
write_env_value "PROXY_LOGIN_PW_SELECTOR" "$PROXY_LOGIN_PW_SELECTOR_INPUT"
write_env_value "PROXY_LOGIN_SUBMIT_SELECTOR" "$PROXY_LOGIN_SUBMIT_SELECTOR_INPUT"
write_env_value "PROXY_LOGIN_PRECLICK_SELECTOR" "$PROXY_LOGIN_PRECLICK_SELECTOR_INPUT"

# UNPAYWALL_EMAIL 도 비어있으면 추가 안내
UNPAYWALL_CUR="$(read_env_value UNPAYWALL_EMAIL)"
if [ -z "$UNPAYWALL_CUR" ]; then
    echo ""
    echo "▸ Tier 1 API 사용을 위해 Unpaywall 이메일도 설정하면 좋습니다."
    read -r -p "UNPAYWALL_EMAIL (Enter=나중에 직접 입력): " UNPAYWALL_INPUT
    if [ -n "$UNPAYWALL_INPUT" ]; then
        write_env_value "UNPAYWALL_EMAIL" "$UNPAYWALL_INPUT"
    fi
fi

echo ""
echo "✓ 프록시 설정을 .env 파일에 저장했습니다."
echo "  파일: $ENV_FILE (chmod 600 — 소유자 전용)"
echo "  추가 API 키(SEMANTIC_SCHOLAR_API_KEY 등)는 .env.example을 참고하여 직접 추가하세요."
