#!/usr/bin/env node

/**
 * Verify-Fix 자기 수정 루프 훅
 *
 * 검색 태스크 완료 시 커버리지를 자동 점검하고,
 * 갭이 발견되면 Stop을 차단하여 추가 검색을 강제한다.
 * Circuit Breaker: 최대 3회 차단 후 무조건 통과.
 *
 * 훅 이벤트: Stop
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');
// 스코프별 활성 태스크 파일 — 연구 파이프라인과 학회 수집이 서로 간섭하지 않도록 분리
const ACTIVE_TASK_PATH = join(FINDINGS_DIR, '_active_task_research.json');
const LEGACY_ACTIVE_TASK_PATH = join(FINDINGS_DIR, '_active_task.json');
const RETRIES_PATH = join(FINDINGS_DIR, '_verify_retries.json');
const MAX_RETRIES = 3;

// 필수 소스 목록
const REQUIRED_SOURCES = ['WebSearch', 'OpenAlex', 'Semantic Scholar', 'arXiv', 'Google Scholar'];
const MIN_QUERY_VARIANTS = 5;
const MIN_PAPERS = 3;

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(inputData);
    const result = handleStop(event);
    process.stdout.write(JSON.stringify(result));
  } catch {
    // 에러 시 조용히 통과
    process.stdout.write(JSON.stringify({}));
  }
});

function handleStop(event) {
  // 사용자 중단, 컨텍스트 한계는 무조건 통과
  const reason = event.stop_reason || event.stopReason || '';
  if (reason === 'user_interrupt' || reason === 'context_limit') {
    return {};
  }

  // 활성 태스크 파일 로드 (신규 스코프 파일 우선, 레거시 파일 폴백)
  // 연구 파이프라인 전용 — 학회 수집 등 다른 스코프는 이 훅의 영향을 받지 않음
  let taskPath = null;
  if (existsSync(ACTIVE_TASK_PATH)) {
    taskPath = ACTIVE_TASK_PATH;
  } else if (existsSync(LEGACY_ACTIVE_TASK_PATH)) {
    // 레거시 파일: scope 필드가 없거나 'research'인 경우만 처리
    try {
      const legacy = JSON.parse(readFileSync(LEGACY_ACTIVE_TASK_PATH, 'utf8'));
      const scope = legacy.scope || 'research';
      if (scope !== 'research') return {};
      taskPath = LEGACY_ACTIVE_TASK_PATH;
    } catch {
      return {};
    }
  }

  if (!taskPath) {
    return {};
  }

  let activeTask;
  try {
    activeTask = JSON.parse(readFileSync(taskPath, 'utf8'));
  } catch {
    return {};
  }

  // 검색 태스크가 아니면 통과
  const labels = activeTask.labels || [];
  const isSearchTask = labels.includes('search') || labels.includes('phase-1');
  if (!isSearchTask) {
    return {};
  }

  // Circuit Breaker 확인
  const retries = getRetryCount(activeTask.id);
  if (retries >= MAX_RETRIES) {
    // 리트라이 카운터 리셋
    resetRetries(activeTask.id);
    return {};
  }

  // 커버리지 검증
  const gaps = verifyCoverage(activeTask);

  if (gaps.length === 0) {
    // 검증 통과 — 리트라이 카운터 리셋
    resetRetries(activeTask.id);
    return {};
  }

  // 갭 발견 — Stop 차단
  incrementRetries(activeTask.id);
  const currentRetry = retries + 1;

  const message = [
    `[커버리지 미비] ${gaps.join(' ')}`,
    `누락된 부분을 추가 검색해주세요.`,
    `재시도: ${currentRetry}/${MAX_RETRIES}`
  ].join('\n');

  return {
    decision: 'block',
    reason: message
  };
}

/**
 * 검색 결과의 커버리지를 검증한다.
 * @returns {string[]} 발견된 갭 목록 (비어있으면 통과)
 */
