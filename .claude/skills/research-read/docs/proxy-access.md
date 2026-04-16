# 논문 전문 접근 — 다단계 폴백 체인

## 개요

논문 전문을 확보하기 위해 3단계 폴백 체인을 사용한다.
비용이 낮은 방법부터 시도하고, 실패하면 다음 단계로 넘어간다.
모든 단계에서 **콘텐츠 검증**을 수행하여 쓰레기 페이지 저장을 방지한다.

## 주 진입점

```bash
node scripts/fetch-paper.js <DOI>
```

이 스크립트가 티어 1(API) + 티어 2(브라우저)를 자동으로 오케스트레이션한다.

---

## 티어 1: API (토큰 0)

### 1a. Unpaywall API

```
GET https://api.unpaywall.org/v2/{doi}?email={UNPAYWALL_EMAIL}
```

- OA 논문의 PDF/HTML URL을 반환
- `.env`에 `UNPAYWALL_EMAIL` 설정 필요 (아무 이메일이나 가능)
- 성공률: OA 논문 ~30% 커버

### 1b. Semantic Scholar API

```
GET https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}?fields=openAccessPdf
```

- `openAccessPdf.url` 필드로 OA PDF 접근
- Rate limit: 100 req/5min (API 키 있으면 완화)
- `.env`에 `SEMANTIC_SCHOLAR_API_KEY` 설정 시 rate limit 완화

### 1c. PubMed Central (PMC)

```
GET https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids={doi}&format=json → PMCID
GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id={pmcid}&rettype=xml → XML 전문
```

- NIH 펀딩 논문은 PMC 등록 의무 → 생의학 분야 커버리지 높음
- XML에서 `<body>` 추출 → 평문 변환

### 1d. CORE API

```
GET https://api.core.ac.uk/v3/search/works/?q=doi:"{doi}"
```

- 전 세계 기관 저장소의 OA 논문 색인
- `.env`에 `CORE_API_KEY` 필요 (core.ac.uk에서 무료 발급)

### 1e. 출판사 TDM API

| 출판사 | API | .env 키 | DOI prefix |
|--------|-----|---------|------------|
| Elsevier | `https://api.elsevier.com/content/article/doi/{doi}` | `ELSEVIER_API_KEY` | 10.1016 |
| Springer | `https://api.springernature.com/openaccess/jats?q=doi:{doi}` | `SPRINGER_API_KEY` | 10.1007, 10.1038 |
| Wiley | `https://api.wiley.com/onlinelibrary/tdm/v1/articles/{doi}` | `WILEY_TDM_TOKEN` | 10.1002 |

- 대학 구독이 있는 경우 사용 가능
- 키가 `.env`에 없으면 자동 스킵

---

## 티어 2: 브라우저 자동화 (토큰 0)

`scripts/read-paper.js`의 기능을 `fetch-paper.js`가 프로그래밍 방식으로 호출한다.

### EZproxy URL 형식

```
https://oca.korea.ac.kr/link.n2s?url=<원본 논문 URL>
```

### 2a. Headless 모드 (기본)

대부분의 출판사에서 작동. Cloudflare가 강한 출판사(ACS)에서는 실패할 수 있다.

### 2b. Headed 모드 (Cloudflare용)

ACS 등 Cloudflare Turnstile을 사용하는 출판사에 자동 에스컬레이션.
GUI 브라우저가 표시되며 봇 탐지 우회 확률이 높다.

### 2c. 직접 접근 (프록시 없이)

프록시 경유 시 Akamai WAF가 차단하는 OA 출판사 등에 사용.

---

## 티어 3: Playwright MCP (토큰 높음)

티어 1+2 모두 실패한 논문에 대해 Claude가 직접 브라우징한다.
상세 절차: `tier3-mcp-protocol.md` 참조.

---

## 콘텐츠 검증

모든 티어에서 추출 후 자동 검증:

| 검사 항목 | 기준 |
|----------|------|
| Cloudflare | "Performing security verification" 등 감지 → 거부 |
| Paywall | "Purchase this article" 등 감지 → 거부 |
| 로그인 | "Log in" + "institution" 조합 → 거부 |
| 최소 길이 | 3000자 미만 → 거부 |
| 섹션 키워드 | Introduction/Results/Discussion 등 0개 → 거부 |
| 점수 | 0-100, 40점 미만 → 거부 |

검증 실패 시 해당 방법의 결과를 폐기하고 다음 티어로 넘어간다.

---

## CLI 명령어 요약

```bash
# 단일 논문 수집 (전체 티어)
node scripts/fetch-paper.js <DOI>

# 배치 수집
node scripts/fetch-paper.js --batch <파일.json>

# API만 시도
node scripts/fetch-paper.js --tier1-only <DOI>

# 기존 파일 검증
node scripts/fetch-paper.js --status

# 실패 파일 재수집
node scripts/fetch-paper.js --refetch

# References 포함 (snowball용 — 기존 스크립트)
node scripts/read-paper.js --refs <DOI>

# EZproxy 인증 갱신
node scripts/setup-auth.js
```

---

## .env 설정

```
# EZproxy 인증 (필수)
KOREA_PORTAL_ID=<포털ID>
KOREA_PORTAL_PW=<비밀번호>

# 티어 1 API (UNPAYWALL_EMAIL만 필수, 나머지는 선택)
UNPAYWALL_EMAIL=<이메일>
SEMANTIC_SCHOLAR_API_KEY=
ELSEVIER_API_KEY=
SPRINGER_API_KEY=
WILEY_TDM_TOKEN=
CORE_API_KEY=
```
