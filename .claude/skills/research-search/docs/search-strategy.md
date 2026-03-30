# 다중 소스 검색 전략

## 개요

모든 문헌조사 태스크에서 아래 5개 소스를 **전부** 검색해야 한다.
하나의 소스에서만 검색하고 멈추는 것은 허용되지 않는다.

---

## 소스별 검색 방법

### 1. 일반 웹 검색 (WebSearch)

WebSearch 도구를 사용하여 학술 논문을 검색한다.

쿼리 예시:
- `"키워드A 키워드B" research paper`
- `"키워드A" AND "키워드B" journal article`
- `"키워드A 키워드B" systematic review`
- `"키워드A 키워드B" site:pubmed.ncbi.nlm.nih.gov`

주의:
- 학술 논문 관련 결과를 우선 확인
- 뉴스 기사나 블로그는 제외
- DOI 링크가 포함된 결과를 우선 수집

### 2. OpenAlex

WebSearch로 OpenAlex 사이트 내 논문을 검색한다.

쿼리 예시:
- `site:openalex.org "{키워드A}" "{키워드B}"`
- `OpenAlex "{키워드A} {키워드B}" research paper`

주의:
- API 직접 호출(WebFetch) 금지 — deferred tool 스키마 미로드 문제 발생
- 검색 결과에서 DOI, 제목, 연도, 인용수를 추출

### 3. Semantic Scholar

WebSearch로 Semantic Scholar 사이트 내 논문을 검색한다.

쿼리 예시:
- `site:semanticscholar.org "{키워드A}" "{키워드B}"`
- `Semantic Scholar "{키워드A} {키워드B}"`

Snowball 추적 시:
- `node scripts/read-paper.js --refs <DOI>` 스크립트로 참고문헌 추출
- 스크립트 결과 파일(`findings/raw_texts/`)을 Read 도구로 읽어서 References 확인

주의:
- API 직접 호출(WebFetch) 금지 — rate limit(429) 및 deferred tool 문제 발생
- Playwright MCP 직접 호출 금지 — 토큰 초과 및 타임아웃 문제 발생

### 4. arXiv

WebSearch로 arXiv 내 논문을 검색한다.

쿼리 예시:
- `site:arxiv.org "{키워드A}" "{키워드B}"`
- `arXiv "{키워드A} {키워드B}"`

주의:
- API 직접 호출(WebFetch) 금지 — deferred tool 스키마 미로드 문제 발생
- arXiv ID는 있지만 DOI가 없는 논문도 많음 -- arXiv ID를 기록

### 5. Google Scholar

WebSearch 도구로 검색한다.

쿼리 예시:
- `site:scholar.google.com "키워드A" "키워드B"`
- `Google Scholar "키워드A" "키워드B" research`

주의:
- Google Scholar는 봇 감지가 강하므로 WebSearch로만 접근
- 인용수 정보가 함께 제공되므로 활용
- 같은 논문이 다른 소스에서도 발견될 수 있으므로 DOI로 중복 체크
- 논문 본문이 필요하면 `node scripts/read-paper.js <DOI>` 스크립트 사용

---

## 논문 본문 접근 (스크립트 기반)

논문 본문이 필요할 때는 반드시 `scripts/read-paper.js` 스크립트를 사용한다.
**Playwright MCP 직접 호출(browser_navigate, browser_snapshot, browser_run_code 등)은 금지한다.**

### 왜 스크립트를 사용하는가

| | 스크립트 (`read-paper.js`) | Playwright MCP 직접 호출 |
|---|---|---|
| 결과 저장 | `findings/raw_texts/`에 파일 저장 | MCP 도구 결과로 반환 |
| 토큰 제한 | **없음** (Read로 분할 읽기) | **10,000 토큰** (MCP 프로토콜 한도) |
| 타임아웃 | 45초 (충분) | 5초 (EZproxy에서 초과) |
| 추출 방식 | JS로 본문만 추출 + 80KB 제한 | 전체 HTML 반환 (350K+ 문자) |

### 사용법

```bash
# 단일 논문
node scripts/read-paper.js <DOI>

# 참고문헌 포함 (Snowball용)
node scripts/read-paper.js --refs <DOI>

# 배치 처리
node scripts/read-paper.js --batch findings/<키워드>_blocked.json
```

