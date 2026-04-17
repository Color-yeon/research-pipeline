---
name: research-credibility
description: "논문과 저널의 신뢰성을 검사하고 사기성 논문을 필터링하는 스킬. Beall's List, MDPI 의심 저널, Retraction Watch를 확인하고, 인용 패턴과 저자 검증을 수행한다. '신뢰성 검사', '사기 논문 확인', 'credibility check', 'predatory journal' 요청 시 사용."
---

# 논문 신뢰성 검사 스킬

## 0단계: 선행 조건 검사

이 스킬을 실행하기 전에 **반드시** 아래 명령을 Bash 도구로 실행하라.

```bash
node scripts/lib/pipeline-guard.mjs research-credibility
```

- exit 0 → 통과. 다음 단계로 진행한다.
- exit code 가 0 이 아니면 → stderr 의 사유를 사용자에게 그대로 보고하고
  **실행을 즉시 중단**하라. 필요한 선행 스킬(예: `/research-search`)을
  먼저 수행해야 한다.

Claude Code 에서는 `.claude/settings.json` 의 PreToolUse 훅이 같은 검사를
이벤트 수준에서 추가로 수행한다. 하지만 Codex 경로에서는 이 명령이
유일한 방어선이다.

## 왜 신뢰성 검사가 필요한가

사용자의 논문에 사기성 출처가 포함되면 논문 전체의 신뢰도가 손상된다.
모드에 따라 사기성 논문의 처리 방식이 다르다:

- **Deep 모드 (심층조사)**: 사기성 논문도 일단 수집하되 `[LOW-CREDIBILITY]` 태그를 붙여 별도 관리한다. 관련 논문을 빠짐없이 파악해야 커버리지가 보장되기 때문이다. 다만 사용자가 직접 reference로 사용할지는 별도로 판단한다.
- **Trend 모드 (동향탐구)**: 사기성 논문은 완전히 제외한다. 최신 동향을 파악할 때 과대 포장되거나 신빙성 없는 논문이 섞이면 동향을 잘못 파악하게 되고, 존재하지 않는 트렌드를 실제라고 착각하는 불상사가 생긴다.

## 개요

수집된 논문과 저널의 신뢰성을 체계적으로 검사하여, 사기성(predatory) 논문을 필터링하고 각 논문에 신뢰도 등급을 부여한다.

## 인자

- `$ARGUMENTS`: findings 파일 경로 또는 `"all"` (전체 findings 디렉토리 검사)

`"all"` 지정 시 `findings/` 디렉토리 내 모든 마크다운 파일에서 논문 정보를 추출하여 검사한다.

## 검사 절차

### 1단계: 저널 품질 검사

1. **Beall's List 확인**
   - WebSearch로 `"Beall's list {출판사명}"` 검색
   - WebSearch로 `"predatory journal {저널명}"` 검색
   - 결과에서 해당 저널/출판사가 Beall's List에 등재되어 있는지 확인
   - `<skill-dir>/docs/journal-blacklist.md`의 알려진 목록과 대조

2. **MDPI 판별**
   - MDPI 소속 저널인지 확인
   - MDPI 저널이면 추가 검사:
     - 논문 제출~수락 기간 (2주 미만이면 의심)
     - Special Issue 소속 여부 (Special Issue 남발 저널 의심)
     - 편집위원 소속 기관 확인

3. **Impact Factor 확인**
   - WebSearch로 `"{저널명} impact factor 2024"` 검색
   - 분야별 상위 저널 기준과 비교
   - IF 없는 저널은 추가 주의 표시

### 2단계: 철회 논문 확인 (Retraction Watch)

1. WebSearch로 `"retraction watch {논문 제목}"` 검색
2. WebSearch로 `"retraction watch {저자명}"` 검색
3. WebSearch로 `"retracted {DOI}"` 검색
4. 철회된 논문 발견 시 즉시 `[RETRACTED]` 태그 부착

### 3단계: 인용 패턴 분석

1. **자기인용 비율 확인**
   - Semantic Scholar 또는 OpenAlex에서 인용 데이터 확인
   - 자기인용 비율이 30% 이상이면 `[HIGH-SELF-CITATION]` 태그

2. **비정상 인용 패턴**
   - 출판 직후 급격한 인용수 증가 → 인용 조작 의심
   - 특정 소수 저자 그룹에서만 인용 → 인용 카르텔 의심
   - 인용수 대비 다운로드수 비정상 비율

3. **인용수 맥락 확인**
   - 출판 연도 대비 인용수가 적절한지 평가
   - 동일 분야 유사 논문 대비 인용수 비교

