# Research Pipeline

> 🇰🇷 논문을 쓰기 전에 필요한 모든 백그라운드 논문을 자동으로 모으고, 핵심 인사이트를 뽑아내고, 쓰려는 논문의 방법론까지 분석해주는 연구 문헌조사 자동화 파이프라인입니다.
>
> 🇺🇸 An automated research literature review pipeline that, before you write your paper, collects every relevant background paper, extracts key insights, and analyzes the methodology you're planning to use.

🇰🇷 이 파이프라인은 **Ralph TUI**가 오케스트레이션하고, **Claude Code / OpenAI Codex CLI / Google Gemini CLI** 중 원하는 에이전트가 연구 에이전트로 동작합니다. 세 에이전트 모두 Anthropic 의 공개 **Agent Skills 표준**을 따르므로 동일한 `/research-*` 슬래시 명령이 그대로 동작합니다. 연구자가 다룰 주제만 정해주면, 관련 논문을 빠짐없이 검색·수집하고, 전문을 확보해 방법론·결과·한계를 분석한 뒤, 최종적으로 **노션(Notion) 데이터베이스**로 정리된 리포트까지 산출합니다.

여러 주제를 오가야 한다면 **프로젝트 라이브러리**(`library` / `restore`)가 기존 작업을 자동으로 `archive/` 에 보존하고 언제든 되돌려 줍니다 — 한 저장소 안에서 에이전트 비교 실험이나 주제 전환이 안전합니다.

🇺🇸 The pipeline is orchestrated by **Ralph TUI** with your choice of **Claude Code / OpenAI Codex CLI / Google Gemini CLI** as the research agent. All three follow Anthropic's open **Agent Skills standard**, so the same `/research-*` slash commands work across them. You give it a topic; it finds and collects every relevant paper, retrieves the full text, analyzes methodology/results/limitations, and finally produces a structured report in a **Notion database**.

If you juggle several topics, the **project library** (`library` / `restore`) auto-preserves prior work under `archive/` and brings it back on demand — safe to compare agents or pivot topics inside one repo.

> 📖 이 README는 각 섹션마다 한국어 블록 바로 아래 영어 블록을 나란히 배치합니다. / Each section below shows Korean first, then English.

---

## 🇰🇷 무엇을 해주나요?

1. **문헌 수집** — 하나의 연구 주제에 대해 OpenAlex, Semantic Scholar, arXiv, Google Scholar, 일반 웹 검색을 전부 훑어 관련 논문을 발견합니다.
2. **전문(full-text) 확보** — API(Tier 1) → 브라우저 자동화(Tier 2) → Playwright MCP(Tier 3) 순으로 폴백하며 논문 본문을 실제로 읽어옵니다. 본인이 속한 학교/기관의 EZproxy를 `.env`에 설정하면 유료 저널도 접근합니다(없으면 오픈액세스만 시도).
3. **참고문헌 눈덩이 추적** — 수집한 논문의 reference를 재귀적으로 역추적하여 아직 안 모인 논문을 찾아냅니다.
4. **신뢰성 검사** — Beall's List, predatory journal, Retraction Watch를 교차 확인하여 사기성 논문을 걸러냅니다.
5. **인사이트 추출** — 논문별 증거 카드 작성, 6개 렌즈(이론·방법·결과·한계·응용·비판)로 병렬 정독합니다.
6. **방법론 비판** — 쓰려는 논문과 관련된 선행 연구의 Methods 섹션을 모아 실험 설계 강점·약점, 재현 가능성, 통계 적절성을 평가합니다.
7. **교차 비교 + 통합 분석** — 여러 논문의 방법·결과를 대조표로 묶고 합의점/불일치점, 연구 갭을 식별합니다.
8. **3중 병렬 검증** — 커버리지·신뢰성·일관성을 3개 에이전트가 독립적으로 감사합니다.
9. **노션 기록** — 모든 결과를 구조화된 DB와 논문별 페이지로 노션에 자동 업로드합니다.

## 🇺🇸 What it does

1. **Literature collection** — Sweeps OpenAlex, Semantic Scholar, arXiv, Google Scholar, and general web search to surface every relevant paper for a topic.
2. **Full-text retrieval** — Falls back through API (Tier 1) → headless browser (Tier 2) → Playwright MCP (Tier 3) to actually read paper bodies. Configure your own institution's EZproxy in `.env` to reach paywalled journals (open-access only if no proxy is configured).
3. **Reference snowballing** — Recursively traces references in collected papers to find anything still missing.
4. **Credibility screening** — Cross-checks Beall's List, predatory journals, and Retraction Watch to filter out untrustworthy sources.
5. **Insight extraction** — Builds per-paper evidence cards and performs parallel deep reads through 6 lenses (theory / methods / results / limitations / applications / critique).
6. **Methods critique** — Collects the Methods sections of prior work relevant to your planned paper and evaluates experimental design strengths, reproducibility, and statistical appropriateness.
7. **Cross-comparison + integrated analysis** — Aligns methods/results across papers into comparison tables and identifies agreements, disagreements, and research gaps.
8. **Triple-parallel validation** — Three independent agents audit coverage, credibility, and coherence.
9. **Notion output** — Uploads every result as a structured database with per-paper pages.

---

## 🇰🇷 아키텍처

```
 ┌───────────────────────┐
 │  사용자: 연구 주제 입력   │
 └──────────┬────────────┘
            ▼
 ┌───────────────────────┐       research-config.json
 │  /research-intake      │ ───▶  (주제·키워드·하위질문 확정)
 └──────────┬────────────┘
            ▼
 ┌───────────────────────┐       prd.json
 │  /research-tasks       │ ───▶  (Ralph TUI가 실행할 태스크 목록)
 └──────────┬────────────┘
            ▼
 ┌───────────────────────────────────────────────────┐
 │  Ralph TUI (sentinel.sh가 프로세스 감시·자동 재시작)  │
 │                                                   │
 │  각 태스크마다 fresh 에이전트 세션(claude/codex/     │
 │  gemini)을 띄워 스킬 실행                          │
 │    • /research-search    (검색 + Tier 1/2 전문 수집) │
 │    • /research-read      (Tier 3 재시도)           │
 │    • /research-snowball  (참고문헌 추적)            │
 │    • /research-credibility, /research-methods …   │
 │    • /research-analyze, /research-validate         │
 │    • /research-notion    (최종 기록)               │
 └──────────────────────┬────────────────────────────┘
                        ▼
            findings/ 디렉토리 + Notion DB
```

