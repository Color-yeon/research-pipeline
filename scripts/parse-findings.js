#!/usr/bin/env node
/**
 * findings/ 디렉토리의 증거 카드를 파싱하여 JSON으로 출력하는 스크립트
 */

const fs = require('fs');
const path = require('path');

const findingsDir = path.join(__dirname, '..', 'findings');

const targetFiles = [
  '4D-QSAR.md',
  'PAMPA-permeability.md',
  'MD-descriptors.md',
  'Molecular-dynamics.md',
  'gap_analysis.md',
  'snowball_depth1.md',
  'snowball_depth2.md',
  'snowball_depth3.md',
];

const fileKeywordMap = {
  '4D-QSAR.md': '4D-QSAR',
  'PAMPA-permeability.md': 'PAMPA permeability',
  'MD-descriptors.md': 'MD descriptors',
  'Molecular-dynamics.md': 'Molecular dynamics',
  'gap_analysis.md': 'gap_analysis',
  'snowball_depth1.md': 'snowball_depth1',
  'snowball_depth2.md': 'snowball_depth2',
  'snowball_depth3.md': 'snowball_depth3',
};

function parseEvidenceCards(content, sourceFile) {
  const papers = [];

  // ### 제목 으로 시작하는 블록 분리
  const sections = content.split(/^### /m);

  for (const section of sections) {
    if (!section.trim()) continue;

    // 제목 추출 (첫 줄)
    const firstLine = section.split('\n')[0].trim();
    let title = firstLine.replace(/^\[|\]$/g, '').trim();

    // 테이블 행이 있는지 확인
    if (!section.includes('| 저자') && !section.includes('| DOI')) continue;

    // 테이블 행 파싱
    const rows = {};
    const lines = section.split('\n');
    for (const line of lines) {
      const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|$/);
      if (m) {
        const key = m[1].trim();
        const value = m[2].trim();
        if (key !== '항목' && key !== '------' && !key.startsWith('-')) {
          rows[key] = value;
        }
      }
    }

    // DOI 추출
    let doi = rows['DOI'] || '';
    if (doi.includes('doi.org/')) {
      const doiMatch = doi.match(/https?:\/\/doi\.org\/[^\s\)\]|]+/);
      doi = doiMatch ? doiMatch[0] : doi;
    } else if (doi.includes('arxiv.org/')) {
      const arxivMatch = doi.match(/https?:\/\/arxiv\.org\/abs\/[^\s\)\]|]+/);
      doi = arxivMatch ? arxivMatch[0] : doi;
    }
    if (!doi || doi === '내용') continue;

    // 인용수
    let citations = null;
    const citStr = rows['인용수'] || '';
    const citMatch = citStr.match(/(\d[\d,]*)/);
    if (citMatch) citations = parseInt(citMatch[1].replace(/,/g, ''));

    // 연도
    let year = null;
    const yearStr = rows['연도'] || '';
    const yearMatch = yearStr.match(/(\d{4})/);
    if (yearMatch) year = parseInt(yearMatch[1]);

    // 신뢰도
    let credibility = '보통';
    const credStr = (rows['신뢰도'] || '').toLowerCase();
    if (credStr.includes('높음') || credStr.includes('high')) credibility = '높음';
    else if (credStr.includes('낮음') || credStr.includes('low')) credibility = '낮음';

    // 전문 확인
    const fullTextStr = rows['전문 상태'] || '';
    const fullTextVerified = fullTextStr.includes('전문 확인') && !fullTextStr.includes('대기') && !fullTextStr.includes('불가');

    papers.push({
      title: title.substring(0, 250),
      authors: (rows['저자'] || '').substring(0, 250),
      year,
      journal: (rows['저널'] || '').substring(0, 250),
      doi,
      citations,
      methodology: (rows['방법론'] || '').substring(0, 200),
      credibility,
      keyFindings: (rows['핵심 발견'] || '').substring(0, 200),
      limitations: (rows['한계점'] || '').substring(0, 200),
      fullTextVerified,
      sourceFile: sourceFile.replace('.md', ''),
      keywords: fileKeywordMap[sourceFile] || '',
    });
  }

  return papers;
}

// 메인 실행
const allPapers = [];
const seenDOIs = new Set();

for (const file of targetFiles) {
  const filePath = path.join(findingsDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`파일 없음: ${file}`);
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const papers = parseEvidenceCards(content, file);
  console.error(`${file}: ${papers.length}편 파싱`);

  for (const paper of papers) {
    // DOI 정규화
    let normalizedDOI = paper.doi
      .replace(/https?:\/\/doi\.org\//i, '')
      .replace(/https?:\/\/arxiv\.org\/abs\//i, 'arxiv:')
      .toLowerCase();

    if (!seenDOIs.has(normalizedDOI)) {
      seenDOIs.add(normalizedDOI);
      allPapers.push(paper);
    }
  }
}

// JSON 출력
fs.writeFileSync(
  path.join(findingsDir, '_notion_papers.json'),
  JSON.stringify(allPapers, null, 2),
  'utf-8'
);
console.error(`\n총 ${allPapers.length}편 저장 → findings/_notion_papers.json`);
