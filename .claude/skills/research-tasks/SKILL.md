---
name: research-tasks
description: "연구 설정(research-config.json)을 기반으로 Ralph TUI용 prd.json 태스크 파일을 자동 생성하는 스킬. deep 모드와 trend 모드에 따라 다른 태스크 시퀀스를 생성한다. '태스크 생성', 'prd 생성', 'generate tasks' 요청 시 사용."
---

# Ralph TUI 태스크 자동 생성

## 0단계: 선행 조건 검사

이 스킬을 실행하기 전에 **반드시** 아래 명령을 Bash 도구로 실행하라.

```bash
node scripts/lib/pipeline-guard.mjs research-tasks
```

- exit 0 → 통과. 다음 단계로 진행한다.
- exit code 가 0 이 아니면 → stderr 의 사유를 사용자에게 그대로 보고하고
  **실행을 즉시 중단**하라. `prd.json` 은 사용자가 승인한 연구 설정
  (`research-config.json` + `findings/_intake_approved.json`)을 기반으로만
  생성되어야 한다. 인테이크를 거치지 않은 상태에서 태스크를 만들면 파이프라인
  전체가 잘못된 방향으로 돌아간다.

Claude Code 에서는 `.claude/settings.json` 의 PreToolUse 훅이 같은 검사를
이벤트 수준에서 추가로 수행한다. 하지만 Codex 경로에서는 이 명령이
유일한 방어선이다.

## 인자

`$ARGUMENTS`: 연구 모드 지정
- **`deep`**: 심층조사 모드 — 특정 주제에 대한 완전한 문헌조사
- **`trend`**: 동향탐구 모드 — 리뷰 논문 기반 최신 트렌드 탐색

## 절차

### 1단계: research-config.json 읽기

프로젝트 루트의 `research-config.json`을 읽어 연구 설정을 파악한다.

```json
{
  "topic": "연구 주제",
  "keywords": ["키워드1", "키워드2", ...],
  "keyword_combinations": [
    ["키워드1", "키워드2"],
    ["키워드1", "키워드3"],
    ...
  ],
  "mode": "deep" | "trend",
  "language": "ko",
  "max_papers": 100,
  "notion_parent_page": "노션 부모 페이지 ID (선택)"
}
```

### 2단계: 모드별 태스크 시퀀스 생성

#### Deep 모드 (심층조사)

`docs/task-template-deep.md` 참조. 태스크 순서:

1. **Phase 1: 검색 + 전문 수집** — 각 키워드 조합별로 다중 소스 검색, Tier 1/2로 즉시 전문 확보, 증거 카드 작성+보강
2. **Phase 2: 신뢰성 검사** — 수집된 논문의 저널 신뢰도, DOI 검증
3. **Phase 3: Tier 3 재시도** — Tier 1/2 실패 논문을 Playwright MCP로 재시도 (대상 없으면 스킵)
4. **Phase 4: Snowball 추적** — 참고문헌 재귀 추적
5. **Phase 5: 방법론 분석** — Methods 섹션 비판적 분석
6. **Phase 6: 통합 분석** — 전체 결과 종합, 연구 갭 식별, 커버리지 감사
7. **Phase 7: 비교 분석** — 논문 간 결과 비교, 일치/불일치 분석
8. **Phase 8: 노션 기록** — 결과를 노션 DB로 구조화

#### Trend 모드 (동향탐구)

`docs/task-template-trend.md` 참조. 태스크 순서:

1. **Stage 1: 리뷰 논문 탐색** — 최신 리뷰/메타분석 논문 검색 및 선정
2. **Stage 2: 참고문헌 전수조사** — 선정된 리뷰 논문의 참고문헌 전체 수집
3. **Stage 3: 최신 트렌드 분석** — 최근 2~3년 논문 집중 분석, 트렌드 도출
4. **Stage 4: 감사** — 커버리지 감사, 빠진 논문 검증
5. **Stage 5: 노션 기록** — 결과를 노션 DB로 구조화

### 3단계: prd.json 생성

Ralph TUI 형식의 `prd.json`을 생성한다.

> ⚠️ **가장 자주 나는 실수**: 각 태스크에 `"status": "pending"` 을 넣는 것.
> ralph-tui 는 이 필드가 있으면 prd.json 전체를 거부하여 "Total tasks: 0" 으로
> 1초 만에 종료한다. 대신 `"passes": false` 를 쓴다. 아래 정상 예시를 그대로 따라라.

**정상 예시 (이대로 복붙해서 시작하라)**:

