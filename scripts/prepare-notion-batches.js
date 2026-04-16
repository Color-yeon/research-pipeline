#!/usr/bin/env node
/**
 * 파싱된 논문 데이터를 노션 create-pages API용 배치 JSON으로 변환
 */

const fs = require('fs');
const path = require('path');

const papers = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'findings', '_notion_papers.json'), 'utf-8')
);

// 키워드 자동 할당 (gap_analysis, snowball 논문용)
function assignKeywords(paper) {
  // 이미 4대 키워드 중 하나인 경우 그대로 사용
  const directKeywords = ['4D-QSAR', 'PAMPA permeability', 'MD descriptors', 'Molecular dynamics'];
  if (directKeywords.includes(paper.keywords)) {
    return [paper.keywords];
  }

  // gap_analysis, snowball 논문은 제목/내용 기반 추론
  const kws = [];
  const titleLower = (paper.title + ' ' + paper.methodology + ' ' + paper.keyFindings).toLowerCase();

  if (titleLower.includes('4d-qsar') || titleLower.includes('4d qsar') || titleLower.includes('gcod')) {
    kws.push('4D-QSAR');
  }
  if (titleLower.includes('pampa') || titleLower.includes('permeab') || titleLower.includes('absorption') || titleLower.includes('caco-2') || titleLower.includes('admet')) {
    kws.push('PAMPA permeability');
  }
  if (titleLower.includes('descriptor') || titleLower.includes('fingerprint') || titleLower.includes('mdfp') || titleLower.includes('prolif')) {
    kws.push('MD descriptors');
  }
  if (titleLower.includes('molecular dynamics') || titleLower.includes('simulation') || titleLower.includes('force field') || titleLower.includes('membrane') || titleLower.includes(' md ')) {
    kws.push('Molecular dynamics');
  }

  // 최소 1개 할당
  if (kws.length === 0) {
    // 출처 파일 기반 기본값
    if (paper.sourceFile.includes('snowball') || paper.sourceFile.includes('gap')) {
      kws.push('Molecular dynamics'); // 기본값
    }
  }

  return kws;
}

// DOI를 URL로 정규화
function normalizeDoiUrl(doi) {
  if (doi.startsWith('https://doi.org/')) return doi;
  if (doi.startsWith('http://doi.org/')) return doi.replace('http://', 'https://');
  if (doi.startsWith('https://arxiv.org/')) return doi;
  if (doi.startsWith('10.')) return `https://doi.org/${doi}`;
  return doi;
}

// 노션 페이지 포맷으로 변환
function toNotionPage(paper) {
  const keywords = assignKeywords(paper);

  return {
    properties: {
      '논문 제목': paper.title,
      '저자': paper.authors || '',
      '연도': paper.year || null,
      '저널': paper.journal || '',
      'DOI': normalizeDoiUrl(paper.doi),
      '인용수': paper.citations || null,
      '방법론': paper.methodology || '',
      '신뢰도': paper.credibility,
      '핵심 발견': paper.keyFindings || '',
      '한계점': paper.limitations || '',
      '전문 확인': paper.fullTextVerified ? '__YES__' : '__NO__',
      '출처 파일': paper.sourceFile,
      '키워드 조합': JSON.stringify(keywords),
    },
    content: `## 증거 카드\n\n| 항목 | 내용 |\n|------|------|\n| 저자 | ${paper.authors || '-'} |\n| 연도 | ${paper.year || '-'} |\n| 저널 | ${paper.journal || '-'} |\n| DOI | ${normalizeDoiUrl(paper.doi)} |\n| 인용수 | ${paper.citations || '-'} |\n| 방법론 | ${paper.methodology || '-'} |\n| 핵심 발견 | ${paper.keyFindings || '-'} |\n| 한계점 | ${paper.limitations || '-'} |\n| 신뢰도 | ${paper.credibility} |\n| 출처 | ${paper.sourceFile} |`
  };
}

// 배치 분할 (50개씩)
const BATCH_SIZE = 50;
const pages = papers.map(toNotionPage);

for (let i = 0; i < pages.length; i += BATCH_SIZE) {
  const batch = pages.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const filePath = path.join(__dirname, '..', 'findings', `_notion_batch${batchNum}.json`);
  fs.writeFileSync(filePath, JSON.stringify(batch, null, 2), 'utf-8');
  console.log(`배치 ${batchNum}: ${batch.length}편 → _notion_batch${batchNum}.json`);
}

console.log(`\n총 ${pages.length}편, ${Math.ceil(pages.length / BATCH_SIZE)}개 배치`);
