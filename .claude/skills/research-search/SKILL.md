---
name: research-search
description: "다중 소스 논문 검색 + 즉시 전문 수집 스킬. WebSearch, OpenAlex, Semantic Scholar, arXiv, Google Scholar를 전부 검색하고, DOI 확인 즉시 Tier 1/2로 전문을 수집하여 증거 카드를 보강한다. 다중 쿼리 변형과 눈덩이(Snowball) 추적을 수행하여 논문을 빠짐없이 수집한다. '논문 검색', '문헌 조사', '키워드 검색', 'literature search' 요청 시 사용."
---

# 논문 검색 스킬

## 0단계: 선행 조건 검사

이 스킬을 실행하기 전에 **반드시** 아래 명령을 Bash 도구로 실행하라.

```bash
node scripts/lib/pipeline-guard.mjs research-search
```

- exit 0 → 통과. 다음 단계로 진행한다.
- exit code 가 0 이 아니면 → stderr 의 사유를 사용자에게 그대로 보고하고
  **실행을 즉시 중단**하라. 이 스킬은 `research-config.json` 과 인테이크 승인 센티넬
  (`findings/_intake_approved.json`)이 모두 있어야만 실행할 수 있다. 없으면
  반드시 `/research-intake` 를 먼저 실행하여 사용자와 대화로 주제/키워드를
  확정하라. 검색 키워드를 혼자 추측해서 진행하면 안 된다.

Claude Code 에서는 `.claude/settings.json` 의 PreToolUse 훅이 같은 검사를
이벤트 수준에서 추가로 수행한다. 하지만 Codex 경로에서는 이 명령이
유일한 방어선이다.

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

### 0단계: 검색 지혜 참조 + 활성 태스크 등록

**검색 지혜 참조**: `findings/_search_wisdom.md` 파일이 존재하면 읽어서 참조한다.
- 효과적인 패턴 → 우선적으로 시도
- 비효과적인 패턴 → 회피하거나 변형하여 사용
- 소스별 통계 → 결과가 많은 소스부터 검색

**활성 태스크 등록**: 현재 실행 중인 태스크 정보를 `findings/_active_task_research.json`에 기록한다.
이 파일은 Verify-Fix 훅이 검색 태스크인지 판별하는 데 사용된다.

```json
{
  "id": "P1-SEARCH-01",
  "keyword": "현재 검색 키워드",
  "labels": ["search", "phase-1"],
  "started_at": "ISO8601"
}
```

검색 완료 시 이 파일을 삭제한다.

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
- DOI 검증 → **WebSearch**로 `doi.org/<DOI>` 검색하여 실존 확인
- 논문 본문 접근 → **`node scripts/read-paper.js`** 스크립트 사용 (Playwright MCP 직접 호출 금지)

### 4단계: DOI 검증 (할루시네이션 방지)

발견한 모든 논문에 대해:
1. DOI가 있으면 WebSearch로 `doi.org/<DOI>` 검색하여 실존 확인
2. DOI가 확인되면 그대로 기록
3. DOI를 찾을 수 없으면 `DOI: 미확인` 기록
4. 검색 실패 시 `[DOI 미검증]` 태그 부착

**절대 규칙: 검색으로 찾지 못한 논문을 기억에 의존해서 언급하지 마라.**

### 5단계: 증거 카드 작성 + 즉시 전문 수집

발견한 모든 논문에 대해 증거 카드를 작성한다.
증거 카드 양식은 `<skill-dir>/docs/evidence-card.md` 참조.

#### 5-1: 전문 즉시 수집 (Tier 1 → Tier 2)

DOI가 확인된 **각 논문마다** 즉시 전문을 수집한다.
검색과 전문 수집을 분리하지 않고, 논문을 찾는 즉시 전문까지 확보하는 것이 원칙이다.

**절차:**

