#!/usr/bin/env node

/**
 * @deprecated 2026-04-16 — Claude Code의 PostToolUse 훅 사양상 tool_output을 받지 못해
 * 442/442 검색 모두 효과 측정 불가였다. PreToolUse 기반 search-wisdom-pretool.mjs로 대체됨.
 * settings.json에서도 등록 해제됨. 향후 PostToolUse 사양이 변경(tool_output 전달)되면
 * 이 파일을 다시 활성화할 수 있다. 그때까지 보존.
 *
 * --- 원래 설명 ---
 * 검색 지혜 자동 학습 (Learner) 훅
 *
 * WebSearch 호출 후 검색 패턴을 자동 추출하여 축적하고,
 * 충분한 데이터가 모이면 효과/비효과 패턴을 분석한다.
 *
 * 훅 이벤트: PostToolUse
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');
const WISDOM_JSON_PATH = join(FINDINGS_DIR, '_search_wisdom.json');
const WISDOM_MD_PATH = join(FINDINGS_DIR, '_search_wisdom.md');
const ANALYSIS_THRESHOLD = 10; // 이 수 이상 기록 시 분석 실행

// 소스 감지 패턴
const SOURCE_PATTERNS = {
  'OpenAlex': /site:\s*openalex\.org/i,
  'Semantic Scholar': /site:\s*semanticscholar\.org/i,
  'arXiv': /site:\s*arxiv\.org/i,
  'Google Scholar': /site:\s*scholar\.google/i,
  'PubMed': /site:\s*pubmed\.ncbi/i,
};

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(inputData);
    handlePostToolUse(event);
  } catch {
    // 에러 시 조용히 통과
  }
  // PostToolUse 훅은 응답 불필요
  process.stdout.write(JSON.stringify({}));
});

function handlePostToolUse(event) {
  const toolName = event.tool_name || '';

  // WebSearch만 추적
  if (toolName !== 'WebSearch') return;

  const toolInput = event.tool_input || {};
  const query = toolInput.query || '';

  if (!query) return;

  // findings/ 디렉토리 보장
  if (!existsSync(FINDINGS_DIR)) {
    mkdirSync(FINDINGS_DIR, { recursive: true });
  }

  // 소스 감지
  let source = 'WebSearch (일반)';
  for (const [name, pattern] of Object.entries(SOURCE_PATTERNS)) {
    if (pattern.test(query)) {
      source = name;
      break;
    }
  }

  // tool_output 추출 — PostToolUse 훅에서 출력이 제공되지 않을 수 있음
  const toolOutput = event.tool_output ?? event.tool_result ?? event.output ?? null;
  const outputStr = toolOutput
    ? (typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput))
    : '';
  const hasOutput = outputStr.length > 0;

  const resultCount = hasOutput ? estimateResultCount(outputStr) : null;
  const academicRatio = hasOutput ? estimateAcademicRatio(outputStr) : null;
  // 출력이 없으면 효과 여부를 판단할 수 없으므로 null로 기록
  const effective = hasOutput ? (resultCount > 0) : null;

  // 쿼리 기록 추가
  const record = {
    query,
    source,
    result_count: resultCount,
    academic_ratio: academicRatio,
    effective,
    timestamp: new Date().toISOString()
  };

  // 기존 데이터 읽기 + 추가
  let wisdomData = loadWisdomData();
  wisdomData.records.push(record);

  // 최대 500개 기록 유지 (FIFO)
  if (wisdomData.records.length > 500) {
    wisdomData.records = wisdomData.records.slice(-500);
  }

  // JSON 저장
  writeFileSync(WISDOM_JSON_PATH, JSON.stringify(wisdomData, null, 2), 'utf8');

  // 분석 임계치 도달 시 마크다운 리포트 갱신
  if (wisdomData.records.length >= ANALYSIS_THRESHOLD) {
    generateWisdomReport(wisdomData);
  }
}

/**
 * 기존 검색 지혜 데이터를 로드한다.
 */
function loadWisdomData() {
  if (!existsSync(WISDOM_JSON_PATH)) {
    return { records: [], last_analysis: null };
  }
  try {
    return JSON.parse(readFileSync(WISDOM_JSON_PATH, 'utf8'));
  } catch {
    return { records: [], last_analysis: null };
  }
}

/**
 * 출력에서 결과 수를 추정한다.
 */
