# 연구 자동화 파이프라인 — 핵심 원칙

이 프로젝트는 Ralph TUI가 오케스트레이션하는 자동 연구 문헌조사 파이프라인이다.
Claude Code가 연구 에이전트로 동작하며, 아래 원칙을 **반드시** 준수해야 한다.

## 첫 행동 규칙 (Hard Rules)

사용자가 "X를 연구해줘", "Y 동향 조사해줘" 류의 연구 의뢰를 새로 던지면, 다음 규칙이 **무조건** 적용된다. 이 규칙은 추측으로 우회할 수 없다.

1. **첫 번째이자 유일한 허용 행동은 `/research-intake` 스킬 호출**이다. 키워드를 임의로 추출해서 `research-config.json`을 쓰지 마라. 사용자와 대화하지 않은 채로 설정을 만드는 것은 파이프라인 위반이다.
2. **`research-config.json`은 `/research-intake` 만 생성·수정한다.** Write/Edit 도구로 config 를 직접 만들려 하면 PreToolUse 가드가 차단한다. 정상 경로는 인테이크가 `findings/_intake_in_progress.json` 마커를 켠 뒤 config 를 쓰고, 마지막에 `findings/_intake_approved.json` 센티넬을 기록하는 흐름이다.
3. **인테이크 승인 전에 `node scripts/fetch-paper.js`, `node scripts/read-paper.js` 를 실행하지 마라.** Bash 가드가 이를 차단한다. 논문 전문 수집은 `/research-search` 안에서만 일어난다.
4. **엔트리포인트는 `./start-research.sh` 이다.** 이 진입점을 쓰지 않고 에이전트 CLI(Claude Code / Codex)를 저장소에서 직접 띄우면 인테이크 프롬프트 주입·자동 아카이빙·센티넬 감시가 전부 빠진다. 즉석에서 시작된 세션에서는 반드시 첫 행동으로 `/research-intake` 를 호출하라.
5. **WebSearch 와 WebFetch 는 DOI/출판처 확인용**이다. 인테이크를 마치지 않은 상태에서 키워드로 논문을 긁어모으는 용도로 쓰면 안 된다. 논문 탐색은 이미 인테이크가 끝난 뒤 `/research-search` 스킬 안에서 일어난다.

이 규칙은 2026-04-17 Codex 가 사용자 의뢰("DNN 과 drug discovery 연구")를 받고 대화 없이 config 를 날조한 뒤 WebSearch + `fetch-paper.js` 로 바로 전문 수집을 시도한 사고를 계기로 도입됐다. 어느 에이전트든 같은 실수를 반복해선 안 된다.

## 핵심 원칙과 그 이유

1. **완전한 문헌 커버리지** — 이 결과로 사용자가 자신의 논문을 작성한다. 관련 논문을 하나라도 놓치면 novelty 주장이 무너지고, 리뷰어가 "이 논문은 왜 고려하지 않았는가"라고 지적하는 순간 논문의 신뢰도가 급격히 떨어진다. 그래서 상위 결과에서 멈추지 않고 다양한 쿼리와 소스를 조합하여 빈틈을 줄여야 한다.

2. **DOI는 검색으로 확인** — LLM은 DOI를 할루시네이션할 수 있다. 존재하지 않는 논문을 인용하면 사용자의 논문 신뢰도가 치명적으로 손상된다. 검색으로 실존이 확인된 논문만 기록한다.

3. **모든 결과는 `findings/` 디렉토리에 한국어 마크다운으로 저장** — Ralph TUI가 태스크마다 fresh 세션을 생성하므로, 이전 세션의 작업 결과는 파일로만 전달된다.

4. **Git 커밋은 하지 않는다** — 사용자가 직접 검토 후 커밋한다.

## 사용 가능한 스킬

| 스킬 | 용도 |
|------|------|
| `/research-intake` | 연구 주제 설정 (사용자 대화 → config 생성) |
| `/research-search` | 다중 소스 논문 검색 + Tier 1/2 즉시 전문 수집 + 증거 카드 작성/보강 |
| `/research-read` | Tier 3(Playwright MCP) 재시도 전용 — 검색 시 Tier 1/2 실패 논문만 처리 |
| `/research-snowball` | 참고문헌 재귀 추적 (눈덩이 방식) |
| `/research-methods` | 방법론 비판적 분석 |
| `/research-analyze` | 통합 분석 + 커버리지 감사 |
| `/research-validate` | 3중 병렬 검증 (커버리지 + 신뢰성 + 일관성) |
| `/research-notion` | 노션에 구조화 기록 |
| `/research-tasks` | prd.json 태스크 자동 생성 |
| `/research-credibility` | 신뢰성 검사 + 사기성 논문 필터링 |
| `/research-deep-read` | 6개 렌즈 병렬 정독 |
| `/research-compare` | 논문 간 교차 비교 |

## 논문 전문 접근

논문 전문은 **검색 단계에서 즉시 수집**한다 (Tier 1 API → Tier 2 브라우저).
- `/research-search`가 논문 발견 즉시 `node scripts/fetch-paper.js`로 전문 확보 시도
- Tier 1/2 실패 논문만 `/research-read`(Tier 3 Playwright MCP)로 후속 처리
- 프록시 URL은 `.env`의 `PROXY_BASE_URL` (예: `https://<프록시호스트>/?url=`) + 원본 URL로 구성된다. 사용자 기관마다 형식이 다르므로 스크립트는 환경변수에서 읽어 동작한다. `PROXY_ENABLED=false`면 프록시 없이 직접 접근한다.
- WebFetch로 논문 본문을 읽지 마라 (검색/DOI확인 전용)
- 상세 절차: `.claude/skills/research-read/docs/proxy-access.md` 참조

