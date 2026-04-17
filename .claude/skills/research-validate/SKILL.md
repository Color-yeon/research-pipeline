---
name: research-validate
description: "연구 결과를 3중 병렬 검증하는 스킬. Coverage Auditor, Credibility Checker, Coherence Reviewer 3개 에이전트를 병렬 디스패치하여 독립적으로 검증한 후 통합 판정한다. '검증', '밸리데이션', 'validate', 'final check' 요청 시 사용."
---

# 3중 병렬 검증

## 0단계: 선행 조건 검사

이 스킬을 실행하기 전에 **반드시** 아래 명령을 Bash 도구로 실행하라.

```bash
node scripts/lib/pipeline-guard.mjs research-validate
```

- exit 0 → 통과. 다음 단계로 진행한다.
- exit code 가 0 이 아니면 → stderr 의 사유를 사용자에게 그대로 보고하고
  **실행을 즉시 중단**하라. 필요한 선행 스킬(예: `/research-search`)을
  먼저 수행해야 한다.

Claude Code 에서는 `.claude/settings.json` 의 PreToolUse 훅이 같은 검사를
이벤트 수준에서 추가로 수행한다. 하지만 Codex 경로에서는 이 명령이
유일한 방어선이다.

## 인자

`$ARGUMENTS`: 검증 대상 지정
- **`all`** (기본값): findings/ 전체 검증
- **파일 경로**: 특정 파일만 검증

## 선행 조건

- `findings/integrated_analysis.md` 파일이 존재해야 한다.
- 없으면 "/research-analyze를 먼저 실행하세요"라고 안내하고 중단한다.

## 절차

### 1단계: 사전 확인

1. `findings/integrated_analysis.md` 존재 확인
2. `research-config.json` 읽기 (sub_questions, keywords 파악)
3. `findings/` 디렉토리 전체 파일 목록 수집
4. `findings/credibility_report.md` 존재 여부 확인

### 2단계: 3개 에이전트 병렬 디스패치

다음 3개 Agent를 **동시에** 병렬 디스패치한다 (한 메시지에 3개 Agent tool 호출):

#### Agent 1: Coverage Auditor

`agents/coverage-auditor.md`의 프롬프트를 참고하여 다음 지시를 전달한다:

```
너는 Coverage Auditor이다. findings/ 디렉토리의 연구 결과물에 대해 커버리지 감사를 수행하라.

1. research-config.json을 읽고 sub_questions 목록을 파악하라.
2. findings/ 디렉토리의 모든 .md 파일을 읽어 수집된 논문 목록을 구축하라.
3. 각 sub_question에 대해 답변하는 논문이 최소 2편 이상 있는지 확인하라.
4. 키워드별 논문 수 매트릭스를 작성하라.
5. 5개 소스(WebSearch, OpenAlex, Semantic Scholar, arXiv, Google Scholar)별 검색 여부를 확인하라.

판정 기준:
- PASS: 모든 sub_question에 최소 2편의 관련 논문이 있고, 4개 이상 소스에서 검색 완료
- FAIL: 미답 질문이 존재하거나, 3개 이하 소스에서만 검색됨

결과를 다음 형식으로 작성하라:

## Coverage Audit 결과
### 판정: [PASS/FAIL]
### Sub-Question 커버리지
(각 질문별 관련 논문 수)
### 키워드별 논문 수
(매트릭스)
### 소스 커버리지
(소스별 검색 여부)
### 미비 사항 (FAIL인 경우)
(구체적 누락 내용 + 추가 검색 쿼리 제안)
```

#### Agent 2: Credibility Checker

`agents/credibility-checker.md`의 프롬프트를 참고하여 다음 지시를 전달한다:

```
너는 Credibility Checker이다. findings/ 디렉토리의 논문들에 대해 신뢰성 재검증을 수행하라.

1. findings/ 전체에서 DOI 목록을 추출하라.
2. findings/credibility_report.md가 있으면 읽어서 이미 검사된 DOI 목록을 파악하라.
3. credibility_report에 없는 미검사 논문을 식별하라 (snowball 등에서 추가된 논문).
4. findings/excluded_papers.md의 EXCLUDE 태그 논문이 다른 findings 파일에서 여전히 인용되고 있지 않은지 확인하라.
5. [LOW-CREDIBILITY] 태그 논문이 적절히 표시되어 있는지 확인하라.

판정 기준:
- PASS: 모든 논문이 검사되었고, EXCLUDE 논문이 인용되지 않음
- FAIL: 미검사 논문이 존재하거나, EXCLUDE 논문이 인용됨

결과를 다음 형식으로 작성하라:

## Credibility Check 결과
### 판정: [PASS/FAIL]
### 검사 현황
(전체 DOI 수 / 검사 완료 수 / 미검사 수)
### 미검사 논문 (있는 경우)
(DOI + 제목 목록)
### EXCLUDE 논문 인용 여부
(인용된 경우 위치 표시)
### 미비 사항 (FAIL인 경우)
(구체적 문제 + 해결 방법)
```

