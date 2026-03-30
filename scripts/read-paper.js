#!/usr/bin/env node
// 논문 전문 읽기 스크립트
// EZproxy 경유 Playwright로 논문 본문을 추출하여 마크다운 파일로 저장
// 세션 만료 시 .env의 자격증명으로 자동 재로그인
// 사용법:
//   node scripts/read-paper.js <DOI 또는 URL>
//   node scripts/read-paper.js --batch <_blocked.json 경로>

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_DIR, 'findings', 'raw_texts');
const PROXY_BASE = 'https://oca.korea.ac.kr/link.n2s?url=';

// .env 파일에서 환경변수 로드
function loadEnv() {
  const envPath = path.join(PROJECT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    if (!process.env[t.substring(0, eq).trim()]) process.env[t.substring(0, eq).trim()] = t.substring(eq + 1).trim();
  }
}
loadEnv();

function doiToSlug(doi) {
  return doi.replace(/^https?:\/\/doi\.org\//, '').replace(/[\/\\:*?"<>|]/g, '_').replace(/_{2,}/g, '_').substring(0, 100);
}

function extractDoi(input) {
  const m = input.match(/10\.\d{4,}\/[^\s,;]+/);
  return m ? m[0] : null;
}

// 논문 본문 추출 JS
const EXTRACTION_JS = `
(() => {
  const parts = [];
  const titleSel = ['h1.c-article-title','h1[data-test="article-title"]','.article-title h1','.article-title','.highwire-cite-title','#page-title','article h1','.document-title h1','.citation-title'];
  for (const sel of titleSel) { const el = document.querySelector(sel); if (el && el.innerText.trim().length > 5) { parts.push('# ' + el.innerText.trim()); break; } }
  const authorSel = ['.c-article-author-list','[data-test="author-list"]','.author-list','.highwire-cite-authors','.loa-wrapper','.article-header__authors','#sb-1'];
  for (const sel of authorSel) { const el = document.querySelector(sel); if (el && el.innerText.trim().length > 3) { parts.push('**Authors:** ' + el.innerText.trim().substring(0, 500)); break; } }
  const skip = /method|material|reference|acknowledg|author info|ethics|data avail|code avail|competing|peer review|additional info|extended data|supplementary|source data|rights|about this|figure|table of content|related article|author contribution|funding|conflict|copyright|license/i;
  document.querySelectorAll('.c-article-section__content').forEach(sec => { const h = sec.previousElementSibling; const ht = h ? h.innerText.trim() : ''; if (skip.test(ht)) return; const text = sec.innerText.trim(); if (text.length > 30) parts.push('## ' + ht + '\\n' + text); });
  if (parts.length <= 2) { document.querySelectorAll('h2').forEach(h2 => { const ht = h2.innerText.trim(); if (skip.test(ht)) return; if (/ORIGINAL RESEARCH|Summary|cookie|privacy|trust in science|statement|funding|conflict|download|cited by|your download/i.test(ht)) return; let text = ''; let sib = h2.nextElementSibling; while (sib && sib.tagName !== 'H2') { if (sib.innerText) text += sib.innerText.trim() + '\\n'; sib = sib.nextElementSibling; } if (text.length > 30) parts.push('## ' + ht + '\\n' + text.trim()); }); }
  if (parts.length <= 2) { document.querySelectorAll('.section-paragraph, .Body .section, [id^="sec"] > .section-paragraph').forEach(sec => { const text = sec.innerText.trim(); if (text.length > 50 && !skip.test(text.substring(0, 100))) parts.push(text); }); }
  if (parts.length <= 2) { document.querySelectorAll('.article-section__content').forEach(sec => { const h = sec.previousElementSibling; const ht = h ? h.innerText.trim() : ''; if (skip.test(ht)) return; const text = sec.innerText.trim(); if (text.length > 30) parts.push('## ' + ht + '\\n' + text); }); }
  if (parts.length <= 2) { const main = document.querySelector('article, main, [role="main"], .article-content'); if (main) parts.push(main.innerText.trim().substring(0, 80000)); }
  return parts.join('\\n\\n');
})()`;

const REFERENCES_JS = `
(() => {
  const sec = [...document.querySelectorAll('.c-article-section__content')].find(s => { const h = s.previousElementSibling; return h && /^reference/i.test(h.innerText.trim()); });
  if (sec) return sec.innerText.trim().substring(0, 50000);
  const refList = document.querySelector('#references, .references, .ref-list, [data-title="References"]');
  if (refList) return refList.innerText.trim().substring(0, 50000);
  return 'REFERENCES_NOT_FOUND';
})()`;

// 로그인 페이지 감지
async function isLoginPage(page) {
  const url = page.url();
  if (url.includes('library.korea.ac.kr/login')) return true;
  if (url.includes('oca.korea.ac.kr/authapi')) return true;
  return await page.evaluate(() => !!document.querySelector('#user-id') && !!document.querySelector('#user-pw')).catch(() => false);
}

// 도서관 포털 로그인 (같은 컨텍스트에서 수행)
async function doLogin(page) {
  const id = process.env.KOREA_PORTAL_ID;
  const pw = process.env.KOREA_PORTAL_PW;
  if (!id || !pw || id === '여기에_포털ID_입력') {
    console.log('  ⚠ .env에 KOREA_PORTAL_ID / KOREA_PORTAL_PW를 설정하세요.');
    return false;
  }

  console.log('  → 자동 로그인 중...');
  try {
    await page.waitForSelector('#user-id', { timeout: 10000 });
    const radio = await page.$('#user-type-1');
    if (radio) await radio.click();
    await page.fill('#user-id', id);
    await page.fill('#user-pw', pw);

    // 로그인 폼의 버튼 정확히 클릭
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {}),
      page.click('form.needs-validation button[type="submit"]'),
    ]);
    await page.waitForTimeout(3000);

    const still = await page.evaluate(() => !!document.querySelector('#user-id')).catch(() => false);
    if (still) {
      console.log('  ✗ 로그인 실패 (아이디/비밀번호 확인)');
      return false;
    }
    console.log('  ✓ 로그인 성공');
    return true;
  } catch (err) {
    console.log(`  ✗ 로그인 에러: ${err.message}`);
    return false;
  }
}

