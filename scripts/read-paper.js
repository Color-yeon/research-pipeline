#!/usr/bin/env node
// 논문 전문 읽기 스크립트
// EZproxy 경유 Playwright로 논문 본문을 추출하여 마크다운 파일로 저장
// 사용법:
//   node scripts/read-paper.js <DOI 또는 URL>
//   node scripts/read-paper.js --batch <_blocked.json 경로>
//   node scripts/read-paper.js --batch findings/4D-QSAR_blocked.json

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(PROJECT_DIR, '.playwright-profile');
const TEMP_PROFILE = path.join(PROJECT_DIR, '.playwright-script-temp');
const OUTPUT_DIR = path.join(PROJECT_DIR, 'findings', 'raw_texts');
const PROXY_BASE = 'https://oca.korea.ac.kr/link.n2s?url=';

// MCP가 메인 프로필을 잠그고 있으므로, 쿠키를 임시 프로필로 복사하여 사용
function prepareTempProfile() {
  if (fs.existsSync(TEMP_PROFILE)) {
    fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
  }
  const tempDefault = path.join(TEMP_PROFILE, 'Default');
  fs.mkdirSync(tempDefault, { recursive: true });

  // 쿠키 파일 복사
  const cookieSrc = path.join(PROFILE_DIR, 'Default', 'Cookies');
  const cookieDst = path.join(tempDefault, 'Cookies');
  if (fs.existsSync(cookieSrc)) {
    fs.copyFileSync(cookieSrc, cookieDst);
    const journalSrc = cookieSrc + '-journal';
    if (fs.existsSync(journalSrc)) {
      fs.copyFileSync(journalSrc, path.join(tempDefault, 'Cookies-journal'));
    }
    return true;
  }
  return false;
}

function cleanupTempProfile() {
  if (fs.existsSync(TEMP_PROFILE)) {
    fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
  }
}

// DOI에서 파일명 생성
function doiToSlug(doi) {
  return doi
    .replace(/^https?:\/\/doi\.org\//, '')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100);
}

// URL에서 DOI 추출 시도
function extractDoi(input) {
  const doiMatch = input.match(/10\.\d{4,}\/[^\s,;]+/);
  return doiMatch ? doiMatch[0] : null;
}

// 논문 본문 추출 JS (multi-publisher 대응)
const EXTRACTION_JS = `
(() => {
  const parts = [];

  // 제목
  const titleSel = [
    'h1.c-article-title',
    'h1[data-test="article-title"]',
    '.article-title h1',
    '.article-title',
    '.highwire-cite-title',
    '#page-title',
    'article h1',
    '.document-title h1',
    '.citation-title'
  ];
  for (const sel of titleSel) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 5) {
      parts.push('# ' + el.innerText.trim());
      break;
    }
  }

  // 저자
  const authorSel = [
    '.c-article-author-list',
    '[data-test="author-list"]',
    '.author-list',
    '.highwire-cite-authors',
    '.loa-wrapper',
    '.article-header__authors',
    '#sb-1'  // T&F 저자
  ];
  for (const sel of authorSel) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 3) {
      parts.push('**Authors:** ' + el.innerText.trim().substring(0, 500));
      break;
    }
  }

  // 제외할 섹션 패턴
  const skip = /method|material|reference|acknowledg|author info|ethics|data avail|code avail|competing|peer review|additional info|extended data|supplementary|source data|rights|about this|figure|table of content|related article|author contribution|funding|conflict|copyright|license/i;

  // 전략 1: Nature/Springer 스타일
  document.querySelectorAll('.c-article-section__content').forEach(sec => {
    const h = sec.previousElementSibling;
    const ht = h ? h.innerText.trim() : '';
    if (skip.test(ht)) return;
    const text = sec.innerText.trim();
    if (text.length > 30) parts.push('## ' + ht + '\\n' + text);
  });

  // 전략 2: h2 기반 섹션 (Frontiers, T&F 등)
  if (parts.length <= 2) {
    document.querySelectorAll('h2').forEach(h2 => {
      const ht = h2.innerText.trim();
      if (skip.test(ht)) return;
      if (/ORIGINAL RESEARCH|Summary|cookie|privacy|trust in science|statement|funding|conflict|download|cited by|your download/i.test(ht)) return;
      let text = '';
      let sib = h2.nextElementSibling;
      while (sib && sib.tagName !== 'H2') {
        if (sib.innerText) text += sib.innerText.trim() + '\\n';
        sib = sib.nextElementSibling;
      }
      if (text.length > 30) parts.push('## ' + ht + '\\n' + text.trim());
    });
  }

  // 전략 3: Elsevier/ScienceDirect 스타일
  if (parts.length <= 2) {
    document.querySelectorAll('.section-paragraph, .Body .section, [id^="sec"] > .section-paragraph').forEach(sec => {
      const text = sec.innerText.trim();
      if (text.length > 50 && !skip.test(text.substring(0, 100))) parts.push(text);
    });
  }

  // 전략 4: Wiley 스타일
  if (parts.length <= 2) {
    document.querySelectorAll('.article-section__content').forEach(sec => {
      const h = sec.previousElementSibling;
      const ht = h ? h.innerText.trim() : '';
      if (skip.test(ht)) return;
      const text = sec.innerText.trim();
      if (text.length > 30) parts.push('## ' + ht + '\\n' + text);
    });
  }

  // 전략 5: 범용 fallback — article/main 태그
  if (parts.length <= 2) {
    const main = document.querySelector('article, main, [role="main"], .article-content');
    if (main) parts.push(main.innerText.trim().substring(0, 80000));
  }

  return parts.join('\\n\\n');
})()
`;

// References 섹션 추출 JS (snowball용)
const REFERENCES_JS = `
(() => {
  // Nature/Springer
  const sec = [...document.querySelectorAll('.c-article-section__content')].find(s => {
    const h = s.previousElementSibling;
    return h && /^reference/i.test(h.innerText.trim());
  });
  if (sec) return sec.innerText.trim().substring(0, 50000);

  // 범용
  const refList = document.querySelector('#references, .references, .ref-list, [data-title="References"]');
  if (refList) return refList.innerText.trim().substring(0, 50000);

  return 'REFERENCES_NOT_FOUND';
})()
`;

// 단일 논문 읽기
async function readPaper(context, url, options = {}) {
  const { includeRefs = false, timeout = 30000 } = options;
  const page = await context.newPage();
  const proxyUrl = PROXY_BASE + url;

  try {
    console.log(`  → 접근 중: ${url}`);
    await page.goto(proxyUrl, { waitUntil: 'domcontentloaded', timeout });

    // 페이지 로딩 대기 (동적 콘텐츠)
    await page.waitForTimeout(3000);

    // 본문 추출
    const content = await page.evaluate(EXTRACTION_JS);

    // References 추출 (옵션)
    let refs = null;
    if (includeRefs) {
      refs = await page.evaluate(REFERENCES_JS);
    }

    return { success: true, content, refs, url };
  } catch (err) {
    return { success: false, error: err.message, url };
  } finally {
    await page.close();
  }
}

// 결과를 파일로 저장
function saveResult(result, doi) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const slug = doi ? doiToSlug(doi) : doiToSlug(result.url);
  const filePath = path.join(OUTPUT_DIR, slug + '.md');

  let md = '';
  if (result.success) {
    md = result.content;
    if (result.refs && result.refs !== 'REFERENCES_NOT_FOUND') {
      md += '\n\n---\n\n## References\n\n' + result.refs;
    }
  } else {
    md = `# 접근 실패\n\nURL: ${result.url}\n에러: ${result.error}`;
  }

  fs.writeFileSync(filePath, md, 'utf-8');
  return filePath;
}

