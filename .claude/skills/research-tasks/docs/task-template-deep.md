# Deep 모드 태스크 시퀀스 상세

심층조사(Deep) 모드의 각 Phase에 대한 상세 설명과 의존성 규칙.

---

## Phase 1: 검색 + 전문 수집

### 목적
각 키워드 조합에 대해 다중 소스 검색을 수행하고, 발견된 논문의 전문을 즉시 확보하여 보강된 증거 카드를 작성한다.

### 태스크 분할
- `keyword_combinations`의 각 조합마다 **별도 태스크** 생성
- 예: 조합이 3개면 → 태스크 3개 (id: 1, 2, 3)
- 각 태스크는 **병렬 실행 가능** (의존성 없음)

### 각 태스크의 내용
1. 해당 키워드 조합으로 **5개 이상의 쿼리 변형** 생성
2. 다중 소스 검색: WebSearch, OpenAlex, Semantic Scholar, arXiv, Google Scholar
3. 발견된 논문마다 증거 카드 작성
4. **DOI가 확인된 논문마다 즉시 전문 수집** (Tier 1 → Tier 2 순서)
   - `node scripts/fetch-paper.js --tier1-only --json <DOI>`
   - Tier 1 실패 시 `node scripts/fetch-paper.js --tier2-only --json <DOI>`
   - 성공 시 증거 카드 즉시 보강 (방법론, 핵심 발견, 한계점)
   - 실패 시 `[전문 확보 대기 - Tier 3 필요]` 태그 부착
5. 기존 findings 파일과 대조하여 중복 제거
6. `findings/{키워드조합}.md`에 결과 저장

### 의존성
- 없음 (시작 태스크)

### 예상 출력
- `findings/{키워드조합}.md` (조합별 1개씩, 전문 확보된 논문은 보강된 증거 카드 포함)
- `findings/raw_texts/{doi-slug}.md` (전문 확보 성공한 논문)

---

## Phase 2: 신뢰성 검사

### 목적
수집된 모든 논문의 저널 신뢰도를 평가하고, DOI 실존을 검증한다.

