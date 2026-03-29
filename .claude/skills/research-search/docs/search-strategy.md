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

OpenAlex API를 WebFetch로 호출한다.

기본 URL:
```
https://api.openalex.org/works?search={쿼리}&per_page=50&sort=relevance_score:desc
```

필터링 옵션 예시:
```
https://api.openalex.org/works?search={쿼리}&filter=publication_year:>2020&per_page=50
```

DOI로 특정 논문 확인:
```
https://api.openalex.org/works/doi:{DOI}
```

주의:
- `per_page=50`으로 설정하여 충분한 결과를 확인
- 결과의 `doi`, `title`, `publication_year`, `cited_by_count` 필드를 추출
- 페이지네이션이 필요하면 `cursor` 파라미터 사용

### 3. Semantic Scholar

Semantic Scholar API를 WebFetch로 호출한다.

기본 검색:
```
https://api.semanticscholar.org/graph/v1/paper/search?query={쿼리}&limit=50&fields=title,authors,year,venue,citationCount,externalIds,abstract
```

DOI로 논문 조회:
```
https://api.semanticscholar.org/graph/v1/paper/DOI:{DOI}?fields=title,authors,year,venue,citationCount,references,abstract
```

참고문헌 조회 (Snowball용):
```
https://api.semanticscholar.org/graph/v1/paper/DOI:{DOI}/references?fields=title,authors,year,venue,citationCount,externalIds&limit=500
```

주의:
- `fields` 파라미터로 필요한 필드를 명시
- API rate limit에 주의 (초당 100 요청)
- 참고문헌 조회 시 `limit=500`으로 설정

### 4. arXiv

arXiv API를 WebFetch로 호출한다.

검색 URL:
```
http://export.arxiv.org/api/query?search_query=all:{쿼리}&start=0&max_results=50
```

카테고리 필터링:
```
http://export.arxiv.org/api/query?search_query=all:{쿼리}+AND+cat:{카테고리}&max_results=50
```

주의:
- XML 응답이므로 제목, 저자, 초록, DOI 필드를 파싱
- `max_results=50`으로 충분한 결과 확인
- arXiv ID는 있지만 DOI가 없는 논문도 많음 -- arXiv ID를 기록

### 5. Google Scholar

WebSearch 도구를 사용하여 Google Scholar를 검색한다.

쿼리 예시:
- `site:scholar.google.com "키워드A" "키워드B"`
- Google Scholar 검색 결과 페이지 URL을 WebFetch로 접근

주의:
- Google Scholar는 직접 API가 없으므로 웹 검색을 활용
- 인용수 정보가 함께 제공되므로 활용
- 같은 논문이 다른 소스에서도 발견될 수 있으므로 DOI로 중복 체크

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
