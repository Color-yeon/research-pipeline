#!/usr/bin/env node

/**
 * State Machine 파이프라인 가드 훅
 *
 * 스킬 실행 전에 선행 조건(가드)을 검사하여,
 * 필수 아티팩트가 없으면 실행을 차단한다.
 *
 * 훅 이벤트: PreToolUse
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');

/**
 * 가드 조건 매트릭스
 * 각 스킬에 대해 필수 선행 조건을 정의한다.
 */
const GUARD_MATRIX = {
  'research-credibility': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search로 논문을 검색하세요.'
  },
  'research-read': {
    check: () => hasMinEvidenceCards(1) && hasTier3Pending(),
    message: 'Tier 3 재시도 대상 논문이 없습니다.\n/research-search에서 Tier 1/2로 전문 확보에 실패한 논문이 있을 때만 실행하세요.\n(findings/ 파일에 [전문 확보 대기 - Tier 3 필요] 태그가 있어야 합니다.)'
  },
  'research-snowball': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search로 논문을 검색하세요.'
  },
  'research-methods': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search로 논문을 검색하세요.'
  },
  'research-deep-read': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search로 논문을 검색하세요.'
  },
  'research-analyze': {
    check: () => hasMinEvidenceCards(2),
    message: 'findings/ 디렉토리에 증거카드 파일이 2개 미만입니다.\n최소 2개 키워드에 대해 /research-search를 실행하세요.'
  },
  'research-compare': {
    check: () => hasMinEvidenceCards(2),
    message: 'findings/ 디렉토리에 증거카드 파일이 2개 미만입니다.\n최소 2개 키워드에 대해 /research-search를 실행하세요.'
  },
  'research-validate': {
    check: () => hasFile('integrated_analysis.md'),
    message: 'findings/integrated_analysis.md 파일이 없습니다.\n먼저 /research-analyze로 통합 분석을 수행하세요.'
  },
  'research-notion': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search로 논문을 검색하세요.'
  }
};

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(inputData);
    const result = handlePreToolUse(event);
    process.stdout.write(JSON.stringify(result));
  } catch {
    // 에러 시 허용 (파이프라인 방해 금지)
    process.stdout.write(JSON.stringify({}));
  }
});

function handlePreToolUse(event) {
  const toolName = event.tool_name || '';

  // Skill 도구가 아니면 통과
  if (toolName !== 'Skill') {
    return {};
  }

  // 스킬명 추출
  const toolInput = event.tool_input || {};
  const skillName = toolInput.skill || toolInput.name || '';

  // 가드 매트릭스에 없는 스킬은 통과
  const guard = GUARD_MATRIX[skillName];
  if (!guard) {
    return {};
  }

  // 가드 조건 검사
  if (guard.check()) {
    return {};  // 통과
  }

  // 가드 실패 — 차단
  return {
    decision: 'block',
    reason: `[파이프라인 가드] /${skillName} 실행 차단.\n필수 선행 조건 미충족: ${guard.message}`
  };
}

/**
 * findings/ 에 최소 N개의 증거카드 .md 파일이 있는지 확인한다.
 * 내부 파일(_로 시작)과 특수 파일(credibility, excluded, integrated 등)은 제외.
 */
function hasMinEvidenceCards(minCount) {
  if (!existsSync(FINDINGS_DIR)) return false;

  const SPECIAL_FILES = new Set([
    'credibility_report.md',
    'excluded_papers.md',
    'integrated_analysis.md',
    'audit_report.md',
    'authors_labs.md',
    'methods_critique.md',
    'gap_analysis.md',
    'validation_report.md'
  ]);

  try {
    const files = readdirSync(FINDINGS_DIR);
    const evidenceCards = files.filter(f => {
      if (!f.endsWith('.md')) return false;
      if (f.startsWith('_')) return false;
      if (SPECIAL_FILES.has(f)) return false;
      if (f.startsWith('snowball_')) return false;
      if (f.startsWith('comparison_')) return false;
      return true;
    });

    return evidenceCards.length >= minCount;
  } catch {
    return false;
  }
}

/**
 * findings/ 에 특정 파일이 존재하는지 확인한다.
 */
function hasFile(filename) {
  return existsSync(join(FINDINGS_DIR, filename));
}

/**
 * findings/ 파일 중 [전문 확보 대기 - Tier 3 필요] 태그가 포함된 논문이 있는지 확인한다.
 * /research-read는 Tier 3 재시도 전용이므로, 대상 논문이 있을 때만 실행을 허용한다.
 */
function hasTier3Pending() {
  if (!existsSync(FINDINGS_DIR)) return false;

  try {
    const files = readdirSync(FINDINGS_DIR);
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      const content = readFileSync(join(FINDINGS_DIR, f), 'utf8');
      if (content.includes('[전문 확보 대기 - Tier 3 필요]')) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
