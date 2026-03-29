---
name: research-deep-read
description: "한 논문을 6개 분석 렌즈(이론/방법/결과/한계/응용/비판)로 병렬 정독하는 스킬. 각 렌즈별 전문 에이전트를 병렬 디스패치하여 다각도 분석 후 통합 리포트를 작성한다. '정독', '심층 읽기', '다각도 분석', 'deep read' 요청 시 사용."
---

# 다중 렌즈 병렬 정독 스킬

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
  1. DOI로 논문 URL 확인 (WebSearch 또는 WebFetch로 `https://doi.org/{DOI}` 확인)
  2. EZproxy를 경유하여 Playwright MCP로 논문 전문 확보
     ```
     browser_navigate → "https://oca.korea.ac.kr/link.n2s?url={논문URL}"
       (토큰 초과 무시, 페이지 로딩만 되면 됨)
     browser_run_code → JS로 본문 텍스트만 추출 (SKILL.md의 추출 코드 참조)
       ※ browser_snapshot은 절대 쓰지 마라 (토큰 초과 확정)
     browser_close → 브라우저 닫기
     ```
  3. 추출된 텍스트를 임시 파일로 저장

- **파일 경로가 주어진 경우**:
  1. Read 도구로 파일 내용 읽기
  2. 논문 텍스트가 너무 길면 섹션별로 나눠서 읽기

- **기존 findings에서 확인**:
  1. `findings/` 디렉토리에 해당 논문 정보가 있는지 확인
  2. 이미 수집된 데이터가 있으면 활용

**본문 추출 JS 코드** (`browser_run_code`에 전달):
```javascript
async (page) => {
  return await page.evaluate(() => {
    const parts = [];
    const title = document.querySelector('h1.c-article-title, h1[data-test="article-title"], article h1, .article-title, .highwire-cite-title, #page-title');
    if (title) parts.push('# ' + title.innerText.trim());
    const authors = document.querySelector('.c-article-author-list, [data-test="author-list"], .author-list, .highwire-cite-authors');
    if (authors) parts.push('**Authors:** ' + authors.innerText.trim().substring(0, 500));
    const skip = /method|reference|acknowledg|author info|ethics|data avail|code avail|competing|peer review|additional info|extended data|supplementary|source data|rights|about this/i;
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
    if (parts.length <= 2) {
      document.querySelectorAll('.section-paragraph, .Body .section').forEach(sec => {
        const text = sec.innerText.trim();
        if (text.length > 50 && !skip.test(text.substring(0, 100))) parts.push(text);
      });
    }
    if (parts.length <= 2) {
      const main = document.querySelector('article, main, [role="main"]');
      if (main) parts.push(main.innerText.trim().substring(0, 80000));
    }
    return parts.join('\n\n');
  });
}
```

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

## 참고 문서

- `<skill-dir>/docs/deep-read-guide.md` — 각 렌즈별 분석 기준과 질문 목록
- `<skill-dir>/agents/lens-theory.md` — 이론 렌즈 에이전트
- `<skill-dir>/agents/lens-methods.md` — 방법 렌즈 에이전트
- `<skill-dir>/agents/lens-results.md` — 결과 렌즈 에이전트
- `<skill-dir>/agents/lens-limitations.md` — 한계 렌즈 에이전트
- `<skill-dir>/agents/lens-application.md` — 응용 렌즈 에이전트
- `<skill-dir>/agents/lens-critique.md` — 비판 렌즈 에이전트
