#!/bin/bash
# 동향 탐구 — prd.json 생성
# research-config.json에서 키워드를 읽고 동향 탐구용 태스크 생성
set -euo pipefail

CONFIG="${1:?사용법: $0 research-config.json}"
export RESEARCH_CONFIG="$CONFIG"
export RESEARCH_OUTPUT="${2:-prd.json}"

python3 << 'PYTHON_SCRIPT'
import json
import os

config_path = os.environ["RESEARCH_CONFIG"]
with open(config_path) as f:
    config = json.load(f)

topic = config["topic"]
keywords = config["keywords"]  # 1-2개
focus_areas = config.get("focus_areas", [])
special = config.get("special_instructions", "")
known_reviews = config.get("known_reviews", [])

keyword_str = " + ".join(keywords)
stories = []
task_num = 1
priority = 1

# === Stage A: 고품질 리뷰 논문 탐색 ===
stories.append({
    "id": f"TREND-{task_num:03d}",
    "title": f"고품질 리뷰 논문 탐색: {keyword_str}",
    "description": f"""분야 [{keyword_str}]에 대한 고품질 리뷰(Review) 논문을 탐색한다.

주제: {topic}
키워드: {keyword_str}
{f'관심 하위 영역: {", ".join(focus_areas)}' if focus_areas else ''}
{f'특별 지시: {special}' if special else ''}
{f'알려진 리뷰 논문: {", ".join(known_reviews)}' if known_reviews else ''}

검색 전략:
1. "{keyword_str} review" 로 다중 소스 검색 (WebSearch, OpenAlex, S2, arXiv, Google Scholar)
2. "systematic review", "survey", "state-of-the-art" 변형 쿼리
3. Citation 수 + Impact Factor 기준으로 정렬
4. **사기성/predatory 논문은 완전 제외**
5. 상위 3-5개 리뷰 논문 선정

선정 기준:
- Citation 수가 많은 것
- IF 높은 저널에 게재된 것
- 최신성 (가능한 최근 것)
- 해당 분야를 포괄적으로 다루는 것""",
    "acceptanceCriteria": [
        "다중 소스에서 리뷰 논문 검색",
        "citation 수 + IF 기준 필터링",
        "predatory 저널 완전 제외",
        "3-5개 고품질 리뷰 논문 선정",
        "각 리뷰 논문의 증거 카드 작성",
        "findings/review_selection.md에 선정 결과 + 근거 저장",
        "DOI 목록 포함"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["trend", "review-search"]
})
task_num += 1
priority += 1

# === Stage B: 리뷰 논문 참고문헌 전수 조사 (리뷰별 각각) ===
# 리뷰 논문 수를 사전에 알 수 없으므로 5개 태스크 생성 (빈 리뷰는 스킵)
review_ids = []
for i in range(1, 6):
    tid = f"TREND-{task_num:03d}"
    review_ids.append(tid)
    stories.append({
        "id": tid,
        "title": f"리뷰 논문 {i} — 참고문헌 전수 조사",
        "description": f"""findings/review_selection.md에서 선정된 리뷰 논문 {i}번의 참고문헌을 전수 조사한다.

**만약 리뷰 논문 {i}번이 선정되지 않았다면, 즉시 COMPLETE 신호를 보내라.**

수행할 작업:
1. 해당 리뷰 논문의 Reference 전체 목록 추출
2. 각 참고 논문을 검색하여 정보 수집 (제목, 저자, DOI, 핵심 내용)
3. 눈덩이(Snowball) 추적: 특히 중요한 Ref의 Ref도 추적
4. 연구 흐름/계보 정리 (시간순)
5. 이 리뷰에서 인용된 논문 중 핵심 논문 식별

주의: 참고문헌 하나도 빠지면 안 됨. 전수 조사가 핵심.""",
        "acceptanceCriteria": [
            f"리뷰 논문 {i}번의 참고문헌 전체 목록 추출",
            "각 참고 논문 정보 수집 (DOI 포함)",
            "연구 흐름/계보 정리",
            f"findings/review_{i}_refs.md에 저장",
            "커버리지 보고 (전체 Ref 수 vs 조사 완료 수)",
            "DOI 목록 포함"
        ],
        "priority": priority,
        "passes": False,
        "labels": ["trend", f"review-{i}"],
        "dependsOn": ["TREND-001"]
    })
    task_num += 1

priority += 1

# === Stage C: 최신 트렌드 파악 ===
stories.append({
    "id": f"TREND-{task_num:03d}",
    "title": f"최신 트렌드 파악: {keyword_str}",
    "description": f"""리뷰 논문에 언급되지 않은 최근 논문과 트렌드를 파악한다.

수행할 작업:
1. 최근 1-2년 논문 중 리뷰에 없는 것을 집중 탐색
2. 다중 쿼리 전략 (동의어, 하위 분야, 방법론 키워드 등)
3. Citation이 빠르게 증가하는 논문 식별 (rising stars)
4. 현재 주요 학회(NeurIPS, ICML, ICLR, ACL 등 분야별)에서 다루는 주제
5. 요즘 사람들이 집중하는 연구 방향 파악
6. predatory 논문 완전 제외

분류:
- 가장 citation이 많은 최근 연구
- 현재 각광받는 연구 방향
- 떠오르는 새로운 접근법""",
    "acceptanceCriteria": [
        "리뷰에 없는 최근 논문 탐색",
        "최소 5개 이상 쿼리 변형 사용",
        "citation 급증 논문 식별",
        "주요 학회 최근 발표 확인",
        "predatory 논문 제외",
        "findings/trend_latest.md에 저장",
        "DOI 목록 포함"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["trend", "latest"],
    "dependsOn": review_ids
})
task_num += 1
priority += 1

# === Stage D: 감사(Audit) ===
audit_id = f"TREND-{task_num:03d}"
stories.append({
    "id": audit_id,
    "title": "감사(Audit): 빠진 논문 검증",
    "description": """모든 조사가 완료된 후, 빠진 논문이 없는지 검증한다.

1. findings/ 전체를 읽어 수집된 논문 전체 목록 파악
2. 완전히 다른 키워드/표현으로 재검색
3. 주요 논문의 citing papers 역추적
4. 누락 발견 시 해당 findings에 추가""",
    "acceptanceCriteria": [
        "전체 논문 목록 정리",
        "대안 키워드로 재검색",
        "citing papers 역추적",
        "findings/audit_report.md에 감사 결과 저장"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["trend", "audit"],
    "dependsOn": [f"TREND-{task_num - 1:03d}"]
})
task_num += 1
priority += 1

# === Stage E: 핵심 연구자/랩 ===
stories.append({
    "id": f"TREND-{task_num:03d}",
    "title": "핵심 연구자 및 연구 랩 정리",
    "description": "반복 등장하는 저자/연구 그룹 식별 + 최근 활동 조사",
    "acceptanceCriteria": [
        "핵심 저자/랩 식별",
        "최근 논문 및 연구 방향 정리",
        "findings/authors_labs.md에 저장",
        "DOI 목록 포함"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["trend", "authors"],
    "dependsOn": [audit_id]
})
task_num += 1
priority += 1

# === Stage F: Notion 보고서 ===
# 부모 페이지 생성
parent_id = f"TREND-{task_num:03d}"
stories.append({
    "id": parent_id,
    "title": f"Notion 부모 페이지 생성: [동향탐구] {keyword_str}",
    "description": f"""Notion에 동향 탐구 부모 페이지를 생성한다.
페이지 제목: [동향탐구] {keyword_str}
페이지 ID/URL을 findings/notion_parent_url.txt에 저장.
연구 설정 기록 하위 페이지도 생성.""",
    "acceptanceCriteria": [
        "Notion 부모 페이지 생성",
        "findings/notion_parent_url.txt에 URL 저장",
        "연구 설정 기록 하위 페이지 생성"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["notion", "parent"],
    "dependsOn": [audit_id]
})
task_num += 1

# 리뷰별 Ref 분석 페이지
for i in range(1, 6):
    stories.append({
        "id": f"TREND-{task_num:03d}",
        "title": f"Notion 보고서: 리뷰 논문 {i} 참고문헌 분석",
        "description": f"findings/review_{i}_refs.md의 내용을 Notion 페이지로 작성. 리뷰 {i}번이 없으면 스킵.",
        "acceptanceCriteria": [
            f"findings/review_{i}_refs.md를 Notion 페이지로 작성 (파일 존재 시)",
            "DOI 목록 포함",
            "페이지 URL을 findings/notion_pages.txt에 추가"
        ],
        "priority": priority,
        "passes": False,
        "labels": ["notion", f"review-{i}-page"],
        "dependsOn": [parent_id]
    })
    task_num += 1

# 최신 트렌드 페이지
stories.append({
    "id": f"TREND-{task_num:03d}",
    "title": "Notion 보고서: 최신 트렌드",
    "description": "findings/trend_latest.md를 Notion 페이지로 작성.",
    "acceptanceCriteria": [
        "findings/trend_latest.md를 Notion 페이지로 작성",
        "DOI 목록 포함",
        "페이지 URL을 findings/notion_pages.txt에 추가"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["notion"],
    "dependsOn": [parent_id]
})
task_num += 1

# 저자/랩 페이지
stories.append({
    "id": f"TREND-{task_num:03d}",
    "title": "Notion 보고서: 핵심 연구자 & 랩",
    "description": "findings/authors_labs.md를 Notion 페이지로 작성.",
    "acceptanceCriteria": [
        "findings/authors_labs.md를 Notion 페이지로 작성",
        "DOI 목록 포함",
        "페이지 URL을 findings/notion_pages.txt에 추가"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["notion"],
    "dependsOn": [parent_id]
})
task_num += 1
priority += 1

# 최종 종합 보고서
stories.append({
    "id": f"TREND-{task_num:03d}",
    "title": "Notion 동향 종합 보고서 작성",
    "description": f"""모든 Notion 페이지가 생성된 후, 동향 종합 보고서를 작성한다.

findings/notion_pages.txt에서 생성된 모든 페이지 URL을 읽고:
1. 분야 [{keyword_str}]의 전체 동향 종합
2. 리뷰 논문에서 파악한 연구 계보/흐름
3. 최신 트렌드 요약 + 해당 페이지 링크
4. 핵심 연구자/랩 요약 + 페이지 링크
5. 향후 연구 방향 전망
6. ## DOI 목록""",
    "acceptanceCriteria": [
        "모든 하위 페이지를 참조한 종합 보고서",
        "각 섹션에 해당 페이지 링크 포함",
        "향후 연구 방향 전망 포함",
        "DOI 목록 포함",
        "Notion 부모 페이지 하위에 생성"
    ],
    "priority": priority,
    "passes": False,
    "labels": ["notion", "synthesis"],
    "dependsOn": [s["id"] for s in stories if "notion" in s.get("labels", [])]
})

# prd.json 작성
prd = {
    "name": f"동향 탐구: {keyword_str}",
    "description": f"분야 [{keyword_str}]의 동향 파악: 리뷰 논문 기반 전수 조사 + 최신 트렌드",
    "userStories": stories
}

output_path = os.environ.get("RESEARCH_OUTPUT", "prd.json")
with open(output_path, "w") as f:
    json.dump(prd, f, ensure_ascii=False, indent=2)

print(f"prd.json 생성 완료:")
print(f"  - 키워드: {keywords}")
print(f"  - 총 태스크 수: {len(stories)}")
print(f"  - 출력: {output_path}")
PYTHON_SCRIPT
