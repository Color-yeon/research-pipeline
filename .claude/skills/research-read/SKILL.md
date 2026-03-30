---
name: research-read
description: "대학 프록시(EZproxy)를 경유하여 논문 전문을 읽는 스킬. Node.js 스크립트로 논문에 접근하여 토큰을 절약한다. '논문 읽기', '전문 접근', '차단된 논문 읽기', 'blocked papers' 요청 시 사용."
---

# 논문 전문 읽기 스킬

## 개요

Paywall 등으로 차단된 논문의 전문을 대학 프록시(고려대 EZproxy)를 경유하여 읽는다.
`scripts/read-paper.js` 스크립트가 Playwright로 논문에 접근하고 텍스트를 추출한다.
LLM 토큰을 절약하기 위해 **브라우저 조작은 스크립트가 처리**하고, Claude는 결과 파일만 읽는다.

## 입력 ($ARGUMENTS)

`$ARGUMENTS`로 아래 중 하나를 받는다:

1. **단일 DOI**: `"10.1234/abcd"`
2. **단일 URL**: `"https://doi.org/10.1234/abcd"`
3. **DOI 목록** (쉼표 구분): `"10.1234/abcd, 10.5678/efgh"`
4. **_blocked.json 경로**: `"findings/키워드조합_blocked.json"`
5. **findings/ 디렉토리**: `"findings/"` — 모든 _blocked.json 파일을 자동 처리

## 절차

### 방법 1: 스크립트 기반 (기본 — 토큰 절약)

#### 단일 논문

```bash
node scripts/read-paper.js <DOI>
```

결과가 `findings/raw_texts/{doi-slug}.md`에 저장된다. Read 도구로 내용을 읽고 증거 카드를 보강한다.

#### 배치 처리 (_blocked.json)

```bash
node scripts/read-paper.js --batch findings/4D-QSAR_blocked.json
```

_blocked.json의 모든 논문을 순차 처리한다. 결과는 `findings/raw_texts/` 디렉토리에 논문별 파일로 저장된다.

#### References 포함 (snowball용)

```bash
node scripts/read-paper.js --refs <DOI>
```

본문과 함께 References 섹션도 추출한다.

#### 전체 _blocked.json 일괄 처리

```bash
for f in findings/*_blocked.json; do
  node scripts/read-paper.js --batch "$f"
done
```

### 스크립트 실행 후 처리

1. `findings/raw_texts/` 디렉토리의 결과 파일 목록 확인
2. 각 파일을 Read 도구로 읽기
3. 읽은 내용을 기반으로 해당 findings 파일의 증거 카드 보강:
   - 방법론, 핵심 발견, 한계점 필드 업데이트
   - `[전문 미확인]` 태그 제거
4. 스크립트 실행 실패한 논문(접근 실패 파일)은 `[전문 미확인]` 태그 유지

### 스크립트 실패 시 처리

스크립트가 실패하면 (로그인 만료, 출판사 차단 등):
1. 에러 메시지를 확인하고 원인을 파악한다
2. 로그인 만료 시: `node scripts/setup-auth.js` 재실행 후 재시도
3. 출판사 차단 시: 초록만 수집 + `[전문 미확인]` 태그 부착
4. **Playwright MCP 직접 호출(browser_navigate, browser_run_code 등)은 사용하지 않는다** — 타임아웃(5s) 및 토큰 초과(10K 한도) 문제 발생

## EZproxy 인증

- 최초 1회: `node scripts/setup-auth.js` 실행 (브라우저에서 고려대 포털 로그인)
- 세션 만료 시: 동일 명령으로 재인증
- 스크립트는 `.playwright-profile/Default/Cookies`의 쿠키를 임시 프로필에 복사하여 사용

## 출력

- `findings/raw_texts/{doi-slug}.md` — 추출된 논문 본문 (스크립트 출력)
- 기존 `findings/*.md` 파일의 증거 카드 보강 (Claude가 수동 업데이트)
- 접근 실패 시 `[전문 미확인]` 태그 유지

## 참고 문서

- `scripts/read-paper.js` — 논문 읽기 스크립트 소스
- `<skill-dir>/docs/proxy-access.md` — EZproxy 접근 절차 상세