- **Ralph TUI**는 태스크마다 새 에이전트 세션을 띄우므로, 이전 작업 결과는 `findings/*.md` 파일과 `_checkpoint.json`으로만 전달됩니다.
- 자동화 훅 4종이 `.claude/settings.json`에 등록되어 파이프라인 품질을 강제합니다(자세한 내용은 아래 "자동화 훅" 절).

## 🇺🇸 Architecture

```
 ┌───────────────────────┐
 │  User: research topic │
 └──────────┬────────────┘
            ▼
 ┌───────────────────────┐       research-config.json
 │  /research-intake      │ ───▶  (topic · keywords · sub-questions)
 └──────────┬────────────┘
            ▼
 ┌───────────────────────┐       prd.json
 │  /research-tasks       │ ───▶  (task list Ralph TUI will execute)
 └──────────┬────────────┘
            ▼
 ┌───────────────────────────────────────────────────┐
 │  Ralph TUI (sentinel.sh supervises / auto-restart)│
 │                                                   │
 │  Spins up a fresh agent session per task          │
 │  (claude / codex / gemini)                        │
 │    • /research-search    (search + Tier 1/2 text) │
 │    • /research-read      (Tier 3 retry)           │
 │    • /research-snowball  (reference tracing)      │
 │    • /research-credibility, /research-methods …   │
 │    • /research-analyze, /research-validate        │
 │    • /research-notion    (final export)           │
 └──────────────────────┬────────────────────────────┘
                        ▼
            findings/ directory + Notion DB
```

- **Ralph TUI** spawns a fresh agent session per task, so prior work crosses sessions only via `findings/*.md` files and `_checkpoint.json`.
- Four automation hooks registered in `.claude/settings.json` enforce pipeline quality (see "Automation hooks" below).

---

## 🇰🇷 실행 전 꼭 읽어 주세요 (안전 고지)

이 파이프라인은 **로컬 자동화 도구**이지 SaaS 가 아닙니다. 아래 사항을 이해하신 상태에서 실행해 주세요.

1. **에이전트가 확인 없이 로컬 명령을 실행합니다.**
   `scripts/run-agent.sh`는 Claude Code를 `--dangerously-skip-permissions`, Codex를 `exec --full-auto`로 기동합니다. Ralph TUI가 각 태스크마다 새 세션을 띄우며, 에이전트는 `Bash` / `Write` / `Edit` / `WebFetch` 등을 허용 프롬프트 없이 실행합니다. **공용 PC, 프로덕션 계정, 민감 레포가 있는 홈 디렉토리**에서는 실행하지 마세요. 별도 계정 또는 전용 작업 디렉토리를 권장합니다. 권한 우회 없이 돌리고 싶다면 `CLAUDE_SAFE_MODE=1 ./start-research.sh ...` 로 기동하면 `.claude/settings.json` 의 `permissions.allow`/`deny` 가 적용됩니다(파이프라인 내부 스크립트만 허용, `sudo`/`curl`/`rm -rf /` 등 차단).
2. **웹/논문 콘텐츠가 컨텍스트에 그대로 주입됩니다.** 검색 결과·논문 본문에 숨겨진 프롬프트 인젝션이 있으면 에이전트가 그 지시대로 움직일 수 있습니다. 파이프라인 내부 가드(`pipeline-guard.mjs`, `coverage-verifier.mjs`)와 본 저장소 코드가 모든 인젝션을 막아 주진 못합니다.
3. **자격 증명은 로컬 파일에만 저장됩니다.**
   `.env`(포털 ID/PW, API 키)와 `.playwright-auth.json`(로그인 세션 쿠키)은 자동으로 `chmod 600`이 적용되지만, 백업 도구(Time Machine, iCloud 등)나 다른 사용자가 접근 가능한 공유 경로에는 두지 마세요. 공용 머신에서는 세션 종료 후 `rm -rf .playwright-profile .playwright-auth.json`으로 정리하세요.
4. **유료 저널 접근은 본인 구독 범위 안에서만 사용해 주세요.**
   스크립트에는 브라우저 호환성 유지를 위한 자동화 감지 회피 옵션(`navigator.webdriver` 마스킹, `--disable-blink-features=AutomationControlled` 등)이 포함됩니다. 이는 본인 기관이 구독한 자료의 접근을 위한 것이며, **출판사의 TDM(Text and Data Mining) 정책과 이용약관을 준수**하는 책임은 사용자에게 있습니다. 위반 시 IP 차단·계정 정지·법적 책임이 발생할 수 있습니다.
5. **토큰·API 호출 비용은 사용자가 부담합니다.** Tier 3 재시도는 한 편당 `~50K` 토큰, 검색 단계의 외부 API는 rate-limit을 빠르게 소진할 수 있습니다.
6. 상세한 보안 정책과 제보 경로는 [SECURITY.md](SECURITY.md)를 참고하세요.

## 🇺🇸 Before you run (safety notice)

This pipeline is a **local automation tool**, not a SaaS. Please make sure you understand the following before running it.

1. **The agent executes local commands without per-action confirmation.**
   `scripts/run-agent.sh` launches Claude Code with `--dangerously-skip-permissions` and Codex with `exec --full-auto`. Ralph TUI spins up a fresh session per task, and the agent is free to run `Bash` / `Write` / `Edit` / `WebFetch` with no allow-prompts. **Do not run this on a shared PC, a production account, or a home directory containing sensitive repos.** Prefer a dedicated user account or working directory. To run without permission bypass, use `CLAUDE_SAFE_MODE=1 ./start-research.sh ...` — the `permissions.allow`/`deny` list in `.claude/settings.json` will be enforced (only internal pipeline scripts allowed; `sudo`/`curl`/`rm -rf /` etc. are denied).
2. **Web and paper content is injected directly into the agent context.** Hidden prompt-injection inside a search result or paper body can cause the agent to follow those instructions. The in-pipeline guards (`pipeline-guard.mjs`, `coverage-verifier.mjs`) and this repo's code do not defend against every possible injection.
3. **Credentials live only in local files.**
   `.env` (portal ID/PW, API keys) and `.playwright-auth.json` (session cookies) are automatically set to `chmod 600`, but do not place them under backup tools (Time Machine, iCloud, etc.) or shared paths reachable by other users. On shared machines, clean up after use: `rm -rf .playwright-profile .playwright-auth.json`.
4. **Use paywalled access only within your own subscription.**
   The scripts include automation-detection evasion options (`navigator.webdriver` masking, `--disable-blink-features=AutomationControlled`, etc.) to preserve browser compatibility for legitimate subscription access. **Complying with each publisher's TDM (Text and Data Mining) policy and Terms of Service is your responsibility.** Violations may result in IP bans, account suspension, or legal liability.