```json
{
  "name": "프로젝트 이름",
  "description": "전체 설명 (선택)",
  "userStories": [
    {
      "id": "DEEP-001",
      "title": "태스크 제목",
      "description": "에이전트에게 전달될 상세 프롬프트",
      "acceptanceCriteria": ["수용 기준 1", "수용 기준 2"],
      "passes": false,
      "priority": 1,
      "labels": ["search-read", "phase-1"],
      "dependsOn": []
    }
  ]
}
```

**절대 이렇게 쓰지 마라 (잘못된 예시)**:

```json
{
  "userStories": [
    {
      "id": "DEEP-001",
      "title": "…",
      "status": "pending",          // ❌ 금지 — passes 로 대체
      "subtasks": [ … ],            // ❌ 금지
      "estimated_hours": 2,         // ❌ 금지
      "files": ["…"]                // ❌ 금지
    }
  ]
}
```

#### Ralph TUI 스키마 제약 (**반드시 준수**)

`ralph-tui` 바이너리가 prd.json 로딩 시 스키마를 검증하며, 위반 시 `Total tasks: 0`으로 즉시 종료되어 파이프라인이 실행되지 않는다.

**필수 필드 (userStories[] 각각)**
- `id` (string)
- `title` (string)
- `passes` (boolean) — 신규 태스크는 `false`. 이전 세션의 `status: "pending"` 에 해당하지만 이름이 다르다.

**금지 필드 — 절대 넣지 마라**
- `status` — `passes` 로 대체됨. (`"status": "pending"` → `"passes": false`, `"status": "completed"` → `"passes": true`)
- `subtasks`
- `estimated_hours`
- `files`

**허용되는 필드**
- `description`, `acceptanceCriteria`, `priority`, `labels`, `dependsOn`, `dependencies`, `notes`, 기타 사용자 정의 필드는 모두 통과한다.

#### 저장 직전 자체 검증 (필수)

prd.json 을 저장하기 직전, **스스로 아래 Bash 명령을 실행해** ralph-tui 와 동일한 검증기를 돌려 통과 여부를 확인하라. 위반이 있으면 스스로 수정한 뒤 다시 실행하라. sentinel 이 자동 청소로 구제해 주지만, 저장 시점에 이미 깨끗하면 파이프라인 로그가 훨씬 읽기 쉽다.

```bash
node scripts/lib/validate-prd.mjs prd.json
```

- exit 0 → 통과. 다음 단계로 진행.
- exit 1 → 위에 나열된 오류를 모두 고친 뒤 재저장. 특히 `status` 필드가 섞여 있으면 제거하고 `passes: false/true` 로 교체하라.

### 의존성 설정 규칙

#### Deep 모드 의존성
```
Phase 1 (검색 + 전문 수집) → 의존성 없음 (키워드별 병렬 실행 가능)
Phase 2 (신뢰성 검사) → Phase 1 전체 완료 후
Phase 3 (Tier 3 재시도) → Phase 2 완료 후 (대상 없으면 자동 스킵)
Phase 4 (Snowball) → Phase 3 완료 후
Phase 5 (방법론 분석) → Phase 3 완료 후 (Phase 4와 병렬 가능)
Phase 6 (통합 분석) → Phase 4 + Phase 5 완료 후
Phase 7 (비교 분석) → Phase 6 완료 후
Phase 8 (노션 기록) → Phase 7 완료 후
```

#### Trend 모드 의존성
```
Stage 1 (리뷰 탐색) → 의존성 없음
Stage 2 (참고문헌 전수조사) → Stage 1 완료 후
Stage 3 (최신 트렌드) → Stage 2 완료 후
Stage 4 (감사) → Stage 3 완료 후
Stage 5 (노션 기록) → Stage 4 완료 후
```

### 4단계: 태스크 details 생성

각 태스크의 `details` 필드에는 Claude가 해당 태스크를 실행할 때 필요한 **완전한 프롬프트**를 작성한다:
- 사용할 스킬 명시 (해당 시)
- 검색할 키워드 조합 명시
- 출력 파일 경로 명시
- CLAUDE.md 규칙 준수 사항 리마인드

### 5단계: 키워드 조합별 태스크 분할

`keyword_combinations`의 각 조합에 대해 별도의 태스크를 생성한다:
- Phase 1에서 조합별로 태스크를 나눈다.
- 조합 간 의존성은 없다 (병렬 실행 가능).
- 각 조합의 태스크 ID를 기록하여 Phase 2 의존성에 사용한다.

## 출력

- `prd.json` — Ralph TUI용 태스크 파일 (프로젝트 루트)
- `.ralph-tui/progress.md`에 태스크 생성 기록 추가

## 참고 문서

- `docs/task-template-deep.md` — Deep 모드 태스크 시퀀스 상세
- `docs/task-template-trend.md` — Trend 모드 태스크 시퀀스 상세
- `CLAUDE.md` — 프로젝트 전체 규칙
