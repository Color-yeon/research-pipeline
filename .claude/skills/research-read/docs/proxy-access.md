# EZproxy 접근 절차 상세

## 개요

고려대학교 EZproxy를 경유하여 논문 전문에 접근하는 절차를 정리한다.
Playwright MCP의 `browser_run_code`를 사용하여 본문 텍스트만 추출한다.

---

## URL 형식

### 기본 형식

```
https://oca.korea.ac.kr/link.n2s?url=<원본 논문 URL>
```

### 원본 URL 구성 예시

| 출처 | 원본 URL 예시 |
|------|--------------|
| DOI | `https://doi.org/10.1016/j.xxx.2024.001` |
| ScienceDirect | `https://www.sciencedirect.com/science/article/pii/S0001234567` |
| Springer | `https://link.springer.com/article/10.1007/s00000-024-00000-0` |
| Wiley | `https://onlinelibrary.wiley.com/doi/10.1002/xxx.00000` |
| Taylor & Francis | `https://www.tandfonline.com/doi/full/10.1080/00000000.2024.000000` |
| PubMed | `https://pubmed.ncbi.nlm.nih.gov/00000000/` |

### 주의

- URL 인코딩은 하지 않는다 (그대로 붙인다)
- DOI 기반 URL이 가장 안정적이다
- PubMed URL은 프록시를 통해 전문 링크로 리다이렉트될 수 있다

---

## Playwright MCP 도구 사용법

### 사용할 도구

| 도구 | 용도 | 비고 |
|------|------|------|
| `browser_navigate` | 프록시 URL로 페이지 로딩 | 결과 토큰 초과는 무시 (페이지 로딩만 되면 됨) |
| `browser_run_code` | **JS로 본문 텍스트만 추출** | 핵심 도구. 토큰 초과 방지 |
| `browser_close` | 브라우저 닫기 | 논문 읽기 완료 후 반드시 실행 |
| `browser_evaluate` | 특정 섹션 개별 추출 | Methods만 별도 추출 등 |

### 절대 사용 금지

| 도구 | 금지 사유 |
|------|----------|
| `browser_snapshot` | 전체 UI 포함, 항상 토큰 초과. **절대 쓰지 마라.** |
| WebFetch | 논문 본문은 WebFetch로 읽을 수 없다. 검색/DOI 확인 전용. |

---

## 기본 접근 절차 (3단계)

### 1단계: 프록시 URL로 이동

```
browser_navigate(url="https://oca.korea.ac.kr/link.n2s?url=<논문URL>")
```

결과가 토큰 초과로 파일에 저장되어도 **무시하라**. 페이지가 로딩되기만 하면 된다.

### 2단계: browser_run_code로 본문 추출

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
    // 핵심 섹션만 (불필요 섹션 제외)
    const skip = /method|reference|acknowledg|author info|ethics|data avail|code avail|competing|peer review|additional info|extended data|supplementary|source data|rights|about this/i;
    // Nature/Springer 스타일
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
    // 범용 fallback
    if (parts.length <= 2) {
      const main = document.querySelector('article, main, [role="main"]');
      if (main) parts.push(main.innerText.trim().substring(0, 80000));
    }
    return parts.join('\n\n');
  });
}
```

**왜 이 방법을 쓰는가:**
- `browser_navigate`/`browser_snapshot`: 전체 UI(네비, 사이드바, 푸터, 광고) 포함 → 350K+ 글자 → 토큰 초과
- `browser_evaluate`: 본문만 추출해도 126K+ 글자 → 토큰 초과
- `browser_run_code`: 핵심 섹션만 추출 → 토큰 한도 내로 들어옴

### 3단계: 브라우저 닫기

```
browser_close()
```

---

## Methods 별도 추출 (research-methods 스킬용)

Methods는 기본 추출에서 제외된다. 필요하면 별도로 추출:

```javascript
async (page) => {
  return await page.evaluate(() => {
    // Nature/Springer
    const sec = [...document.querySelectorAll('.c-article-section__content')].find(s => {
      const h = s.previousElementSibling;
      return h && /^method/i.test(h.innerText.trim());
    });
    if (sec) return '## Methods\n' + sec.innerText.trim();
    // Elsevier
    const elSec = document.querySelector('#sec-methods, .Methods');
    if (elSec) return '## Methods\n' + elSec.innerText.trim();
    return 'METHODS_NOT_FOUND';
  });
}
```

※ Methods는 보통 60K+ 글자로 매우 길다. 토큰 초과 시 파일에 저장된 경로를 Read로 분할 읽기.

---

## References 별도 추출 (research-snowball 스킬용)

참고문헌도 기본 추출에서 제외된다. Snowball 추적 시 별도 추출:

```javascript
async (page) => {
  return await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.c-article-section__content')].find(s => {
      const h = s.previousElementSibling;
      return h && /^reference/i.test(h.innerText.trim());
    });
    if (sec) return sec.innerText.trim();
    const refList = document.querySelector('#references, .references, .ref-list');
    if (refList) return refList.innerText.trim();
    return 'REFERENCES_NOT_FOUND';
  });
}
```

---

## 토큰 초과 fallback (극단적으로 긴 논문)

`browser_run_code` 결과마저 초과하는 경우 (매우 드묾):

1. 결과가 파일로 저장된 경로를 확인한다
2. Read 도구로 분할하여 읽는다:

```
Read(file_path="저장된경로", offset=1, limit=500)
Read(file_path="저장된경로", offset=500, limit=500)
... 끝까지 반복
```

3. **논문 전체를 반드시 읽어야 한다** — 일부만 읽고 멈추지 마라

---

## 접근 실패 시 대안

### 실패 유형별 대응

| 실패 유형 | 대응 |
|----------|------|
| EZproxy 로그인 만료 | 사용자에게 `bash scripts/setup-auth.sh` 재실행 요청 |
| 프록시 경유해도 접근 불가 | 초록만 수집 + `[전문 미확인]` 태그 |
| 페이지 로딩 실패 | 1회 재시도 후 실패 시 `[전문 미확인]` 태그 |
| 논문 삭제/이동 | DOI로 다른 URL 검색 시도 후 실패 시 `[전문 미확인]` 태그 |

### [전문 미확인] 태그 처리

접근 실패 시 증거 카드에 아래를 추가:
```markdown
| 전문 접근 | [전문 미확인] - 사유: {실패 사유} |
```