5. **Token and API costs are on you.** Tier 3 retries cost `~50K` tokens per paper and the search step can consume external API rate limits quickly.
6. See [SECURITY.md](SECURITY.md) for the full security policy and reporting channel.

---

## 🇰🇷 빠른 시작

### 1. 전제 조건

- **Node.js** (scripts 실행용)
- **연구 에이전트 CLI** — 아래 셋 중 최소 하나 (실행 시 전환 가능)
  - **Claude Code** (`claude`) — 가장 검증된 경로이자 기본값
  - **OpenAI Codex CLI** (`codex`) — Agent Skills 표준으로 자동 호환
  - **Google Gemini CLI** (`gemini-cli`) — TOML 래퍼 경유로 지원
- **Ralph TUI** (`~/.bun/bin/ralph-tui`) — 위 어떤 에이전트와도 함께 동작
- **Playwright** (`npm install`로 설치됨)
- (선택) 본인 학교/기관의 EZproxy 계정 — 유료 저널 전문 접근용. 처음 실행 시 `./start-research.sh`가 대화형으로 프록시 URL과 자격 증명을 입력받아 `.env`에 저장합니다. 없으면 오픈액세스 논문만 시도합니다.
- **Notion MCP 연결** — 결과를 노션에 기록하려면 Notion MCP 서버가 활성화되어 있어야 합니다.

### 2. 설치

```bash
git clone <this-repo>
cd research-pipeline
npm install
```

### 3. EZproxy 설정 (선택)

첫 실행 시 `./start-research.sh`가 자동으로 설정을 묻지만, 미리 준비해 두려면 직접 설정할 수 있습니다:

```bash
# 대화형 설정 (권장)
bash scripts/setup-proxy.sh

# 또는 템플릿 복사 후 직접 편집
cp .env.example .env
# .env에서 PROXY_BASE_URL, PROXY_LOGIN_URL, PROXY_PORTAL_ID/PW 등을 채우세요
```

프록시 URL 형식은 기관마다 다릅니다 (`https://<프록시호스트>/?url=`, `https://<도서관>/proxy?url=` 등). 본인 학교 도서관 안내에서 정확한 패턴을 확인하세요. 프록시를 사용하지 않으려면 `PROXY_ENABLED=false`로 두면 됩니다.

### 4. 실행

```bash
# 모드 선택해서 처음부터 시작
./start-research.sh deep     # 심층 참고문헌 조사 (특정 주제 완전 탐색)
./start-research.sh trend    # 동향 탐구 (최신 트렌드 파악)

# 이미 prd.json이 있을 때 바로 실행
./start-research.sh run

# 중단된 세션 이어서 실행
./start-research.sh resume

# 에이전트 전환 (기본값은 .env의 AGENT, 없으면 claude)
./start-research.sh deep --agent codex
./start-research.sh deep --agent gemini

# 프로젝트 라이브러리 — 이전 주제 보존 · 목록 · 복원
./start-research.sh library                 # 아카이브된 프로젝트 목록 보기
./start-research.sh restore <slug>          # 과거 프로젝트를 루트로 복원
./start-research.sh deep --name my-topic-v1 # 기존 작업을 이 이름으로 자동 보존 후 새 주제 시작
```

장시간 실행되므로 `tmux` 안에서 돌리는 것을 권장합니다:

```bash
tmux new -s research
./start-research.sh deep
# Ctrl+B, D → detach (백그라운드 유지)
```

### 5. 결과 확인

파이프라인이 끝나면 다음이 생성됩니다:

- `findings/` 디렉토리의 마크다운 리포트들
- `findings/raw_texts/` 안의 논문 전문(추출된 텍스트)
- 노션 워크스페이스 안에 자동 생성된 DB와 논문별 페이지

## 🇺🇸 Quick start

### 1. Prerequisites

- **Node.js** (for scripts)
- **A research-agent CLI** — at least one of the following (switchable at run time)
  - **Claude Code** (`claude`) — the most battle-tested path and the default
  - **OpenAI Codex CLI** (`codex`) — natively compatible via the Agent Skills standard
  - **Google Gemini CLI** (`gemini-cli`) — supported through an auto-generated TOML wrapper
- **Ralph TUI** (`~/.bun/bin/ralph-tui`) — works with any of the agents above
- **Playwright** (installed via `npm install`)
- (Optional) An EZproxy account from your own institution, for paywalled journal access. On first run, `./start-research.sh` will interactively ask for the proxy URL and credentials and save them to `.env`. Without it, the pipeline only tries open-access papers.
- **Notion MCP connection** — required only if you want to push results to Notion.

### 2. Install

```bash
git clone <this-repo>
cd research-pipeline
npm install
```

### 3. Configure EZproxy (optional)

`./start-research.sh` will prompt for proxy details on first run, but you can also configure it up front:

```bash
# Interactive setup (recommended)
bash scripts/setup-proxy.sh

# Or copy the template and edit by hand
cp .env.example .env
# Fill in PROXY_BASE_URL, PROXY_LOGIN_URL, PROXY_PORTAL_ID/PW, etc.
```

Proxy URL shapes vary by institution (`https://<proxy-host>/?url=`, `https://<library>/proxy?url=`, …). Check your library's docs for the exact pattern. If you don't want to use a proxy at all, set `PROXY_ENABLED=false`.

### 4. Run

```bash
# Start from scratch in a chosen mode
./start-research.sh deep     # deep literature sweep on a specific topic
./start-research.sh trend    # trend scan for a field

# Run immediately with an existing prd.json
./start-research.sh run

# Resume an interrupted session
./start-research.sh resume

# Switch agent (defaults to AGENT in .env, or `claude` when unset)
./start-research.sh deep --agent codex
./start-research.sh deep --agent gemini

# Project library — preserve, list, restore past topics
./start-research.sh library                 # show archived projects
./start-research.sh restore <slug>          # bring a past project back to root
./start-research.sh deep --name my-topic-v1 # auto-archive current work under this name, then start new topic
```

Runs are long, so use `tmux`:

```bash
tmux new -s research
./start-research.sh deep
# Ctrl+B, D → detach (keeps running)
```

### 5. Results

After completion you'll find:

- Markdown reports under `findings/`
- Extracted full texts under `findings/raw_texts/`
- An auto-generated Notion database and per-paper pages in your workspace

---

## 🇰🇷 에이전트 선택 (Claude / Codex / Gemini)

