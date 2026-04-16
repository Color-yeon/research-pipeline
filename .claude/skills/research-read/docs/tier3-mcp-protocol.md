# 티어 3: Playwright MCP 청크 추출 프로토콜

## 언제 사용하는가

`node scripts/fetch-paper.js`의 티어 1(API) + 티어 2(브라우저)가 **모두 실패**한 논문에 대해서만 사용한다.
`findings/_fetch_results.json`의 `needsTier3` 배열에 있는 논문이 대상이다.

## 왜 최후 수단인가

Playwright MCP 호출은 토큰을 많이 소비한다:
- 논문 1편당 ~10회 MCP 호출 = ~50K 토큰
- 5편이면 ~250K 토큰

하지만 초록만 수집하는 것은 절대 허용되지 않으므로, 비용이 높더라도 반드시 시도한다.

## 절차

### 1. 대상 논문 확인

```
findings/_fetch_results.json의 needsTier3 배열을 읽는다.
각 항목: { "doi": "...", "attempts": [...], "reason": "..." }
```

5편 이상이면 사용자에게 경고한다 (토큰 비용 높음).

### 2. EZproxy URL 구성

사용자가 `.env`에 설정한 `PROXY_BASE_URL`을 사용한다.
프록시 URL은 해당 베이스에 원본 논문 URL(또는 DOI URL)을 그대로 이어 붙인 값이다.

```
프록시 URL = ${PROXY_BASE_URL}https://doi.org/{doi}
```

`.env`에서 `PROXY_BASE_URL`을 직접 읽어 쓰거나, 이미 `scripts/read-paper.js`의 `PROXY_BASE` export를 참조하는 것이 안전하다.
`PROXY_ENABLED=false`이면 프록시 URL 구성을 건너뛰고 원본 URL로 바로 접근한다.

### 3. 페이지 접근

```
browser_navigate → 프록시 URL
```

10초 대기 후 `browser_snapshot`으로 페이지 상태 확인:
- 로그인 페이지 → 로그인 처리 후 재시도
- Cloudflare 챌린지 → 15초 추가 대기 후 재확인
- 논문 페이지 → 추출 진행

### 4. 섹션별 청크 추출

`browser_evaluate`로 섹션별 텍스트를 추출한다. 한 번에 3000자 이하로 제한:

```javascript
// 추출 스크립트 예시 (섹션 1: 제목 + 초록 + 서론)
(() => {
  const parts = [];
  // 제목
  const h1 = document.querySelector('h1');
  if (h1) parts.push('# ' + h1.innerText.trim());
  // 초록
  const abs = document.querySelector('[data-test="abstract"], .abstract, #abstract');
  if (abs) parts.push('## Abstract\n' + abs.innerText.trim());
  // 서론 (첫 번째 섹션)
  const sections = document.querySelectorAll('.c-article-section__content, article section, .article-section__content');
  if (sections[0]) parts.push('## Introduction\n' + sections[0].innerText.trim().substring(0, 3000));
  return parts.join('\n\n').substring(0, 3000);
})()
```

```javascript
// 추출 스크립트 예시 (섹션 2: Results + Discussion)
(() => {
  const sections = document.querySelectorAll('.c-article-section__content, article section, .article-section__content');
  const parts = [];
  for (const sec of sections) {
    const h = sec.previousElementSibling;
    const title = h ? h.innerText.trim() : '';
    if (/Results?|Discussion|Findings/i.test(title)) {
      parts.push('## ' + title + '\n' + sec.innerText.trim().substring(0, 3000));
    }
  }
  return parts.join('\n\n').substring(0, 3000);
})()
```

### 5. 추가 섹션 추출 (필요시)

위 2회 추출로 부족하면 추가 섹션을 추출한다:
- Conclusion
- Experimental / Methods
- 나머지 본문

논문 1편당 최대 10회 `browser_evaluate` 호출.

### 6. 청크 합치기 및 저장

추출된 청크를 합쳐서 Write 도구로 저장:

```
findings/raw_texts/{doi-slug}.md
```

파일 상단에 메타 정보를 주석으로 추가:
```markdown
<!-- fetch-paper: tier=3, source=mcp-chunked, timestamp=... -->
```

### 7. 콘텐츠 검증 (수동)

저장한 파일이 다음 기준을 충족하는지 직접 판단한다:
- 3000자 이상인가?
- 학술 섹션 키워드 (Introduction, Results, Discussion 등) 1개 이상 포함?
- Cloudflare/paywall/login 문구가 주된 내용이 아닌가?

통과 → 증거 카드 보강 진행
실패 → `[전문 불가 - 모든 티어 실패]` 태그 부착

### 8. 페이지 닫기

추출 완료 후:
```
browser_navigate → about:blank
```

## 로그인 처리

페이지가 로그인 페이지인 경우:
1. `browser_snapshot`으로 로그인 폼 확인
2. `browser_type`으로 ID/PW 입력 (.env의 `PROXY_PORTAL_ID` / `PROXY_PORTAL_PW`)
3. `browser_click`으로 로그인 버튼 클릭
4. 5초 대기 후 `browser_snapshot`으로 결과 확인
5. 성공 시 원래 프록시 URL로 재이동

학교마다 로그인 폼 셀렉터가 다를 수 있다. `.env`의 `PROXY_LOGIN_ID_SELECTOR` / `PROXY_LOGIN_PW_SELECTOR` / `PROXY_LOGIN_SUBMIT_SELECTOR` / `PROXY_LOGIN_PRECLICK_SELECTOR`가 설정되어 있으면 해당 값을 우선 사용한다.

## 주의사항

- 티어 3은 토큰이 많이 드므로 **티어 1+2를 먼저 반드시 시도**한 후에만 사용
- 한 세션에서 5편 이상 처리 시 사용자에게 경고
- Cloudflare 챌린지를 MCP로도 통과하지 못하면 `[전문 불가]` 처리
- `browser_evaluate` 결과가 빈 문자열이면 선택자를 변경하여 재시도
