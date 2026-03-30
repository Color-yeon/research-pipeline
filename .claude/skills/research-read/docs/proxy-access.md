# EZproxy 접근 절차 상세

## 개요

고려대학교 EZproxy를 경유하여 논문 전문에 접근하는 절차를 정리한다.
**반드시 `scripts/read-paper.js` 스크립트를 사용한다.**
Playwright MCP 직접 호출(browser_navigate, browser_run_code, browser_snapshot 등)은 **금지**한다.

### 왜 Playwright MCP 직접 호출을 금지하는가

| 문제 | 원인 |
|------|------|
| **타임아웃** | Playwright MCP의 action 타임아웃이 5초로 하드코딩 — EZproxy 페이지가 5초 내에 렌더링 불가 |
| **토큰 초과** | MCP 도구 결과의 10,000 토큰 한도 — 논문 HTML이 44,000+ 토큰으로 항상 초과 |
| **토큰 낭비** | browser_navigate가 전체 HTML(350K+ 문자)을 반환 — 불필요한 토큰 소비 |

스크립트는 이 문제를 모두 회피한다:
- 타임아웃: 45초 (충분)
- 토큰 제한: 없음 (파일 시스템에 저장 → Read로 분할 읽기)
- 추출 방식: JS로 본문만 추출 + 80KB 제한

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

## 스크립트 사용법

### 단일 논문 읽기

```bash
node scripts/read-paper.js <DOI>
```

결과: `findings/raw_texts/{doi-slug}.md`

### 참고문헌 포함 (Snowball용)

```bash
node scripts/read-paper.js --refs <DOI>
```

본문과 함께 References 섹션도 추출한다.

### 배치 처리 (_blocked.json)

```bash
node scripts/read-paper.js --batch findings/<키워드>_blocked.json
```

### 전체 _blocked.json 일괄 처리

```bash
for f in findings/*_blocked.json; do
  node scripts/read-paper.js --batch "$f"
done
```

---

## 스크립트 실행 후 처리

1. `findings/raw_texts/` 디렉토리의 결과 파일 목록 확인
2. 각 파일을 Read 도구로 읽기 (필요시 offset/limit으로 분할)
3. 읽은 내용을 기반으로 해당 findings 파일의 증거 카드 보강:
   - 방법론, 핵심 발견, 한계점 필드 업데이트
   - `[전문 미확인]` 태그 제거
4. 스크립트 실행 실패한 논문은 `[전문 미확인]` 태그 유지

---

## Methods 별도 추출 (research-methods 스킬용)

스크립트의 기본 추출에서 Methods는 제외된다. Methods가 필요하면:

```bash
# 스크립트로 전체 본문을 추출한 후
node scripts/read-paper.js <DOI>

# 결과 파일에서 Methods 섹션을 Read로 읽기
# findings/raw_texts/{doi-slug}.md 에서 "## Methods" 이후 부분 확인
```

※ 스크립트의 skip 패턴에서 Methods를 포함하려면 `--include-methods` 옵션 추가 (향후 구현)

---

## References 별도 추출 (research-snowball 스킬용)

```bash
node scripts/read-paper.js --refs <DOI>
```

결과 파일의 하단에 References 섹션이 포함된다.

---

## 접근 실패 시 대안

### 실패 유형별 대응

| 실패 유형 | 대응 |
|----------|------|
| EZproxy 로그인 만료 | `node scripts/setup-auth.js` 재실행 후 재시도 |
| 프록시 경유해도 접근 불가 | 초록만 수집 + `[전문 미확인]` 태그 |
| 페이지 로딩 실패 | 1회 재시도 후 실패 시 `[전문 미확인]` 태그 |
| 논문 삭제/이동 | DOI로 다른 URL 검색 시도 후 실패 시 `[전문 미확인]` 태그 |

### [전문 미확인] 태그 처리

접근 실패 시 증거 카드에 아래를 추가:
```markdown
| 전문 접근 | [전문 미확인] - 사유: {실패 사유} |
```
