#!/usr/bin/env node
// Tier 3 대기 논문 강제 탐색 — findings/*.md를 grep해서 [전문 확보 대기 - Tier 3 필요]
// 태그가 붙은 증거 카드의 DOI를 추출한다. /research-read 스킬이 LLM 자체 판단 대신
// 이 스크립트로 대상을 확정하도록 강제하기 위해 만들었다.
//
// 사용법:
//   node scripts/list-pending-tier3.js          # 사람이 읽는 표
//   node scripts/list-pending-tier3.js --json   # 배치 입력용 JSON

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..');
const FINDINGS_DIR = path.join(PROJECT_DIR, 'findings');
const RAW_TEXTS_DIR = path.join(FINDINGS_DIR, 'raw_texts');

// 카드 안에서 [전문 확보 대기 - Tier 3 필요] 태그가 있는지 검사
const PENDING_TAG = /\[전문\s*확보\s*대기\s*-\s*Tier\s*3\s*필요\]/i;

// 카드 안에서 DOI 추출 (`| DOI | https://doi.org/... |` 또는 본문에 doi.org/ 또는 10.xxxx/yyyy)
const DOI_REGEX = /(?:doi\.org\/)?(10\.\d{4,9}\/[^\s)\]>"`|]+)/i;

function doiToSlug(doi) {
  return doi.replace(/^https?:\/\/doi\.org\//i, '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100);
}

// 이미 raw_texts에 정상 저장된 DOI는 제외 대상
function hasValidRawText(doi) {
  const filePath = path.join(RAW_TEXTS_DIR, doiToSlug(doi) + '.md');
  if (!fs.existsSync(filePath)) return false;
  // 검증은 비싸므로 여기서는 파일 크기만 체크 (3000자 미만이면 검증 실패로 간주)
  try {
    return fs.statSync(filePath).size >= 3000;
  } catch {
    return false;
  }
}

// findings/*.md를 스캔하여 Pending Tier 3 카드를 추출한다.
function findPendingCards() {
  if (!fs.existsSync(FINDINGS_DIR)) return [];

  const mdFiles = fs.readdirSync(FINDINGS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'));

  const pending = new Map();   // doi(소문자) → {doi, title, source_files: Set}

  for (const file of mdFiles) {
    const fullPath = path.join(FINDINGS_DIR, file);
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    // `### `로 시작하는 헤딩을 카드 단위 분할 기준으로 사용
    // (정규식 split으로 헤딩과 그 직후 본문을 함께 묶는다)
    const sections = content.split(/(?=^### )/m);

    for (const section of sections) {
      if (!PENDING_TAG.test(section)) continue;

      // 카드 헤딩에서 제목 추출
      const titleMatch = section.match(/^###\s+(?:\d+\.\s*)?(.+?)$/m);
      const title = titleMatch ? titleMatch[1].trim() : '(제목 없음)';

      // 같은 카드 안에서 DOI 추출 — 첫 번째 매치를 채택
      const doiMatch = section.match(DOI_REGEX);
      if (!doiMatch) continue;
      const doi = doiMatch[1].toLowerCase().replace(/[.,;)]+$/, '');

      // 이미 정상 raw_text가 있으면 제외 (Tier 3에서 이미 처리된 경우)
      if (hasValidRawText(doi)) continue;

      if (!pending.has(doi)) {
        pending.set(doi, { doi, title, source_files: new Set() });
      }
      pending.get(doi).source_files.add(file);
    }
  }

  // Set → 배열로 변환
  return [...pending.values()].map(p => ({
    doi: p.doi,
    title: p.title,
    source_files: [...p.source_files],
  }));
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

const isJson = process.argv.includes('--json');
const pending = findPendingCards();

if (isJson) {
  // 배치 입력용 — fetch-paper.js --batch로 바로 파이프 가능
  process.stdout.write(JSON.stringify(pending, null, 2));
} else {
  // 사람이 읽는 표
  console.log(`\nTier 3 대기 논문: ${pending.length}편\n`);
  if (pending.length === 0) {
    console.log('대기 중인 논문이 없습니다. (Tier 3 자동 스킵)');
    process.exit(0);
  }

  console.log('| # | DOI | 출처 파일 | 제목 |');
  console.log('|---|-----|----------|------|');
  pending.forEach((p, i) => {
    const titleShort = p.title.length > 50 ? p.title.substring(0, 47) + '...' : p.title;
    console.log(`| ${i + 1} | ${p.doi} | ${p.source_files.join(', ')} | ${titleShort} |`);
  });

  console.log(`\n→ 배치 입력: node scripts/list-pending-tier3.js --json > /tmp/pending.json`);
}
