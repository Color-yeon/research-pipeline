#!/usr/bin/env node

/**
 * 연구 체크포인트 — 공용 라이브러리 + CLI 진입점
 *
 * findings/, research-config.json, prd.json 의 상태를 스캔하여
 * 진행 요약(체크포인트)을 생성하고 findings/_checkpoint.json 에 기록한다.
 * 다음 세션/태스크가 이 파일을 읽어 이어갈 수 있도록 한다.
 *
 * Claude Code 환경에서는 .claude/settings.json 의 PreCompact 훅
 * (pre-compact-checkpoint.mjs) 이 컨텍스트 압축 직전에 같은 정보를
 * 자동으로 저장한다. 이 라이브러리는 PreCompact 이벤트가 없는
 * Codex 경로에서, 각 스킬 종료 시점에 명시적으로 호출되어
 * 같은 역할을 수행한다.
 *
 * ## 사용법 (CLI)
 *   node scripts/lib/checkpoint.mjs
 *   → findings/_checkpoint.json 에 저장 + 요약을 stdout 에 출력 (exit 0)
 *
 * ## 사용법 (함수 import)
 *   import { buildCheckpoint, buildSummary, saveCheckpoint } from './scripts/lib/checkpoint.mjs';
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');
const CHECKPOINT_PATH = join(FINDINGS_DIR, '_checkpoint.json');
const CONFIG_PATH = join(PROJECT_ROOT, 'research-config.json');
const PRD_PATH = join(PROJECT_ROOT, 'prd.json');

/**
 * 현재 연구 상태를 스캔하여 체크포인트 객체를 구축한다.
 */
export function buildCheckpoint() {
  const checkpoint = {
    timestamp: new Date().toISOString(),
    papers_collected: 0,
    dois: [],
    keywords_searched: [],
    keywords_remaining: [],
    findings_files: [],
    blocked_papers: 0,
    current_phase: 'unknown',
    tasks_completed: [],
    tasks_remaining: [],
    sources_mentioned: {
      WebSearch: false,
      OpenAlex: false,
      'Semantic Scholar': false,
      arXiv: false,
      'Google Scholar': false,
    },
  };

  if (!existsSync(FINDINGS_DIR)) return checkpoint;

  const files = readdirSync(FINDINGS_DIR).filter((f) => {
    const fullPath = join(FINDINGS_DIR, f);
    try {
      return statSync(fullPath).isFile();
    } catch {
      return false;
    }
  });

  for (const file of files) {
    const fullPath = join(FINDINGS_DIR, file);
    if (file.startsWith('_')) continue;

    if (file.endsWith('_blocked.json')) {
      try {
        const blocked = JSON.parse(readFileSync(fullPath, 'utf8'));
        checkpoint.blocked_papers += Array.isArray(blocked) ? blocked.length : 0;
      } catch {
        /* 무시 */
      }
      continue;
    }

    if (file.endsWith('.md')) {
      checkpoint.findings_files.push(file);

      try {
        const content = readFileSync(fullPath, 'utf8');

        // DOI 추출 (중복 제거)
        const doiMatches = content.match(/doi\.org\/[^\s\)>\]]+/gi);
        if (doiMatches) {
          for (const doi of doiMatches) {
            const normalized = doi.replace(/doi\.org\//i, '').toLowerCase();
            if (!checkpoint.dois.includes(normalized)) {
              checkpoint.dois.push(normalized);
            }
          }
        }

        // 소스 언급 확인
        if (content.includes('WebSearch') || content.includes('웹 검색'))
          checkpoint.sources_mentioned.WebSearch = true;
        if (content.includes('OpenAlex') || content.includes('openalex'))
          checkpoint.sources_mentioned.OpenAlex = true;
        if (
          content.includes('Semantic Scholar') ||
          content.includes('semanticscholar')
        )
          checkpoint.sources_mentioned['Semantic Scholar'] = true;
        if (content.includes('arXiv') || content.includes('arxiv'))
          checkpoint.sources_mentioned.arXiv = true;
        if (
          content.includes('Google Scholar') ||
          content.includes('scholar.google')
        )
          checkpoint.sources_mentioned['Google Scholar'] = true;
      } catch {
        /* 무시 */
      }
    }
  }

  // research-config.json 에서 키워드 진행률 계산
  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      const allKeywords = config.keywords || [];

      for (const kw of allKeywords) {
        const normalizedKw = kw.toLowerCase().replace(/\s+/g, '-');
        const searched = checkpoint.findings_files.some((f) =>
          f.toLowerCase().includes(normalizedKw),
        );
        if (searched) checkpoint.keywords_searched.push(kw);
        else checkpoint.keywords_remaining.push(kw);
      }
    } catch {
      /* 무시 */
    }
  }

  // prd.json 에서 태스크 진행률
  if (existsSync(PRD_PATH)) {
    try {
      const prd = JSON.parse(readFileSync(PRD_PATH, 'utf8'));
      const stories = prd.userStories || prd.tasks || [];

      for (const story of stories) {
        const id = story.id || story.title;
        if (story.passes === true || story.status === 'completed') {
          checkpoint.tasks_completed.push(id);
        } else {
          checkpoint.tasks_remaining.push(id);
        }
      }

      if (checkpoint.tasks_remaining.length > 0) {
        const nextTask = checkpoint.tasks_remaining[0];
        if (typeof nextTask === 'string') {
          const phaseMatch = nextTask.match(/P(\d+)/);
          if (phaseMatch) {
            checkpoint.current_phase = `Phase ${phaseMatch[1]}`;
          }
        }
      }
    } catch {
      /* 무시 */
    }
  }

  checkpoint.papers_collected = checkpoint.dois.length;

  return checkpoint;
}

