# read-paper.js 논문 전문 읽기 — 문제 분석 및 해결 기록

> 작성일: 2026-03-30
> 브랜치: master (파이프라인 실행 중 발견)

## 요약

파이프라인 논문 전문 읽기 단계에서 **10건 중 8건이 실패**하는 문제를 발견하고 수정했다.

| 문제 유형 | 영향 출판사 | 건수 | 해결 상태 |
|-----------|-----------|------|----------|
| Cloudflare 봇 차단 | ACS, AIP, Taylor & Francis | 6건 | **해결** (stealth 설정) |
| Akamai WAF Access Denied | MDPI | 2건 | **해결** (OA 직접 접근 + DOI 변환) |
| EZproxy 세션 만료 | ACS (구독 저널) | 3건 | **스크립트 외 문제** (재인증 필요) |

---

## 문제 1: Cloudflare 봇 차단 (ACS, AIP, T&F)

### 증상

`findings/raw_texts/` 파일이 529바이트로, 논문 본문 대신 아래 내용만 저장됨:

```
Performing security verification
This website uses a security service to protect against malicious bots.
Enable JavaScript and cookies to continue
```

### 원인

`headless: true`로 실행되는 Playwright Chromium이 Cloudflare Bot Management에 감지됨.
기존 설정은 `--disable-blink-features=AutomationControlled` 플래그 하나뿐이었음.

### 해결

`read-paper.js`에 다중 stealth 설정을 추가:

1. **`ignoreDefaultArgs: ['--enable-automation']`** — Chromium의 자동화 플래그 제거
2. **`navigator.webdriver` 위장** — `addInitScript`로 `webdriver` 속성을 `undefined`로 오버라이드
3. **`chrome.runtime` 위장** — 실제 Chrome 객체처럼 위장
4. **현실적인 User-Agent** — Chrome 131 macOS UA 문자열
5. **`extraHTTPHeaders`** — `Sec-Fetch-*`, `sec-ch-ua-*` 등 실제 브라우저 헤더 추가
6. **`navigator.plugins`, `navigator.languages` 위장** — 빈 plugins 배열 방지
7. **Cloudflare 챌린지 대기 로직** — 챌린지 감지 시 최대 25초 대기 후 재확인

### 결과

| DOI | 출판사 | 수정 전 | 수정 후 |
|-----|--------|--------|--------|
| 10.1063/5.0013429 | AIP | 529B (CF 차단) | **82KB** |
| 10.1080/17460441.2019.1664467 | T&F | 543B (CF 차단) | **5.7KB** |
| 10.1021/acs.jcim.7b00048 | ACS | 529B (CF 차단) | **1.2KB** (CF 통과, 구독 미인증) |

---

## 문제 2: MDPI Akamai WAF Access Denied

### 증상

`findings/raw_texts/` 파일이 0바이트 (완전히 빈 파일).

### 원인 (3중)

1. **EZproxy → MDPI 경로에서 Akamai WAF가 "Access Denied" 반환**
   - MDPI는 오픈 액세스라 프록시가 불필요한데, 프록시 경유가 오히려 차단을 유발
2. **DOI 리다이렉트가 Akamai를 트리거**
   - `https://doi.org/10.3390/...` → `https://www.mdpi.com/...` 리다이렉트 시 `Sec-Fetch-Site: cross-site`가 발생하여 봇으로 감지됨
   - 직접 `https://www.mdpi.com/...` 접근은 정상 작동
3. **MDPI DOM 구조와 추출 셀렉터 불일치**
   - MDPI는 `.html-body > section > .html-p` 구조를 사용
   - 기존 셀렉터(`.c-article-section__content`, 일반 `h2`)로는 추출 불가

### 해결

1. **OA 출판사 DOI prefix 감지** — `10.3390` (MDPI), `10.1371` (PLoS), `10.3389` (Frontiers) 등 감지
2. **DOI → 실제 URL 변환** — Node.js `https.request`로 HEAD 요청하여 리다이렉트 최종 URL 취득
3. **프록시 건너뛰기** — OA 출판사는 변환된 URL로 직접 접근
4. **MDPI 전용 추출 셀렉터** — `.html-body > section` 하위의 `.html-p` 요소에서 본문 추출
5. **일반 h2 폴백에 네비게이션 필터 추가** — MDPI 사이트 네비게이션 h2(Journals, Topics 등) 제외

### 결과

| DOI | 수정 전 | 수정 후 |
|-----|--------|--------|
| 10.3390/ijms22105212 | 0B | **47KB** |
| 10.3390/ijms20133170 | 0B | **31KB** |

---

## 미해결: ACS 구독 콘텐츠 접근

### 증상

Cloudflare는 통과했지만 논문 본문 대신 T&C 문구와 빈 Abstract만 추출됨 (1.2KB).

### 원인

EZproxy 세션이 만료되어 ACS 구독 콘텐츠에 접근할 수 없음. 스크립트 문제가 아닌 **인증 문제**.

### 대응

```bash
node scripts/setup-auth.js
```

위 명령으로 고려대 포털에 재로그인한 후, ACS 논문을 재처리하면 전문 접근 가능.

---

## 수정 파일

- `scripts/read-paper.js` — 본 문서의 모든 수정사항 적용

## 추가된 기능

| 기능 | 설명 |
|------|------|
| `--headed` 옵션 | GUI 모드로 실행 (더 강한 봇 탐지 우회) |
| OA 출판사 자동 감지 | MDPI, PLoS, Frontiers, eLife, PeerJ, BMC의 DOI prefix 감지 |
| DOI 자동 변환 | OA 출판사 DOI를 실제 URL로 변환 후 직접 접근 |
| Cloudflare 대기 | 챌린지 감지 시 자동 대기 (최대 25초) |
| 프록시 실패 폴백 | Access Denied 시 쿠키 클리어 후 직접 접근 시도 |

## 교훈

1. **Headless 브라우저 탐지는 다층적이다** — UA만 바꿔서는 안 되고, `navigator.webdriver`, `chrome.runtime`, HTTP 헤더, `Sec-Fetch-*` 등을 모두 위장해야 한다.
2. **오픈 액세스 저널에 프록시를 쓰면 역효과** — Akamai WAF는 프록시 경유 트래픽을 봇으로 감지한다.
3. **DOI 리다이렉트도 봇 탐지를 트리거한다** — cross-site 리다이렉트에서 `Sec-Fetch-Site`가 바뀌면서 WAF가 발동한다. HEAD 요청으로 미리 URL을 변환하면 해결된다.