### 태스크 내용
1. Phase 1에서 수집된 모든 논문의 저널명 확인
2. 각 저널의 Impact Factor, 인덱싱 여부 확인
3. Predatory journal 여부 검사 (Beall's List 참조)
4. 모든 DOI에 대해 WebFetch로 실존 검증
5. 신뢰도 낮은 논문에 `[LOW-CREDIBILITY]` 태그 부착
6. 증거 카드의 신뢰도 필드 업데이트

### 의존성
- Phase 1의 **모든 태스크** 완료 후 실행

### 예상 출력
- 기존 findings 파일의 신뢰도 필드 업데이트
- `findings/low_credibility_important.md` (신뢰도 낮지만 중요한 발견)

---

## Phase 3: Tier 3 재시도

### 목적
Phase 1에서 Tier 1/2로 전문 확보에 실패한 논문을 Playwright MCP(Tier 3)로 재시도한다.

### 태스크 내용
1. findings/ 파일에서 `[전문 확보 대기 - Tier 3 필요]` 태그가 붙은 논문 목록 추출
2. 대상 논문이 없으면 이 Phase를 **자동 스킵** (즉시 passes: true)
3. 대상 논문이 있으면 `/research-read pending` 실행
4. Playwright MCP로 EZproxy 경유 전문 접근 시도
5. 성공 시 증거 카드 보강, 실패 시 `[전문 불가 - 모든 티어 실패]` 태그 부착

### 의존성
- Phase 2 완료 후 실행

### 예상 출력
- `findings/raw_texts/{doi-slug}.md` (Tier 3 성공 논문)
- 기존 findings 파일의 증거 카드 보강

### 스킵 조건
- `[전문 확보 대기 - Tier 3 필요]` 태그가 붙은 논문이 0편이면 자동 완료

---

## Phase 4: Snowball 추적

### 목적
참고문헌을 재귀적으로 추적하여 빠진 논문을 수집한다.

### 태스크 내용
1. `research-snowball` 스킬 실행
2. 인자: `all` (전체 findings 대상)
3. 최대 깊이 3까지 추적
4. 각 depth별 결과 파일 생성

### 의존성
- Phase 3 완료 후 실행

### 예상 출력
- `findings/snowball_depth1.md`
- `findings/snowball_depth2.md`
- `findings/snowball_depth3.md` (해당 시)

---

## Phase 5: 방법론 분석

### 목적
수집된 논문의 실험 방법론을 비판적으로 분석한다.

### 태스크 내용
1. `research-methods` 스킬 실행
2. 인자: `all` (전체 findings 대상)
3. 각 논문의 Methods 섹션 평가
4. 방법론 등급(A~F) 부여

### 의존성
- Phase 3 완료 후 실행 (**Phase 4와 병렬 가능**)

### 예상 출력
- `findings/methods_critique.md`

---

## Phase 6: 통합 분석

### 목적
전체 문헌조사 결과를 종합하고, 연구 갭을 식별하며, 커버리지 감사를 수행한다.

### 태스크 내용
1. `research-analyze` 스킬 실행
2. 전체 findings 읽기 및 논문 목록 통합
3. 논문 간 관계 분석 (인용 네트워크, 시간적 흐름)
4. 연구 갭 식별
5. 커버리지 감사 (추가 검색으로 누락 검증)
6. 핵심 저자/랩 정리

### 의존성
- Phase 4 **그리고** Phase 5 **모두** 완료 후 실행

### 예상 출력
- `findings/integrated_analysis.md`
- `findings/audit_report.md`
- `findings/authors_labs.md`

---

## Phase 7: 비교 분석

### 목적
논문 간 결과를 직접 비교하고, 합의점과 논쟁점을 정리한다.

### 태스크 내용
1. 통합 분석 결과를 기반으로 논문 간 비교 매트릭스 작성
2. 동일 주제의 상충하는 결과 식별 및 원인 분석
3. 연구 커뮤니티의 합의(consensus) 수준 평가
4. 향후 연구 방향 제안

### 의존성
- Phase 6 완료 후 실행

### 예상 출력
- `findings/comparison_matrix.md`

---

## Phase 8: 노션 기록

### 목적
모든 결과를 노션 데이터베이스로 구조화하여 기록한다.

### 태스크 내용
1. `research-notion` 스킬 실행
2. 인자: `all`
3. 문헌 DB 생성 + 논문별 페이지 생성
4. DOI 목록 페이지 생성
5. 뷰 생성 (연도별, 신뢰도별)

### 의존성
- Phase 7 완료 후 실행

### 예상 출력
- 노션 데이터베이스 + 페이지
- `findings/notion_pages.txt`

---

## 의존성 다이어그램

```
Phase 1 (검색+전문수집) ─┬─ 태스크 1-1 (조합 A) ──┐  ← Tier 1/2로 즉시 전문 확보
                          ├─ 태스크 1-2 (조합 B) ──┤
                          └─ 태스크 1-3 (조합 C) ──┘
                                                    │
                                                    ▼
                          Phase 2 (신뢰성 검사) ────┐
                                                    │
                                                    ▼
                   Phase 3 (Tier 3 재시도) ─────────┤  ← 실패분만, 대상 없으면 스킵
                                                    │
                              ┌─────────────────────┼─────────────────────┐
                              ▼                                           ▼
                    Phase 4 (Snowball)                      Phase 5 (방법론 분석)
                              │                                           │
                              └─────────────────────┬─────────────────────┘
                                                    │
                                                    ▼
                          Phase 6 (통합 분석) ──────┐
                                                    │
                                                    ▼
                          Phase 7 (비교 분석) ──────┐
                                                    │
                                                    ▼
                          Phase 8 (노션 기록)
```
