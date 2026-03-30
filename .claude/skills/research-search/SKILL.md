---
name: research-search
description: "다중 소스 논문 검색 스킬. WebSearch, OpenAlex, Semantic Scholar, arXiv, Google Scholar를 전부 검색하고, 다중 쿼리 변형과 눈덩이(Snowball) 추적을 수행하여 논문을 빠짐없이 수집한다. 발견한 논문의 증거 카드를 작성한다. '논문 검색', '문헌 조사', '키워드 검색', 'literature search' 요청 시 사용."
---

# 논문 검색 스킬

## 왜 완전한 커버리지가 중요한가

이 검색 결과는 최종적으로 사용자가 자신의 논문을 작성하는 근거가 된다.
논문의 novelty(새로움)는 기존 연구를 빠짐없이 검토했을 때만 보장된다.
만약 관련 논문을 하나라도 놓치면, 리뷰어가 "이 논문을 왜 고려하지 않았는가"라고
지적하는 순간 논문의 신뢰도가 급격히 떨어진다.

그래서 이 스킬의 핵심 목표는 **완전한 문헌 커버리지**이다.
- 상위 검색 결과에서 멈추지 않고, 다양한 쿼리 변형과 소스를 조합하여 빈틈을 줄인다
- "충분히 찾았다"는 판단보다 "더 찾을 수 있는 논문이 남아있는가?"를 자문한다
- 분야가 좁아서 논문이 적더라도, 있는 것은 전부 찾는다

## 입력 ($ARGUMENTS)

`$ARGUMENTS`로 키워드 조합을 받는다.

형식 예시:
- `"키워드A + 키워드B"` -- 단일 키워드 조합
- `"키워드A + 키워드B, 키워드C + 키워드D"` -- 복수 키워드 조합 (쉼표 구분)
- `config` -- `research-config.json`에서 키워드 조합을 읽어옴

`config`가 전달된 경우:
1. `/Users/goomba/dev/research-pipeline/research-config.json` 파일을 읽는다
2. `keywords` 배열에서 키워드 조합을 생성한다
3. 모든 조합에 대해 순차적으로 검색을 수행한다

## 검색 절차

### 1단계: 기존 결과 확인 (중복 제거)

검색 시작 전에 반드시 `findings/` 디렉토리의 기존 파일들을 읽어라.
- 이미 수집된 논문의 DOI 목록을 추출한다
- 이후 검색에서 동일 DOI가 발견되면 "이미 [조합X] findings에서 수집됨"으로 표기하고 스킵한다

### 2단계: 쿼리 변형 생성

주어진 키워드 조합에 대해 **최소 5개 이상**의 쿼리 변형을 만든다:
1. 원래 키워드 (영어)
2. 동의어/유의어 변형
3. 약어/축약어 변형
4. 다른 표현 방식
5. 관련 하위 개념

상세한 변형 전략은 `<skill-dir>/docs/search-strategy.md` 참조.

### 3단계: 5개 소스 전부 검색

모든 쿼리 변형에 대해 아래 5개 소스를 **전부** 검색한다:

1. **일반 웹 검색** (WebSearch)
2. **OpenAlex** (https://openalex.org/)
3. **Semantic Scholar** (https://www.semanticscholar.org/)
4. **arXiv** (https://arxiv.org/)
5. **Google Scholar** (https://scholar.google.com/)

소스별 구체적인 검색 방법은 `<skill-dir>/docs/search-strategy.md` 참조.

**도구 선택 규칙:**
- 모든 논문 검색 → **WebSearch** (API 직접 호출 금지, WebFetch 사용 금지)
  - OpenAlex, Semantic Scholar, arXiv 등 학술 DB는 WebSearch 쿼리로 간접 검색
  - 예: `Semantic Scholar "4D-QSAR"`, `OpenAlex "keyword" research`, `arXiv "keyword"`
- 웹 페이지 (Google Scholar, 출판사 페이지, PMC 등) → **Playwright MCP**
- DOI 검증 → **WebSearch**로 `doi.org/<DOI>` 검색하여 실존 확인

### 4단계: DOI 검증 (할루시네이션 방지)

발견한 모든 논문에 대해:
1. DOI가 있으면 WebSearch로 `doi.org/<DOI>` 검색하여 실존 확인
2. WebSearch로 확인 실패 시 Playwright MCP로 `https://doi.org/<DOI>` 접근하여 재시도
3. DOI가 확인되면 그대로 기록
4. DOI를 찾을 수 없으면 `DOI: 미확인` 기록
5. 두 방법 모두 실패하면 `[DOI 미검증]` 태그 부착

**절대 규칙: 검색으로 찾지 못한 논문을 기억에 의존해서 언급하지 마라.**

### 5단계: 증거 카드 작성

발견한 모든 논문에 대해 증거 카드를 작성한다.
증거 카드 양식은 `<skill-dir>/docs/evidence-card.md` 참조.

### 6단계: Snowball 추적

1. 발견한 논문의 참고문헌(References) 목록을 확인한다
2. 참고문헌 중 아직 수집하지 않은 논문을 검색하여 수집한다
3. 새로 수집한 논문의 참고문헌도 동일하게 추적한다
4. **새로운 논문이 더 이상 발견되지 않을 때까지 반복**한다

Snowball 추적의 상세 절차는 `<skill-dir>/docs/search-strategy.md` 참조.

### 7단계: 커버리지 보고

검색 완료 후 반드시 아래 양식으로 커버리지 보고를 작성한다:

```markdown
## 커버리지 보고
- 사용한 검색 쿼리: [목록]
- 검색한 소스: [목록]
- 검토한 논문 총 수: N개
- 최종 선별 수: M개
- Snowball 추적 깊이: N단계
- 자체 점검: 더 찾을 수 있는 논문이 남아있는가? [예/아니오 + 근거]
```

## 출력

### 메인 결과 파일
`findings/{키워드조합}.md` 에 저장한다.

파일 구조:
```markdown
# {키워드조합} 문헌조사 결과

## 검색 정보
- 검색일: YYYY-MM-DD
- 키워드 조합: ...
- 쿼리 변형: ...

## 발견 논문

### [논문 제목 1]
(증거 카드)

### [논문 제목 2]
(증거 카드)

...

## 커버리지 보고
(위 양식)

## DOI 목록
저자 (연도). 제목. 저널. DOI: https://doi.org/...
```

## 참고 문서

- `<skill-dir>/docs/search-strategy.md` -- 다중 소스 검색 전략 상세
- `<skill-dir>/docs/evidence-card.md` -- 증거 카드 템플릿 및 신뢰도 기준
