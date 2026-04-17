# Security Policy / 보안 정책

## 🇰🇷 지원 버전

이 프로젝트는 아직 정식 릴리스 태그가 없는 초기 단계 저장소입니다. 보안 수정은
**`master` 브랜치의 최신 커밋**에만 반영됩니다. 오래된 포크나 복제본을 쓰고 있다면
먼저 최신 커밋으로 업데이트해 주세요.

## 🇺🇸 Supported Versions

This project is in an early stage with no versioned releases yet. Security fixes
are applied only to the **latest commit on the `master` branch**. If you are on an
older fork or clone, please update to the latest commit before reporting.

---

## 🇰🇷 취약점 제보 방법

- **제보처:** `sorenklin@gmail.com` — 제목에 `[security]` 를 붙여 주세요.
- **공개 이슈 트래커에는 올리지 말아 주세요.** GitHub Issues / PR 에 직접 써 주시면 이미 노출된 상태가 됩니다. 먼저 이메일로 비공개 제보 후, 수정이 공개되면 관련 이슈를 함께 열어 주세요.
- 가능한 경우 다음을 포함해 주시면 분석이 빨라집니다.
  - 재현 환경(OS / Node 버전 / 선택한 에이전트 CLI)
  - 재현 절차와 실제로 확인된 영향(예: 로컬 파일 읽기, 외부 호출 발생 등)
  - 관련 커밋 SHA 또는 파일 경로
- 응답 목표: **영업일 기준 3일 이내 1차 회신**, 유효 취약점은 **14일 이내 수정 또는 대응 플랜 공유**.

## 🇺🇸 Reporting a Vulnerability

- **Contact:** `sorenklin@gmail.com` — prefix the subject with `[security]`.
- **Do not open a public issue first.** Filing a GitHub Issue/PR for a live vulnerability exposes it. Please email privately, and we will coordinate a public disclosure after a fix lands.
- Please include (as available):
  - Environment (OS / Node version / which agent CLI you selected)
  - Reproduction steps and observed impact (e.g. local file read, outbound request, etc.)
  - Related commit SHA or file path
- Target response: **first acknowledgement within 3 business days**; for valid issues, **a fix or remediation plan within 14 days**.

---

## 🇰🇷 적용 범위 / 범위 밖

**범위 안 (in scope):**
- `scripts/`, `.claude/skills/`, `.claude/settings.json`, `start-research.sh` 등 이 저장소의 코드 자체에서 비롯된 취약점
- 파이프라인이 외부 도구(Claude Code / Codex / Ralph TUI / Playwright) 를 호출할 때, 이 저장소 설정이 권한 경계를 잘못 완화시키는 경우
- `.env`, `.playwright-auth.json` 등 로컬 자격 증명 파일을 저장/노출하는 방식에 대한 결함

**범위 밖 (out of scope):**
- 이 저장소가 의존하는 제3자 도구(Claude Code, OpenAI Codex CLI, Ralph TUI, Playwright, Notion MCP 등) 자체의 취약점 — 각 프로젝트의 보안 채널로 제보해 주세요.
- 출판사/데이터베이스 이용약관(TDM 정책) 위반에 따른 IP 차단·계정 정지 등 운영상 이슈.
- `--dangerously-skip-permissions`, `codex exec --full-auto`, `settings.local.json` 의 `"allow": [...]` 확장 등 **사용자가 명시적으로 활성화한 권한 완화**에서 비롯된 피해. 이 모드는 에이전트에 폭넓은 로컬 권한을 부여한다는 사실을 README에서 안내하고 있습니다.
- 봇 탐지 우회 옵션(`navigator.webdriver` 마스킹, `--disable-blink-features=AutomationControlled` 등)을 본인의 구독/권한 범위 밖에서 사용해 발생한 문제.

