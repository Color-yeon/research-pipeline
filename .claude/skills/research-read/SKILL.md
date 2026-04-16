---
name: research-read
description: "검색 단계에서 Tier 1/2로 전문 확보에 실패한 논문을 Tier 3(Playwright MCP)로 재시도하는 스킬. 검색 시 이미 Tier 1/2가 시도되었으므로, 이 스킬은 Tier 3 전용이다. '전문 재시도', 'Tier 3', '남은 논문 읽기' 요청 시 사용."
---

# Tier 3 전문 수집 스킬 (검색 후 재시도 전용)

## 역할

**이 스킬은 `/research-search`에서 Tier 1/2로 전문 확보에 실패한 논문만 처리한다.**

파이프라인 흐름:
1. `/research-search`가 논문 검색 + 즉시 Tier 1/2 전문 수집을 수행
2. Tier 1/2 실패 논문은 `[전문 확보 대기 - Tier 3 필요]` 태그가 부착됨
3. **이 스킬**이 해당 논문들만 골라서 Tier 3(Playwright MCP)로 재시도

## 핵심 원칙

1. **사용자에게 모든 과정을 보여준다** — 각 시도와 결과를 메시지로 보고한다
2. **콘텐츠 검증 결과를 설명한다** — 성공이든 실패든 왜 그런지 사용자가 이해할 수 있게 쓴다
3. **초록만 수집하고 넘어가지 않는다** — 전문을 확보하거나, 실패를 명시적으로 기록한다

## 입력 ($ARGUMENTS)

`$ARGUMENTS`로 아래 중 하나를 받는다:

1. **`pending`** (기본): findings/에서 `[전문 확보 대기 - Tier 3 필요]` 태그가 붙은 논문을 자동 탐색하여 처리
2. **단일 DOI**: `"10.1234/abcd"` — 특정 논문만 Tier 3 시도
3. **DOI 목록** (쉼표 구분): `"10.1234/abcd, 10.5678/efgh"`
4. **`status`**: 전체 전문 수집 현황 요약 (성공/대기/실패 비율)

## 절차

### Step 0: 대상 논문 탐색 (스크립트 강제)

**LLM 자체 판단 금지.** 반드시 아래 스크립트로 대상을 확정한다.
(이전 사이클에서 LLM이 "대상 0편"으로 잘못 판단해 30+편 누락된 사례 있음.)

```bash
# 1) 대상 목록 추출 — findings/*.md를 grep해서 [전문 확보 대기 - Tier 3 필요] 태그가
#    붙은 카드의 DOI를 자동 추출하고, 이미 raw_texts에 정상 저장된 DOI는 자동 제외한다.
node scripts/list-pending-tier3.js

# 2) 배치 입력용 JSON 추출 (DOI 목록 변수에 저장)
node scripts/list-pending-tier3.js --json > /tmp/pending.json
COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/pending.json')).length)")
echo "대상: $COUNT편"
```

`COUNT=0`이면 진짜로 0이다 → 자동 스킵. 1편 이상이면 **모든 항목**을 처리한다.

대상 목록을 사용자에게 보고한다:

```
📄 Tier 3 재시도 대상: N편 (스크립트 확정)
  1. 10.1021/acs.jcim.7b00048 (ACS)
  2. 10.1126/science.xxx (AAAS)
  ...
⚠️ Tier 3은 토큰 소비가 높습니다 (~50K 토큰/편). 총 예상: ~{N*50}K 토큰
```

---

### Step 1: Tier 3 시도 (Playwright MCP)

상세 절차: `<skill-dir>/docs/tier3-mcp-protocol.md`

**사용자에게 진행 상황을 단계별로 보고한다:**

```
🤖 티어 3: Playwright MCP 직접 브라우징 시작
  EZproxy URL: https://oca.korea.ac.kr/link.n2s?url=https://doi.org/10.1021/acs.jcim.7b00048
```