// 단일 논문 읽기 (같은 persistent context에서 로그인+접근)
async function readPaper(ctx, url, options = {}) {
  const { includeRefs = false, timeout = 45000 } = options;
  const proxyUrl = PROXY_BASE + url;
  const page = await ctx.newPage();

  try {
    console.log(`  → 접근 중: ${url}`);
    try {
      await page.goto(proxyUrl, { waitUntil: 'networkidle', timeout });
    } catch {
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(2000);

    // 로그인 필요 시 — 같은 페이지에서 바로 로그인
    if (await isLoginPage(page)) {
      const ok = await doLogin(page);
      if (!ok) return { success: false, error: '자동 로그인 실패', url };

      // 로그인 성공 후 returl로 자동 리다이렉트 되었을 수 있음
      // 안 됐으면 직접 이동
      await page.waitForTimeout(2000);
      if (!(page.url().includes('doi.org') || page.url().includes('pubs.') || page.url().includes('sciencedirect') || page.url().includes('springer') || page.url().includes('frontiersin') || page.url().includes('wiley'))) {
        console.log('  → 프록시 URL로 이동...');
        try {
          await page.goto(proxyUrl, { waitUntil: 'networkidle', timeout });
        } catch {
          await page.waitForTimeout(5000);
        }
        await page.waitForTimeout(3000);

        // 또 로그인 페이지면 한번 더
        if (await isLoginPage(page)) {
          console.log('  → 재로그인...');
          const ok2 = await doLogin(page);
          if (!ok2) return { success: false, error: '재로그인 실패', url };
          await page.waitForTimeout(2000);
        }
      }
    }

    // 본문 추출
    const content = await page.evaluate(EXTRACTION_JS);
    let refs = null;
    if (includeRefs) refs = await page.evaluate(REFERENCES_JS);
    return { success: true, content, refs, url };
  } catch (err) {
    return { success: false, error: err.message, url };
  } finally {
    await page.close();
  }
}

function saveResult(result, doi) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const slug = doi ? doiToSlug(doi) : doiToSlug(result.url);
  const filePath = path.join(OUTPUT_DIR, slug + '.md');
  let md = result.success
    ? result.content + (result.refs && result.refs !== 'REFERENCES_NOT_FOUND' ? '\n\n---\n\n## References\n\n' + result.refs : '')
    : `# 접근 실패\n\nURL: ${result.url}\n에러: ${result.error}`;
  fs.writeFileSync(filePath, md, 'utf-8');
  return filePath;
}

