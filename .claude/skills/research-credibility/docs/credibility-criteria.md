# 신뢰성 평가 기준 상세

## 1. Impact Factor 기준 (분야별 top 저널)

### IF 등급 분류

| 등급 | IF 범위 | 의미 |
|------|---------|------|
| 최상위 | IF > 10.0 | 분야 최고 수준 (Nature, Science, Cell 등) |
| 상위 | IF 5.0 ~ 10.0 | 분야 상위 10% |
| 중상위 | IF 2.0 ~ 5.0 | 분야 상위 25% |
| 중위 | IF 1.0 ~ 2.0 | 일반 peer-reviewed |
| 하위 | IF < 1.0 | 주의 필요 |
| 미등록 | IF 없음 | 추가 검증 필수 |

### 분야별 보정

- 의생명 분야: IF가 전반적으로 높으므로 IF 3.0 이상을 중상위로 분류
- 수학/인문학: IF가 전반적으로 낮으므로 IF 1.0 이상이면 양호
- 컴퓨터과학: 학회 논문(conference paper) 비중이 높으므로 학회 등급(A*/A/B/C) 함께 확인
- 공학: IF 2.0 이상이면 양호한 수준

### IF 확인 방법

1. WebSearch로 `"{저널명} impact factor {현재연도}"` 검색
2. Journal Citation Reports (JCR) 데이터 참조
3. Scimago Journal Rank (SJR) 교차 확인: `site:scimagojr.com "{저널명}"`

## 2. Beall's List 체크 방법

### 검색 절차

1. **출판사 확인**: WebSearch로 `"Beall's list {출판사명}"` 검색
2. **저널 확인**: WebSearch로 `"Beall's list {저널명}"` 검색
3. **아카이브 확인**: Beall's List 원본은 삭제되었으므로 아카이브 버전 참조
   - WebSearch: `"beallslist.net {출판사명}"`
   - WebSearch: `"predatory journal {저널명}"`
4. **Cabells' Predatory Reports**: 유료 DB이지만 WebSearch로 관련 정보 확인 가능

### Beall's List 주요 기준 (Jeffrey Beall의 원래 기준)

- 투명성 부족: 편집위원 정보 미공개, 연락처 불분명
- 공격적 마케팅: 스팸 이메일로 투고 권유
- 비정상 APC: 논문 처리 비용이 비정상적으로 저렴
- 빠른 심사: 제출~수락 1~2주 (정상적 peer review 불가능)
- 저널명 모방: 유명 저널과 유사한 이름 사용
- 허위 IF 표시: 실제 JCR IF가 아닌 자체 지표 사용

## 3. MDPI 판별 기준

### MDPI 저널이 의심스러운 경우

MDPI(Multidisciplinary Digital Publishing Institute)는 합법적 출판사이나, 일부 저널/관행이 의심을 받는다.

#### 레드 플래그 (경고 신호)

| 지표 | 의심 기준 | 확인 방법 |
|------|-----------|-----------|
| 심사 기간 | 제출~수락 14일 미만 | 논문 메타데이터에서 Received/Accepted 날짜 확인 |
| Special Issue | 연간 Special Issue 수가 일반 논문 수보다 많음 | 저널 홈페이지에서 Special Issue 목록 확인 |
| 편집위원 | Guest Editor가 해당 분야 비전문가 | Guest Editor 프로필 확인 |
| APC | 논문당 APC가 $2,000 이상인데 IF가 낮음 | 저널 홈페이지에서 APC 확인 |
| 초청 이메일 | 저자가 MDPI로부터 투고 요청 이메일을 받았다고 언급 | 논문 내용/토론에서 확인 |

#### 판별 절차

1. MDPI 저널인지 확인 (`mdpi.com` 도메인)
2. 해당 저널의 JCR IF 확인
3. 논문의 심사 기간 확인 (Received/Accepted 날짜)
4. Special Issue 소속 여부 확인
5. 레드 플래그 2개 이상이면 `[LOW-CREDIBILITY]` 부여

### MDPI 저널 중 비교적 신뢰할 수 있는 경우

- JCR IF가 분야 평균 이상
- 심사 기간이 2개월 이상
- Regular Issue 게재
- 편집위원이 해당 분야 전문가

## 4. Retraction Watch 검색 방법

### 검색 절차

1. **논문 제목으로 검색**
   ```
   WebSearch: "retraction watch" "{논문 제목}"
   ```

2. **저자명으로 검색**
   ```
   WebSearch: "retraction watch" "{제1저자 성명}"
   ```

3. **DOI로 검색**
   ```
   WebSearch: "retracted" "{DOI}"
   ```

4. **Retraction Watch Database 직접 검색**
   ```
   WebFetch: http://retractiondatabase.org/RetractionSearch.aspx 에서 검색
   ```

### 철회 유형

| 유형 | 의미 | 처리 |
|------|------|------|
| Retraction | 완전 철회 | `[RETRACTED]` + `[EXCLUDE]` |
| Expression of Concern | 우려 표명 | `[CONCERN]` + `[LOW-CREDIBILITY]` |
| Correction/Erratum | 수정 | 내용 확인 후 판단 |
| Withdrawal | 저자 자진 철회 | 사유 확인 후 판단 |

## 5. 인용 패턴 비정상 지표

### 비정상 패턴 유형

#### 1) 자기인용 카르텔
- **정의**: 소수 저자 그룹이 서로의 논문을 반복 인용
- **탐지**: 인용 논문 저자 목록에서 동일 저자가 30% 이상 반복 출현
- **태그**: `[CITATION-CARTEL-SUSPECT]`

#### 2) 인용 급증 (Citation Spike)
- **정의**: 출판 직후 비정상적으로 빠른 인용 축적
- **탐지**: 출판 1년 이내 인용수가 분야 평균의 5배 이상
- **태그**: `[CITATION-SPIKE]`

#### 3) 인용-다운로드 불일치
- **정의**: 인용수는 많은데 다운로드/열람수가 극히 적음
- **탐지**: 인용수/다운로드수 비율이 비정상
- **태그**: `[CITATION-DOWNLOAD-MISMATCH]`

#### 4) 단일 출처 인용 집중
- **정의**: 인용의 대부분이 특정 1~2개 저널에서만 발생
- **탐지**: 인용 저널 다양성 분석
- **태그**: `[NARROW-CITATION-SOURCE]`

### 인용 패턴 분석 도구

1. **Semantic Scholar API**: 인용 논문 목록과 저자 정보 확인
2. **OpenAlex**: 인용 데이터 및 저자 네트워크 분석
3. **Google Scholar**: 인용수 및 인용 논문 목록
4. **Dimensions**: 인용 맥락(Citation Context) 확인 가능
