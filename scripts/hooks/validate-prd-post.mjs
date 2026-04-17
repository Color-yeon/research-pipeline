#!/usr/bin/env node

/**
 * /research-tasks 스킬 실행 직후 prd.json 스키마를 자동 검증한다.
 *
 * 스키마 위반(예: status 필드 포함, passes 누락 등)이 발견되면
 * decision: 'block' 으로 Stop 을 막아서 에이전트가 prd.json 을
 * 올바른 스키마로 재작성하도록 유도한다.
 *
 * 위반을 여기서 잡지 못하면 sentinel.sh 가 Ralph 를 띄우는 순간
 * "Total tasks: 0" 으로 즉시 종료되어 파이프라인이 사실상 실행되지 않는다.
 *
 * 훅 이벤트: PostToolUse (matcher: Skill)
 */

import { join } from 'path';
import { validatePrd, formatValidationResult } from '../lib/validate-prd.mjs';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const PRD_PATH = join(PROJECT_ROOT, 'prd.json');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(inputData);
    const result = handlePostToolUse(event);
    process.stdout.write(JSON.stringify(result));
  } catch {
    // 에러 발생 시 조용히 통과 (파이프라인 방해 금지)
    process.stdout.write(JSON.stringify({}));
  }
});

function handlePostToolUse(event) {
  // Skill 도구만 처리
  if ((event.tool_name || '') !== 'Skill') {
    return {};
  }

  // /research-tasks 스킬만 대상으로 한다.
  // 다른 스킬(research-search 등)은 prd.json 을 건드리지 않으므로 검증 불필요.
  const toolInput = event.tool_input || {};
  const skillName = toolInput.skill || toolInput.name || '';
  if (skillName !== 'research-tasks') {
    return {};
  }

  const result = validatePrd(PRD_PATH);
  if (result.valid) {
    return {};  // 통과
  }

  // 검증 실패 → block 하여 에이전트가 prd.json 을 고치도록 유도
  const formatted = formatValidationResult(result, PRD_PATH);
  return {
    decision: 'block',
    reason:
      `[prd.json 스키마 검증 실패]\n` +
      `${formatted}\n\n` +
      `⚠ 이 상태로 Ralph 를 실행하면 "Total tasks: 0" 으로 즉시 종료됩니다.\n` +
      `스키마 제약은 .claude/skills/research-tasks/SKILL.md 의 "Ralph TUI 스키마 제약" 섹션을 참고하세요.`
  };
}