이 파이프라인은 Anthropic의 **Agent Skills 공개 표준**을 채택해 세 가지 에이전트
CLI에서 동일한 슬래시 명령(`/research-*`)을 수행할 수 있습니다.

### 정본과 파생물

스킬 정본은 `.claude/skills/` 하나뿐이며, `npm install` 또는
`npm run sync-agents` 실행 시 `scripts/sync-agent-assets.mjs` 가 나머지 에이전트용
파생물을 자동 생성합니다.

```
.claude/skills/<name>/SKILL.md       ← 정본 (사람이 편집, Git 커밋)
  ↓ sync
.codex/skills/<name>/                ← Codex CLI 전용 (자동 생성, .gitignore)
.gemini/commands/<name>.toml         ← Gemini CLI 래퍼 (자동 생성, .gitignore)
```

파생물은 **직접 편집하지 마세요** — 다음 sync 때 덮어쓰여집니다. 스킬을 수정하려면
언제나 `.claude/skills/` 의 원본을 편집한 뒤 `npm run sync-agents` 를 재실행하세요.

### 전환 방법

| 수단 | 예시 | 우선순위 |
|------|------|---------|
| 일회성 플래그 | `./start-research.sh deep --agent codex` | 1순위 |
| `.env` 의 `AGENT` 변수 | `AGENT=gemini` | 2순위 |
| 지정 없음 | — | 기본값 `claude` |

### 에이전트별 설치

| 에이전트 | 설치 명령 |
|---------|----------|
| Claude Code | 공식 안내: https://claude.com/claude-code |
| OpenAI Codex CLI | `npm i -g @openai/codex` (또는 공식 안내의 최신 설치법) |
| Google Gemini CLI | `npm i -g @google/gemini-cli` (명령어 `gemini-cli`) |

세 에이전트 모두 각자의 로그인/API 키 절차를 먼저 완료해야 합니다 — 본 파이프라인은
로그인 자체를 대행하지 않습니다.

### 호환성 노트

- Claude Code 는 `CLAUDE.md` 를, Codex·Gemini 는 `AGENTS.md` 를 자동으로 읽습니다.
  두 파일은 같은 원칙을 담고 있으며 `AGENTS.md` 가 세 에이전트 공용 본문입니다.
- Ralph TUI 는 `run-agent.sh` 래퍼와 `--agent` 플래그를 통해 어떤 에이전트도
  오케스트레이션할 수 있습니다 (`ralph-tui plugins agents` 참고).
- 진행 중인 Ralph 세션은 resume 시 **해당 세션이 시작된 에이전트**를 그대로
  이어받습니다 (중간 전환은 지원하지 않음).

## 🇺🇸 Agent selection (Claude / Codex / Gemini)

This pipeline adopts Anthropic's **open Agent Skills standard**, so the same
`/research-*` slash commands work across three agent CLIs.

### Source of truth vs. derivatives

The only skill source of truth is `.claude/skills/`. Running `npm install` or
`npm run sync-agents` invokes `scripts/sync-agent-assets.mjs`, which generates
derivatives for the other agents:

```
.claude/skills/<name>/SKILL.md       ← source of truth (editable, committed)
  ↓ sync
.codex/skills/<name>/                ← Codex CLI copies (auto-generated, gitignored)
.gemini/commands/<name>.toml         ← Gemini CLI wrappers (auto-generated, gitignored)
```

**Never edit derivatives** — they are overwritten on the next sync. To modify a
skill, always edit the source under `.claude/skills/` and re-run
`npm run sync-agents`.

### How to switch

| Mechanism | Example | Priority |
|-----------|---------|----------|
| One-shot flag | `./start-research.sh deep --agent codex` | 1st |
| `AGENT` in `.env` | `AGENT=gemini` | 2nd |
| Nothing set | — | defaults to `claude` |

### Install each agent

| Agent | Install |
|-------|---------|
| Claude Code | Official docs: https://claude.com/claude-code |
| OpenAI Codex CLI | `npm i -g @openai/codex` (or whatever the official docs recommend) |
| Google Gemini CLI | `npm i -g @google/gemini-cli` (binary name `gemini-cli`) |

You still need to complete each agent's own login / API-key flow — the pipeline
does not proxy authentication.

### Compatibility notes

- Claude Code auto-reads `CLAUDE.md`; Codex and Gemini auto-read `AGENTS.md`.
  Both files share the same core rules; `AGENTS.md` is the cross-agent source.
- Ralph TUI can orchestrate any of the three via the `run-agent.sh` wrapper and
  `--agent` flag (see `ralph-tui plugins agents`).
- When resuming a Ralph session, the **agent the session was started with** is
  preserved (mid-session switching is not supported).

---

## 🇰🇷 프로젝트 라이브러리 (여러 주제를 안전하게 오가기)

이 파이프라인은 `findings/` · `research-config.json` · `prd.json` 을 루트에 직접 둡니다. 그래서 새 주제를 시작하면 이전 작업이 덮어쓰일 위험이 있습니다. **프로젝트 라이브러리**는 이 문제를 자동으로 해결해, 새 주제를 시작할 때 기존 작업을 `archive/` 로 보존하고 언제든 되돌릴 수 있게 합니다.

### 동작 방식

- **자동 아카이브** — `./start-research.sh deep` (또는 `trend`) 실행 중 "기존 설정을 사용할까요? (Y/n)" 에 `n` 이라고 답하면, 루트의 현재 상태(`research-config.json`, `prd.json`, `findings/`, `.ralph-tui/` 의 재사용 가능한 일부)가 `archive/{slug}-{YYYYMMDD-HHMMSS}/` 로 이동합니다.
- **Slug 자동 생성** — 기본값은 `research-config.json` 의 첫 키워드를 kebab-case 로 변환 (예: `4D-QSAR` → `4d-qsar`). `--name my-v1` 옵션으로 덮어쓸 수 있습니다.
- **라이브러리 목록** — `./start-research.sh library` 로 아카이브된 프로젝트를 표로 확인 (slug / topic / mode / papers / phase / archived_at).
- **Swap 복원** — `./start-research.sh restore <slug>` 는 현재 루트 상태를 먼저 자동 아카이브한 뒤 지정 프로젝트를 루트로 되돌립니다. slug 는 전체 이름 또는 고유 접두어.

### 명령 요약

```bash
# 현재 작업을 수동으로 아카이브 (--name 은 선택)
node scripts/lib/project-archive.mjs archive --name my-baseline

# 목록
./start-research.sh library

# 복원 (swap — 현재 루트는 자동 보존)
./start-research.sh restore 4d-qsar-pampa-20260416-183804
./start-research.sh restore 4d-qsar          # 접두어가 유일하면 OK

# 복원 직후 재개
./start-research.sh run
```