## 자동화 훅 (OMC 패턴)

`.claude/settings.json`에 등록된 4개 이벤트(PreCompact, Stop, PreToolUse, PostToolUse)에 걸린 훅 5종이 파이프라인 품질을 자동으로 보장한다. PreToolUse에는 모든 도구 대상의 `pipeline-guard`와 WebSearch 전용 `search-wisdom-pretool` 두 개가, PostToolUse에는 Skill 전용 `validate-prd-post` 한 개가 등록되어 있다.

### 1. Pre-Compact 체크포인트 (`PreCompact`)
컨텍스트 압축 직전에 연구 진행 상황을 `findings/_checkpoint.json`에 자동 저장한다.
- 수집된 논문 수, DOI 목록, 키워드 진행률, 태스크 상태를 기록
- 압축 후 요약이 컨텍스트에 재주입되어 이전 작업을 이어갈 수 있음
- Ralph TUI의 fresh 세션에서도 `_checkpoint.json`을 읽어 연속성 확보

### 2. Verify-Fix 자기 수정 루프 (`Stop`)
검색 태스크 완료 시 커버리지를 자동 점검하고, 미비 시 Stop을 차단한다.
- 5개 소스 전부 검색했는지, 쿼리 변형 5개 이상인지, 최소 논문 수 충족하는지 검증
- 갭 발견 시 구체적 미비 사항을 메시지로 전달하여 추가 검색 유도
- **Circuit Breaker**: 최대 3회 차단 후 무조건 통과 (무한 루프 방지)
- 활성 태스크 추적: `findings/_active_task_research.json` 필요 (검색 스킬이 자동 생성)

### 3. State Machine 파이프라인 가드 (`PreToolUse`)
스킬 실행 전 선행 조건을 검사하여, 필수 아티팩트가 없으면 실행을 차단한다.
- 예: `/research-analyze` 실행 시 findings/에 증거카드 2개 미만이면 차단
- 예: `/research-validate` 실행 시 `integrated_analysis.md` 없으면 차단
- 파이프라인 순서 위반을 프로그래밍적으로 방지

### 4. 검색 지혜 사전 점검 (`PreToolUse`, matcher: `WebSearch`)
WebSearch 호출 직전에 동일 쿼리 반복 여부를 점검하고 누적 기록을 갱신한다.
- 쿼리, 소스(OpenAlex/Semantic Scholar/arXiv 등), 반복 횟수를 `findings/_search_wisdom.json`에 기록
- 동일 쿼리 3회 이상이면 stderr로 경고 (차단은 하지 않음)
- 10개 이상 기록 축적 시 `findings/_search_wisdom.md` 마크다운 리포트 자동 생성
- 효과 측정(결과 수)은 PostToolUse 훅이 `tool_output`을 전달하지 않는 현 사양상 불가능하여, 쿼리 패턴/소스 분포만 학습한다.

### 5. prd.json 스키마 사후 검증 (`PostToolUse`, matcher: `Skill`)
`/research-tasks` 스킬이 종료된 직후 `prd.json`을 ralph-tui 스키마 기준으로 자동 검증한다.
- 검증 로직은 `scripts/lib/validate-prd.mjs` (ralph-tui `dist/index.js`의 `parsePrdJson` 재현)
- 금지 필드(`status`, `subtasks`, `estimated_hours`, `files`) 포함 또는 `passes` 누락 시 Stop을 차단하여 에이전트가 prd.json을 재작성하도록 유도
- 동일 검증을 `sentinel.sh`가 Ralph 실행 직전에 한 번 더 수행하여, 위반이 있으면 Ralph를 띄우지 않고 exit 2로 중단한다 (최후 방어선)
- **Why:** 위반 시 ralph-tui는 "Total tasks: 0"으로 즉시 종료되어 파이프라인이 아무 일도 하지 않은 채 끝나는 문제가 발생한다. 2026-04-17 실제 사고 후 도입됨.

## 모드별 규칙

- **Deep 모드 (심층조사)**: 신뢰도 낮은 논문도 수집하되 `[LOW-CREDIBILITY]` 태그를 부착한다. 관련 논문을 빠짐없이 파악해야 커버리지가 보장되기 때문이다. 사용자가 reference로 실제 사용할지는 별도로 판단한다.
- **Trend 모드 (동향탐구)**: 사기성/predatory 논문은 완전히 제외한다. 과대 포장되거나 신빙성 없는 논문이 섞이면 동향을 잘못 파악하게 되고, 존재하지 않는 트렌드를 실제라고 착각하는 문제가 생긴다.

## 결과 파일 구조

```
findings/                          # 연구 파이프라인 결과물
  {키워드조합}.md               # 키워드별 조사 결과
  {키워드조합}_blocked.json     # 접근 실패 논문 목록
  credibility_report.md         # 신뢰성 검사 결과
  excluded_papers.md            # 제외된 사기성 논문
  deep_read/{논문식별자}.md     # 정독 리포트
  methods_critique.md           # 방법론 분석
  comparison_{주제}.md          # 교차 비교
  integrated_analysis.md        # 통합 분석
  audit_report.md               # 감사 결과
  authors_labs.md               # 핵심 저자/랩
  snowball_{depth}.md           # 참고문헌 추적
```
