#!/usr/bin/env node
/**
 * 노션 create-pages 도구용 compact JSON 생성
 * content 없이 properties만 포함하여 크기 최소화
 */

const fs = require('fs');
const path = require('path');

const papers = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'findings', '_notion_papers.json'), 'utf-8')
);

// 키워드 자동 할당
function assignKeywords(paper) {
  const directKeywords = ['4D-QSAR', 'PAMPA permeability', 'MD descriptors', 'Molecular dynamics'];
  if (directKeywords.includes(paper.keywords)) return [paper.keywords];

  const kws = [];
  const text = (paper.title + ' ' + paper.methodology + ' ' + paper.keyFindings).toLowerCase();
  if (text.includes('4d-qsar') || text.includes('4d qsar') || text.includes('gcod')) kws.push('4D-QSAR');
  if (text.includes('pampa') || text.includes('permeab') || text.includes('absorption') || text.includes('caco-2') || text.includes('admet') || text.includes('adme')) kws.push('PAMPA permeability');
  if (text.includes('descriptor') || text.includes('fingerprint') || text.includes('mdfp') || text.includes('prolif')) kws.push('MD descriptors');
  if (text.includes('molecular dynamics') || text.includes('simulation') || text.includes('force field') || text.includes('membrane') || text.includes(' md ') || text.includes('lipid')) kws.push('Molecular dynamics');
  if (kws.length === 0) kws.push('Molecular dynamics');
  return kws;
}

function normalizeDoiUrl(doi) {
  if (doi.startsWith('https://doi.org/')) return doi;
  if (doi.startsWith('http://doi.org/')) return doi.replace('http://', 'https://');
  if (doi.startsWith('https://arxiv.org/')) return doi;
  if (doi.startsWith('10.')) return `https://doi.org/${doi}`;
  return doi;
}

// 배치 크기
const batchIdx = parseInt(process.argv[2] || '1');
const BATCH_SIZE = 50;
const start = (batchIdx - 1) * BATCH_SIZE;
const batch = papers.slice(start, start + BATCH_SIZE);

const pages = batch.map(p => {
  const kws = assignKeywords(p);
  return {
    properties: {
      '논문 제목': p.title.substring(0, 200),
      '저자': (p.authors || '').substring(0, 200),
      '연도': p.year,
      '저널': (p.journal || '').substring(0, 150),
      'DOI': normalizeDoiUrl(p.doi),
      '인용수': p.citations,
      '방법론': (p.methodology || '').substring(0, 200),
      '신뢰도': p.credibility,
      '핵심 발견': (p.keyFindings || '').substring(0, 200),
      '한계점': (p.limitations || '').substring(0, 200),
      '전문 확인': p.fullTextVerified ? '__YES__' : '__NO__',
      '출처 파일': p.sourceFile,
      '키워드 조합': JSON.stringify(kws),
    }
  };
});

console.log(JSON.stringify(pages));
console.error(`배치 ${batchIdx}: ${pages.length}편 (${start+1}~${start+pages.length})`);