### 아카이브 구조

```
archive/{slug}-{YYYYMMDD-HHMMSS}/
├── manifest.json          # slug, topic, keywords, mode, papers_collected, archived_at, agent 등
├── research-config.json   # 루트에서 이동
├── prd.json               # 루트에서 이동
├── findings/              # 루트에서 이동 (_checkpoint.json 포함)
└── ralph-session/
    ├── config.toml        # 복사 (루트에도 남겨 다음 세션에 재사용)
    ├── templates/         # 복사
    ├── progress.md        # 이동 (루트는 깨끗하게 리셋)
    ├── iterations/        # 이동
    └── reports/           # 이동
```

### 주의 사항

- **Ralph TUI 세션 자체는 복원 대상이 아닙니다.** `session.json` 등은 절대경로·프로세스 PID 에 묶여 있어서 복원 후엔 `./start-research.sh run` 으로 새 세션을 시작해야 합니다 (`prd.json` 은 그대로라 Ralph 가 진행 상태를 다시 계산).
- **Ralph 실행 중에는 아카이브가 차단됩니다** (`.ralph-tui/ralph.lock` 의 PID 가 살아있는 경우). 죽은 프로세스가 남긴 **stale 락**은 자동으로 정리됩니다.
- `archive/` 는 `.gitignore` 되어 있습니다. 특정 스냅샷을 커밋하고 싶다면 수동으로 `git add -f archive/<slug>/` 하세요.

## 🇺🇸 Project library (swap topics safely)

The pipeline keeps `findings/` · `research-config.json` · `prd.json` at the repo root, so starting a new topic could overwrite prior work. The **project library** handles this automatically: when you start a new topic, current work is preserved under `archive/`, and you can bring any past project back whenever.

### How it works

- **Automatic archive** — While running `./start-research.sh deep` (or `trend`), answering `n` at the `"Use existing config? (Y/n)"` prompt moves the root state (`research-config.json`, `prd.json`, `findings/`, and reusable bits of `.ralph-tui/`) into `archive/{slug}-{YYYYMMDD-HHMMSS}/`.
- **Auto-derived slug** — Defaults to the first keyword of `research-config.json`, kebab-cased (`4D-QSAR` → `4d-qsar`). Override with `--name my-v1`.
- **Library listing** — `./start-research.sh library` prints an archive table (slug / topic / mode / papers / phase / archived_at).
- **Swap restore** — `./start-research.sh restore <slug>` first auto-archives current root state, then restores the named project. Slug can be the full directory name or a unique prefix.

### Command summary

```bash
# Manually archive current work (--name optional)
node scripts/lib/project-archive.mjs archive --name my-baseline

# List
./start-research.sh library

# Restore (swap — current root is auto-preserved)
./start-research.sh restore 4d-qsar-pampa-20260416-183804
./start-research.sh restore 4d-qsar          # prefix match, if unique

# Resume right after restore
./start-research.sh run
```

### Archive layout

```
archive/{slug}-{YYYYMMDD-HHMMSS}/
├── manifest.json          # slug, topic, keywords, mode, papers_collected, archived_at, agent, ...
├── research-config.json   # moved from root
├── prd.json               # moved from root
├── findings/              # moved from root (includes _checkpoint.json)
└── ralph-session/
    ├── config.toml        # copied (stays in root for the next session too)
    ├── templates/         # copied
    ├── progress.md        # moved (root resets clean)
    ├── iterations/        # moved
    └── reports/           # moved
```

### Caveats

- **The Ralph TUI session itself is not restored.** `session.json` and friends are tied to absolute paths and live PIDs; after a restore, start a new session with `./start-research.sh run` (Ralph recomputes progress from `prd.json`).
- **Archiving is blocked while Ralph is running** (a live PID in `.ralph-tui/ralph.lock`). **Stale locks** from dead processes are cleaned up automatically.
- `archive/` is in `.gitignore`. To commit a specific snapshot, force-add it: `git add -f archive/<slug>/`.

---

## 🇰🇷 두 가지 모드

### `deep` — 심층 참고문헌 조사

특정 연구 주제에 대해 **모든 관련 논문을 빠짐없이** 수집합니다. 논문 작성 직전에 novelty를 주장하기 위한 레퍼런스를 쌓는 용도입니다.

- 키워드 3-4개와 하위 연구 질문 3-5개를 확정합니다.
- 신뢰도 낮은 논문도 일단 수집하되 `[LOW-CREDIBILITY]` 태그를 붙입니다(사용자가 reference로 쓸지는 별도 판단).
- 실험 설계 지원이 필요한 경우, 선행 연구의 프로토콜을 집약해 방법론 제안까지 생성합니다.

### `trend` — 동향 탐구

특정 분야의 **최신 리뷰·트렌드**를 파악합니다.

- 리뷰 논문 중심으로 수집합니다.
- 사기성/predatory 논문은 **완전히 제외**합니다(존재하지 않는 트렌드를 실제라고 착각하는 문제를 방지).

## 🇺🇸 Two modes

### `deep` — deep literature sweep

Collects **every related paper** on a specific topic. Designed to be run right before writing, so you can justify the novelty of your own paper.

- Locks down 3–4 keywords and 3–5 sub-questions.
- Low-credibility papers are kept but tagged `[LOW-CREDIBILITY]` (you decide whether to cite them).
- If experiment-design support is requested, the pipeline synthesizes protocols from prior work into concrete suggestions.

### `trend` — trend scan

Understands **recent reviews and trends** in a field.

- Prioritizes review articles.
- **Fully excludes** predatory / fraudulent papers to prevent phantom trends from leaking in.

---

## 🇰🇷 스킬 목록

모든 스킬은 슬래시 명령(`/skill-name`)으로 호출됩니다. 파이프라인은 아래 스킬들을 정해진 순서로 실행합니다.

| 스킬 | 역할 |
|------|------|
| `/research-intake` | 사용자와 대화해 연구 주제·키워드·하위 질문을 확정하고 `research-config.json` 생성 |
| `/research-tasks` | config를 읽어 모드별 `prd.json` 태스크 시퀀스 자동 생성 |
| `/research-search` | 5개 소스 다중 쿼리 검색 + Tier 1/2 전문 즉시 수집 + 증거 카드 작성 |
| `/research-read` | Tier 1/2 실패 논문을 Tier 3(Playwright MCP)로 재시도 |
| `/research-snowball` | 참고문헌 재귀 추적(눈덩이) |
| `/research-credibility` | Beall's List, predatory journal, Retraction Watch 교차 확인 |
| `/research-methods` | Methods 섹션 집중 분석(설계·재현성·통계 적절성) |
| `/research-deep-read` | 한 논문을 6개 렌즈(이론·방법·결과·한계·응용·비판)로 병렬 정독 |
| `/research-compare` | 여러 논문의 방법·결과·주장 교차 비교, 대조표 생성 |
| `/research-analyze` | findings 전체 통합 분석 + 커버리지 감사 |
| `/research-validate` | 3중 병렬 검증(Coverage / Credibility / Coherence) |
| `/research-notion` | 최종 결과를 노션 DB와 논문별 페이지로 기록 |

