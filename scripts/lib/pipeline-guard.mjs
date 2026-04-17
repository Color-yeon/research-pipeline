#!/usr/bin/env node

/**
 * 파이프라인 가드 — 공용 라이브러리 + CLI 진입점
 *
 * 스킬 실행 전에 선행 조건을 검사한다. 에이전트 중립적으로 동작하도록
 * ES 모듈 함수로 export 하고, 동시에 직접 실행 가능한 CLI 진입점을 제공한다.
 *
 * ## 사용법 (CLI)
 *   node scripts/lib/pipeline-guard.mjs <skill-name>
 *   → 통과 시 exit 0, 차단 시 exit 1 + stderr 에 사유 출력
 *
 *   예: node scripts/lib/pipeline-guard.mjs research-analyze
 *
 * ## 사용법 (함수 import)
 *   import { checkGuard } from './scripts/lib/pipeline-guard.mjs';
 *   const { ok, reason } = checkGuard('research-analyze');
 *
 * ## 설계 메모
 * Claude Code 환경에서는 .claude/settings.json 의 PreToolUse 훅이 같은 로직을
 * 이벤트 레벨에서 더 촘촘히 방어한다. 이 라이브러리는 Codex/Gemini 를 포함한
 * 에이전트 중립 경로용이며, 스킬 본문의 "0단계"에서 Bash 도구로 호출된다.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');
const CONFIG_PATH = join(PROJECT_ROOT, 'research-config.json');
const INTAKE_APPROVED_PATH = join(FINDINGS_DIR, '_intake_approved.json');
const INTAKE_IN_PROGRESS_PATH = join(FINDINGS_DIR, '_intake_in_progress.json');

/**
 * 가드 조건 매트릭스 — scripts/hooks/pipeline-guard.mjs 와 의도적으로 동일.
 * 한 쪽을 고치면 다른 쪽도 맞춰야 한다.
 */
export const GUARD_MATRIX = {
  'research-search': {
    check: () => hasConfig() && hasIntakeApproved(),
    message:
      'research-config.json 이 없거나, 인테이크 승인 센티넬(findings/_intake_approved.json) 이 없습니다.\n' +
      '주제/키워드를 사용자와 확정하지 않은 상태에서 검색을 시작하면, 엉뚱한 방향으로 논문을 모으게 됩니다.\n' +
      '반드시 /research-intake 를 먼저 실행하여 사용자와 대화로 설정을 확정한 뒤 /research-search 를 호출하세요.',
  },
  'research-tasks': {
    check: () => hasConfig() && hasIntakeApproved(),
    message:
      'research-config.json 이 없거나, 인테이크 승인 센티넬(findings/_intake_approved.json) 이 없습니다.\n' +
      'prd.json 은 사용자가 승인한 연구 설정을 기반으로 생성되어야 합니다.\n' +
      '먼저 /research-intake 로 설정을 확정하세요.',
  },
  'research-credibility': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search 로 논문을 검색하세요.',
  },
  'research-read': {
    check: () => hasMinEvidenceCards(1) && hasTier3Pending(),
    message:
      'Tier 3 재시도 대상 논문이 없습니다.\n/research-search 에서 Tier 1/2 로 전문 확보에 실패한 논문이 있을 때만 실행하세요.\n(findings/ 파일에 [전문 확보 대기 - Tier 3 필요] 태그가 있어야 합니다.)',
  },
  'research-snowball': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search 로 논문을 검색하세요.',
  },
  'research-methods': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search 로 논문을 검색하세요.',
  },
  'research-deep-read': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search 로 논문을 검색하세요.',
  },
  'research-analyze': {
    check: () => hasMinEvidenceCards(2),
    message: 'findings/ 디렉토리에 증거카드 파일이 2개 미만입니다.\n최소 2개 키워드에 대해 /research-search 를 실행하세요.',
  },
  'research-compare': {
    check: () => hasMinEvidenceCards(2),
    message: 'findings/ 디렉토리에 증거카드 파일이 2개 미만입니다.\n최소 2개 키워드에 대해 /research-search 를 실행하세요.',
  },
  'research-validate': {
    check: () => hasFile('integrated_analysis.md'),
    message: 'findings/integrated_analysis.md 파일이 없습니다.\n먼저 /research-analyze 로 통합 분석을 수행하세요.',
  },
  'research-notion': {
    check: () => hasMinEvidenceCards(1),
    message: 'findings/ 디렉토리에 증거카드 파일이 없습니다.\n먼저 /research-search 로 논문을 검색하세요.',
  },
};

/**
 * findings/ 에 최소 N 개의 증거카드 .md 파일이 있는지 확인.
 * 내부 파일(_로 시작)과 특수 파일은 제외.
 */
export function hasMinEvidenceCards(minCount) {
  if (!existsSync(FINDINGS_DIR)) return false;

  const SPECIAL_FILES = new Set([
    'credibility_report.md',
    'excluded_papers.md',
    'integrated_analysis.md',
    'audit_report.md',
    'authors_labs.md',
    'methods_critique.md',
    'gap_analysis.md',
    'validation_report.md',
  ]);

  try {
    const files = readdirSync(FINDINGS_DIR);
    const evidenceCards = files.filter((f) => {
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
 * findings/ 에 특정 파일이 존재하는지 확인.
 */
export function hasFile(filename) {
  return existsSync(join(FINDINGS_DIR, filename));
}

/**
 * research-config.json 존재 여부.
 */
export function hasConfig() {
  return existsSync(CONFIG_PATH);
}

/**
 * 인테이크 승인 센티넬(findings/_intake_approved.json) 존재 여부.
 * /research-intake 스킬이 사용자 확인을 받은 뒤 기록한다.
 */
export function hasIntakeApproved() {
  return existsSync(INTAKE_APPROVED_PATH);
}

/**
 * 인테이크가 진행 중(중간 상태)인지. intake-in-progress 마커가 있으면 true.
 * 이 플래그는 Write 가드가 research-config.json 의 정식 생성을 허용할 때 사용한다.
 */
export function hasIntakeInProgress() {
  return existsSync(INTAKE_IN_PROGRESS_PATH);
}

/**
 * [전문 확보 대기 - Tier 3 필요] 태그가 있는 논문이 하나라도 있는지 확인.
 */
export function hasTier3Pending() {
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

/**
 * 스킬명을 받아 가드 통과 여부와 사유를 반환한다.
 * 정의되지 않은 스킬은 자동 통과.
 */
export function checkGuard(skillName) {
  const guard = GUARD_MATRIX[skillName];
  if (!guard) {
    return { ok: true, reason: `(가드 정의 없음: ${skillName})` };
  }
  if (guard.check()) {
    return { ok: true, reason: `(가드 통과: ${skillName})` };
  }
  return { ok: false, reason: guard.message };
}

// ─── CLI 진입점 ──────────────────────────────────────────────────────
// 직접 실행된 경우에만 동작 (import 시에는 실행 안 됨)
const isMainModule = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMainModule) {
  const skillName = process.argv[2];

  if (!skillName) {
    console.error('사용법: node scripts/lib/pipeline-guard.mjs <skill-name>');
    console.error('예: node scripts/lib/pipeline-guard.mjs research-analyze');
    process.exit(2);
  }

  const { ok, reason } = checkGuard(skillName);

  if (ok) {
    console.log(`✓ ${reason}`);
    process.exit(0);
  } else {
    console.error(`❌ [파이프라인 가드] /${skillName} 실행 차단`);
    console.error(`선행 조건 미충족: ${reason}`);
    process.exit(1);
  }
}
