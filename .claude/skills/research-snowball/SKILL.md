---
name: research-snowball
description: "발견된 논문의 참고문헌을 재귀적으로 추적하는 눈덩이(Snowball) 스킬. 기존 findings의 논문에서 참고문헌을 추출하고, 아직 수집되지 않은 논문을 검색하여 빠짐없이 수집한다. '참고문헌 추적', 'snowball', 'reference tracing' 요청 시 사용."
---

# 눈덩이(Snowball) 참고문헌 추적

## 0단계: 선행 조건 검사

이 스킬을 실행하기 전에 **반드시** 아래 명령을 Bash 도구로 실행하라.

```bash
node scripts/lib/pipeline-guard.mjs research-snowball
```

- exit 0 → 통과. 다음 단계로 진행한다.
- exit code 가 0 이 아니면 → stderr 의 사유를 사용자에게 그대로 보고하고
  **실행을 즉시 중단**하라. 필요한 선행 스킬(예: `/research-search`)을
  먼저 수행해야 한다.

Claude Code 에서는 `.claude/settings.json` 의 PreToolUse 훅이 같은 검사를
이벤트 수준에서 추가로 수행한다. 하지만 Codex·Gemini 경로에서는 이 명령이
유일한 방어선이다.

## 인자

`$ARGUMENTS`: findings 파일 경로 (예: `findings/keyword_combination_1.md`)

- 특정 파일 경로가 주어지면 해당 파일의 논문만 대상으로 추적
- `all`이 주어지면 `findings/` 디렉토리 전체의 모든 논문을 대상으로 추적

## 절차

### 1단계: 기존 논문 목록 수집

1. `$ARGUMENTS`로 지정된 findings 파일을 읽는다.
2. 파일 내 모든 논문의 **DOI**와 **제목**을 추출하여 `수집_완료_목록`을 만든다.
3. `findings/` 디렉토리의 다른 파일에서도 DOI 목록을 읽어 중복 제거에 활용한다.

### 2단계: 참고문헌 추출

각 논문에 대해:
1. **스크립트**를 사용하여 논문 전문 + References에 접근한다:
   ```bash
   node scripts/read-paper.js --refs <DOI>
   ```
   결과 파일(`findings/raw_texts/{doi-slug}.md`)을 Read 도구로 읽어서 References 섹션을 추출한다.

   **Playwright MCP 직접 호출(browser_navigate, browser_run_code 등)은 금지** — 타임아웃(5s) 및 토큰 초과(10K 한도) 문제 발생.
2. References/Bibliography 섹션에서 인용된 논문 목록을 추출한다.
3. 각 참고문헌의 **제목**, **저자**, **연도**, **DOI(가능한 경우)**를 기록한다.

### 3단계: 미수집 논문 식별

1. 추출한 참고문헌을 `수집_완료_목록`과 대조한다 (DOI 우선, DOI 없으면 제목으로 매칭).
2. 아직 수집되지 않은 논문을 `미수집_목록`으로 분류한다.

### 4단계: 미수집 논문 검색 및 수집

`미수집_목록`의 각 논문에 대해:
1. **WebSearch**로 논문 제목 + 저자를 검색하여 DOI와 원문 URL을 확인한다.
2. **Semantic Scholar**, **OpenAlex** API로 메타데이터를 확인한다.
3. DOI가 확인되면 **WebFetch**로 DOI 실존을 검증한다.
4. `node scripts/read-paper.js <DOI>` 스크립트로 논문 전문을 읽고 **증거 카드**를 작성한다.
5. 증거 카드를 `findings/snowball_depth{N}.md`에 기록한다.

### 5단계: 재귀 반복

1. 4단계에서 새로 수집한 논문의 참고문헌도 2단계부터 반복한다.
2. 추적 깊이(depth)를 1씩 증가시키며 기록한다.
3. **종료 조건**: 새로운 미수집 논문이 0개가 될 때까지 반복한다.
   - 단, docs/snowball-strategy.md의 깊이 제한 규칙을 따른다.

## 중복 제거 규칙

- DOI가 동일한 논문은 무조건 중복으로 판정한다.
- DOI가 없는 경우, 제목 유사도 90% 이상이면 중복으로 간주한다.
- 중복 발견 시 `"이미 [파일명]에서 수집됨"` 표기 후 스킵한다.
- 매 depth마다 수집 완료 목록을 갱신한다.

## 출력

- `findings/snowball_depth1.md` — 1차 추적 결과
- `findings/snowball_depth2.md` — 2차 추적 결과
- ... (깊이별로 파일 분리)
- 각 파일에는 증거 카드 형식으로 논문 정보를 기록한다.
- 파일 하단에 반드시 `## DOI 목록` 섹션을 포함한다.
- 파일 상단에 `## 커버리지 보고` 섹션을 포함한다:
  ```
  ## 커버리지 보고
  - 추적 시작 논문 수: N개
  - 추출한 참고문헌 총 수: M개
  - 미수집 논문 수: K개
  - 신규 수집 수: L개
  - 현재 추적 깊이: depth N
  - 종료 사유: [미수집 0개 / 깊이 제한 도달]
  ```

## 종료 단계: 체크포인트 저장

스킬 실행을 완료하기 직전에 **반드시** 아래 명령을 Bash 도구로 실행하라.

```bash
node scripts/lib/checkpoint.mjs
```

findings/ 전체 상태를 `findings/_checkpoint.json` 에 기록하여 다음 태스크
(또는 컨텍스트 압축 이후) 가 진행 상황을 이어갈 수 있게 한다. 실패해도
스킬은 정상 종료로 간주한다(베스트 에포트).

Claude Code 에서는 `.claude/settings.json` 의 PreCompact 훅이 같은 일을
컨텍스트 압축 직전에 수행한다. 하지만 Codex·Gemini 경로에서는 이 명령이
유일한 체크포인트 경로다.

## 참고 문서

- `docs/snowball-strategy.md` — 추적 깊이 제한, 중복 판정, 종료 조건 상세
- `CLAUDE.md` — 프로젝트 전체 규칙 (검색 전략, 증거 카드 형식, DOI 검증)