### 4단계: 저자 검증

1. **기관 소속 확인**
   - WebSearch로 저자명 + 소속기관 검색
   - 알려진 연구기관/대학 소속인지 확인
   - 기관이 확인 불가하면 `[UNVERIFIED-AFFILIATION]` 태그

2. **h-index 확인**
   - Google Scholar 프로필 또는 Semantic Scholar에서 h-index 확인
   - 분야 평균 대비 극단적으로 낮으면 주의

3. **연구 이력 확인**
   - 해당 분야에서의 지속적 연구 이력 존재 여부
   - 갑작스러운 분야 전환 시 추가 주의

## 결과 분류

각 논문에 아래 등급 중 하나를 부여한다:

| 등급 | 태그 | 기준 |
|------|------|------|
| 높은 신뢰도 | `[HIGH-CREDIBILITY]` | Top 저널 (Nature, Science, 분야별 상위 저널), 인용수 다수, 유명 기관 소속 저자 |
| 보통 신뢰도 | `[MEDIUM-CREDIBILITY]` | 일반 peer-reviewed 저널, 적절한 인용수, 확인된 기관 소속 |
| 낮은 신뢰도 | `[LOW-CREDIBILITY]` | Predatory 의심 저널, 극소 인용, 미확인 기관, 비정상 인용 패턴 |
| 제외 | `[EXCLUDE]` | Beall's List 확인된 출판사, 철회된 논문, 확인된 사기성 저널 → reference로 부적격 |

### 등급 부여 세부 규칙

- `[HIGH-CREDIBILITY]`: 아래 조건 중 2개 이상 충족
  - 분야 상위 25% 저널 (IF 기준)
  - 인용수 50회 이상 (출판 5년 이내 기준)
  - 저자 h-index 20 이상
  - 저명 기관 (QS 세계 Top 200 대학 또는 국립 연구소)

- `[MEDIUM-CREDIBILITY]`: 아래 조건 충족
  - Peer-reviewed 저널에 게재
  - Beall's List 미등재
  - 저자 기관 확인 가능

- `[LOW-CREDIBILITY]`: 아래 조건 중 1개 이상 해당
  - Beall's List 의심 출판사
  - 자기인용 30% 이상
  - IF 없음 + 인용수 극소
  - 저자 기관 미확인

- `[EXCLUDE]`: 아래 조건 중 1개 이상 해당
  - Retraction Watch에서 철회 확인
  - Beall's List 확정 등재 출판사
  - 명백한 인용 조작 증거

## 출력 파일

### findings/credibility_report.md

```markdown
# 신뢰성 검사 보고서

검사 일시: {날짜}
검사 대상: {파일 경로 또는 "전체"}
총 검사 논문 수: N개

## 요약
| 등급 | 논문 수 |
|------|---------|
| HIGH-CREDIBILITY | N |
| MEDIUM-CREDIBILITY | N |
| LOW-CREDIBILITY | N |
| EXCLUDE | N |

## 상세 결과

### [HIGH-CREDIBILITY] 논문 목록
(논문별 검사 결과)

### [MEDIUM-CREDIBILITY] 논문 목록
(논문별 검사 결과)

### [LOW-CREDIBILITY] 논문 목록
(논문별 검사 결과 + 주의 사유)

### [EXCLUDE] 논문 목록
(논문별 제외 사유)
```

### findings/excluded_papers.md

```markdown
# 제외된 논문 목록

## 제외 사유별 분류

### 철회된 논문
(목록)

### Predatory 저널 게재 논문
(목록)

### 인용 조작 의심 논문
(목록)
```

## 종료 단계: 체크포인트 저장

스킬 실행을 완료하기 직전에 **반드시** 아래 명령을 Bash 도구로 실행하라.

```bash
node scripts/lib/checkpoint.mjs
```

findings/ 전체 상태를 `findings/_checkpoint.json` 에 기록하여 다음 태스크
(또는 컨텍스트 압축 이후) 가 진행 상황을 이어갈 수 있게 한다. 실패해도
스킬은 정상 종료로 간주한다(베스트 에포트).

Claude Code 에서는 `.claude/settings.json` 의 PreCompact 훅이 같은 일을
컨텍스트 압축 직전에 수행한다. 하지만 Codex 경로에서는 이 명령이
유일한 체크포인트 경로다.

## 참고 문서

- `<skill-dir>/docs/credibility-criteria.md` — 신뢰성 평가 기준 상세
- `<skill-dir>/docs/journal-blacklist.md` — 알려진 사기성/의심 저널 목록
