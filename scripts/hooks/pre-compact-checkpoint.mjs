#!/usr/bin/env node

/**
 * Pre-Compact 체크포인트 훅
 *
 * 컨텍스트 압축 직전에 연구 진행 상황을 findings/_checkpoint.json에 저장하고,
 * 압축 후 컨텍스트에 요약을 재주입한다.
 *
 * 훅 이벤트: PreCompact
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';

// 프로젝트 루트 (hooks 스크립트 위치 기준)
const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');
const CHECKPOINT_PATH = join(FINDINGS_DIR, '_checkpoint.json');
const CONFIG_PATH = join(PROJECT_ROOT, 'research-config.json');
const PRD_PATH = join(PROJECT_ROOT, 'prd.json');

// stdin에서 이벤트 데이터 읽기
let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const checkpoint = buildCheckpoint();

    // 체크포인트 JSON 저장
    writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');

    // 압축 후 컨텍스트에 주입할 요약 메시지 생성
    const summary = buildSummary(checkpoint);

    // stdout으로 훅 응답 반환
    const response = {
      suppressMessage: summary
    };

    process.stdout.write(JSON.stringify(response));
  } catch (err) {
    // 훅 실패 시 조용히 통과 (파이프라인 방해 금지)
    process.stdout.write(JSON.stringify({}));
  }
});

/**
 * findings/ 디렉토리를 스캔하여 체크포인트 데이터를 구축한다.
 */
function buildCheckpoint() {
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
      'Google Scholar': false
    }
  };

  // findings/ 디렉토리가 없으면 빈 체크포인트 반환
  if (!existsSync(FINDINGS_DIR)) return checkpoint;

  // findings/ 파일 스캔
  const files = readdirSync(FINDINGS_DIR).filter(f => {
    const fullPath = join(FINDINGS_DIR, f);
    return statSync(fullPath).isFile();
  });

  for (const file of files) {
    const fullPath = join(FINDINGS_DIR, file);

    // _로 시작하는 내부 파일은 건너뜀
    if (file.startsWith('_')) continue;

    // _blocked.json 파일 처리
    if (file.endsWith('_blocked.json')) {
      try {
        const blocked = JSON.parse(readFileSync(fullPath, 'utf8'));
        checkpoint.blocked_papers += Array.isArray(blocked) ? blocked.length : 0;
      } catch { /* 무시 */ }
      continue;
    }

    // .md 증거카드 파일 처리
    if (file.endsWith('.md')) {
      checkpoint.findings_files.push(file);

      try {
        const content = readFileSync(fullPath, 'utf8');

        // (구버그 제거) `### ` 헤딩 단순 합산은 같은 논문이 4D-QSAR.md, snowball_*, integrated_analysis.md 등에
        // 여러 번 등장하면서 중복 카운트되어 papers_collected를 부풀림. 본 카운트는 루프 종료 후
        // 고유 DOI 수(checkpoint.dois.length)로 한 번만 설정한다.

        // DOI 추출
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
        if (content.includes('WebSearch') || content.includes('웹 검색')) checkpoint.sources_mentioned.WebSearch = true;
        if (content.includes('OpenAlex') || content.includes('openalex')) checkpoint.sources_mentioned.OpenAlex = true;
        if (content.includes('Semantic Scholar') || content.includes('semanticscholar')) checkpoint.sources_mentioned['Semantic Scholar'] = true;
        if (content.includes('arXiv') || content.includes('arxiv')) checkpoint.sources_mentioned.arXiv = true;
        if (content.includes('Google Scholar') || content.includes('scholar.google')) checkpoint.sources_mentioned['Google Scholar'] = true;
      } catch { /* 무시 */ }
    }
  }

  // research-config.json에서 키워드 정보 추출
  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      const allKeywords = config.keywords || [];

      // findings 파일명에서 검색 완료된 키워드 추출
      for (const kw of allKeywords) {
        const normalizedKw = kw.toLowerCase().replace(/\s+/g, '-');
        const searched = checkpoint.findings_files.some(f =>
          f.toLowerCase().includes(normalizedKw)
        );
        if (searched) {
          checkpoint.keywords_searched.push(kw);
        } else {
          checkpoint.keywords_remaining.push(kw);
        }
      }
    } catch { /* 무시 */ }
  }

  // prd.json에서 태스크 상태 추출
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

      // 현재 Phase 추정
      if (checkpoint.tasks_remaining.length > 0) {
        const nextTask = checkpoint.tasks_remaining[0];
        if (typeof nextTask === 'string') {
          const phaseMatch = nextTask.match(/P(\d+)/);
          if (phaseMatch) {
            checkpoint.current_phase = `Phase ${phaseMatch[1]}`;
          }
        }
      }
    } catch { /* 무시 */ }
  }

  // 고유 DOI 수가 곧 수집 논문 수다. (구버그: 헤딩 단순 합산은 중복 카운트)
  checkpoint.papers_collected = checkpoint.dois.length;

  return checkpoint;
}

/**
 * 체크포인트에서 간결한 요약 메시지를 생성한다.
 */
function buildSummary(cp) {
  const lines = [
    `[연구 체크포인트] 논문 ${cp.papers_collected}편 수집 (DOI ${cp.dois.length}개 확인).`
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

  // 소스 커버리지
  const sourcesChecked = Object.entries(cp.sources_mentioned)
    .filter(([, v]) => v).map(([k]) => k);
  const sourcesMissing = Object.entries(cp.sources_mentioned)
    .filter(([, v]) => !v).map(([k]) => k);

  if (sourcesMissing.length > 0 && sourcesChecked.length > 0) {
    lines.push(`소스 ${sourcesChecked.length}/5 검색됨. 미검색: ${sourcesMissing.join(', ')}.`);
  }

  if (cp.blocked_papers > 0) {
    lines.push(`접근 실패 논문: ${cp.blocked_papers}편.`);
  }

  lines.push(`전체 체크포인트: findings/_checkpoint.json`);

  return lines.join('\n');
}