1. **Tier 1 시도** (API, 토큰 소비 없음):
   ```bash
   node scripts/fetch-paper.js --tier1-only --json <DOI>
   ```
   - 성공 시: `findings/raw_texts/{doi-slug}.md`에 저장됨
   - 실패 시: Tier 2로 진행

2. **Tier 2 시도** (브라우저, 토큰 소비 없음):
   ```bash
   node scripts/fetch-paper.js --tier2-only --json <DOI>
   ```
   - 성공 시: `findings/raw_texts/{doi-slug}.md`에 저장됨
   - 실패 시: 증거 카드에 `[전문 확보 대기 - Tier 3 필요]` 태그 부착

3. **성공 시 즉시 증거 카드 보강**:
   - `findings/raw_texts/{doi-slug}.md`를 읽고 증거 카드의 방법론, 핵심 발견, 한계점 필드를 보강
   - `[전문 확인 - 티어{N}/{source}]` 태그 부착 (예: `[전문 확인 - 티어1/pmc]`)

4. **Tier 1+2 모두 실패 시**:
   - 증거 카드에 `[전문 확보 대기 - Tier 3 필요]` 태그 부착
   - 후속 `/research-read` 스킬에서 Tier 3(Playwright MCP)으로 재시도

**병렬 처리 팁:**
- 논문이 여러 편이면, DOI 목록을 모아서 한 번에 배치 처리할 수도 있다:
  ```bash
  node scripts/fetch-paper.js --tier1-only --json <DOI1> <DOI2> <DOI3>
  ```
- Tier 1 성공률이 낮으면 Tier 2를 일괄 시도한다

**보고 형식:**
```
📄 전문 수집 결과 (이 키워드 조합)
  ✅ Tier 1 성공: N편 (unpaywall: X, pmc: Y, semanticScholar: Z)
  ✅ Tier 2 성공: M편 (ezproxy-headless: A, ezproxy-headed: B)
  ⏳ Tier 3 대기: K편 (후속 /research-read에서 처리)
```

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
- 전문 수집: 성공 X편 (Tier 1: A, Tier 2: B) / Tier 3 대기 Y편
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

## 종료 단계: 커버리지 자가 검증 + 체크포인트 저장

검색을 마치기 직전에 **반드시** 아래 두 명령을 Bash 도구로 실행하라.
이 두 단계는 Claude Code 의 Stop/PreCompact 훅이 담당하던 보장을 Codex
경로에서도 동일하게 유지하기 위한 에이전트 중립 안전망이다.

### 1) 커버리지 자가 검증

```bash
node scripts/lib/coverage-verifier.mjs "<이번 키워드 조합>"
```

- exit 0 → 통과. 다음 단계로 진행한다.
- exit 1 → 갭 발견. stdout 에 표시된 부족 항목(논문 수 / 소스 / 쿼리 변형)을
  읽고, **같은 스킬 안에서** 추가 검색을 수행하여 갭을 해소한 뒤 다시 호출한다.
  3회 시도 후에도 통과 못 하면 findings 파일에 `커버리지 미해결` 메모를 남기고
  종료한다(무한 루프 방지).

Claude Code 에서는 `.claude/settings.json` 의 Stop 훅이 같은 검사를 이벤트
수준에서 추가로 수행하므로 이 명령이 중복처럼 느껴질 수 있다. 그래도 항상
실행하라 — 다른 에이전트 경로에서는 이 호출이 유일한 방어선이다.

### 2) 체크포인트 저장

```bash
node scripts/lib/checkpoint.mjs
```

findings/ 전체 상태를 `findings/_checkpoint.json` 에 기록한다.
Ralph TUI 의 다음 태스크(또는 컨텍스트 압축 후 재주입) 가 이 파일을 참조해
진행 상황을 이어간다. 실패해도 스킬은 계속 진행한다(베스트 에포트).

## 참고 문서

- `<skill-dir>/docs/search-strategy.md` -- 다중 소스 검색 전략 상세
- `<skill-dir>/docs/evidence-card.md` -- 증거 카드 템플릿 및 신뢰도 기준