## 🇺🇸 Skill catalog

Every skill is invoked as a slash command (`/skill-name`). The pipeline runs them in a fixed order.

| Skill | Role |
|-------|------|
| `/research-intake` | Converses with the user to lock in topic / keywords / sub-questions, writes `research-config.json` |
| `/research-tasks` | Reads the config and generates a mode-specific `prd.json` task sequence |
| `/research-search` | Multi-query search across 5 sources + immediate Tier 1/2 full-text + evidence cards |
| `/research-read` | Retries Tier 1/2 failures through Tier 3 (Playwright MCP) |
| `/research-snowball` | Recursive reference tracing (snowball) |
| `/research-credibility` | Cross-checks Beall's List, predatory journals, Retraction Watch |
| `/research-methods` | Focused Methods analysis (design / reproducibility / statistics) |
| `/research-deep-read` | Parallel 6-lens deep read (theory / methods / results / limits / application / critique) |
| `/research-compare` | Cross-comparison of methods / results / claims with comparison tables |
| `/research-analyze` | Integrated analysis across all findings + coverage audit |
| `/research-validate` | Triple-parallel validation (Coverage / Credibility / Coherence) |
| `/research-notion` | Final export to a Notion database and per-paper pages |

---

## 🇰🇷 논문 전문 접근 전략 (3-Tier Fallback)

논문 전문은 검색 단계에서 즉시 확보합니다. 한 번에 안 열리면 다음 단계로 폴백합니다.

| Tier | 방법 | 속도 | 토큰 소비 |
|------|------|------|-----------|
| **Tier 1** | OpenAlex / Unpaywall / arXiv / Crossref 공개 API | 빠름 | 낮음 |
| **Tier 2** | Node.js + Playwright 헤드리스 브라우저 (EZproxy 경유) | 중간 | 낮음 |
| **Tier 3** | Playwright MCP 수동 세션(스크립트에서 분리) | 느림 | 높음 |

- Tier 3은 토큰 소비가 크므로(`~50K/편`) Tier 1/2 실패 논문에만 적용합니다.
- 추출된 본문은 `findings/raw_texts/{doi-slug}.md`에 저장되어 이후 스킬들이 재사용합니다.
- EZproxy 경유 URL은 기관마다 다릅니다. `.env`의 `PROXY_BASE_URL`에 본인 기관 프록시 베이스를 입력하세요(스크립트 수정 불필요). 프록시 없이 쓰려면 `PROXY_ENABLED=false`.

## 🇺🇸 Full-text retrieval (3-Tier fallback)

Full texts are fetched during the search phase. When one tier fails, the pipeline falls back to the next.

| Tier | Method | Speed | Token cost |
|------|--------|-------|------------|
| **Tier 1** | Public APIs: OpenAlex / Unpaywall / arXiv / Crossref | Fast | Low |
| **Tier 2** | Node.js + Playwright headless browser (through EZproxy) | Medium | Low |
| **Tier 3** | Manual Playwright MCP session (decoupled from scripts) | Slow | High |

- Tier 3 is expensive (`~50K tokens/paper`), so it only runs for Tier 1/2 failures.
- Extracted text is cached at `findings/raw_texts/{doi-slug}.md` and reused by downstream skills.
- EZproxy URL shapes vary by institution. Put your proxy base in `.env` (`PROXY_BASE_URL=…`) — no script edits needed. Set `PROXY_ENABLED=false` to skip the proxy entirely.

---

## 🇰🇷 결과물 구조

### `findings/` — 마크다운 리포트

```
findings/
├── {키워드조합}.md              # 키워드 조합별 증거 카드 모음
├── {키워드조합}_blocked.json    # 접근 실패 논문 목록
├── raw_texts/{doi-slug}.md      # 추출된 논문 전문
├── credibility_report.md        # 신뢰성 검사 결과
├── excluded_papers.md           # 제외된 사기성 논문
├── snowball_{depth}.md          # 참고문헌 재귀 추적 결과
├── methods_critique.md          # 방법론 비판 분석
├── deep_read/{논문id}.md        # 6-렌즈 정독 리포트
├── comparison_{주제}.md         # 논문 간 교차 비교
├── integrated_analysis.md       # 통합 분석
├── audit_report.md              # 3중 검증 감사 결과
├── authors_labs.md              # 핵심 저자·랩 리스트
├── _checkpoint.json             # 진행 체크포인트(훅이 자동 갱신)
└── _search_wisdom.md            # 축적된 검색 패턴 인사이트
```

### Notion — 자동 생성되는 DB와 페이지

`/research-notion` 스킬이 실행되면 아래가 노션에 만들어집니다.

**1. 문헌 데이터베이스** (`"[연구 주제] 문헌 데이터베이스"`)

| 속성 | 타입 | 설명 |
|------|------|------|
| 논문 제목 | Title | |
| 저자 | Rich text | |
| 연도 | Number | |
| 저널 | Rich text | |
| DOI | URL | 클릭 시 원문으로 이동 |
| 인용수 | Number | |
| 방법론 | Rich text | RCT / MD simulation / QSAR 등 |
| 신뢰도 | Select | 높음(green) / 보통(yellow) / 낮음(red) |
| 키워드 조합 | Multi-select | 어떤 검색 조합에서 발견됐는지 |
| 핵심 발견 | Rich text | 요약 |
| 한계점 | Rich text | |
| 전문 확인 | Checkbox | 풀텍스트 확보 성공 여부 |
| 출처 파일 | Rich text | `findings/` 내 어떤 파일에서 왔는지 |

**2. 논문별 상세 페이지** — DB의 각 row마다 하위 페이지가 생성되고, 그 안에 **증거 카드 전체 내용 + 추가 분석 메모**가 담깁니다.

**3. DOI 목록 페이지** — 인용 형식(저자·연도·제목·저널·DOI)으로 정리된 별도 페이지.

