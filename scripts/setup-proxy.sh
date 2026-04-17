#!/bin/bash
# 도서관 EZproxy + Notion MCP 초기 설정 스크립트
#
# .env 파일이 없거나 각 섹션의 필수 값이 비어있을 때 대화형으로 .env를 생성한다.
# 각 섹션(EZproxy, Notion)은 독립적으로 판정하며, 이미 설정된 섹션은 건너뛰고
# 누락된 섹션만 물어본다. 즉 처음 프록시만 입력했던 사용자가 나중에 다시
# 돌려도 Notion 섹션까지 도달한다.
#
# 사용법:
#   bash scripts/setup-proxy.sh               # 자동 감지 (누락 섹션만 질문)
#   bash scripts/setup-proxy.sh --force       # 모든 섹션 강제로 다시 질문
#   bash scripts/setup-proxy.sh --notion-only # 프록시는 건드리지 않고 Notion 섹션만

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

FORCE="${1:-}"
NOTION_ONLY=""
if [ "$FORCE" = "--notion-only" ]; then
    NOTION_ONLY="1"
    FORCE=""
fi

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

# 프록시 섹션을 실행할지 결정.
# --notion-only → 프록시 섹션 스킵
# 이미 설정되어 있고 --force 아님 → 스킵 (단, exit 하지 않고 Notion 섹션으로 계속 진행)
RUN_PROXY_SECTION=1
if [ "$NOTION_ONLY" = "1" ]; then
    echo "ℹ --notion-only: 프록시 섹션을 건너뛰고 Notion 설정으로 바로 이동합니다."
    RUN_PROXY_SECTION=0
elif [ "$FORCE" != "--force" ]; then
    if [ "$PROXY_ENABLED_CUR" = "false" ]; then
        echo "✓ 프록시 비활성 모드(.env: PROXY_ENABLED=false) — 프록시 섹션 스킵"
        RUN_PROXY_SECTION=0
    elif [ -n "$PROXY_BASE_URL_CUR" ]; then
        echo "✓ EZproxy 설정이 이미 존재합니다(.env: PROXY_BASE_URL) — 프록시 섹션 스킵"
        echo "  프록시를 재설정하려면: bash scripts/setup-proxy.sh --force"
        RUN_PROXY_SECTION=0
    fi
fi

if [ "$RUN_PROXY_SECTION" = "1" ]; then

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
    # exit 0 을 제거 — Notion 섹션까지 계속 진행
    RUN_PROXY_SECTION=0
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

fi  # end of RUN_PROXY_SECTION

# ─────────────────────────────────────────────────────────────
# Notion MCP 설정 (선택)
# ─────────────────────────────────────────────────────────────
# Phase 8 의 /research-notion 스킬이 결과를 노션 DB/페이지로 기록한다.
# 이를 위해 Notion integration token 과 부모 페이지 ID 가 필요하다.
# 이미 설정돼 있거나 사용자가 건너뛰면 이 블록은 아무 일도 하지 않는다.
NOTION_TOKEN_CUR="$(read_env_value NOTION_TOKEN)"
NOTION_PARENT_CUR="$(read_env_value NOTION_PARENT_PAGE_ID)"

if [ -z "$NOTION_TOKEN_CUR" ] || [ -z "$NOTION_PARENT_CUR" ] || [ "$FORCE" = "--force" ]; then
    cat <<'EOF'

────────────────────────────────────────
 Notion MCP 초기 설정 (선택)
────────────────────────────────────────

Phase 8 에서 `/research-notion` 스킬이 연구 결과를 노션 데이터베이스/
페이지로 기록합니다. 사용하려면 다음 두 가지가 필요합니다:

  1) Notion Integration Token
     https://www.notion.so/profile/integrations 에서 "New integration"
     으로 생성한 뒤, 생성된 Internal Integration Token (ntn_... 또는
     secret_... 으로 시작) 을 복사해 두세요.

  2) 부모 페이지 ID
     결과를 담을 Notion 페이지를 하나 만들고, 해당 페이지 우측 상단의
     "..." → "Connect to" 에서 방금 만든 Integration 을 연결합니다.
     페이지 URL 의 마지막 32자(하이픈 포함 가능)가 Page ID 입니다.

노션 기록이 필요 없으면 그냥 Enter 로 건너뛰세요. (나중에 추가하려면
bash scripts/setup-proxy.sh --force 로 재실행하거나 .env 에 직접
NOTION_TOKEN, NOTION_PARENT_PAGE_ID 를 추가하면 됩니다.)

EOF
    read -r -p "노션 MCP 를 설정하시겠습니까? (y/N): " SETUP_NOTION
    if [[ "$SETUP_NOTION" =~ ^[Yy] ]]; then
        read -r -s -p "NOTION_TOKEN (ntn_ 또는 secret_ 으로 시작): " NOTION_TOKEN_INPUT
        echo ""
        while [ -z "$NOTION_TOKEN_INPUT" ]; do
            read -r -s -p "비어있을 수 없습니다. NOTION_TOKEN: " NOTION_TOKEN_INPUT
            echo ""
        done

        read -r -p "NOTION_PARENT_PAGE_ID (하이픈 있어도/없어도 OK): " NOTION_PARENT_INPUT
        while [ -z "$NOTION_PARENT_INPUT" ]; do
            read -r -p "비어있을 수 없습니다. NOTION_PARENT_PAGE_ID: " NOTION_PARENT_INPUT
        done

        # 하이픈 제거해서 32자 bare ID 로 정규화 (Notion API 는 양쪽 다 받지만 일관성 위해)
        NOTION_PARENT_INPUT="$(echo "$NOTION_PARENT_INPUT" | tr -d '-' | tr -d ' ')"

        write_env_value "NOTION_TOKEN" "$NOTION_TOKEN_INPUT"
        write_env_value "NOTION_PARENT_PAGE_ID" "$NOTION_PARENT_INPUT"

        echo ""
        echo "✓ Notion 설정을 .env 에 저장했습니다 (chmod 600, 커밋 안 됨)."
        echo ""
        echo "▸ 실제 MCP 연결:"
        echo "  - Claude Code 사용자가 이미 연결한 Notion 커넥터가 있다면 그대로 쓰면 됩니다."
        echo "  - 없는 경우, .mcp.json 에 포함된 notion 서버 엔트리가 이 NOTION_TOKEN 을 읽어"
        echo "    다음 세션부터 자동으로 Notion MCP 도구(mcp__notion-*)를 제공합니다."
    else
        echo "Notion MCP 설정을 건너뛰었습니다. Phase 8 은 스킵되거나 실패할 수 있습니다."
    fi
fi
