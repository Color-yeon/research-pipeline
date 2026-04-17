#!/usr/bin/env node

/**
 * 커버리지 검증기 — 공용 라이브러리 + CLI 진입점
 *
 * 특정 키워드에 대한 findings/ 파일을 점검하여 커버리지 갭(소스/쿼리/논문 수)이
 * 있는지 반환한다. 에이전트 중립적으로 동작하며, 스킬 본문의 마지막 단계에서
 * Bash 도구로 호출되어 "검색 태스크의 자가 검증" 역할을 한다.
 *
 * Claude Code 환경에서는 .claude/settings.json 의 Stop 훅
 * (verify-fix-loop.mjs) 이 같은 로직을 Stop 이벤트 레벨에서 더 촘촘히
 * 방어한다. 이 라이브러리는 Codex 등 해당 훅이 없는 에이전트용이다.
 *
 * ## 사용법 (CLI)
 *   node scripts/lib/coverage-verifier.mjs "<keyword>"
 *   → 갭 없음: exit 0, stdout 에 "✓ coverage ok"
 *   → 갭 있음: exit 1, stdout 에 갭 목록을 한 줄씩 출력
 *
 * ## 사용법 (함수 import)
 *   import { verifyCoverage } from './scripts/lib/coverage-verifier.mjs';
 *   const { ok, gaps, file } = verifyCoverage(keyword);
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');

export const MIN_PAPERS = 3;
export const MIN_QUERY_VARIANTS = 5;

export const REQUIRED_SOURCE_PATTERNS = {
  WebSearch: /WebSearch|웹\s*검색/i,
  OpenAlex: /OpenAlex|openalex\.org/i,
  'Semantic Scholar': /Semantic\s*Scholar|semanticscholar\.org/i,
  arXiv: /arXiv|arxiv\.org/i,
  'Google Scholar': /Google\s*Scholar|scholar\.google/i,
};

/**
 * 키워드 → findings/ 파일 경로 매핑.
 * "A + B + C" 복합 키워드는 (1) + 제거 후 하이픈 연결 전체 매칭,
 * (2) 첫 번째 핵심어 매칭 순으로 시도한다.
 */
export function findFindingsFile(keyword) {
  if (!existsSync(FINDINGS_DIR)) return null;

  const files = readdirSync(FINDINGS_DIR).filter(
    (f) => !f.startsWith('_') && f.endsWith('.md'),
  );

  const parts = keyword
    .split(/\s*\+\s*/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  const fullNormalized = keyword
    .toLowerCase()
    .replace(/[+]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-');

  for (const file of files) {
    const fileLower = file.toLowerCase();
    if (fileLower.includes(fullNormalized)) {
      return join(FINDINGS_DIR, file);
    }
    const firstPart = parts[0]?.replace(/\s+/g, '-');
    if (firstPart && fileLower.includes(firstPart)) {
      return join(FINDINGS_DIR, file);
    }
  }
  return null;
}

/**
 * 키워드에 대한 findings 파일의 커버리지를 검증한다.
 * @returns { ok: boolean, gaps: string[], file: string | null }
 */
export function verifyCoverage(keyword) {
  const file = findFindingsFile(keyword);
  if (!file) {
    return {
      ok: false,
      file: null,
      gaps: [`findings 파일을 찾을 수 없습니다 (키워드: "${keyword}").`],
    };
  }

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return {
      ok: false,
      file,
      gaps: [`findings 파일 읽기 실패: ${file}`],
    };
  }

  const gaps = [];

  // 1) 논문 수 (### 헤딩 개수)
  const paperCount = (content.match(/^### /gm) || []).length;
  if (paperCount < MIN_PAPERS) {
    gaps.push(
      `논문 ${paperCount}편만 수집됨 (최소 ${MIN_PAPERS}편 필요).`,
    );
  }

  // 2) 소스 커버리지
  const sourcesFound = [];
  const sourcesMissing = [];
  for (const [source, pattern] of Object.entries(REQUIRED_SOURCE_PATTERNS)) {
    if (pattern.test(content)) sourcesFound.push(source);
    else sourcesMissing.push(source);
  }
  if (sourcesMissing.length > 0) {
    gaps.push(
      `소스 ${sourcesFound.length}/5 만 검색됨 (미검색: ${sourcesMissing.join(', ')}).`,
    );
  }

  // 3) 쿼리 변형 수 (쿼리 섹션 아래 리스트 항목)
  const querySection = content.match(
    /##\s*(쿼리|검색\s*쿼리|Query|사용한\s*쿼리)/i,
  );
  if (querySection) {
    const afterQuery = content.slice(content.indexOf(querySection[0]));
    const queryItems = afterQuery.match(/^[-*]\s+/gm) || [];
    if (queryItems.length < MIN_QUERY_VARIANTS) {
      gaps.push(
        `쿼리 변형 ${queryItems.length}개만 사용됨 (최소 ${MIN_QUERY_VARIANTS}개 필요).`,
      );
    }
  }

  return { ok: gaps.length === 0, file, gaps };
}

// ─── CLI 진입점 ──────────────────────────────────────────────────────
const isMainModule = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const keyword = process.argv.slice(2).join(' ').trim();

  if (!keyword) {
    console.error('사용법: node scripts/lib/coverage-verifier.mjs "<keyword>"');
    console.error('예: node scripts/lib/coverage-verifier.mjs "4D-QSAR"');
    process.exit(2);
  }

  const { ok, gaps, file } = verifyCoverage(keyword);

  if (ok) {
    console.log(`✓ 커버리지 통과 (${file})`);
    process.exit(0);
  }

  console.error(`❌ [커버리지 미비] 키워드: "${keyword}"`);
  if (file) console.error(`   파일: ${file}`);
  for (const gap of gaps) {
    console.error(`   - ${gap}`);
  }
  console.error('');
  console.error('위 항목을 보완할 수 있도록 추가 검색/편집을 수행하세요.');
  process.exit(1);
}