**4. 통합 분석 페이지** — `integrated_analysis.md`, `audit_report.md`, `methods_critique.md` 등이 노션 페이지로 변환됩니다.

## 🇺🇸 Output structure

### `findings/` — markdown reports

```
findings/
├── {keyword-combo}.md           # evidence cards grouped by keyword combo
├── {keyword-combo}_blocked.json # papers whose full text could not be reached
├── raw_texts/{doi-slug}.md      # extracted paper full text
├── credibility_report.md        # credibility screening output
├── excluded_papers.md           # papers dropped as fraudulent / predatory
├── snowball_{depth}.md          # recursive reference tracing
├── methods_critique.md          # methodology critique
├── deep_read/{paper-id}.md      # 6-lens deep reads
├── comparison_{topic}.md        # cross-paper comparisons
├── integrated_analysis.md       # integrated analysis
├── audit_report.md              # triple-validation audit
├── authors_labs.md              # key authors / labs
├── _checkpoint.json             # progress checkpoint (auto-updated by hook)
└── _search_wisdom.md            # accumulated search-pattern insights
```

### Notion — auto-created DB + pages

Running `/research-notion` produces the following inside Notion.

**1. Literature database** (`"[research topic] Literature Database"`)

| Property | Type | Description |
|----------|------|-------------|
| Paper title | Title | |
| Authors | Rich text | |
| Year | Number | |
| Journal | Rich text | |
| DOI | URL | Links to the original paper |
| Citations | Number | |
| Methodology | Rich text | e.g. RCT / MD simulation / QSAR |
| Credibility | Select | High (green) / Medium (yellow) / Low (red) |
| Keyword combo | Multi-select | Which search combo surfaced it |
| Key findings | Rich text | Summary |
| Limitations | Rich text | |
| Full text retrieved | Checkbox | Did we actually get the body? |
| Source file | Rich text | Which `findings/` file it came from |

**2. Per-paper subpages** — every row gets a child page containing the **full evidence card + additional analysis notes**.

**3. DOI list page** — a separate page listing citations in `author (year). title. journal. DOI` form.

**4. Integrated analysis page** — `integrated_analysis.md`, `audit_report.md`, `methods_critique.md`, etc. are rendered as Notion pages.

---

## 🇰🇷 자동화 훅 (품질 보장 메커니즘)

Claude Code 경로에서는 `.claude/settings.json`에 등록된 4개 훅이 실수를 자동 교정합니다.
Codex·Gemini 경로에서는 Claude 고유의 이벤트 훅이 동작하지 않으므로, 같은 보장을
**스킬 본문의 "0단계"·"종료 단계"** 가 CLI 호출로 수행합니다
(`scripts/lib/pipeline-guard.mjs`, `scripts/lib/coverage-verifier.mjs`,
`scripts/lib/checkpoint.mjs`). 결과적으로 어떤 에이전트로 돌려도 동일한 품질 게이트가
적용됩니다.

### 1. Pre-Compact 체크포인트 (`PreCompact`)
컨텍스트 압축 직전에 연구 진행 상황을 `findings/_checkpoint.json`에 저장합니다. Ralph TUI가 fresh 세션을 띄워도 체크포인트를 읽어 연속성을 확보합니다.

### 2. Verify-Fix 자기 수정 루프 (`Stop`)
검색 태스크가 끝날 때 커버리지를 자동 점검합니다.
- 5개 소스 모두 검색했는가?
- 쿼리 변형이 5개 이상인가?
- 최소 논문 수를 충족했는가?

갭이 있으면 **Stop을 차단**하고 구체적 누락 내용을 메시지로 전달해 추가 검색을 유도합니다(무한 루프 방지를 위해 최대 3회 후 강제 통과).

### 3. State Machine 파이프라인 가드 (`PreToolUse`)
스킬 실행 전 선행 조건을 검사합니다. 예: `/research-validate`는 `integrated_analysis.md`가 없으면 실행이 차단됩니다. 파이프라인 순서 위반을 프로그래밍적으로 막습니다.

### 4. 검색 지혜 자동 학습 (실험적 — 현재 비활성)
설계 의도는 `PostToolUse` 훅으로 `WebSearch` 결과를 `_search_wisdom.json`에 쌓아 이후 검색에 참조하는 것이었습니다. 다만 **현 Claude Code 훅 사양은 `tool_output`을 훅에 전달하지 않아** 효과 측정이 불가능하여, 지금은 `.claude/settings.json`에서 등록을 제외한 상태입니다. 관련 스크립트(`scripts/hooks/search-wisdom-learner.mjs`)는 참고용으로만 남겨 두고, 훅 사양이 변경되면 재등록 예정입니다.

## 🇺🇸 Automation hooks (quality enforcement)

On the Claude Code path, four hooks registered in `.claude/settings.json`
auto-correct mistakes. On the Codex / Gemini paths, those event hooks do not
fire — so the same guarantees are implemented as CLI calls inside each skill's
"Step 0" and "Final step" (`scripts/lib/pipeline-guard.mjs`,
`scripts/lib/coverage-verifier.mjs`, `scripts/lib/checkpoint.mjs`). The net
result is the same quality gate regardless of which agent runs the pipeline.

### 1. Pre-Compact checkpoint (`PreCompact`)
Right before context compaction, snapshots current research state into `findings/_checkpoint.json`. Even a fresh Ralph TUI session can read it back to preserve continuity.

### 2. Verify-Fix self-correction loop (`Stop`)
When a search task ends, coverage is auto-checked:
- Were all 5 sources queried?
- At least 5 query variants?
- Minimum paper count met?

On failure, Stop is **blocked** and specific gaps are sent back as a message to trigger more searching. A circuit breaker forces pass after 3 blocks (prevents infinite loops).

### 3. State-machine pipeline guard (`PreToolUse`)
Checks preconditions before a skill runs. e.g. `/research-validate` is blocked unless `integrated_analysis.md` exists — pipeline-order violations are prevented programmatically.

### 4. Search-wisdom auto-learning (experimental — currently disabled)
The intent was a `PostToolUse` hook that accumulates `WebSearch` outcomes into `_search_wisdom.json` for future reference. However the **current Claude Code hook spec does not pass `tool_output` to hooks**, so effect measurement is not possible and the hook is **not registered in `.claude/settings.json`** at the moment. The script (`scripts/hooks/search-wisdom-learner.mjs`) is kept for reference and will be re-enabled if the hook spec changes.

---

## 🇰🇷 핵심 원칙 (이 파이프라인이 추구하는 것)

