# 알려진 사기성/의심 저널 및 출판사 목록

## 1. 확인된 사기성 출판사 (Beall's List 상위)

아래 출판사는 Beall's List에 등재되었거나, 학계에서 널리 사기성으로 인정된 출판사이다.
이 출판사의 저널에 게재된 논문은 `[EXCLUDE]` 처리한다.

### 즉시 제외 대상

| 출판사 | 사유 |
|--------|------|
| OMICS International | Beall's List 확정, FTC 소송 패소 |
| WASET (World Academy of Science, Engineering and Technology) | 가짜 학회 + 가짜 저널 운영 |
| Scientific Research Publishing (SCIRP) | 대규모 predatory 출판 |
| Academic Journals (academicjournals.org) | 스팸 투고 권유, 비정상 심사 |
| David Publishing | 논문 공장 의심 |
| Science Domain International (SDI) | Beall's List 등재 |
| Juniper Publishers | 공격적 마케팅, 저품질 심사 |
| MedCrave | 의료 분야 predatory |
| Longdom Publishing | OMICS 계열사 |
| iMedPub | OMICS 계열사 |

## 2. 의심 대상 출판사 (주의 필요)

아래 출판사는 일부 저널이 의심을 받지만, 전체가 사기성은 아닌 경우이다.
개별 저널/논문 단위로 추가 검사가 필요하다.

### MDPI (Multidisciplinary Digital Publishing Institute)

- **상태**: 합법적 출판사이나 일부 관행이 의심받음
- **의심 저널**: Special Issue가 과도하게 많은 저널
- **판별 기준**:
  - JCR IF 존재 여부
  - 심사 기간 (2주 미만이면 의심)
  - Special Issue 비율 (70% 이상이면 의심)
  - Guest Editor 자격
- **처리**: 개별 논문 단위로 판별, 의심 시 `[LOW-CREDIBILITY]`

### Frontiers

- **상태**: 대부분 합법적이나 일부 저널/논문에 우려
- **의심 저널**: 일부 Specialty Section에서 심사 품질 저하 보고
- **판별 기준**:
  - JCR IF 확인 (Frontiers 저널별 IF 차이 큼)
  - 심사 기간
  - 해당 Specialty Section의 평판
- **처리**: IF가 분야 평균 이상이면 `[MEDIUM-CREDIBILITY]`, 아니면 추가 확인

### Hindawi

- **상태**: 2023년 Wiley에 인수 후 대규모 철회 사태 발생
- **의심 사유**: 논문 공장(paper mill) 관련 대량 철회
- **판별 기준**:
  - 2023년 이후 게재 논문은 특히 주의
  - Wiley 철회 목록과 대조
  - Special Issue 게재 여부
- **처리**: Retraction Watch에서 해당 논문 철회 여부 반드시 확인

## 3. 경계선 저널 판별 방법

### 판별이 어려운 경우의 처리 절차

```
1. JCR/Scopus 등재 여부 확인
   - 등재됨 → 2단계로
   - 미등재 → [LOW-CREDIBILITY] + 추가 확인

2. Impact Factor 확인
   - 분야 평균 이상 → 3단계로
   - 분야 평균 미만 → 추가 주의 표시

3. 심사 기간 확인
   - 2개월 이상 → [MEDIUM-CREDIBILITY] 이상 가능
   - 2주 미만 → [LOW-CREDIBILITY]

4. 저자/기관 확인
   - 저명 기관 + 높은 h-index → [HIGH-CREDIBILITY] 가능
   - 미확인 기관 → [LOW-CREDIBILITY]

5. 최종 판단
   - 위 지표를 종합하여 등급 결정
   - 판단이 어려우면 [MEDIUM-CREDIBILITY] + [NEEDS-REVIEW] 태그
```

### 추가 레드 플래그

아래 신호가 2개 이상이면 `[LOW-CREDIBILITY]`:

- 저널 웹사이트에 편집위원 정보 미공개
- 연락처가 무료 이메일(gmail, yahoo 등)만 제공
- 저널명이 유명 저널과 매우 유사 (예: "International Journal of..." 패턴 남발)
- APC(논문 처리 비용) 정보가 불투명
- 과장된 Acceptance Rate 광고
- 자체 제작 Impact Factor 사용 (JCR IF가 아닌 "Global IF", "Universal IF" 등)
- Open Access인데 저자가 비용을 모르거나 언급하지 않음
- 편집위원이 다른 분야 전문가

## 4. 알려진 가짜 지표 (Fake Metrics)

아래 지표는 JCR Impact Factor가 아니며, 사기성 저널이 자주 사용한다:

| 가짜 지표 | 설명 |
|-----------|------|
| Global Impact Factor (GIF) | 비공인 지표 |
| Universal Impact Factor (UIF) | 비공인 지표 |
| InfoBase Index | 비공인 지표 |
| Cosmos Impact Factor | 비공인 지표 |
| Journal Impact Factor (JIF) - 비JCR | JCR이 아닌 자체 산출 |
| International Scientific Indexing (ISI) | Thomson Reuters ISI와 무관 |

저널이 위 지표를 사용하면 `[LOW-CREDIBILITY]` 이상 부여.

## 5. 신뢰할 수 있는 인덱싱 서비스

아래 인덱싱에 등재된 저널은 기본적으로 `[MEDIUM-CREDIBILITY]` 이상:

| 인덱싱 서비스 | 신뢰 수준 |
|--------------|-----------|
| Web of Science (Clarivate) | 높음 |
| Scopus (Elsevier) | 높음 |
| PubMed/MEDLINE | 높음 (의생명) |
| DOAJ (Directory of Open Access Journals) | 보통~높음 |
| IEEE Xplore | 높음 (공학/CS) |
| ACM Digital Library | 높음 (CS) |
| MathSciNet | 높음 (수학) |