1. `browser_navigate`로 EZproxy URL 접근
2. `browser_snapshot`으로 페이지 상태 확인 → 사용자에게 보고:
   - 로그인 페이지 → "로그인 페이지입니다. 자동 로그인 시도합니다."
   - Cloudflare → "Cloudflare 챌린지입니다. 통과 대기 중..."
   - 논문 페이지 → "논문 페이지에 도착했습니다. 본문 추출 시작합니다."
3. `browser_evaluate`로 섹션별 추출 → 추출된 섹션과 크기를 보고
4. 추출 완료 후 Write 도구로 저장

**성공 시:**
```
✅ 티어 3 성공 (Playwright MCP)
  EZproxy 로그인: 성공
  Cloudflare 우회: 성공 (EZproxy 세션 경유)
  추출된 섹션: Introduction, Materials and Methods, Results, Discussion, Conclusions (5개)
  총 크기: 88.9KB
  검증 점수: 80/100
  → 저장: findings/raw_texts/10.1021_acs.jcim.7b00048.md
```

**실패 시:**
```
❌ 티어 3 실패 — 모든 티어 소진
  사유: Cloudflare 챌린지를 MCP로도 통과하지 못함
  → [전문 불가 - 모든 티어 실패] 태그를 증거 카드에 부착합니다.
```

---

### Step 2: 증거 카드 보강

성공한 논문에 대해 `findings/raw_texts/{doi-slug}.md`를 Read 도구로 읽고:
1. findings 파일의 해당 논문 증거 카드를 보강
2. `[전문 확보 대기 - Tier 3 필요]` 태그 제거
3. `[전문 확인 - 티어3/mcp]` 태그 추가
4. 방법론, 핵심 발견, 한계점 필드 업데이트

실패한 논문:
1. `[전문 확보 대기 - Tier 3 필요]` 태그 제거
2. `[전문 불가 - 모든 티어 실패]` 태그 부착
**절대 `[전문 확보 대기 - Tier 3 필요]`로 남겨두지 않는다.**

---

## 배치 처리 시 리포팅

DOI 여러 개를 처리할 때, 각 논문의 결과를 개별 보고한 뒤 최종 요약을 제공한다:

```
📊 Tier 3 재시도 결과 요약 (3편)

| # | DOI | 출판사 | 결과 | 크기 | Score |
|---|-----|--------|------|------|-------|
| 1 | 10.1021/acs.jcim.7b00048 | ACS | ✅ 성공 | 89KB | 80 |
| 2 | 10.1126/science.xxx | AAAS | ❌ 실패 | - | - |
| 3 | 10.1002/jcc.25678 | Wiley | ✅ 성공 | 45KB | 65 |

Tier 3 성공: 2/3 (67%)
최종 전문 불가: 1편 — 10.1126/science.xxx (Cloudflare 차단)
```

---

## CLI 명령어

```bash
# EZproxy 인증 갱신 (Tier 3 시도 전에 필요할 수 있음)
node scripts/setup-auth.js
```

> **참고**: Tier 1/2 명령어는 `/research-search` 단계에서 이미 사용되었다.
> 이 스킬에서는 Playwright MCP를 직접 사용하므로 별도 CLI가 필요 없다.

## 콘텐츠 검증 기준

| 검사 항목 | 기준 | 실패 시 의미 |
|----------|------|-------------|
| 최소 길이 | 3000자 이상 | 초록/메타만 가져옴 |
| 섹션 키워드 | 1개 이상 | 논문이 아닌 페이지 |
| 점수 | 40점 이상 | 복합적 품질 미달 |
| Cloudflare | 미감지 | 보안 검증 페이지 |
| Paywall | 미감지 | 결제 유도 페이지 |
| 로그인 | 미감지 | 인증 요구 페이지 |

## 참고 문서

- `scripts/fetch-paper.js` — 다단계 오케스트레이터 (티어 1+2)
- `scripts/read-paper.js` — 브라우저 기반 논문 읽기 (티어 2)
- `<skill-dir>/docs/proxy-access.md` — EZproxy 접근 절차 상세
- `<skill-dir>/docs/tier3-mcp-protocol.md` — 티어 3 MCP 청크 추출 프로토콜
