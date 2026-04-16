---
name: research-deep-read
description: "한 논문을 6개 분석 렌즈(이론/방법/결과/한계/응용/비판)로 병렬 정독하는 스킬. 각 렌즈별 전문 에이전트를 병렬 디스패치하여 다각도 분석 후 통합 리포트를 작성한다. '정독', '심층 읽기', '다각도 분석', 'deep read' 요청 시 사용."
---

# 다중 렌즈 병렬 정독 스킬

## 0단계: 선행 조건 검사

이 스킬을 실행하기 전에 **반드시** 아래 명령을 Bash 도구로 실행하라.

```bash
node scripts/lib/pipeline-guard.mjs research-deep-read
```

- exit 0 → 통과. 다음 단계로 진행한다.
- exit code 가 0 이 아니면 → stderr 의 사유를 사용자에게 그대로 보고하고
  **실행을 즉시 중단**하라. 필요한 선행 스킬(예: `/research-search`)을
  먼저 수행해야 한다.

Claude Code 에서는 `.claude/settings.json` 의 PreToolUse 훅이 같은 검사를
이벤트 수준에서 추가로 수행한다. 하지만 Codex·Gemini 경로에서는 이 명령이
유일한 방어선이다.

## 개요

한 편의 논문을 6개의 분석 렌즈로 다각도 심층 분석한다. 각 렌즈는 독립된 전문 에이전트 프롬프트를 사용하며, 병렬로 실행하여 효율적이고 포괄적인 분석을 생성한다.

## 인자

- `$ARGUMENTS`: DOI (예: `10.1234/example.5678`) 또는 논문 텍스트 파일 경로 (예: `findings/paper_text.md`)

DOI가 주어지면 논문 전문을 먼저 확보한 후 분석을 시작한다.
파일 경로가 주어지면 해당 파일에서 논문 텍스트를 직접 읽는다.

## 6개 분석 렌즈

| 렌즈 | 에이전트 파일 | 초점 |
|------|--------------|------|
| 이론 | `<skill-dir>/agents/lens-theory.md` | 이론적 프레임워크, 가설 근거, 선행연구 연결 |
| 방법 | `<skill-dir>/agents/lens-methods.md` | 실험 설계, 재현 가능성, 통계 방법 |
| 결과 | `<skill-dir>/agents/lens-results.md` | 핵심 발견, 데이터 해석, 효과 크기 |
| 한계 | `<skill-dir>/agents/lens-limitations.md` | 인정된 한계 + 저자가 놓친 한계, 일반화 가능성 |
| 응용 | `<skill-dir>/agents/lens-application.md` | 실무 적용, 후속 연구 제안, 기술 이전 |
| 비판 | `<skill-dir>/agents/lens-critique.md` | 논리 비약, 과대 주장, 편향, 이해충돌 |

## 워크플로우

### 1단계: 논문 전문 확보

- **DOI가 주어진 경우**:
  1. 스크립트로 논문 전문 확보:
     ```bash
     node scripts/read-paper.js <DOI>
     ```
  2. 결과 파일(`findings/raw_texts/{doi-slug}.md`)을 Read 도구로 읽기
  3. 논문 텍스트가 길면 offset/limit으로 분할 읽기

- **파일 경로가 주어진 경우**:
  1. Read 도구로 파일 내용 읽기
  2. 논문 텍스트가 너무 길면 섹션별로 나눠서 읽기

- **기존 findings에서 확인**:
  1. `findings/raw_texts/` 디렉토리에 해당 논문이 이미 추출되어 있는지 확인
  2. `findings/` 디렉토리에 해당 논문 정보가 있는지 확인
  3. 이미 수집된 데이터가 있으면 활용

**Playwright MCP 직접 호출(browser_navigate, browser_run_code 등)은 금지** — 타임아웃(5s) 및 토큰 초과(10K 한도) 문제 발생.

### 2단계: 논문 텍스트 준비

- 확보된 논문 텍스트를 6개 에이전트에 전달할 형태로 준비
- 논문의 주요 섹션을 식별: 초록, 서론, 방법, 결과, 논의, 결론, 참고문헌

### 3단계: 6개 에이전트 병렬 디스패치

**중요: 6개 분석은 하나의 메시지에서 병렬로 실행한다.**

각 에이전트에게 전달하는 정보:
- 논문 전체 텍스트 (또는 해당 렌즈에 관련된 섹션)
- 에이전트 프롬프트 (`<skill-dir>/agents/lens-*.md`)
- 출력 형식 지정 (JSON)

각 에이전트의 분석 결과를 JSON 형식으로 수집한다.

### 4단계: 결과 수합 및 통합 리포트 작성

6개 렌즈의 분석 결과를 통합하여 아래 구조의 리포트를 생성한다:

```markdown
# 다중 렌즈 심층 분석: {논문 제목}

## 논문 기본 정보
| 항목 | 내용 |
|------|------|
| 제목 | |
| 저자 | |
| 연도 | |
| 저널 | |
| DOI | |

## 이론 분석 (Theory Lens)
{lens-theory 에이전트 결과}

## 방법론 분석 (Methods Lens)
{lens-methods 에이전트 결과}

## 결과 분석 (Results Lens)
{lens-results 에이전트 결과}

## 한계점 분석 (Limitations Lens)
{lens-limitations 에이전트 결과}

## 응용 분석 (Application Lens)
{lens-application 에이전트 결과}

## 비판적 평가 (Critique Lens)
{lens-critique 에이전트 결과}

## 종합 평가
- 논문의 주요 강점:
- 논문의 주요 약점:
- 우리 연구에 대한 시사점:
- 후속 연구 제안:
- 종합 신뢰도 등급: [HIGH/MEDIUM/LOW]
```

## 출력 파일

- **메인 리포트**: `findings/deep_read/{논문식별자}.md`
  - `{논문식별자}`: DOI에서 특수문자를 제거한 형태 또는 논문 제1저자_연도
  - 예: `findings/deep_read/kim_2024_neural_networks.md`

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

- `<skill-dir>/docs/deep-read-guide.md` — 각 렌즈별 분석 기준과 질문 목록
- `<skill-dir>/agents/lens-theory.md` — 이론 렌즈 에이전트
- `<skill-dir>/agents/lens-methods.md` — 방법 렌즈 에이전트
- `<skill-dir>/agents/lens-results.md` — 결과 렌즈 에이전트
- `<skill-dir>/agents/lens-limitations.md` — 한계 렌즈 에이전트
- `<skill-dir>/agents/lens-application.md` — 응용 렌즈 에이전트
- `<skill-dir>/agents/lens-critique.md` — 비판 렌즈 에이전트
