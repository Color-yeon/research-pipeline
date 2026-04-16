#!/bin/bash
# [DEPRECATED] 이 스크립트는 이전 버전의 파이프라인용입니다.
# 현재는 /research-tasks 스킬이 prd.json을 생성합니다.
# 새 파이프라인: 검색+Tier1/2전문수집 → 신뢰성 → Tier3재시도 → 분석
#
# 이전 3단계 구조: 검색+읽기시도 → 못읽은것 Chrome읽기 → 통합분석+재검색
set -euo pipefail

CONFIG="${1:?사용법: $0 research-config.json}"
export RESEARCH_CONFIG="$CONFIG"
export RESEARCH_OUTPUT="${2:-prd.json}"

python3 << 'PYTHON_SCRIPT'
import json
import os
from itertools import combinations

config_path = os.environ["RESEARCH_CONFIG"]
with open(config_path) as f:
    config = json.load(f)

topic = config["topic"]
keywords = config["keywords"]
sub_questions = config.get("sub_questions", [])
special = config.get("special_instructions", "")
time_range = config.get("time_range", "제한 없음")
exp_needed = config.get("experiment_design_needed", True)
known_papers = config.get("known_papers", [])
known_authors = config.get("known_authors", [])

combos = []
for r in range(1, len(keywords) + 1):
    for combo in combinations(keywords, r):
        combos.append(list(combo))

stories = []
task_num = 1
priority = 1

# ============================================================
# Phase 1: 검색 + WebFetch 읽기 시도
# 읽힌 것 → findings/{조합}.md
# 못 읽힌 것 → findings/{조합}_blocked.json
# ============================================================

phase1_ids = []

