---
name: research-read
description: "대학 프록시(EZproxy)를 경유하여 논문 전문을 읽는 스킬. Playwright MCP로 고려대 EZproxy를 통해 논문에 접근하고 텍스트를 추출한다. '논문 읽기', '전문 접근', '차단된 논문 읽기', 'blocked papers' 요청 시 사용."
---

# 논문 전문 읽기 스킬 (Playwright MCP)

## 개요

Paywall 등으로 차단된 논문의 전문을 대학 프록시(고려대 EZproxy)를 경유하여 읽는다.
Playwright MCP를 사용하여 브라우저를 통해 논문에 접근하고, 텍스트를 추출한다.
Playwright의 persistent profile 모드로 EZproxy 인증이 자동 유지된다.

## EZproxy URL 패턴

```
https://oca.korea.ac.kr/link.n2s?url=<원본 논문 URL>
```

원본 URL을 그대로 뒤에 붙인다. URL 인코딩은 하지 않는다.

예시:
```
https://oca.korea.ac.kr/link.n2s?url=https://www.sciencedirect.com/science/article/pii/S0001234567890123
```

## 입력 ($ARGUMENTS)

`$ARGUMENTS`로 아래 중 하나를 받는다:

1. **DOI 목록**: 읽을 논문의 DOI를 쉼표로 구분
   - 예: `"10.1234/abcd, 10.5678/efgh"`

2. **_blocked.json 경로**: `research-search` 스킬이 생성한 차단 논문 목록 파일
   - 예: `"findings/키워드조합_blocked.json"`

3. **단일 URL**: 직접 논문 URL 제공
   - 예: `"https://doi.org/10.1234/abcd"`

## Playwright MCP 접근 절차

**반드시 아래 절차만 따른다. 다른 도구를 사용하지 마라.**

### 핵심 원칙: browser_run_code로 본문 추출

`browser_navigate`나 `browser_snapshot`은 페이지 전체 UI(네비, 사이드바, 푸터)를 포함하여
토큰 초과가 거의 확실하게 발생한다. **반드시 `browser_run_code`로 본문만 추출하라.**

### 기본 절차 (3단계)

```
1단계: browser_navigate
  url = "https://oca.korea.ac.kr/link.n2s?url=<논문URL>"
  ※ 결과가 토큰 초과로 파일에 저장되어도 무시해도 된다 (페이지 로딩만 되면 됨)

2단계: browser_run_code로 본문 추출
  아래 JS 코드를 사용하여 핵심 섹션만 추출한다 (Methods/References 제외)

3단계: browser_close
  (반드시 브라우저 닫기)
```

### 2단계 상세: 본문 추출 코드

```javascript
async (page) => {
  return await page.evaluate(() => {
    const parts = [];
    // 제목
    const title = document.querySelector('h1.c-article-title, h1[data-test="article-title"], article h1, .article-title, .highwire-cite-title, #page-title');
    if (title) parts.push('# ' + title.innerText.trim());
    // 저자
    const authors = document.querySelector('.c-article-author-list, [data-test="author-list"], .author-list, .highwire-cite-authors');
    if (authors) parts.push('**Authors:** ' + authors.innerText.trim().substring(0, 500));
    // 핵심 섹션만 (Methods, References, Extended Data, Supplementary 등 제외)
    const skip = /method|reference|acknowledg|author info|ethics|data avail|code avail|competing|peer review|additional info|extended data|supplementary|source data|rights|about this/i;
    // Nature 스타일
    document.querySelectorAll('.c-article-section__content').forEach(sec => {
      const h = sec.previousElementSibling;
      const headingText = h ? h.innerText.trim() : '';
      if (skip.test(headingText)) return;
      const text = sec.innerText.trim();
      if (text.length > 30) parts.push('## ' + headingText + '\n' + text);
    });
    // Frontiers 스타일 (h2 기반 섹션)
    if (parts.length <= 2) {
      document.querySelectorAll('h2').forEach(h2 => {
        const ht = h2.innerText.trim();
        if (skip.test(ht)) return;
        if (/ORIGINAL RESEARCH|Summary|cookie|privacy|trust in science|statement|author contribution|funding|conflict/i.test(ht)) return;
        let text = '';
        let sib = h2.nextElementSibling;
        while (sib && sib.tagName !== 'H2') {
          if (sib.innerText) text += sib.innerText.trim() + '\n';
          sib = sib.nextElementSibling;
        }
        if (text.length > 30) parts.push('## ' + ht + '\n' + text.trim());
      });
    }
    // Elsevier/ScienceDirect 스타일
    if (parts.length <= 2) {
      document.querySelectorAll('.section-paragraph, .Body .section').forEach(sec => {
        const text = sec.innerText.trim();
        if (text.length > 50 && !skip.test(text.substring(0, 100))) parts.push(text);
      });
    }
    // 범용 fallback: article 또는 main 태그
    if (parts.length <= 2) {
      const main = document.querySelector('article, main, [role="main"]');
      if (main) parts.push(main.innerText.trim().substring(0, 80000));
    }
    return parts.join('\n\n');
  });
}
```