// 메인
(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법:');
    console.log('  node scripts/read-paper.js <DOI 또는 URL>');
    console.log('  node scripts/read-paper.js --batch <_blocked.json 경로>');
    console.log('  node scripts/read-paper.js --refs <DOI>  (References 포함)');
    process.exit(0);
  }

  // Persistent context 사용 (쿠키가 페이지 간 자동 공유됨)
  const tmpProfile = path.join(PROJECT_DIR, '.playwright-script-temp');
  if (fs.existsSync(tmpProfile)) fs.rmSync(tmpProfile, { recursive: true, force: true });

  console.log('브라우저 시작 중...');
  const ctx = await chromium.launchPersistentContext(tmpProfile, {
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const includeRefs = args.includes('--refs');
    const isBatch = args.includes('--batch');

    if (isBatch) {
      const jsonPath = args[args.indexOf('--batch') + 1];
      if (!jsonPath || !fs.existsSync(jsonPath)) { console.error('오류: _blocked.json 파일을 찾을 수 없습니다:', jsonPath); process.exit(1); }
      const papers = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      console.log(`${papers.length}개 논문 처리 시작...\n`);

      const results = [];
      for (let i = 0; i < papers.length; i++) {
        const paper = papers[i];
        const url = paper.doi || paper.url;
        console.log(`[${i + 1}/${papers.length}] ${paper.title || url}`);
        const result = await readPaper(ctx, url, { includeRefs, timeout: 45000 });
        const filePath = saveResult(result, paper.doi);
        if (result.success) {
          console.log(`  ✓ 저장: ${filePath} (${(result.content.length / 1024).toFixed(1)}KB)\n`);
        } else {
          console.log(`  ✗ 실패: ${result.error}\n`);
        }
        results.push({ ...paper, filePath, success: result.success });
        if (i < papers.length - 1) await new Promise(r => setTimeout(r, 2000));
      }
      const ok = results.filter(r => r.success).length;
      console.log(`\n완료: 성공 ${ok}건, 실패 ${results.length - ok}건`);
    } else {
      const input = args.filter(a => !a.startsWith('--'))[0];
      let url = input;
      if (!input.startsWith('http')) url = 'https://doi.org/' + input.replace(/^doi:?\s*/i, '');
      const result = await readPaper(ctx, url, { includeRefs, timeout: 45000 });
      const filePath = saveResult(result, extractDoi(input) || input);
      if (result.success) {
        console.log(`✓ 저장 완료: ${filePath} (${(result.content.length / 1024).toFixed(1)}KB)`);
      } else {
        console.log(`✗ 실패: ${result.error}`);
        process.exit(1);
      }
    }
  } finally {
    await ctx.close();
    if (fs.existsSync(tmpProfile)) fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log('브라우저 종료.');
  }
})().catch(err => {
  console.error('치명적 오류:', err.message);
  const tmpProfile = path.join(PROJECT_DIR, '.playwright-script-temp');
  if (fs.existsSync(tmpProfile)) fs.rmSync(tmpProfile, { recursive: true, force: true });
  process.exit(1);
});
