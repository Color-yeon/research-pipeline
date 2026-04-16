#!/usr/bin/env node

/**
 * 검색 지혜 PreToolUse 훅
 *
 * 구 search-wisdom-learner.mjs(PostToolUse)는 Claude Code 훅 사양상 tool_output을 받지 못해
 * 442/442 검색 모두 효과 측정 불가였다. 이 훅은 PreToolUse로 옮겨서 두 가지 역할을 수행한다.
 *
 *   역할 1 (사전 경고): WebSearch 호출 직전에 동일 쿼리 이력을 체크하고 stderr로 경고
 *   역할 2 (누적 기록): 쿼리 자체는 계속 누적 저장 (반복 횟수 트래킹)
 *
 * 차단(decision: block)은 하지 않는다 — 단순 정보 제공만.
 *
 * 훅 이벤트: PreToolUse, matcher: "WebSearch"
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');
const WISDOM_JSON_PATH = join(FINDINGS_DIR, '_search_wisdom.json');
const WISDOM_MD_PATH = join(FINDINGS_DIR, '_search_wisdom.md');

// 동일 쿼리 N회 이상 반복 시 경고
const REPEAT_WARN_THRESHOLD = 3;
// 분석 리포트 갱신 임계치
const ANALYSIS_THRESHOLD = 10;

// 소스 감지 패턴 (구 훅과 동일)
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
    handlePreToolUse(event);
  } catch {
    // 에러 시 조용히 통과 (훅 실패가 도구 실행을 막아선 안 됨)
  }
  // PreToolUse: 빈 객체 반환 = 통과 (decision 키 없음)
  process.stdout.write(JSON.stringify({}));
});

function handlePreToolUse(event) {
  const toolName = event.tool_name || '';
  if (toolName !== 'WebSearch') return;

  const toolInput = event.tool_input || {};
  const query = (toolInput.query || '').trim();
  if (!query) return;

  // findings/ 디렉토리 보장
  if (!existsSync(FINDINGS_DIR)) mkdirSync(FINDINGS_DIR, { recursive: true });

  // 소스 감지
  let source = 'WebSearch (일반)';
  for (const [name, pattern] of Object.entries(SOURCE_PATTERNS)) {
    if (pattern.test(query)) { source = name; break; }
  }

  // 데이터 로드 + 마이그레이션 (구 스키마 호환)
  const wisdom = loadWisdom();

  // 동일 쿼리 검색 — 정확 일치만 (의미 유사도는 비용 대비 가치 낮음)
  const queryKey = normalizeQuery(query);
  const existing = wisdom.queries.find(q => q.query_key === queryKey);

  let repeatCount;
  if (existing) {
    existing.repeat_count = (existing.repeat_count || 1) + 1;
    existing.last_seen = new Date().toISOString();
    repeatCount = existing.repeat_count;
  } else {
    wisdom.queries.push({
      query,
      query_key: queryKey,
      source,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      repeat_count: 1,
    });
    repeatCount = 1;
  }

  // 최대 1000개 쿼리 유지 (FIFO, 가장 오래된 것부터 제거)
  if (wisdom.queries.length > 1000) {
    wisdom.queries = wisdom.queries.slice(-1000);
  }

  // 사전 경고 — 동일 쿼리 N회 이상 시 stderr로 경고
  // (LLM이 받을 수 있을지는 Claude Code 사양에 따라 다르지만,
  //  최소한 사용자 화면에는 노출되어 디버깅에 도움이 된다)
  if (repeatCount >= REPEAT_WARN_THRESHOLD) {
    process.stderr.write(
      `⚠ search-wisdom: 동일 쿼리 ${repeatCount}회째 — "${query.substring(0, 80)}${query.length > 80 ? '...' : ''}"\n` +
      `  변형(동의어, 약어, 다른 표현)을 시도하세요.\n`
    );
  }

  // 저장
  writeFileSync(WISDOM_JSON_PATH, JSON.stringify(wisdom, null, 2), 'utf8');

  // 임계치 도달 시 마크다운 리포트 갱신
  if (wisdom.queries.length >= ANALYSIS_THRESHOLD) {
    generateReport(wisdom);
  }
}

// 쿼리 정규화 — 공백/대소문자/특수문자 차이를 흡수
function normalizeQuery(q) {
  return q.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s가-힣]/g, '').trim();
}

// 데이터 로드 + 구 스키마 마이그레이션
function loadWisdom() {
  if (!existsSync(WISDOM_JSON_PATH)) {
    return { queries: [], schema_version: 2, migrated_at: null };
  }
  try {
    const data = JSON.parse(readFileSync(WISDOM_JSON_PATH, 'utf8'));

    // 구 스키마(records 배열, schema_version 없음) → 신 스키마(queries 배열) 변환
    if (Array.isArray(data.records) && !data.queries) {
      const queryMap = new Map();
      for (const r of data.records) {
        if (!r.query) continue;
        const key = normalizeQuery(r.query);
        if (queryMap.has(key)) {
          const existing = queryMap.get(key);
          existing.repeat_count++;
          existing.last_seen = r.timestamp || existing.last_seen;
        } else {
          queryMap.set(key, {
            query: r.query,
            query_key: key,
            source: r.source || 'WebSearch (일반)',
            first_seen: r.timestamp || new Date().toISOString(),
            last_seen: r.timestamp || new Date().toISOString(),
            repeat_count: 1,
          });
        }
      }
      return {
        queries: [...queryMap.values()],
        schema_version: 2,
        migrated_at: new Date().toISOString(),
      };
    }

    // 신 스키마
    return {
      queries: Array.isArray(data.queries) ? data.queries : [],
      schema_version: data.schema_version || 2,
      migrated_at: data.migrated_at || null,
    };
  } catch {
    return { queries: [], schema_version: 2, migrated_at: null };
  }
}

// 마크다운 리포트 — 어느 쿼리가 자주 반복되었는지, 소스별 분포는 어떤지 보여준다
function generateReport(wisdom) {
  const queries = wisdom.queries;
  const totalCalls = queries.reduce((sum, q) => sum + (q.repeat_count || 1), 0);

  // 반복 횟수 상위 10개
  const repeated = queries
    .filter(q => (q.repeat_count || 1) >= 2)
    .sort((a, b) => (b.repeat_count || 1) - (a.repeat_count || 1))
    .slice(0, 10);

  // 소스별 통계
  const sourceStats = {};
  for (const q of queries) {
    const s = q.source;
    if (!sourceStats[s]) sourceStats[s] = { unique: 0, total: 0 };
    sourceStats[s].unique++;
    sourceStats[s].total += (q.repeat_count || 1);
  }

  const lines = [
    '# 검색 지혜 (PreToolUse 훅 자동 생성)',
    '',
    `> 마지막 갱신: ${new Date().toISOString()}`,
    `> 고유 쿼리 ${queries.length}개 / 총 호출 ${totalCalls}회`,
    `> 스키마 v${wisdom.schema_version} ${wisdom.migrated_at ? `(마이그레이션: ${wisdom.migrated_at})` : ''}`,
    '',
    '> ℹ 이 훅은 PreToolUse라서 검색 결과 자체는 측정하지 않습니다.',
    '> 동일 쿼리 반복을 감지해 변형을 유도하는 역할만 합니다.',
    '',
    '## 반복 호출된 쿼리 (변형 권장)',
    '',
  ];

  if (repeated.length > 0) {
    lines.push('| 반복 | 쿼리 | 소스 |');
    lines.push('|------|------|------|');
    for (const q of repeated) {
      const queryShort = q.query.length > 60 ? q.query.substring(0, 57) + '...' : q.query;
      lines.push(`| ${q.repeat_count}회 | \`${queryShort}\` | ${q.source} |`);
    }
  } else {
    lines.push('- 반복 호출된 쿼리 없음 (모든 쿼리가 1회만 실행됨)');
  }

  lines.push('', '## 소스별 통계', '');
  lines.push('| 소스 | 고유 쿼리 | 총 호출 |');
  lines.push('|------|----------|---------|');
  for (const [source, stats] of Object.entries(sourceStats).sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`| ${source} | ${stats.unique} | ${stats.total} |`);
  }
  lines.push('');

  writeFileSync(WISDOM_MD_PATH, lines.join('\n'), 'utf8');
}