/**
 * 체크포인트 객체에서 사람이 읽기 좋은 요약 문자열을 생성한다.
 */
export function buildSummary(cp) {
  const lines = [
    `[연구 체크포인트] 논문 ${cp.papers_collected}편 수집 (DOI ${cp.dois.length}개 확인).`,
  ];

  if (cp.keywords_searched.length > 0 || cp.keywords_remaining.length > 0) {
    const total = cp.keywords_searched.length + cp.keywords_remaining.length;
    lines.push(`키워드 ${cp.keywords_searched.length}/${total} 완료.`);
  }

  if (cp.current_phase !== 'unknown') {
    lines.push(`현재: ${cp.current_phase}.`);
  }

  if (cp.tasks_remaining.length > 0) {
    lines.push(`다음 태스크: ${cp.tasks_remaining[0]}.`);
  }

  const sourcesChecked = Object.entries(cp.sources_mentioned)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const sourcesMissing = Object.entries(cp.sources_mentioned)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (sourcesMissing.length > 0 && sourcesChecked.length > 0) {
    lines.push(
      `소스 ${sourcesChecked.length}/5 검색됨. 미검색: ${sourcesMissing.join(', ')}.`,
    );
  }

  if (cp.blocked_papers > 0) {
    lines.push(`접근 실패 논문: ${cp.blocked_papers}편.`);
  }

  lines.push(`전체 체크포인트: findings/_checkpoint.json`);

  return lines.join('\n');
}

/**
 * 체크포인트를 빌드 → JSON 저장 → 요약 반환 까지 한 번에 수행.
 * findings/ 가 없으면 생성 시도.
 */
export function saveCheckpoint() {
  const checkpoint = buildCheckpoint();

  try {
    writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');
  } catch (err) {
    // findings/ 자체가 없을 수도 — 조용히 폴백
    return { checkpoint, summary: buildSummary(checkpoint), saved: false, error: err.message };
  }

  return { checkpoint, summary: buildSummary(checkpoint), saved: true };
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
  const { summary, saved, error } = saveCheckpoint();

  if (!saved) {
    console.error(`⚠ 체크포인트 저장 실패: ${error ?? 'findings/ 없음'}`);
    console.log(summary);
    process.exit(0);
  }

  console.log(summary);
  process.exit(0);
}