1. **완전한 문헌 커버리지** — 관련 논문을 하나라도 놓치면 리뷰어가 "왜 이 논문은 고려하지 않았는가"라고 지적하는 순간 논문의 신뢰도가 무너집니다. 상위 결과에서 멈추지 않고, 다양한 쿼리와 소스를 조합해 빈틈을 줄입니다.
2. **DOI는 검색으로 확인** — LLM은 DOI를 할루시네이션할 수 있습니다. 실존이 검색으로 확인된 논문만 기록합니다.

## 🇺🇸 Core principles

1. **Complete literature coverage** — If you miss even one related paper, a reviewer asking "why wasn't this paper considered?" can collapse your credibility. The pipeline refuses to stop at top results and varies queries / sources to close gaps.
2. **DOIs are verified by search** — LLMs hallucinate DOIs. Only papers whose existence is confirmed by search are recorded.

---

## 🇰🇷 제한 사항 및 주의점

- **유료 저널 접근**은 본인 학교/기관의 EZproxy를 필요로 합니다. `.env`의 `PROXY_BASE_URL`, `PROXY_LOGIN_URL`, `PROXY_PORTAL_ID/PW`를 채우거나 `bash scripts/setup-proxy.sh`로 대화형 설정하세요. 프록시가 없으면 `PROXY_ENABLED=false`로 두고 오픈액세스 논문만 시도합니다.
- **LLM 토큰 비용**이 상당히 듭니다. Tier 3 재시도는 한 편당 `~50K` 토큰을 쓰므로 사전에 대상 편수를 확인하세요.
- **Notion MCP**가 연결되지 않으면 `/research-notion` 스킬만 동작하지 않습니다. 나머지는 정상 실행됩니다.
- `WebFetch`로 논문 본문을 직접 읽는 것은 금지됩니다(검색·DOI 확인 전용). 반드시 `scripts/read-paper.js` 또는 `scripts/fetch-paper.js`를 경유하세요.

## 🇺🇸 Caveats

- **Paywalled access** requires an EZproxy from your own institution. Fill in `PROXY_BASE_URL`, `PROXY_LOGIN_URL`, `PROXY_PORTAL_ID/PW` in `.env`, or run `bash scripts/setup-proxy.sh` for an interactive setup. Without a proxy, set `PROXY_ENABLED=false` and the pipeline will try open-access papers only.
- **LLM token cost** is significant. Tier 3 retries cost about `~50K` tokens per paper — check the pending count before kicking it off.
- **Notion MCP** only affects `/research-notion`. Everything else runs without it.
- Do not use `WebFetch` to read paper bodies (it's for search / DOI verification only). Always go through `scripts/read-paper.js` or `scripts/fetch-paper.js`.

---

## 🇰🇷 디렉토리 한눈에 보기

```
research-pipeline/
├── .claude/
│   ├── settings.json              # 훅 설정 (Claude Code 전용)
│   └── skills/                    # 12개 연구 스킬 (정본)
├── .codex/skills/                 # Codex CLI 파생물 (자동 생성, .gitignore)
├── .gemini/commands/              # Gemini CLI 래퍼 (자동 생성, .gitignore)
├── .ralph-tui/
│   └── config.toml                # Ralph TUI 설정
├── scripts/
│   ├── fetch-paper.js             # Tier 1/2 전문 수집
│   ├── read-paper.js              # 단일 논문 전문 추출
│   ├── list-pending-tier3.js      # Tier 3 대상 자동 탐지
│   ├── setup-proxy.sh             # EZproxy 대화형 초기 설정
│   ├── setup-auth.sh              # Playwright 세션 쿠키 설정
│   ├── sentinel.sh                # Ralph 프로세스 감시
│   ├── run-agent.sh               # claude/codex/gemini 호출 래퍼
│   ├── sync-agent-assets.mjs      # .claude/skills → .codex/.gemini 동기화
│   ├── hooks/                     # 자동화 훅 구현체
│   └── lib/
│       ├── checkpoint.mjs         # 진행 체크포인트 (스킬 경계에서 호출)
│       ├── pipeline-guard.mjs     # 선행 조건 가드
│       ├── coverage-verifier.mjs  # 커버리지 검증
│       └── project-archive.mjs    # 프로젝트 라이브러리 (archive/list/restore)
├── archive/                       # 프로젝트 라이브러리 (과거 주제 보관, .gitignore)
├── findings/                      # 파이프라인 결과물 (활성 프로젝트)
├── research-config.json           # 연구 설정(인테이크 산출물)
├── prd.json                       # Ralph TUI가 실행할 태스크
├── .env.example                   # 환경변수 템플릿 (.env는 .gitignore)
├── CLAUDE.md                      # Claude Code 지침 (Claude 전용)
├── AGENTS.md                      # Codex/Gemini 공용 지침
├── start-research.sh              # 진입점
└── README.md                      # 이 파일
```

## 🇺🇸 Directory at a glance

```
research-pipeline/
├── .claude/
│   ├── settings.json              # hook settings (Claude Code only)
│   └── skills/                    # 12 research skills (source of truth)
├── .codex/skills/                 # Codex CLI derivatives (auto-generated, gitignored)
├── .gemini/commands/              # Gemini CLI wrappers (auto-generated, gitignored)
├── .ralph-tui/
│   └── config.toml                # Ralph TUI config
├── scripts/
│   ├── fetch-paper.js             # Tier 1/2 full-text fetcher
│   ├── read-paper.js              # single-paper extractor
│   ├── list-pending-tier3.js      # auto-detect Tier 3 targets
│   ├── setup-proxy.sh             # interactive EZproxy setup
│   ├── setup-auth.sh              # Playwright session cookie setup
│   ├── sentinel.sh                # Ralph process supervisor
│   ├── run-agent.sh               # claude/codex/gemini invocation wrapper
│   ├── sync-agent-assets.mjs      # sync .claude/skills → .codex/.gemini
│   ├── hooks/                     # hook implementations
│   └── lib/
│       ├── checkpoint.mjs         # progress checkpoint (called at skill boundaries)
│       ├── pipeline-guard.mjs     # precondition guard
│       ├── coverage-verifier.mjs  # coverage verifier
│       └── project-archive.mjs    # project library (archive / list / restore)
├── archive/                       # project library — past topics (gitignored)
├── findings/                      # pipeline output (active project)
├── research-config.json           # research config (intake output)
├── prd.json                       # Ralph TUI task list
├── .env.example                   # env-var template (.env is gitignored)
├── CLAUDE.md                      # instructions for Claude Code
├── AGENTS.md                      # shared instructions for Codex/Gemini
├── start-research.sh              # entry point
└── README.md                      # this file
```

---

## License

ISC
