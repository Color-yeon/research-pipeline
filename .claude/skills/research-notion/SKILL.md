---
name: research-notion
description: "연구 결과를 노션(Notion) 페이지와 데이터베이스로 구조화하여 기록하는 스킬. findings의 증거 카드를 노션 DB로 변환하고, 논문별 페이지를 생성한다. '노션에 정리', '노션 기록', 'notion report' 요청 시 사용."
---

# 노션(Notion) 연구 결과 기록

## 인자

`$ARGUMENTS`: 기록 대상 지정 (다음 중 하나)
- **findings 파일 경로**: `findings/keyword_combination_1.md` — 해당 파일의 논문만 기록
- **`all`**: `findings/` 디렉토리의 모든 논문을 기록

## 절차

### 1단계: findings 파일 읽기 및 파싱

1. 지정된 findings 파일(또는 전체)을 읽는다.
2. 각 증거 카드에서 다음 정보를 추출한다:
   - 논문 제목, 저자, 연도, 저널, DOI, 인용수
   - 방법론, 핵심 발견, 한계점, 신뢰도
   - 관련 키워드 조합
3. DOI 기준으로 중복을 제거한다.

### 2단계: 노션 DB 생성

**Notion MCP 도구를 사용하여 데이터베이스를 생성한다.**

사용할 도구: `mcp__notion-create-database`

DB 스키마:
```sql
CREATE TABLE (
  "논문 제목" TITLE,
  "저자" RICH_TEXT,
  "연도" NUMBER,
  "저널" RICH_TEXT,
  "DOI" URL,
  "인용수" NUMBER,
  "방법론" RICH_TEXT,
  "신뢰도" SELECT('높음':green, '보통':yellow, '낮음':red),
  "키워드 조합" MULTI_SELECT(),
  "핵심 발견" RICH_TEXT,
  "한계점" RICH_TEXT,
  "전문 확인" CHECKBOX,
  "출처 파일" RICH_TEXT
)
```

- `title` 파라미터: `"[연구 주제] 문헌 데이터베이스"`
- `parent` 파라미터: 사용자가 지정한 노션 페이지 ID (없으면 워크스페이스 루트)

### 3단계: 논문별 페이지 생성

**도구: `mcp__notion-create-pages`**

각 논문에 대해 페이지를 생성한다:

```json
{
  "parent": {"data_source_id": "<2단계에서 받은 data_source_id>"},
  "pages": [
    {
      "properties": {
        "논문 제목": "논문 제목 텍스트",
        "저자": "저자1, 저자2, ...",
        "연도": 2024,
        "저널": "저널명",
        "DOI": "https://doi.org/10.xxxx/yyyy",
        "인용수": 42,
        "방법론": "RCT",
        "신뢰도": "높음",
        "핵심 발견": "핵심 발견 요약",
        "한계점": "주요 한계점",
        "전문 확인": "__YES__",
        "출처 파일": "keyword_combination_1.md"
      },
      "content": "## 증거 카드\n\n[증거 카드 전체 내용]\n\n## 상세 메모\n\n[추가 분석 내용]"
    }
  ]
}
```

- 한 번에 최대 100개 페이지까지 생성 가능하다.
- 100개를 초과하면 배치(batch)로 나누어 생성한다.

### 4단계: DOI 목록 페이지 생성

별도의 노션 페이지로 DOI 목록을 생성한다:

**도구: `mcp__notion-create-pages`**

```json
{
  "parent": {"page_id": "<DB가 속한 부모 페이지>"},
  "pages": [
    {
      "properties": {"title": "DOI 목록"},
      "content": "## DOI 목록\n\n저자 (연도). 제목. 저널. DOI: https://doi.org/...\n..."
    }
  ]
}
```

### 5단계: 뷰 생성 (선택적)

유용한 뷰를 추가로 생성한다:

**도구: `mcp__notion-create-view`**

1. **연도별 정렬 뷰**:
   ```
   type: "table", configure: "SORT BY \"연도\" DESC"
   ```
2. **신뢰도별 필터 뷰**:
   ```
   type: "board", configure: "GROUP BY \"신뢰도\""
   ```
3. **키워드별 갤러리 뷰**:
   ```
   type: "gallery", configure: "GROUP BY \"키워드 조합\""
   ```

### 6단계: 결과 기록

생성된 노션 페이지 URL을 로컬에 기록한다.

## 출력

- **노션**: 문헌 데이터베이스 + 논문별 페이지 + DOI 목록 페이지
- **로컬**: `findings/notion_pages.txt` — 생성된 모든 노션 페이지 URL 목록
  ```
  DB URL: https://www.notion.so/...
  DOI 목록: https://www.notion.so/...
  논문 페이지:
  - [논문 제목 1]: https://www.notion.so/...
  - [논문 제목 2]: https://www.notion.so/...
  ...
  총 N개 페이지 생성 완료
  ```

## 주의사항

- 노션 API 속도 제한에 주의: 페이지 생성 간 적절한 간격을 둔다.
- MULTI_SELECT의 키워드 조합은 실제 사용된 키워드를 옵션으로 동적 추가한다.
- 신뢰도가 `[LOW-CREDIBILITY]` 태그가 붙은 논문은 신뢰도를 `낮음`으로 설정한다.
- DOI가 `[DOI 미검증]`인 논문은 DOI 필드에 텍스트 그대로 기입하고 비고를 남긴다.

## 참고 문서

- `docs/notion-schema.md` — 노션 DB 스키마 정의, 속성 매핑 규칙, 페이지 구조 상세
- `CLAUDE.md` — 프로젝트 전체 규칙 (증거 카드 형식, DOI 규칙)
