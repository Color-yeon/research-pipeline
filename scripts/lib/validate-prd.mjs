#!/usr/bin/env node

/**
 * prd.json 스키마 검증 모듈
 *
 * ralph-tui 바이너리의 내부 검증 로직
 * (dist/index.js 의 parsePrdJson)과 동일한 규칙을 재현한다.
 * Ralph가 실제로 실행되기 전에 스키마 위반을 포착해,
 * 태스크 0개로 즉시 종료되는 상황을 방지한다.
 *
 * 사용 방법:
 *   - 모듈: import { validatePrd } from './lib/validate-prd.mjs'
 *   - CLI : node scripts/lib/validate-prd.mjs [prd.json]
 *           exit 0 = 통과, exit 1 = 스키마 위반, exit 2 = 파일 없음/IO 오류
 */

import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// ralph-tui 가 prd.json 에 허용하지 않는 필드 목록.
// userStories[] 안에 이 중 하나라도 있으면 스키마 전체가 reject 된다.
const UNSUPPORTED_FIELDS = ['subtasks', 'estimated_hours', 'files', 'status'];

/**
 * prd.json 파일을 ralph-tui 스키마 기준으로 검증한다.
 * @param {string} filePath - prd.json 경로
 * @returns {{valid: boolean, errors: string[], userStoryCount: number, name: string|null}}
 */
export function validatePrd(filePath) {
  const errors = [];

  if (!existsSync(filePath)) {
    return { valid: false, errors: [`파일이 존재하지 않습니다: ${filePath}`], userStoryCount: 0, name: null };
  }

  let obj;
  try {
    obj = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { valid: false, errors: [`JSON 파싱 실패: ${e.message}`], userStoryCount: 0, name: null };
  }

  // name 필드 (ralph-tui 는 name 필수)
  const name = typeof obj.name === 'string' ? obj.name : null;
  if (!name) {
    errors.push('최상위 "name" 필드 누락 또는 문자열 아님');
  }

  // userStories 검증
  if (!Array.isArray(obj.userStories)) {
    errors.push('"userStories" 필드가 배열이 아님');
    return { valid: false, errors, userStoryCount: 0, name };
  }

  const stories = obj.userStories;

  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];

    if (typeof s !== 'object' || s === null) {
      errors.push(`userStories[${i}]: 객체여야 함`);
      continue;
    }

    if (!s.id || typeof s.id !== 'string') {
      errors.push(`userStories[${i}]: 필수 필드 "id" (string) 누락`);
    }

    if (!s.title || typeof s.title !== 'string') {
      errors.push(`userStories[${i}]: 필수 필드 "title" (string) 누락`);
    }

    if (typeof s.passes !== 'boolean') {
      if ('status' in s) {
        errors.push(
          `userStories[${i}]: "status" 필드 발견 — ralph-tui 는 대신 "passes" (boolean) 를 요구합니다. ` +
          `"status": "pending" → "passes": false 로, "status": "completed" → "passes": true 로 변환하세요.`
        );
      } else {
        errors.push(`userStories[${i}]: 필수 필드 "passes" (boolean) 누락`);
      }
    }

    const foundUnsupported = UNSUPPORTED_FIELDS.filter((f) => f in s);
    if (foundUnsupported.length > 0) {
      errors.push(
        `userStories[${i}]: 지원하지 않는 필드 포함: ${foundUnsupported.join(', ')}. ` +
        `ralph-tui prd.json 스키마는 subtasks, estimated_hours, files, status 를 허용하지 않습니다.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    userStoryCount: stories.length,
    name
  };
}

/**
 * 검증 결과를 사람이 읽기 좋은 문자열로 포매팅한다.
 */
export function formatValidationResult(result, filePath) {
  if (result.valid) {
    return `✓ prd.json 스키마 검증 통과 — ${filePath}\n  userStories: ${result.userStoryCount}개\n  name: ${result.name}`;
  }

  const lines = [
    `✗ prd.json 스키마 검증 실패 — ${filePath}`,
    `  발견된 오류 ${result.errors.length}개:`
  ];
  for (const err of result.errors) {
    lines.push(`    - ${err}`);
  }
  lines.push('');
  lines.push('  수정 방법:');
  lines.push('    /research-tasks 스킬을 다시 실행하거나,');
  lines.push('    prd.json 을 직접 편집하여 스키마를 맞춰주세요.');
  lines.push('    참고: .claude/skills/research-tasks/SKILL.md (스키마 제약 섹션)');
  return lines.join('\n');
}

// CLI 모드 진입점
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const filePath = process.argv[2] || 'prd.json';
  const result = validatePrd(filePath);
  console.log(formatValidationResult(result, filePath));

  if (result.valid) {
    process.exit(0);
  } else if (result.errors.some((e) => e.startsWith('파일이 존재하지 않습니다') || e.startsWith('JSON 파싱 실패'))) {
    process.exit(2);
  } else {
    process.exit(1);
  }
}