function verifyCoverage(activeTask) {
  const gaps = [];
  const keyword = activeTask.keyword || activeTask.title || '';

  // findings 파일 찾기
  const findingsFile = findFindingsFile(keyword);
  if (!findingsFile) {
    gaps.push(`findings 파일을 찾을 수 없습니다 (키워드: ${keyword}).`);
    return gaps;
  }

  let content;
  try {
    content = readFileSync(findingsFile, 'utf8');
  } catch {
    gaps.push(`findings 파일 읽기 실패: ${findingsFile}`);
    return gaps;
  }

  // 1. 논문 수 확인
  const paperCount = (content.match(/^### /gm) || []).length;
  if (paperCount < MIN_PAPERS) {
    gaps.push(`논문 ${paperCount}편만 수집됨 (최소 ${MIN_PAPERS}편 필요).`);
  }

  // 2. 소스 커버리지 확인
  const sourcesFound = [];
  const sourcesMissing = [];

  const sourcePatterns = {
    'WebSearch': /WebSearch|웹\s*검색/i,
    'OpenAlex': /OpenAlex|openalex\.org/i,
    'Semantic Scholar': /Semantic\s*Scholar|semanticscholar\.org/i,
    'arXiv': /arXiv|arxiv\.org/i,
    'Google Scholar': /Google\s*Scholar|scholar\.google/i
  };

  for (const [source, pattern] of Object.entries(sourcePatterns)) {
    if (pattern.test(content)) {
      sourcesFound.push(source);
    } else {
      sourcesMissing.push(source);
    }
  }

  if (sourcesMissing.length > 0) {
    gaps.push(`소스 ${sourcesFound.length}/5만 검색됨 (미검색: ${sourcesMissing.join(', ')}).`);
  }

  // 3. 쿼리 변형 수 확인
  // "쿼리 변형" 또는 "Query" 섹션 패턴 매칭
  const querySection = content.match(/##\s*(쿼리|검색\s*쿼리|Query|사용한\s*쿼리)/i);
  if (querySection) {
    // 쿼리 섹션 이후의 리스트 항목 카운트
    const afterQuery = content.slice(content.indexOf(querySection[0]));
    const queryItems = afterQuery.match(/^[-*]\s+/gm) || [];
    if (queryItems.length < MIN_QUERY_VARIANTS) {
      gaps.push(`쿼리 변형 ${queryItems.length}개만 사용됨 (최소 ${MIN_QUERY_VARIANTS}개 필요).`);
    }
  }

  return gaps;
}

/**
 * 키워드에 해당하는 findings 파일을 찾는다.
 * 복합 키워드("A + B + C")는 첫 번째 핵심어로 매칭하고,
 * 개별 단어 전체가 파일명에 포함되는지도 확인한다.
 */
function findFindingsFile(keyword) {
  if (!existsSync(FINDINGS_DIR)) return null;

  const files = readdirSync(FINDINGS_DIR)
    .filter(f => !f.startsWith('_') && f.endsWith('.md'));

  // "A + B + C" 형태의 복합 키워드를 개별 부분으로 분리
  const parts = keyword.split(/\s*\+\s*/).map(p => p.trim().toLowerCase()).filter(Boolean);
  // 전체를 하이픈으로 연결한 형태도 시도
  const fullNormalized = keyword.toLowerCase().replace(/[+]/g, '').replace(/\s+/g, '-').replace(/-{2,}/g, '-');

  for (const file of files) {
    const fileLower = file.toLowerCase();

    // 1차: 전체 키워드 매칭 (+ 제거 후)
    if (fileLower.includes(fullNormalized)) {
      return join(FINDINGS_DIR, file);
    }

    // 2차: 첫 번째 핵심어(가장 구체적인 부분)로 매칭
    const firstPart = parts[0]?.replace(/\s+/g, '-');
    if (firstPart && fileLower.includes(firstPart)) {
      return join(FINDINGS_DIR, file);
    }
  }
  return null;
}

/**
 * 리트라이 카운터를 읽는다.
 */
function getRetryCount(taskId) {
  if (!existsSync(RETRIES_PATH)) return 0;
  try {
    const data = JSON.parse(readFileSync(RETRIES_PATH, 'utf8'));
    return data[taskId] || 0;
  } catch {
    return 0;
  }
}

/**
 * 리트라이 카운터를 증가시킨다.
 */
function incrementRetries(taskId) {
  let data = {};
  if (existsSync(RETRIES_PATH)) {
    try {
      data = JSON.parse(readFileSync(RETRIES_PATH, 'utf8'));
    } catch { /* 무시 */ }
  }
  data[taskId] = (data[taskId] || 0) + 1;
  writeFileSync(RETRIES_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 리트라이 카운터를 리셋한다.
 */
function resetRetries(taskId) {
  if (!existsSync(RETRIES_PATH)) return;
  try {
    const data = JSON.parse(readFileSync(RETRIES_PATH, 'utf8'));
    delete data[taskId];
    writeFileSync(RETRIES_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* 무시 */ }
}
