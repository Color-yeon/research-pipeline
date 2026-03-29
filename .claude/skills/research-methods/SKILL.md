---
name: research-methods
description: "논문의 실험 방법론을 비판적으로 분석하는 스킬. Methods/Materials 섹션을 집중 분석하여 실험 설계의 강점/약점, 재현 가능성, 통계 적절성을 평가한다. '방법론 분석', '실험 설계 비판', 'methods critique' 요청 시 사용."
---

# 방법론 비판적 분석

## 인자

`$ARGUMENTS`: 분석 대상 지정 (다음 중 하나)
- **논문 DOI**: `https://doi.org/10.xxxx/yyyy` — 특정 논문 1편을 분석
- **findings 파일 경로**: `findings/keyword_combination_1.md` — 해당 파일의 모든 논문을 분석
- **`all`**: `findings/` 디렉토리의 모든 논문을 분석

## 분석 절차

### 1단계: 논문 전문 접근

1. 대상 논문의 DOI 또는 URL을 확인한다.
2. **Playwright MCP**로 논문 전문에 접근한다:
   - `browser_navigate` → `https://oca.korea.ac.kr/link.n2s?url=<논문URL>` (토큰 초과 무시)
   - `browser_run_code` → **Methods 섹션만 JS로 추출** (아래 코드 사용)
   - `browser_close` → 브라우저 닫기
3. **browser_snapshot은 절대 쓰지 마라** (토큰 초과 확정)

**Methods 추출 코드** (`browser_run_code`에 전달):
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
    // 범용 fallback
    const main = document.querySelector('article, main');
    if (main) return main.innerText.trim().substring(0, 80000);
    return 'METHODS_NOT_FOUND';
  });
}
```
※ Methods는 60K+ 글자로 매우 길 수 있음. 토큰 초과 시 파일 저장 경로를 Read로 분할 읽기.

### 2단계: 연구 설계 분석

다음 항목을 체계적으로 평가한다:

#### 2-1. 연구 설계 유형
- RCT / 코호트 / 사례-대조 / 횡단면 / 체계적 리뷰 / 메타분석 등
- 설계 유형의 적절성 (연구 질문에 맞는가?)

#### 2-2. 샘플 크기 및 선정
- 샘플 크기(n)는 충분한가?
- 검정력 분석(power analysis)이 수행되었는가?
- 포함/제외 기준이 명확한가?
- 선택 편향(selection bias) 가능성은?

#### 2-3. 통계 방법
- 사용된 통계 검정은 적절한가?
- 다중 비교 보정(multiple comparison correction)이 수행되었는가?
- 효과 크기(effect size)와 신뢰구간이 보고되었는가?
- p-value만 의존하고 있지는 않은가?

#### 2-4. 대조군 설계
- 적절한 대조군이 설정되었는가?
- 위약(placebo) 또는 양성 대조군이 있는가?
- 대조군과 실험군의 기저 특성이 균형인가?

#### 2-5. 블라인딩
- 단일/이중/삼중 블라인딩 여부
- 블라인딩이 적절히 유지되었는가?
- 블라인딩 불가능한 경우 어떤 조치를 취했는가?

#### 2-6. 재현 가능성
- 프로토콜이 충분히 상세한가?
- 사용한 시약/장비/소프트웨어 버전이 기재되었는가?
- 데이터/코드 공개 여부
- 사전 등록(pre-registration) 여부

### 3단계: 강점/약점 요약

각 논문에 대해 다음 형식으로 요약한다:

```markdown
### [논문 제목] — 방법론 분석

| 평가 항목 | 등급 | 세부 내용 |
|-----------|------|-----------|
| 연구 설계 | 적절/부적절/부분적 | |
| 샘플 크기 | 충분/부족/미기재 | |
| 통계 방법 | 적절/부적절/부분적 | |
| 대조군 | 있음/없음/부적절 | |
| 블라인딩 | 이중/단일/없음 | |
| 재현 가능성 | 높음/보통/낮음 | |
| 데이터 공개 | 예/아니오/부분 | |

**주요 강점:**
1. ...
2. ...

**주요 약점:**
1. ...
2. ...

**재현 시 주의사항:**
- ...

**방법론 종합 등급:** A/B/C/D/F
```

### 등급 기준
- **A**: 모든 항목이 적절, 재현 가능성 높음
- **B**: 대부분 적절, 사소한 약점 존재
- **C**: 일부 중요한 약점 존재, 결과 해석에 주의 필요
- **D**: 심각한 방법론적 결함, 결과 신뢰도 낮음
- **F**: 근본적 설계 오류, 결과를 신뢰할 수 없음

## 출력

- `findings/methods_critique.md` — 모든 분석 대상 논문의 방법론 평가 보고서
- 파일 상단에 요약 테이블 포함:
  ```markdown
  ## 방법론 분석 요약

  | 논문 | 설계 | 샘플 | 통계 | 대조군 | 블라인딩 | 재현성 | 종합 |
  |------|------|------|------|--------|----------|--------|------|
  | ... | ... | ... | ... | ... | ... | ... | A~F |
  ```

## 참고 문서

- `docs/methods-checklist.md` — 방법론 평가 체크리스트 상세
- `CLAUDE.md` — 프로젝트 전체 규칙 (논문 전문 접근 절차, 증거 카드 형식)