// 메인 실행
(async () => {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('사용법:');
    console.log('  node scripts/read-paper.js <DOI 또는 URL>');
    console.log('  node scripts/read-paper.js --batch <_blocked.json 경로>');
    console.log('  node scripts/read-paper.js --refs <DOI>  (References 포함)');
    process.exit(0);
  }

  // 프로필 존재 확인
  if (!fs.existsSync(PROFILE_DIR)) {
    console.error('오류: .playwright-profile이 없습니다. scripts/setup-auth.sh를 먼저 실행하세요.');
    process.exit(1);
  }

  // MCP가 메인 프로필을 잠그고 있으므로 임시 프로필에 쿠키 복사
  console.log('인증 쿠키 준비 중...');
  const hasCookies = prepareTempProfile();
  if (!hasCookies) {
    console.error('오류: 쿠키 파일을 찾을 수 없습니다. scripts/setup-auth.sh를 먼저 실행하세요.');
    process.exit(1);
  }

  // 브라우저 시작 (임시 프로필)
  console.log('브라우저 시작 중...');
  const context = await chromium.launchPersistentContext(TEMP_PROFILE, {
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const includeRefs = args.includes('--refs');
    const isBatch = args.includes('--batch');

    if (isBatch) {
      // 배치 모드: _blocked.json 파일 읽기
      const jsonPath = args[args.indexOf('--batch') + 1];
      if (!jsonPath || !fs.existsSync(jsonPath)) {
        console.error('오류: _blocked.json 파일을 찾을 수 없습니다:', jsonPath);
        process.exit(1);
      }

      const papers = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      console.log(`${papers.length}개 논문 처리 시작...\n`);

      const results = [];
      for (let i = 0; i < papers.length; i++) {
        const paper = papers[i];
        const url = paper.doi || paper.url;
        console.log(`[${i + 1}/${papers.length}] ${paper.title || url}`);

        const result = await readPaper(context, url, { includeRefs, timeout: 30000 });
        const filePath = saveResult(result, paper.doi);

        if (result.success) {
          const size = (result.content.length / 1024).toFixed(1);
          console.log(`  ✓ 저장: ${filePath} (${size}KB)\n`);
        } else {
          console.log(`  ✗ 실패: ${result.error}\n`);
        }

        results.push({ ...paper, filePath, success: result.success });

        // rate limit 방지
        if (i < papers.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      // 결과 요약
      const ok = results.filter(r => r.success).length;
      const fail = results.filter(r => !r.success).length;
      console.log(`\n완료: 성공 ${ok}건, 실패 ${fail}건`);
      console.log(`출력 디렉토리: ${OUTPUT_DIR}`);

    } else {
      // 단일 논문 모드
      const input = args.filter(a => !a.startsWith('--'))[0];
      let url = input;

      // DOI인 경우 URL로 변환
      if (!input.startsWith('http')) {
        url = 'https://doi.org/' + input.replace(/^doi:?\s*/i, '');
      }

      const result = await readPaper(context, url, { includeRefs, timeout: 30000 });
      const doi = extractDoi(input) || input;
      const filePath = saveResult(result, doi);

      if (result.success) {
        const size = (result.content.length / 1024).toFixed(1);
        console.log(`✓ 저장 완료: ${filePath} (${size}KB)`);
      } else {
        console.log(`✗ 실패: ${result.error}`);
        console.log(`  파일: ${filePath}`);
        process.exit(1);
      }
    }
  } finally {
    await context.close();
    cleanupTempProfile();
    console.log('브라우저 종료.');
  }
})().catch(err => {
  console.error('치명적 오류:', err.message);
  cleanupTempProfile();
  process.exit(1);
});