**운영상 권장 (best practices):**
- `.env` 와 `.playwright-auth.json` 은 반드시 `chmod 600` 으로 유지하세요. 이 저장소의 `scripts/setup-proxy.sh` 와 `scripts/setup-auth.js` 는 자동으로 이 권한을 적용합니다.
- 공용 머신(공동 작업실 데스크톱 등)에서는 이 파이프라인을 실행하지 마시고, 사용 후 `rm -rf .playwright-profile .playwright-auth.json` 로 세션을 정리하세요.
- API 키가 노출된 것으로 의심되면 즉시 해당 서비스(Unpaywall / Semantic Scholar / Elsevier / Springer / CORE 등)에서 회전(revoke & re-issue)하세요.

## 🇺🇸 Scope

**In scope:**
- Vulnerabilities originating in this repository's code itself (`scripts/`, `.claude/skills/`, `.claude/settings.json`, `start-research.sh`, etc.).
- Cases where this repo's configuration wrongly relaxes the permission boundary when invoking external tools (Claude Code / Codex / Ralph TUI / Playwright).
- Flaws in how local credentials (`.env`, `.playwright-auth.json`) are stored or exposed.

**Out of scope:**
- Vulnerabilities in upstream tools this repo depends on — please report those to the respective projects (Claude Code, OpenAI Codex CLI, Ralph TUI, Playwright, Notion MCP).
- Operational consequences of violating a publisher/database Terms of Service (TDM policy) — e.g. IP blocks or account suspensions.
- Damage resulting from user-enabled permission relaxations such as `--dangerously-skip-permissions`, `codex exec --full-auto`, or entries you add to `settings.local.json` under `"allow"`. The README warns that these modes grant broad local capability to the agent.
- Use of bot-detection-evasion options (e.g. `navigator.webdriver` masking, `--disable-blink-features=AutomationControlled`) outside your own subscription or authorized access.

**Operational best practices:**
- Keep `.env` and `.playwright-auth.json` at `chmod 600`. `scripts/setup-proxy.sh` and `scripts/setup-auth.js` apply this automatically.
- Do not run this pipeline on shared machines; after use, clean up sessions with `rm -rf .playwright-profile .playwright-auth.json`.
- If you suspect an API key has leaked, rotate it immediately at the issuing service (Unpaywall / Semantic Scholar / Elsevier / Springer / CORE, etc.).

---

## 🇰🇷 제3자 서비스와 법적/윤리적 주의

이 파이프라인은 유료 저널 전문을 가져오기 위해 **사용자 본인의 기관 EZproxy 자격 증명**과 **Playwright 브라우저 자동화**를 사용할 수 있습니다. 다음은 **사용자 책임**입니다.

- 본인이 속한 기관의 구독 범위 내에서만 사용하기
- 해당 출판사/데이터베이스의 **TDM(Text and Data Mining) 정책**과 robots/자동화 제한을 준수하기
- 학습/연구 목적으로 접근한 전문(full-text)을 `findings/raw_texts/` 등에 저장할 때, 외부 공개/재배포하지 않기
- 수집 속도에 합리적인 한도를 두기 (이 저장소의 기본 `setTimeout(1500)` 배치 간격은 예시일 뿐, 기관 정책상 더 느리게 해야 할 수 있습니다)

이 저장소의 스크립트가 포함하는 자동화 기법(`navigator.webdriver` 숨김, 커스텀 User-Agent, `--disable-blink-features=AutomationControlled` 등)은 **합법적 구독 접근의 브라우저 호환성**을 위한 것이며, 권한이 없는 리소스의 접근 통제 우회를 목적으로 사용해서는 안 됩니다.

## 🇺🇸 Third-party services: legal and ethical note

This pipeline can use your own institutional EZproxy credentials and Playwright browser automation to retrieve paywalled full text. The following are **user responsibilities**:

- Use only within the scope of your institution's subscription.
- Comply with each publisher/database's **TDM (Text and Data Mining) policy** and any robots/automation restrictions.
- Do not re-distribute downloaded full text stored under `findings/raw_texts/` or similar.
- Keep collection rate at a reasonable level (the default `setTimeout(1500)` batch interval is illustrative; your institution may require slower rates).

The automation techniques in this repo (`navigator.webdriver` masking, custom User-Agent, `--disable-blink-features=AutomationControlled`, etc.) are intended to maintain **browser compatibility for legitimate subscription access**, not to bypass access controls for resources you are not entitled to.
