# 연구 자동화 파이프라인 — 에이전트 공용 지침서

이 파일은 Claude Code, OpenAI Codex CLI, Google Gemini CLI 세 가지 에이전트가 공통으로 읽는 프로젝트 지침서이다.
세 에이전트 모두 본 파이프라인의 연구 에이전트로 동작할 수 있으며, Ralph TUI가 오케스트레이션한다.

> **Claude Code 사용자 안내**: `CLAUDE.md`도 함께 읽어도 동일 내용이다.
> **Codex / Gemini CLI 사용자 안내**: 이 파일이 정본(正本)이며, `CLAUDE.md`는 Claude 전용 사항이 소폭 추가된 버전이다.

## 핵심 원칙과 그 이유

1. **완전한 문헌 커버리지** — 이 결과로 사용자가 자신의 논문을 작성한다. 관련 논문을 하나라도 놓치면 novelty 주장이 무너지고, 리뷰어가 "이 논문은 왜 고려하지 않았는가"라고 지적하는 순간 논문의 신뢰도가 급격히 떨어진다. 그래서 상위 결과에서 멈추지 않고 다양한 쿼리와 소스를 조합하여 빈틈을 줄여야 한다.

2. **DOI는 검색으로 확인** — LLM은 DOI를 할루시네이션할 수 있다. 존재하지 않는 논문을 인용하면 사용자의 논문 신뢰도가 치명적으로 손상된다. 검색으로 실존이 확인된 논문만 기록한다.

3. **모든 결과는 `findings/` 디렉토리에 한국어 마크다운으로 저장** — Ralph TUI가 태스크마다 fresh 세션을 생성하므로, 이전 세션의 작업 결과는 파일로만 전달된다.

4. **Git 커밋은 하지 않는다** — 사용자가 직접 검토 후 커밋한다.

## 에이전트 선택과 스킬 파일 배치

본 파이프라인은 **Agent Skills 표준**(2025년 오픈 스펙)을 따른다.
정본 스킬은 `.claude/skills/`에 위치하며, 나머지는 `scripts/sync-agent-assets.mjs`가 자동 파생한다.

| 에이전트 | 스킬 파일 위치 | 비고 |
|---------|-------------|------|
| Claude Code | `.claude/skills/<name>/SKILL.md` | 정본 (Git에 커밋) |
| Codex CLI | `.codex/skills/<name>/SKILL.md` | 자동 파생 (`.gitignore`) |
| Gemini CLI | `.gemini/commands/<name>.toml` | 자동 파생 (`.gitignore`) |

**사람이 편집하는 파일은 `.claude/skills/` 하나뿐이다.** 나머지는 `npm run sync-agents`로 재생성된다.

에이전트 전환은 `.env`의 `AGENT` 변수 또는 `./start-research.sh deep --agent <name>` 플래그로 수행한다.

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

세 에이전트 모두 슬래시 커맨드로 위 스킬을 호출한다.

## 논문 전문 접근

논문 전문은 **검색 단계에서 즉시 수집**한다 (Tier 1 API → Tier 2 브라우저).
- `/research-search`가 논문 발견 즉시 `node scripts/fetch-paper.js`로 전문 확보 시도
- Tier 1/2 실패 논문만 `/research-read`(Tier 3 Playwright MCP)로 후속 처리
- 프록시 URL은 `.env`의 `PROXY_BASE_URL` (예: `https://<프록시호스트>/?url=`) + 원본 URL로 구성된다. 사용자 기관마다 형식이 다르므로 스크립트는 환경변수에서 읽어 동작한다. `PROXY_ENABLED=false`면 프록시 없이 직접 접근한다.
- WebFetch로 논문 본문을 읽지 마라 (검색/DOI확인 전용)
- 상세 절차: `.claude/skills/research-read/docs/proxy-access.md` 참조

## 자동화 훅 — 에이전트별 취급

Claude Code 사용 시에는 `.claude/settings.json`에 등록된 훅들이 추가로 동작한다(PreCompact 체크포인트, Stop verify-fix, PreToolUse pipeline-guard, PreToolUse search-wisdom-pretool).
Codex / Gemini 사용 시에는 훅이 호출되지 않으므로, 같은 품질 보장을 위해 훅 로직의 핵심을 **스킬 본문의 0단계(선행조건 검사)**와 **prd.json의 검증 태스크(verify-fix 대체)**로 이식해 두었다. 따라서 어느 에이전트로 돌려도 동일한 커버리지·순서 보장이 유지된다.

자세한 내용은 `CLAUDE.md`의 "자동화 훅" 섹션 참조.

## 모드별 규칙

- **Deep 모드 (심층조사)**: 신뢰도 낮은 논문도 수집하되 `[LOW-CREDIBILITY]` 태그를 부착한다. 관련 논문을 빠짐없이 파악해야 커버리지가 보장되기 때문이다. 사용자가 reference로 실제 사용할지는 별도로 판단한다.
- **Trend 모드 (동향탐구)**: 사기성/predatory 논문은 완전히 제외한다. 과대 포장되거나 신빙성 없는 논문이 섞이면 동향을 잘못 파악하게 되고, 존재하지 않는 트렌드를 실제라고 착각하는 문제가 생긴다.

## 결과 파일 구조

```
findings/                          # 연구 파이프라인 결과물
  {키워드조합}.md                  # 키워드별 조사 결과
  {키워드조합}_blocked.json        # 접근 실패 논문 목록
  credibility_report.md            # 신뢰성 검사 결과
  excluded_papers.md               # 제외된 사기성 논문
  deep_read/{논문식별자}.md        # 정독 리포트
  methods_critique.md              # 방법론 분석
  comparison_{주제}.md             # 교차 비교
  integrated_analysis.md           # 통합 분석
  audit_report.md                  # 감사 결과
  authors_labs.md                  # 핵심 저자/랩
  snowball_{depth}.md              # 참고문헌 추적
```