#### Agent 3: Coherence Reviewer

`agents/coherence-reviewer.md`의 프롬프트를 참고하여 다음 지시를 전달한다:

```
너는 Coherence Reviewer이다. findings/integrated_analysis.md의 논리적 일관성을 검토하라.

1. findings/integrated_analysis.md를 읽어라.
2. 연구 갭 식별 결과와 실제 수집된 논문을 대조하라:
   - 식별된 갭이 실제로 수집 논문에서 빈 영역인지 확인
   - 수집되었지만 갭으로 표시되지 않은 빈 영역이 있는지 확인
3. "향후 연구 방향" 제안이 실제 식별된 갭에서 논리적으로 도출되는지 확인하라.
4. findings/comparison_*.md가 있다면 상충하는 결과가 해결(설명)되었는지 확인하라.
5. 시간적 흐름 분석이 실제 논문 연도와 일치하는지 확인하라.

판정 기준:
- PASS: 논리적 일관성이 유지되고, 갭/방향/비교가 정합함
- FAIL: 논리적 불일치가 발견되거나, 미해결 상충이 존재

결과를 다음 형식으로 작성하라:

## Coherence Review 결과
### 판정: [PASS/FAIL]
### 갭-논문 정합성
(갭이 실제 빈 영역인지 검증 결과)
### 향후 방향 논리성
(제안이 갭에서 도출되는지)
### 상충 결과 해결 여부
(미해결 상충 목록)
### 미비 사항 (FAIL인 경우)
(구체적 불일치 + 수정 제안)
```

### 3단계: 결과 통합 및 판정

3개 에이전트의 결과를 수집한 후:

1. 각 에이전트의 판정(PASS/FAIL)을 추출한다.
2. **통합 판정**:
   - 3개 모두 PASS → **APPROVED**
   - 1개 이상 FAIL → **NEEDS_REVISION**
3. `findings/validation_report.md`에 통합 리포트를 작성한다:

```markdown
# 연구 결과 검증 리포트

## 통합 판정: [APPROVED / NEEDS_REVISION]

| 검증 영역 | 판정 | 요약 |
|-----------|------|------|
| 커버리지 감사 | PASS/FAIL | 한 줄 요약 |
| 신뢰성 검증 | PASS/FAIL | 한 줄 요약 |
| 일관성 검토 | PASS/FAIL | 한 줄 요약 |

---

(각 에이전트의 상세 결과를 아래에 병합)
```

### 4단계: NEEDS_REVISION인 경우

- FAIL 항목별 구체적 수정 사항을 정리한다.
- 자동 수정은 하지 않는다 (사용자가 판단).
- 다음 태스크에서 참조할 수 있도록 `validation_report.md`에 명확히 기록한다.

## 출력

- `findings/validation_report.md` — 3중 검증 통합 리포트
  - APPROVED: 최종 결과 확정 가능
  - NEEDS_REVISION: 수정 필요 항목 목록

## 종료 단계: 체크포인트 저장

스킬 실행을 완료하기 직전에 **반드시** 아래 명령을 Bash 도구로 실행하라.

```bash
node scripts/lib/checkpoint.mjs
```

findings/ 전체 상태를 `findings/_checkpoint.json` 에 기록하여 다음 태스크
(또는 컨텍스트 압축 이후) 가 진행 상황을 이어갈 수 있게 한다. 실패해도
스킬은 정상 종료로 간주한다(베스트 에포트).

Claude Code 에서는 `.claude/settings.json` 의 PreCompact 훅이 같은 일을
컨텍스트 압축 직전에 수행한다. 하지만 Codex 경로에서는 이 명령이
유일한 체크포인트 경로다.

## 참고 문서

- `agents/coverage-auditor.md` — 커버리지 감사 에이전트 프롬프트
- `agents/credibility-checker.md` — 신뢰성 검증 에이전트 프롬프트
- `agents/coherence-reviewer.md` — 일관성 검토 에이전트 프롬프트