**출판사별 셀렉터가 다르므로** 위 코드는 Nature, Elsevier, Springer, Wiley, 범용을 순서대로 시도한다.

### Methods가 필요할 때 (research-methods 스킬 등)

별도로 Methods 섹션만 추출한다:

```javascript
async (page) => {
  return await page.evaluate(() => {
    const methodsSec = [...document.querySelectorAll('.c-article-section__content')].find(sec => {
      const h = sec.previousElementSibling;
      return h && /^method/i.test(h.innerText.trim());
    });
    return methodsSec ? methodsSec.innerText.trim() : 'METHODS_NOT_FOUND';
  });
}
```

### 토큰 초과 fallback (드문 경우)

`browser_run_code` 결과마저 초과하면 (극단적으로 긴 논문):

1. 결과가 파일로 저장된 경로를 확인한다
2. Read 도구로 분할하여 읽는다:
```
Read(file_path="저장된경로", offset=1, limit=500)
Read(file_path="저장된경로", offset=500, limit=500)
... 끝까지 반복
```

상세 절차는 `<skill-dir>/docs/proxy-access.md` 참조.

## 도구 선택 가이드

WebFetch와 Playwright MCP는 역할이 다르다:

- **WebFetch**: 검색 결과 확인, DOI 검증 등 메타데이터 조회에 적합하다. 하지만 대부분의 학술 출판사는 봇 접근을 차단하므로 논문 본문 추출에는 사용할 수 없다 (403 에러 발생).
- **Playwright MCP**: EZproxy 인증 쿠키를 활용하여 논문 본문에 접근한다. 논문 전문을 읽을 때는 이 도구를 사용해야 한다.

WebFetch에서 403 에러가 발생했다면, 해당 논문은 Playwright MCP로 접근해야 한다는 신호이다.

## 처리 절차

### _blocked.json 입력인 경우

1. `_blocked.json` 파일을 읽는다
2. 각 논문의 `url` 또는 `doi`를 사용하여 EZproxy URL을 구성한다
3. 순차적으로 각 논문에 접근하여 전문을 읽는다
4. 읽은 내용을 기반으로 증거 카드를 갱신한다

### DOI 목록 입력인 경우

1. 각 DOI에 대해 `https://doi.org/<DOI>` 를 원본 URL로 사용한다
2. EZproxy URL을 구성하여 접근한다
3. 전문을 읽고 증거 카드를 작성한다

## 출력

- 읽은 논문의 증거 카드를 해당 `findings/` 파일에 **추가 또는 갱신**한다
- 기존에 초록만 있던 증거 카드를 전문 기반으로 보강한다
- 접근 실패 시 `[전문 미확인]` 태그를 유지하고, 실패 사유를 기록한다

## 주의사항

- Playwright persistent profile에 EZproxy **로그인이 되어 있어야** 한다 (최초 1회 `scripts/setup-auth.sh` 실행)
- 읽은 후 **반드시 탭을 닫아라**
- Playwright로도 접근 실패 시: 초록만 수집 + `[전문 미확인]` 태그

## 참고 문서

- `<skill-dir>/docs/proxy-access.md` -- EZproxy 접근 절차 상세
