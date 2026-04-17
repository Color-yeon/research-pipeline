---
name: research-intake
description: "연구 문헌조사 파이프라인의 인테이크 스킬. 사용자와 대화하여 연구 주제, 키워드, 하위 질문을 확정하고 research-config.json을 생성한다. '연구 시작', '문헌조사 설정', '연구 주제 설정' 요청 시 사용."
---

# 연구 인테이크 스킬

## 개요

사용자와 대화하여 연구 주제, 키워드, 하위 질문을 확정하고 `research-config.json` 파일을 생성한다.
이 설정 파일은 이후 `research-search`, `research-read` 등 다른 스킬의 입력으로 사용된다.

## 0단계: 기존 승인 확인 + 시작 마커 기록 (필수)

스킬이 실제로 작동을 시작하기 전에 **반드시** 아래 Bash 명령을 실행하라.

```bash
# 1) 이미 승인된 인테이크가 있으면 덮어쓰지 않는다.
#    사용자가 Phase 1(/research-tasks) 중에 실수로 이 스킬을 재호출하거나,
#    Codex 가 혼란으로 다시 인테이크를 시작했을 때 _intake_approved.json 을
#    _intake_in_progress.json 으로 덮어버리는 사고가 반복됐다 (2026-04-17).
#    승인이 이미 있으면 즉시 스킬을 종료하고 사용자에게 그대로 알린다.
if [ -f findings/_intake_approved.json ]; then
  echo ""
  echo "⚠ 이미 승인된 인테이크가 있습니다 (findings/_intake_approved.json)."
  echo "  새 주제로 다시 시작하려면 ./start-research.sh 를 종료하고"
  echo "  'node scripts/lib/project-archive.mjs archive --reason new-topic' 로"
  echo "  기존 작업을 archive/ 로 보존한 뒤 ./start-research.sh deep 을 다시 실행하세요."
  echo ""
  echo "지금은 이 스킬을 종료합니다. 인테이크를 다시 하지 마세요."
  exit 0
fi

# 2) 승인이 없는 정상 경로 — 진행 마커를 만들고 대화를 시작한다.
mkdir -p findings && node -e "const fs=require('fs');fs.writeFileSync('findings/_intake_in_progress.json', JSON.stringify({started_at: new Date().toISOString(), tool: 'research-intake'}, null, 2))"
```

**중요한 해석 규칙**:
- 위 명령이 `이미 승인된 인테이크가 있습니다` 메시지를 출력하며 `exit 0` 으로 끝나면, 절대 **다시 실행하지 말고** 사용자에게 해당 상황을 그대로 전달한 뒤 스킬을 완전히 종료하라. `research-config.json` 이나 `_intake_in_progress.json` 을 어떤 방법으로도 만들지 마라.
- 그 외에 명령이 정상적으로 완료됐다면 (= 승인이 없던 상태) `findings/_intake_in_progress.json` 이 생성된다. 이 마커가 없는 상태에서 에이전트가 `research-config.json` 을 직접 쓰려고 하면 Write 가드가 차단한다. 마커를 만든 뒤에야 사용자와 대화를 시작하라.

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

## 설정 파일 생성 직후: 종료 안내 메시지 (필수)

`research-config.json` 을 Write 로 생성한 직후, 사용자에게 **정확히 아래 블록을 그대로 한국어로 출력하라**. 임의로 줄여 쓰지 말고, "다음 단계" 를 네가 직접 실행하지도 마라. 이 문구가 없으면 사용자는 어떻게 파이프라인을 이어가야 할지 알 수 없다.

```
✓ research-config.json 생성이 완료되었습니다.

다음 단계는 자동으로 이어집니다:
  • 이 채팅을 **Ctrl+C** (또는 `/exit`) 로 종료해 주세요.
  • 종료 즉시 `./start-research.sh` 가 이어받아
    - Phase 1: `/research-tasks` 를 실행해 `prd.json` 을 자동 생성하고,
    - Phase 2: Ralph 무인 실행으로 문헌조사를 시작합니다.

추가로 수정하거나 보완할 내용이 있다면 **Ctrl+C 누르기 전에** 지금 말씀해 주세요.
더 지시하실 내용이 없다면 Ctrl+C 로 이 창을 닫아 주세요.
```

주의:
- 네가 스스로 `/research-tasks` 나 `/research-search` 를 호출하면 안 된다. 인테이크 세션의 유일한 출구는 사용자의 Ctrl+C 이다. 뒤 단계는 `start-research.sh` 가 **새 에이전트 세션** 에서 띄운다.
- "오케이", "좋아요" 같은 짧은 동의만 돌아와도 **"Ctrl+C 로 종료해 주세요"** 라고 한 번 더 안내하라. 사용자가 종료 방법을 모르고 다음 지시를 기다리고 있을 수 있다.
- 아직 승인 센티넬을 기록하지 않았다면 이 안내 메시지를 내보내고 난 뒤 아래 마무리 단계를 실행하라.

## 마무리 단계: 인테이크 승인 센티넬 기록 (필수)

위 종료 안내 메시지를 출력한 뒤, **반드시** 아래 Bash 명령을 실행하여 승인 센티넬을 기록하고 시작 마커를 제거하라.

```bash
node -e "
const fs=require('fs');
const crypto=require('crypto');
const cfg=fs.readFileSync('research-config.json');
const hash=crypto.createHash('sha256').update(cfg).digest('hex');
const parsed=JSON.parse(cfg.toString());
fs.writeFileSync('findings/_intake_approved.json', JSON.stringify({
  approved_at: new Date().toISOString(),
  config_sha256: hash,
  config_path: 'research-config.json',
  mode: parsed.mode,
  keywords: parsed.keywords || []
}, null, 2));
try { fs.unlinkSync('findings/_intake_in_progress.json'); } catch (e) {}
"
```

이 센티넬은 이후 `/research-search`, `/research-tasks`, `fetch-paper.js` 같은 후속 단계가 인테이크 통과 여부를 확인할 때 사용된다. 센티넬 없이 후속 단계를 실행하면 파이프라인 가드가 차단한다.

## 주의사항

- **한국어로 대화하라**
- 사용자의 의도를 정확히 파악할 때까지 성급하게 넘어가지 마라
- 키워드는 사용자가 최종 확인한 것만 사용하라
- 설정 파일 생성 후 반드시 사용자에게 최종 확인을 받아라

## 참고 문서

- `<skill-dir>/docs/intake-deep.md` -- 심층 문헌조사 대화 흐름 상세
- `<skill-dir>/docs/intake-trend.md` -- 동향 탐구 대화 흐름 상세
