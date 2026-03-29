---
name: research-intake
description: "연구 문헌조사 파이프라인의 인테이크 스킬. 사용자와 대화하여 연구 주제, 키워드, 하위 질문을 확정하고 research-config.json을 생성한다. '연구 시작', '문헌조사 설정', '연구 주제 설정' 요청 시 사용."
---

# 연구 인테이크 스킬

## 개요

사용자와 대화하여 연구 주제, 키워드, 하위 질문을 확정하고 `research-config.json` 파일을 생성한다.
이 설정 파일은 이후 `research-search`, `research-read` 등 다른 스킬의 입력으로 사용된다.

## 입력 ($ARGUMENTS)

`$ARGUMENTS`로 연구 모드를 받는다:

- `deep` -- 심층 문헌조사 모드 (모드 1)
- `trend` -- 동향 탐구 모드 (모드 2)
- 미지정 시 -- 사용자에게 모드를 물어본다

## 모드별 분기

### deep 모드 (심층 문헌조사)

심층 문헌조사는 특정 연구 주제에 대해 **모든 관련 논문을 빠짐없이** 수집하는 것이 목표다.

상세 대화 흐름은 `<skill-dir>/docs/intake-deep.md` 참조.

주요 특징:
- 키워드 3-4개 확정
- 하위 연구 질문 3-5개 분해
- 실험 설계 니즈 확인
- 시간 범위 설정
- 제외 영역 확인

### trend 모드 (동향 탐구)

동향 탐구는 특정 분야의 **최신 연구 트렌드를 파악**하는 것이 목표다.

상세 대화 흐름은 `<skill-dir>/docs/intake-trend.md` 참조.

주요 특징:
- 키워드 1-2개 (넓은 범위)
- 관심 하위 영역 확인
- 알려진 리뷰 논문 확인
- 사용자 배경 수준 파악

## 5단계 대화 흐름 요약

### deep 모드

1. **연구 주제 파악**: 연구 목적, 배경, 기존 지식 파악
2. **핵심 키워드 추출 및 확인**: 3-4개 키워드 제안 -> 사용자 확인
3. **하위 연구 질문 분해**: 3-5개 하위 질문 제시 -> 피드백 반영
4. **추가 정보 수집**: 집중/제외 영역, 알려진 논문/저자, 실험 설계 니즈, 시간 범위
5. **설정 파일 생성**: `research-config.json` 생성 -> 최종 확인

### trend 모드

1. **탐구 분야 파악**: 분야, 동기, 기존 이해 수준 파악
2. **키워드 확정**: 1-2개 핵심 키워드 -> 사용자 확인
3. **관심 방향 구체화**: 하위 영역, 응용/방법론 관심, 알려진 리뷰 논문
4. **설정 파일 생성**: `research-config.json` 생성 -> 최종 확인
5. (trend 모드는 4단계로 진행)

## 출력

### research-config.json

deep 모드:
```json
{
  "mode": "deep",
  "topic": "전체 연구 주제 설명",
  "keywords": ["A", "B", "C", "D"],
  "sub_questions": [
    "하위 질문 1",
    "하위 질문 2",
    "하위 질문 3"
  ],
  "special_instructions": "특별 지시사항",
  "known_papers": ["알려진 논문 제목 또는 DOI"],
  "known_authors": ["알려진 저자"],
  "exclude": ["제외할 영역"],
  "time_range": "2020-현재",
  "experiment_design_needed": true,
  "created_at": "2026-03-28T12:00:00"
}
```

trend 모드:
```json
{
  "mode": "trend",
  "topic": "탐구 분야 설명",
  "keywords": ["X", "Y"],
  "focus_areas": ["관심 하위 영역"],
  "special_instructions": "특별 지시사항",
  "known_reviews": ["알려진 리뷰 논문"],
  "known_authors": ["알려진 저자"],
  "created_at": "2026-03-28T12:00:00"
}
```

파일 경로: `/Users/goomba/dev/research-pipeline/research-config.json`

## 주의사항

- **한국어로 대화하라**
- 사용자의 의도를 정확히 파악할 때까지 성급하게 넘어가지 마라
- 키워드는 사용자가 최종 확인한 것만 사용하라
- 설정 파일 생성 후 반드시 사용자에게 최종 확인을 받아라

## 참고 문서

- `<skill-dir>/docs/intake-deep.md` -- 심층 문헌조사 대화 흐름 상세
- `<skill-dir>/docs/intake-trend.md` -- 동향 탐구 대화 흐름 상세