# 전체 주제
sid = f"DEEP-{task_num:03d}"
phase1_ids.append(sid)
stories.append({
    "id": sid,
    "title": f"[검색+읽기] 전체 주제: {topic[:40]}",
    "description": f"""WebSearch로 논문을 검색하고, WebFetch로 전문 읽기를 시도한다.

연구 주제: {topic}
시간 범위: {time_range}
{f'특별 지시: {special}' if special else ''}

하위 연구 질문:
{chr(10).join(f'- {q}' for q in sub_questions) if sub_questions else '- (없음)'}

{f'알려진 핵심 논문: {", ".join(known_papers)}' if known_papers else ''}
{f'알려진 핵심 저자: {", ".join(known_authors)}' if known_authors else ''}

**작업 흐름 (논문 하나마다):**
1. WebSearch로 논문 발견 (제목, DOI)
2. WebFetch로 전문 읽기 시도
   - 성공 → 증거 카드 작성 → findings/full_topic.md에 추가
   - 실패 (403 등) → findings/full_topic_blocked.json에 DOI 추가
3. 다음 논문으로

**출력:**
- `findings/full_topic.md` — 읽기 성공한 논문의 증거 카드 + DOI 목록
- `findings/full_topic_blocked.json` — 읽기 실패한 논문 목록:
  ```json
  [{{"title": "...", "doi": "https://doi.org/...", "journal": "...", "reason": "403"}}]
  ```""",
    "acceptanceCriteria": [
        "다중 소스 검색 (OpenAlex, Semantic Scholar, arXiv, Google Scholar)",
        "최소 10개 이상 쿼리 변형",
        "눈덩이(Snowball) 추적",
        "WebFetch 성공 → findings/full_topic.md에 증거 카드",
        "WebFetch 실패 → findings/full_topic_blocked.json에 DOI 저장",
        "커버리지 보고 작성"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["search-read"],
    "notes": "Chrome MCP는 이 단계에서 사용하지 마라. WebFetch만 시도하고 실패하면 blocked에 기록."
})
task_num += 1

# 키워드 조합별
for combo in combos:
    combo_name = " + ".join(combo)
    combo_filename = "_".join(combo).replace(" ", "-")
    sid = f"DEEP-{task_num:03d}"
    phase1_ids.append(sid)

    stories.append({
        "id": sid,
        "title": f"[검색+읽기] 키워드: {combo_name}",
        "description": f"""키워드 [{combo_name}]으로 검색 + WebFetch 읽기 시도.

연구 주제: {topic}
시간 범위: {time_range}

이전 findings를 읽고 이미 수집된 논문(DOI 기준)은 스킵.

**작업 흐름:** 검색 → WebFetch 시도 → 성공이면 증거카드, 실패면 blocked.json
**출력:**
- `findings/{combo_filename}.md` — 읽기 성공 논문
- `findings/{combo_filename}_blocked.json` — 읽기 실패 논문""",
        "acceptanceCriteria": [
            f"키워드 [{combo_name}]으로 다중 소스 검색",
            "최소 5개 쿼리 변형",
            "중복 체크 (이전 findings 참조)",
            f"성공 → findings/{combo_filename}.md",
            f"실패 → findings/{combo_filename}_blocked.json",
            "커버리지 보고"
        ],
        "priority": priority,
        "passes": False,
        "labels": ["search-read", "combo"],
        "dependsOn": [phase1_ids[0]]
    })
    task_num += 1

priority += 1

# ============================================================
# Phase 2: Chrome MCP로 못 읽은 논문만 읽기
# findings/*_blocked.json → Chrome MCP → findings/*_chrome.md
# ============================================================

chrome_id = f"DEEP-{task_num:03d}"
stories.append({
    "id": chrome_id,
    "title": "[Chrome 읽기] 접근 제한 논문 전문 읽기",
    "description": f"""**모든 *_blocked.json 파일의 논문을 Chrome MCP로 읽는다.**

1. findings/ 디렉토리에서 모든 *_blocked.json 파일을 읽는다
2. 각 논문에 대해:
   a. `mcp__chrome-mcp__chrome_navigate` → `${PROXY_BASE_URL}<DOI>` (PROXY_BASE_URL은 .env 값)
   b. `mcp__chrome-mcp__chrome_get_visible_text` → 텍스트 추출
      (토큰 초과로 파일 저장 시 → Read 도구로 300줄씩 나눠 읽기. 포기하지 마라!)
   c. 증거 카드 작성
   d. `mcp__chrome-mcp__chrome_close_tab` → 탭 닫기
3. 결과를 findings/chrome_readings.md에 저장

**이 태스크에서는:**
- WebSearch 사용 금지 (검색은 Phase 1에서 끝남)
- `chrome_get_content` 사용 금지 (HTML → 토큰 초과)
- `chrome_get_visible_text`만 사용""",
    "acceptanceCriteria": [
        "모든 *_blocked.json 파일의 논문을 Chrome MCP로 읽기",
        "각 논문에 증거 카드 작성",
        "findings/chrome_readings.md에 저장",
        "DOI 목록 포함",
        "WebSearch 사용 금지"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["chrome-read"],
    "dependsOn": phase1_ids,
    "notes": "blocked.json이 비어있거나 없으면 즉시 COMPLETE."
})
task_num += 1
priority += 1

# ============================================================
# Phase 3: 통합 분석 + 추가 탐색
# Phase 1 + Phase 2 결과를 합쳐서 분석, 빠진 부분 재검색
# ============================================================

integrate_id = f"DEEP-{task_num:03d}"
stories.append({
    "id": integrate_id,
    "title": "[통합분석] 전체 결과 통합 + 추가 탐색",
    "description": f"""Phase 1(WebFetch)과 Phase 2(Chrome)의 결과를 통합 분석한다.

1. findings/*.md + findings/chrome_readings.md를 모두 읽는다
2. 전체 논문 목록을 통합 정리
3. 분석 중 빠진 부분이나 추가 궁금한 점이 발견되면:
   - WebSearch로 추가 검색
   - 필요시 Chrome MCP로 읽기
4. 통합 분석 결과를 findings/integrated_analysis.md에 저장

연구 주제: {topic}
하위 질문:
{chr(10).join(f'- {q}' for q in sub_questions) if sub_questions else '(없음)'}""",
    "acceptanceCriteria": [
        "모든 findings를 통합 분석",
        "빠진 부분 발견 시 추가 검색 + 읽기",
        "findings/integrated_analysis.md에 저장",
        "DOI 목록 포함"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["integrate"],
    "dependsOn": [chrome_id]
})
task_num += 1
priority += 1

# ============================================================
# Phase 4: 감사(Audit)
# ============================================================
audit_id = f"DEEP-{task_num:03d}"
stories.append({
    "id": audit_id,
    "title": "감사(Audit): 빠진 논문 검증",
    "description": """통합 분석 후 빠진 논문이 없는지 최종 검증.
1. 전체 논문 목록 대비 다른 키워드로 재검색
2. citing papers 역추적
3. 누락 발견 시 Chrome MCP로 읽기
4. findings/audit_report.md에 결과 저장""",
    "acceptanceCriteria": [
        "전체 논문 목록 정리",
        "대안 쿼리 재검색",
        "누락 발견 시 Chrome MCP로 읽기",
        "findings/audit_report.md에 저장"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["audit"],
    "dependsOn": [integrate_id]
})
task_num += 1
priority += 1

# ============================================================
# Phase 5: 신뢰도 / 저자 / 실험설계
# ============================================================
stories.append({
    "id": f"DEEP-{task_num:03d}",
    "title": "신뢰도 낮은 논문 중 중요 발견 정리",
    "description": "findings에서 [LOW-CREDIBILITY] 논문 수집, 중요 발견 별도 보고서.",
    "acceptanceCriteria": ["LOW-CREDIBILITY 수집", "중요 발견 선별", "findings/low_credibility_important.md", "DOI 포함"],
    "priority": priority, "passes": False, "labels": ["analysis"],
    "dependsOn": [audit_id]
})
task_num += 1

stories.append({
    "id": f"DEEP-{task_num:03d}",
    "title": "핵심 저자 및 연구 랩 추적",
    "description": "반복 등장 저자/랩 식별 + 최근 논문 조사.",
    "acceptanceCriteria": ["저자/랩 5명+ 식별", "최근 논문 정리", "findings/authors_labs.md", "DOI 포함"],
    "priority": priority, "passes": False, "labels": ["analysis"],
    "dependsOn": [audit_id]
})
task_num += 1

if exp_needed:
    stories.append({
        "id": f"DEEP-{task_num:03d}",
        "title": "실험 설계 지원: 참고 논문 및 조건 제안",
        "description": f"연구 주제: {topic}\n문헌조사 기반 실험 설계 지원.",
        "acceptanceCriteria": ["참고 논문 10-15개", "실험 조건 비교표", "findings/experiment_design.md", "DOI 포함"],
        "priority": priority, "passes": False, "labels": ["analysis"],
        "dependsOn": [audit_id]
    })
    task_num += 1

priority += 1

# ============================================================
# Phase 6: Notion 보고서
# ============================================================
parent_id = f"DEEP-{task_num:03d}"
stories.append({
    "id": parent_id,
    "title": f"Notion 부모 페이지: [심층조사] {topic[:30]}",
    "description": "Notion 부모 페이지 생성. URL을 findings/notion_parent_url.txt에 저장.",
    "acceptanceCriteria": ["부모 페이지 생성", "URL 저장", "설정 기록 하위 페이지"],
    "priority": priority, "passes": False, "labels": ["notion", "parent"],
    "dependsOn": [audit_id]
})
task_num += 1

for combo in combos:
    combo_name = " + ".join(combo)
    combo_filename = "_".join(combo).replace(" ", "-")
    stories.append({
        "id": f"DEEP-{task_num:03d}",
        "title": f"Notion: {combo_name}",
        "description": f"findings/{combo_filename}.md + chrome_readings.md 중 해당 내용 → Notion.",
        "acceptanceCriteria": ["Notion 페이지 작성", "DOI 포함", "URL 기록"],
        "priority": priority, "passes": False, "labels": ["notion"],
        "dependsOn": [parent_id]
    })
    task_num += 1

for name, fn in [("전체 주제", "full_topic"), ("통합 분석", "integrated_analysis"),
                  ("신뢰도 주의", "low_credibility_important"),
                  ("핵심 연구자", "authors_labs")]:
    stories.append({
        "id": f"DEEP-{task_num:03d}",
        "title": f"Notion: {name}",
        "description": f"findings/{fn}.md → Notion.",
        "acceptanceCriteria": ["Notion 페이지 작성", "DOI 포함", "URL 기록"],
        "priority": priority, "passes": False, "labels": ["notion"],
        "dependsOn": [parent_id]
    })
    task_num += 1

if exp_needed:
    stories.append({
        "id": f"DEEP-{task_num:03d}",
        "title": "Notion: 실험 설계 가이드",
        "description": "findings/experiment_design.md → Notion.",
        "acceptanceCriteria": ["Notion 페이지 작성", "DOI 포함", "URL 기록"],
        "priority": priority, "passes": False, "labels": ["notion"],
        "dependsOn": [parent_id]
    })
    task_num += 1

priority += 1

stories.append({
    "id": f"DEEP-{task_num:03d}",
    "title": "Notion 최종 종합 보고서",
    "description": "모든 Notion 페이지 참조, 종합 분석, 각 페이지 링크 포함, DOI 목록.",
    "acceptanceCriteria": ["종합 보고서", "모든 페이지 링크", "추가 연구 방향", "DOI 포함"],
    "priority": priority, "passes": False, "labels": ["notion", "synthesis"],
    "dependsOn": [s["id"] for s in stories if "notion" in s.get("labels", [])]
})

prd = {
    "name": f"심층 참고문헌 조사: {topic[:50]}",
    "description": f"키워드 {keywords}: 검색→Chrome읽기→통합분석→보고",
    "userStories": stories
}

output_path = os.environ.get("RESEARCH_OUTPUT", "prd.json")
with open(output_path, "w") as f:
    json.dump(prd, f, ensure_ascii=False, indent=2)

p1 = len([s for s in stories if "search-read" in s.get("labels", [])])
p2 = len([s for s in stories if "chrome-read" in s.get("labels", [])])
p3 = len([s for s in stories if "integrate" in s.get("labels", [])])
p4 = len([s for s in stories if "audit" in s.get("labels", [])])
p5 = len([s for s in stories if "analysis" in s.get("labels", [])])
p6 = len([s for s in stories if "notion" in s.get("labels", [])])

print(f"prd.json 생성 완료:")
print(f"  키워드: {keywords}")
print(f"  조합 수: {len(combos)}")
print(f"  Phase 1 검색+WebFetch: {p1}개")
print(f"  Phase 2 Chrome 읽기:   {p2}개")
print(f"  Phase 3 통합 분석:     {p3}개")
print(f"  Phase 4 감사:          {p4}개")
print(f"  Phase 5 분석:          {p5}개")
print(f"  Phase 6 Notion:        {p6}개")
print(f"  총: {len(stories)}개")
PYTHON_SCRIPT