function estimateResultCount(output) {
  // "N results", "N 건", "About N results" 패턴
  const countMatch = output.match(/(?:about\s+)?(\d[\d,]*)\s*(?:results?|건|개|hits?)/i);
  if (countMatch) {
    return parseInt(countMatch[1].replace(/,/g, ''), 10);
  }

  // URL 카운트로 대체 추정
  const urlMatches = output.match(/https?:\/\/[^\s"<>]+/g);
  return urlMatches ? urlMatches.length : 0;
}

/**
 * 학술 소스 비율을 추정한다.
 */
function estimateAcademicRatio(output) {
  const totalUrls = (output.match(/https?:\/\/[^\s"<>]+/g) || []).length;
  if (totalUrls === 0) return 0;

  const academicDomains = [
    'doi.org', 'scholar.google', 'semanticscholar.org', 'arxiv.org',
    'openalex.org', 'pubmed.ncbi', 'springer.com', 'wiley.com',
    'sciencedirect.com', 'nature.com', 'science.org', 'acs.org',
    'rsc.org', 'mdpi.com', 'frontiersin.org', 'plos.org',
    'biorxiv.org', 'medrxiv.org', 'researchgate.net'
  ];

  const academicUrls = (output.match(/https?:\/\/[^\s"<>]+/g) || []).filter(url =>
    academicDomains.some(domain => url.includes(domain))
  ).length;

  return Math.round((academicUrls / totalUrls) * 100) / 100;
}

/**
 * 축적된 데이터에서 검색 지혜 마크다운 리포트를 생성한다.
 */
function generateWisdomReport(wisdomData) {
  const records = wisdomData.records;

  // 출력 데이터 유무로 분류
  const measuredRecords = records.filter(r => r.effective !== null);
  const unmeasuredRecords = records.filter(r => r.effective === null);

  // 소스별 통계
  const sourceStats = {};
  for (const r of records) {
    if (!sourceStats[r.source]) {
      sourceStats[r.source] = { count: 0, measured: 0, effective: 0 };
    }
    sourceStats[r.source].count++;
    if (r.effective !== null) {
      sourceStats[r.source].measured++;
      if (r.effective) sourceStats[r.source].effective++;
    }
  }

  // 효과 측정 가능한 기록에서 패턴 추출
  const effectiveRecords = measuredRecords.filter(r => r.effective && r.result_count > 0)
    .sort((a, b) => b.result_count - a.result_count);
  const ineffectiveRecords = measuredRecords.filter(r => !r.effective);

  const topN = Math.max(3, Math.ceil(effectiveRecords.length * 0.2));
  const topEffective = effectiveRecords.slice(0, topN);

  // 마크다운 생성
  const lines = [
    '# 검색 지혜 (자동 생성)',
    '',
    `> 마지막 갱신: ${new Date().toISOString()}`,
    `> 총 ${records.length}개 검색 기록 (측정 가능: ${measuredRecords.length}개, 미측정: ${unmeasuredRecords.length}개)`,
    '',
  ];

  if (unmeasuredRecords.length > 0 && measuredRecords.length === 0) {
    lines.push('> ⚠ PostToolUse 훅에서 tool_output이 전달되지 않아 효과 측정 불가. 쿼리 패턴과 소스별 횟수만 기록됨.');
    lines.push('');
  }

  lines.push('## 효과적인 패턴', '');

  if (topEffective.length > 0) {
    for (const r of topEffective) {
      lines.push(`- \`${r.query}\` → 결과 ${r.result_count}개 (학술 비율: ${Math.round(r.academic_ratio * 100)}%)`);
    }
  } else {
    lines.push('- 효과 측정 데이터가 부족합니다.');
  }

  lines.push('', '## 비효과적인 패턴', '');

  if (ineffectiveRecords.length > 0) {
    for (const r of ineffectiveRecords.slice(0, 10)) {
      lines.push(`- \`${r.query}\` → 결과 없음`);
    }
  } else if (measuredRecords.length > 0) {
    lines.push('- 모든 측정된 검색이 결과를 반환했습니다.');
  } else {
    lines.push('- 측정 데이터 없음 (tool_output 미제공).');
  }

  lines.push('', '## 소스별 통계', '');
  lines.push('| 소스 | 검색 횟수 | 측정 가능 | 성공률 |');
  lines.push('|------|----------|----------|--------|');

  for (const [source, stats] of Object.entries(sourceStats).sort((a, b) => b[1].count - a[1].count)) {
    const successRate = stats.measured > 0
      ? `${Math.round((stats.effective / stats.measured) * 100)}%`
      : 'N/A';
    lines.push(`| ${source} | ${stats.count} | ${stats.measured} | ${successRate} |`);
  }

  lines.push('');

  writeFileSync(WISDOM_MD_PATH, lines.join('\n'), 'utf8');
  wisdomData.last_analysis = new Date().toISOString();
  writeFileSync(WISDOM_JSON_PATH, JSON.stringify(wisdomData, null, 2), 'utf8');
}
