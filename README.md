# Research Pipeline

> 🇰🇷 논문을 쓰기 전에 필요한 모든 백그라운드 논문을 자동으로 모으고, 핵심 인사이트를 뽑아내고, 쓰려는 논문의 방법론까지 분석해주는 연구 문헌조사 자동화 파이프라인입니다.
>
> 🇺🇸 An automated research literature review pipeline that, before you write your paper, collects every relevant background paper, extracts key insights, and analyzes the methodology you're planning to use.

🇰🇷 이 파이프라인은 **Ralph TUI**가 오케스트레이션하고 **Claude Code**가 연구 에이전트로 동작합니다. 연구자가 다룰 주제만 정해주면, 관련 논문을 빠짐없이 검색·수집하고, 전문을 확보해 방법론·결과·한계를 분석한 뒤, 최종적으로 **노션(Notion) 데이터베이스**로 정리된 리포트까지 산출합니다.

🇺🇸 The pipeline is orchestrated by **Ralph TUI** with **Claude Code** acting as the research agent. You give it a topic; it finds and collects every relevant paper, retrieves the full text, analyzes methodology/results/limitations, and finally produces a structured report in a **Notion database**.

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
 │  각 태스크마다 fresh Claude 세션을 띄워 스킬 실행    │
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

- **Ralph TUI**는 태스크마다 새 Claude 세션을 띄우므로, 이전 작업 결과는 `findings/*.md` 파일과 `_checkpoint.json`으로만 전달됩니다.
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
 │  Spins up a fresh Claude session per task         │
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

- **Ralph TUI** spawns a fresh Claude session per task, so prior work crosses sessions only via `findings/*.md` files and `_checkpoint.json`.
- Four automation hooks registered in `.claude/settings.json` enforce pipeline quality (see "Automation hooks" below).

---

## 🇰🇷 빠른 시작

### 1. 전제 조건

- **Node.js** (scripts 실행용)
- **Claude Code** CLI (`claude`)
- **Ralph TUI** (`~/.bun/bin/ralph-tui`)
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
- **Claude Code** CLI (`claude`)
- **Ralph TUI** (`~/.bun/bin/ralph-tui`)
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

## 🇰🇷 두 가지 모드

### `deep` — 심층 참고문헌 조사

특정 연구 주제에 대해 **모든 관련 논문을 빠짐없이** 수집합니다. 논문 작성 직전에 novelty를 주장하기 위한 레퍼런스를 쌓는 용도입니다.

- 키워드 3~4개와 하위 연구 질문 3~5개를 확정합니다.
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

`.claude/settings.json`에 등록된 4개 훅이 Claude의 실수를 자동 교정합니다.

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

### 4. 검색 지혜 자동 학습 (`PostToolUse`)
WebSearch 호출 때마다 쿼리·소스·결과 수·학술 비율을 `_search_wisdom.json`에 기록합니다. 10회 이상 축적되면 마크다운 리포트가 자동 생성되어 이후 검색에 참조됩니다.

## 🇺🇸 Automation hooks (quality enforcement)

Four hooks registered in `.claude/settings.json` auto-correct Claude's mistakes.

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

### 4. Search-wisdom auto-learning (`PostToolUse`)
Every `WebSearch` call logs query / source / result count / academic ratio into `_search_wisdom.json`. After 10 entries the hook auto-generates a markdown report that future searches consult.

---

## 🇰🇷 핵심 원칙 (이 파이프라인이 추구하는 것)

1. **완전한 문헌 커버리지** — 관련 논문을 하나라도 놓치면 리뷰어가 "왜 이 논문은 고려하지 않았는가"라고 지적하는 순간 논문의 신뢰도가 무너집니다. 상위 결과에서 멈추지 않고, 다양한 쿼리와 소스를 조합해 빈틈을 줄입니다.
2. **DOI는 검색으로 확인** — LLM은 DOI를 할루시네이션할 수 있습니다. 실존이 검색으로 확인된 논문만 기록합니다.
3. **Git 커밋은 하지 않습니다** — 파이프라인은 자동으로 커밋하지 않습니다. 사용자가 직접 검토 후 커밋합니다.

## 🇺🇸 Core principles

1. **Complete literature coverage** — If you miss even one related paper, a reviewer asking "why wasn't this paper considered?" can collapse your credibility. The pipeline refuses to stop at top results and varies queries / sources to close gaps.
2. **DOIs are verified by search** — LLMs hallucinate DOIs. Only papers whose existence is confirmed by search are recorded.
3. **No automatic Git commits** — The pipeline never commits on its own. The user reviews and commits manually.

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
│   ├── settings.json              # 훅 설정
│   └── skills/                    # 12개 연구 스킬
├── .ralph-tui/
│   └── config.toml                # Ralph TUI 설정
├── scripts/
│   ├── fetch-paper.js             # Tier 1/2 전문 수집
│   ├── read-paper.js              # 단일 논문 전문 추출
│   ├── list-pending-tier3.js      # Tier 3 대상 자동 탐지
│   ├── setup-proxy.sh             # EZproxy 대화형 초기 설정
│   ├── setup-auth.sh              # Playwright 세션 쿠키 설정
│   ├── sentinel.sh                # Ralph 프로세스 감시
│   └── hooks/                     # 자동화 훅 구현체
├── findings/                      # 파이프라인 결과물
├── research-config.json           # 연구 설정(인테이크 산출물)
├── prd.json                       # Ralph TUI가 실행할 태스크
├── .env.example                   # 환경변수 템플릿 (.env는 .gitignore)
├── CLAUDE.md                      # Claude Code 지침
├── start-research.sh              # 진입점
└── README.md                      # 이 파일
```

## 🇺🇸 Directory at a glance

```
research-pipeline/
├── .claude/
│   ├── settings.json              # hook settings
│   └── skills/                    # 12 research skills
├── .ralph-tui/
│   └── config.toml                # Ralph TUI config
├── scripts/
│   ├── fetch-paper.js             # Tier 1/2 full-text fetcher
│   ├── read-paper.js              # single-paper extractor
│   ├── list-pending-tier3.js      # auto-detect Tier 3 targets
│   ├── setup-proxy.sh             # interactive EZproxy setup
│   ├── setup-auth.sh              # Playwright session cookie setup
│   ├── sentinel.sh                # Ralph process supervisor
│   └── hooks/                     # hook implementations
├── findings/                      # pipeline output
├── research-config.json           # research config (intake output)
├── prd.json                       # Ralph TUI task list
├── .env.example                   # env-var template (.env is gitignored)
├── CLAUDE.md                      # instructions for Claude Code
├── start-research.sh              # entry point
└── README.md                      # this file
```

---

## License

ISC
