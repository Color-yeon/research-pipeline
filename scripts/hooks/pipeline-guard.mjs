#!/usr/bin/env node

/**
 * State Machine 파이프라인 가드 훅
 *
 * 스킬/Write/Bash 실행 전에 선행 조건(가드)을 검사하여,
 * 파이프라인 순서 위반이 발생하면 실행을 차단한다.
 *
 * 훅 이벤트: PreToolUse
 *
 * 커버하는 위반 케이스:
 *  1. Skill: 각 스킬별 선행 아티팩트 검사 (GUARD_MATRIX)
 *  2. Write: 인테이크 없이 research-config.json 직접 생성 시도
 *  3. Bash: 인테이크 승인 전에 fetch-paper.js / read-paper.js 실행 시도
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');
const CONFIG_PATH = join(PROJECT_ROOT, 'research-config.json');
const INTAKE_APPROVED_PATH = join(FINDINGS_DIR, '_intake_approved.json');
const INTAKE_IN_PROGRESS_PATH = join(FINDINGS_DIR, '_intake_in_progress.json');

/**
 * 가드 조건 매트릭스
 * scripts/lib/pipeline-guard.mjs 와 의도적으로 동일하게 유지한다. 한 쪽을 고치면 다른 쪽도 맞춰야 한다.
 */
const GUARD_MATRIX = {
  'research-search': {
    check: () => hasConfig() && hasIntakeApproved(),
    message:
      'research-config.json 또는 findings/_intake_approved.json 이 없습니다.\n' +
      '사용자와 주제/키워드를 확정하기 전에 검색을 시작하면 엉뚱한 방향의 논문을 모으게 됩니다.\n' +
      '먼저 /research-intake 를 실행하여 사용자와 대화로 설정을 확정하세요.'
  },
  'research-tasks': {
    check: () => hasConfig() && hasIntakeApproved(),
    message:
      'research-config.json 또는 findings/_intake_approved.json 이 없습니다.\n' +
      'prd.json 은 사용자가 승인한 연구 설정을 기반으로만 생성되어야 합니다.\n' +
      '먼저 /research-intake 를 완료하세요.'
  },
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
  const toolInput = event.tool_input || {};

  // 1) Skill 가드 매트릭스
  if (toolName === 'Skill') {
    return handleSkillGuard(toolInput);
  }

  // 2) Write 가드 — research-config.json 의 무단 생성 차단
  if (toolName === 'Write') {
    return handleWriteGuard(toolInput);
  }

  // 3) Bash 가드 — 인테이크 승인 전 논문 수집 스크립트 차단
  if (toolName === 'Bash') {
    return handleBashGuard(toolInput);
  }

  return {};
}

function handleSkillGuard(toolInput) {
  const skillName = toolInput.skill || toolInput.name || '';
  const guard = GUARD_MATRIX[skillName];
  if (!guard) return {};
  if (guard.check()) return {};
  return {
    decision: 'block',
    reason: `[파이프라인 가드] /${skillName} 실행 차단.\n필수 선행 조건 미충족: ${guard.message}`
  };
}

/**
 * research-config.json 을 인테이크 과정 밖에서 직접 쓰는 것을 막는다.
 *
 * 허용 조건:
 *  - /research-intake 스킬이 진행 중(_intake_in_progress.json 존재) → 스킬이 config 를 쓰는 정상 경로
 *  - 이미 config 가 존재하고 승인 센티넬이 있는 경우 → 사용자가 수동 편집하는 경우 허용
 * 그 외에는 차단한다. 사용자 요청을 듣자마자 에이전트가 자기 판단으로 config 를 생성하는 사고(2026-04-17)를 방지.
 */
function handleWriteGuard(toolInput) {
  const filePath = String(toolInput.file_path || '');
  if (!filePath.endsWith('research-config.json')) return {};

  const configExists = existsSync(filePath);
  const intakeInProgress = existsSync(INTAKE_IN_PROGRESS_PATH);
  const intakeApproved = existsSync(INTAKE_APPROVED_PATH);

  if (intakeInProgress) return {};
  if (configExists && intakeApproved) return {};

  return {
    decision: 'block',
    reason:
      '[파이프라인 가드] research-config.json 직접 쓰기를 차단합니다.\n' +
      '사용자와의 인테이크 대화 없이 연구 설정을 만들면 안 됩니다.\n' +
      '먼저 /research-intake 스킬을 호출하세요. 인테이크 스킬은 첫 단계에서\n' +
      'findings/_intake_in_progress.json 마커를 생성하며, 그때부터 이 Write 가 허용됩니다.\n' +
      '기존 config 를 수동 편집하고 싶다면 사전에 /research-intake 를 통과한 상태여야 합니다.'
  };
}

/**
 * 인테이크 승인 전에 논문 전문 수집 스크립트가 실행되는 것을 차단한다.
 * 현재 감지 대상: scripts/fetch-paper.js, scripts/read-paper.js
 */
function handleBashGuard(toolInput) {
  const cmd = String(toolInput.command || '');
  // node 로 실행되는 fetch-paper / read-paper 스크립트 호출만 잡는다.
  // 다른 위치에 있는 동명 스크립트나 주석은 건드리지 않는다.
  if (!/\bnode\s+(?:[^\s]*\/)?scripts\/(?:fetch-paper|read-paper)\.(?:js|mjs)\b/.test(cmd)) {
    return {};
  }

  if (hasConfig() && hasIntakeApproved()) return {};

  return {
    decision: 'block',
    reason:
      '[파이프라인 가드] 인테이크 승인 전 논문 전문 수집 스크립트 실행을 차단합니다.\n' +
      '연구 주제가 확정되지 않은 상태에서 fetch-paper.js / read-paper.js 를 돌리는 것은 파이프라인 순서 위반입니다.\n' +
      '먼저 /research-intake 를 완료한 뒤 /research-search 스킬을 통해서만 호출되어야 합니다.'
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

function hasFile(filename) {
  return existsSync(join(FINDINGS_DIR, filename));
}

function hasConfig() {
  return existsSync(CONFIG_PATH);
}

function hasIntakeApproved() {
  return existsSync(INTAKE_APPROVED_PATH);
}

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