결과 파일(`findings/raw_texts/`)을 Read 도구로 읽어서 증거 카드를 보강한다.

### 주의사항

- **Playwright MCP 직접 호출 금지** — 타임아웃(5s) 및 토큰 초과(10K 한도) 문제 발생
- **WebFetch 사용 금지** — deferred tool 스키마 미로드 및 rate limit(429) 문제 발생
- 모든 논문 검색은 WebSearch로, 논문 본문 접근은 스크립트로 수행

---

## 쿼리 변형 전략

각 키워드 조합마다 **최소 5개 이상**의 쿼리 변형을 생성해야 한다.

### 변형 유형

1. **원래 키워드 (영어)**: 주어진 그대로의 키워드 조합
2. **동의어/유의어**: 같은 의미의 다른 단어
   - 예: "machine learning" -> "deep learning", "artificial intelligence"
   - 예: "treatment" -> "therapy", "intervention"
3. **약어/축약어**: 분야에서 통용되는 약어
   - 예: "convolutional neural network" -> "CNN"
   - 예: "natural language processing" -> "NLP"
4. **다른 표현 방식**: 같은 개념을 다르게 표현
   - 예: "drug delivery" -> "therapeutic delivery", "pharmaceutical delivery"
   - 예: "climate change effects" -> "global warming impact"
5. **관련 하위 개념**: 상위 개념에 속하는 구체적 개념
   - 예: "renewable energy" -> "solar energy", "wind power", "biomass energy"
   - 예: "cancer" -> "breast cancer", "lung cancer", "colorectal cancer"

### 변형 생성 규칙

- 각 변형이 실제로 다른 논문을 찾을 가능성이 있어야 한다
- 너무 일반적인 변형은 노이즈만 증가시키므로 피한다
- 분야 특화 용어를 반드시 포함한다
- 영어 키워드가 기본이지만, 특정 분야에서 다른 언어 용어가 표준이면 포함

---

## Snowball 추적 절차

### 전방 Snowball (참고문헌 추적)

1. **발견한 핵심 논문의 참고문헌 목록을 확인한다**
   - Semantic Scholar API의 `/references` 엔드포인트 사용
   - 논문 본문의 References 섹션 확인 (전문 접근 가능 시)

2. **참고문헌 중 아직 수집하지 않은 논문을 식별한다**
   - DOI 기준으로 기존 수집 목록과 대조
   - DOI가 없으면 제목+저자로 대조

3. **미수집 논문을 검색하여 수집한다**
   - DOI가 있으면 DOI로 직접 조회
   - DOI가 없으면 제목으로 검색

4. **새로 수집한 논문의 참고문헌도 동일하게 추적한다**
   - 재귀적으로 반복
   - 관련성이 떨어지는 논문(주제와 무관한 일반 방법론 논문 등)은 추적 중단

5. **새로운 관련 논문이 더 이상 발견되지 않을 때까지 반복한다**

### 후방 Snowball (인용 추적)

핵심 논문이 이후에 어떤 논문에서 인용되었는지 확인:
- Semantic Scholar API의 `/citations` 엔드포인트 사용
- 최신 인용 논문에서 추가 발견이 있을 수 있음

### 추적 깊이 기록

- 각 Snowball 단계를 기록한다 (1단계: 원 논문 -> 2단계: 참고문헌 -> 3단계: ...)
- 최종 추적 깊이를 커버리지 보고에 포함한다

---

## 커버리지 자체 점검

검색 완료 후 반드시 아래 질문에 답한다:

1. **5개 소스 전부 검색했는가?**
   - 검색하지 않은 소스가 있으면 즉시 보충

2. **쿼리 변형을 5개 이상 사용했는가?**
   - 변형이 부족하면 추가 변형 생성 후 재검색

3. **Snowball 추적을 수행했는가?**
   - 핵심 논문의 참고문헌을 전수 확인했는지 점검

4. **더 찾을 수 있는 논문이 남아있는가?**
   - "아니오"라고 답하려면 근거가 있어야 함
   - 근거 예: "5개 소스에서 동일한 논문만 반복 발견됨", "Snowball 3단계에서 새로운 관련 논문 0건"

5. **특정 하위 분야가 누락되지 않았는가?**
   - research-config.json의 sub_questions와 대조하여 확인
