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
const AUTH_STATE_PATH = path.join(PROJECT_DIR, '.playwright-auth.json');

// .env에서 프록시 설정을 읽는다. 환경변수는 아래 loadEnv() 호출 후에 채워진다.
// PROXY_ENABLED=false 인 경우 PROXY_BASE는 빈 문자열이 되어 "직접 접근" 모드로 동작한다.
// 모듈 로드 시점에 한 번 결정되므로, 다른 모듈에서 require할 때도 동일한 값이 노출된다.
function resolveProxyBase() {
  if (process.env.PROXY_ENABLED === 'false') return '';
  return process.env.PROXY_BASE_URL || '';
}

// CLI 모드에서 추출 결과를 저장하기 전 검증하기 위한 의존성.
// fetch-paper.js가 이미 사용하던 모듈을 그대로 가져온다.
const { validateContent } = require('./lib/content-validator');
const { appendOne } = require('./lib/results-store');

// 다른 모듈에서 require 시 로그를 stderr로 보낼 수 있도록 설정
let _log = console.log.bind(console);
function setLogger(fn) { _log = fn; }

// 프록시 경유 시 Akamai WAF가 차단하는 오픈 액세스 출판사 DOI prefix
const OA_DOI_PREFIXES = [
  '10.3390',   // MDPI
  '10.1371',   // PLoS
  '10.3389',   // Frontiers
  '10.7554',   // eLife
  '10.7717',   // PeerJ
  '10.1186',   // BMC (SpringerOpen)
];

function isOpenAccess(url) {
  const doiMatch = url.match(/10\.\d{4,}/);
  if (!doiMatch) return false;
  return OA_DOI_PREFIXES.some(prefix => doiMatch[0].startsWith(prefix));
}

// DOI → 실제 URL 변환 (리다이렉트 추적, OA 출판사용)
async function resolveDoi(doiUrl) {
  const https = require('https');
  const http = require('http');
  return new Promise((resolve) => {
    const follow = (url, depth = 0) => {
      if (depth > 5) return resolve(url);
      const mod = url.startsWith('https') ? https : http;
      const req = mod.request(url, { method: 'HEAD', timeout: 8000 }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
          follow(next, depth + 1);
        } else {
          resolve(url);
        }
      });
      req.on('error', () => resolve(doiUrl));
      req.on('timeout', () => { req.destroy(); resolve(doiUrl); });
      req.end();
    };
    follow(doiUrl);
  });
}

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

// loadEnv() 후에 PROXY_BASE를 결정한다. 빈 문자열이면 모든 접근이 직접(프록시 미경유)으로 동작한다.
const PROXY_BASE = resolveProxyBase();

// 로그인 페이지 도메인 — PROXY_LOGIN_URL과 거기서 도출한 호스트만으로 판별한다.
// (이전에는 특정 학교 도메인이 하드코딩되어 있었음)
function getLoginHosts() {
  const hosts = new Set();
  const loginUrl = process.env.PROXY_LOGIN_URL || '';
  if (loginUrl) {
    try { hosts.add(new URL(loginUrl).host); } catch (e) { /* invalid URL — 무시 */ }
  }
  // PROXY_BASE_URL의 호스트도 — 인증 challenge가 같은 호스트에서 나오는 경우가 많다
  const baseUrl = process.env.PROXY_BASE_URL || '';
  if (baseUrl) {
    try { hosts.add(new URL(baseUrl).host); } catch (e) { /* 무시 */ }
  }
  return hosts;
}
const LOGIN_HOSTS = getLoginHosts();

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
  const titleSel = ['h1.c-article-title','h1[data-test="article-title"]','.article-title h1','.article-title','.highwire-cite-title','#page-title','article h1','.document-title h1','.citation-title','.hypothesis_container h1'];
  for (const sel of titleSel) { const el = document.querySelector(sel); if (el && el.innerText.trim().length > 5) { parts.push('# ' + el.innerText.trim()); break; } }
  const authorSel = ['.c-article-author-list','[data-test="author-list"]','.author-list','.highwire-cite-authors','.loa-wrapper','.article-header__authors','#sb-1'];
  for (const sel of authorSel) { const el = document.querySelector(sel); if (el && el.innerText.trim().length > 3) { parts.push('**Authors:** ' + el.innerText.trim().substring(0, 500)); break; } }
  const skip = /method|material|reference|acknowledg|author info|ethics|data avail|code avail|competing|peer review|additional info|extended data|supplementary|source data|rights|about this|figure|table of content|related article|author contribution|funding|conflict|copyright|license/i;
  document.querySelectorAll('.c-article-section__content').forEach(sec => { const h = sec.previousElementSibling; const ht = h ? h.innerText.trim() : ''; if (skip.test(ht)) return; const text = sec.innerText.trim(); if (text.length > 30) parts.push('## ' + ht + '\\n' + text); });
  if (parts.length <= 2) { const mdpiBody = document.querySelector('.html-body'); if (mdpiBody) { mdpiBody.querySelectorAll(':scope > section').forEach(sec => { const h = sec.querySelector('h2, h4'); const ht = h ? h.innerText.trim() : ''; if (skip.test(ht)) return; const paras = [...sec.querySelectorAll('.html-p')].map(p => p.innerText.trim()).filter(t => t.length > 20); if (paras.length > 0) parts.push('## ' + ht + '\\n' + paras.join('\\n')); }); } }
  if (parts.length <= 2) { document.querySelectorAll('h2').forEach(h2 => { const ht = h2.innerText.trim(); if (skip.test(ht)) return; if (/ORIGINAL RESEARCH|Summary|cookie|privacy|trust in science|statement|funding|conflict|download|cited by|your download|Journals|Topics|Information|Author Services|Initiatives|About/i.test(ht)) return; let text = ''; let sib = h2.nextElementSibling; while (sib && sib.tagName !== 'H2') { if (sib.innerText) text += sib.innerText.trim() + '\\n'; sib = sib.nextElementSibling; } if (text.length > 30) parts.push('## ' + ht + '\\n' + text.trim()); }); }
  if (parts.length <= 2) { document.querySelectorAll('.section-paragraph, .Body .section, [id^="sec"] > .section-paragraph').forEach(sec => { const text = sec.innerText.trim(); if (text.length > 50 && !skip.test(text.substring(0, 100))) parts.push(text); }); }
  if (parts.length <= 2) { document.querySelectorAll('.article-section__content').forEach(sec => { const h = sec.previousElementSibling; const ht = h ? h.innerText.trim() : ''; if (skip.test(ht)) return; const text = sec.innerText.trim(); if (text.length > 30) parts.push('## ' + ht + '\\n' + text); }); }
  if (parts.length <= 2) { const main = document.querySelector('article, main, [role="main"], .article-content, .html-body'); if (main) parts.push(main.innerText.trim().substring(0, 80000)); }
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

// Cloudflare 챌린지 페이지 감지 및 대기
async function waitForCloudflare(page, maxWait = 20000) {
  const isCF = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    return text.includes('Performing security verification') ||
           text.includes('Enable JavaScript and cookies') ||
           text.includes('Checking if the site connection is secure') ||
           !!document.querySelector('#challenge-error-text');
  }).catch(() => false);

  if (!isCF) return false;
  _log('  ⏳ Cloudflare 챌린지 감지 — 통과 대기 중...');
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await page.waitForTimeout(3000);
    const still = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('Performing security verification') ||
             text.includes('Enable JavaScript and cookies') ||
             !!document.querySelector('#challenge-error-text');
    }).catch(() => false);
    if (!still) {
      _log('  ✓ Cloudflare 챌린지 통과');
      return true;
    }
  }
  _log('  ✗ Cloudflare 챌린지 타임아웃');
  return false;
}

// 로그인 페이지 감지 — .env의 PROXY_LOGIN_URL 호스트와 폼 셀렉터를 기반으로 판별
async function isLoginPage(page) {
  const idSel = process.env.PROXY_LOGIN_ID_SELECTOR || '#user-id';
  const pwSel = process.env.PROXY_LOGIN_PW_SELECTOR || '#user-pw';
  try {
    const url = new URL(page.url());
    if (LOGIN_HOSTS.has(url.host)) return true;
  } catch (e) { /* 무시 */ }
  return await page.evaluate(([i, p]) => !!document.querySelector(i) && !!document.querySelector(p), [idSel, pwSel]).catch(() => false);
}

// 프록시/도서관 포털 자동 로그인 — 성공 시 storageState 자동 갱신
async function doLogin(page) {
  const id = process.env.PROXY_PORTAL_ID;
  const pw = process.env.PROXY_PORTAL_PW;
  if (!id || !pw) {
    _log('  ⚠ .env에 PROXY_PORTAL_ID / PROXY_PORTAL_PW를 설정하세요. (bash scripts/setup-proxy.sh 로 대화형 설정 가능)');
    return false;
  }

  const idSel = process.env.PROXY_LOGIN_ID_SELECTOR || '#user-id';
  const pwSel = process.env.PROXY_LOGIN_PW_SELECTOR || '#user-pw';
  const submitSel = process.env.PROXY_LOGIN_SUBMIT_SELECTOR || 'form.needs-validation button[type="submit"], button[type="submit"]';
  const preClickSel = process.env.PROXY_LOGIN_PRECLICK_SELECTOR || '';

  _log('  → 자동 로그인 중...');
  try {
    await page.waitForSelector(idSel, { timeout: 10000 });
    if (preClickSel) {
      const pre = await page.$(preClickSel);
      if (pre) await pre.click();
    }
    await page.fill(idSel, id);
    await page.fill(pwSel, pw);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {}),
      page.click(submitSel),
    ]);
    await page.waitForTimeout(3000);

    const still = await page.evaluate((sel) => !!document.querySelector(sel), idSel).catch(() => false);
    if (still) {
      _log('  ✗ 로그인 실패 (아이디/비밀번호 확인)');
      return false;
    }
    // 로그인 성공 — storageState 갱신 (다음 실행에서 재사용)
    await page.context().storageState({ path: AUTH_STATE_PATH });
    _log('  ✓ 로그인 성공 (인증 상태 저장됨)');
    return true;
  } catch (err) {
    _log(`  ✗ 로그인 에러: ${err.message}`);
    return false;
  }
}

// 단일 논문 읽기 (같은 persistent context에서 로그인+접근)
async function readPaper(ctx, url, options = {}) {
  const { includeRefs = false, timeout = 45000 } = options;
  // PROXY_BASE가 비어있으면 (프록시 미설정 또는 PROXY_ENABLED=false) 항상 직접 접근
  const proxyEnabled = !!PROXY_BASE;
  const proxyUrl = proxyEnabled ? PROXY_BASE + url : url;
  let page = await ctx.newPage();

  try {
    // 오픈 액세스 출판사는 프록시 없이 직접 접근 (Akamai WAF 차단 방지)
    // DOI 리다이렉트도 Akamai를 트리거하므로, DOI→실제URL 변환 후 직접 접근
    const oa = isOpenAccess(url);
    // 프록시 비활성이면 OA 여부와 무관하게 직접 접근
    let targetUrl = (oa || !proxyEnabled) ? url : proxyUrl;
    if ((oa || !proxyEnabled) && url.includes('doi.org')) {
      _log(`  → DOI 변환 중...`);
      targetUrl = await resolveDoi(url);
      _log(`  → 변환 완료: ${targetUrl}`);
    }
    _log(`  → 접근 중: ${url}${oa ? ' (OA 직접)' : (proxyEnabled ? '' : ' (직접)')}`);
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout });
    } catch {
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(2000);

    // Cloudflare 챌린지 대기
    await waitForCloudflare(page, 25000);

    // 로그인 필요 시 — 같은 페이지에서 바로 로그인
    if (await isLoginPage(page)) {
      const ok = await doLogin(page);
      if (!ok) return { success: false, error: '자동 로그인 실패', url };

      // 로그인 성공 후 returl로 자동 리다이렉트 되었을 수 있음
      // 안 됐으면 직접 이동
      await page.waitForTimeout(2000);
      if (!(page.url().includes('doi.org') || page.url().includes('pubs.') || page.url().includes('sciencedirect') || page.url().includes('springer') || page.url().includes('frontiersin') || page.url().includes('wiley'))) {
        _log('  → 프록시 URL로 이동...');
        try {
          await page.goto(proxyUrl, { waitUntil: 'networkidle', timeout });
        } catch {
          await page.waitForTimeout(5000);
        }
        await page.waitForTimeout(3000);

        // 또 로그인 페이지면 한번 더
        if (await isLoginPage(page)) {
          _log('  → 재로그인...');
          const ok2 = await doLogin(page);
          if (!ok2) return { success: false, error: '재로그인 실패', url };
          await page.waitForTimeout(2000);
        }
      }
    }

    // Access Denied 등 프록시 경유 실패 시 직접 접근 폴백
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (bodyText.length < 300 && (bodyText.includes('Access Denied') || bodyText.includes('403') || bodyText.includes('Forbidden'))) {
      _log('  ⚠ 프록시 경유 차단 — 직접 접근 시도...');
      await page.close();
      page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout });
      } catch {
        await page.waitForTimeout(5000);
      }
      await page.waitForTimeout(2000);
      await waitForCloudflare(page, 25000);
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

// 모듈 내보내기 — fetch-paper.js에서 프로그래밍 방식으로 호출할 수 있도록
module.exports = {
  readPaper,
  saveResult,
  doiToSlug,
  extractDoi,
  isOpenAccess,
  isLoginPage,
  doLogin,
  waitForCloudflare,
  setLogger,
  EXTRACTION_JS,
  REFERENCES_JS,
  PROXY_BASE,
  AUTH_STATE_PATH,
  OUTPUT_DIR,
  OA_DOI_PREFIXES,
};

// CLI 모드 — 직접 실행 시에만 동작 (다른 스킬에서 node scripts/read-paper.js 호출 시)
if (require.main === module) {
(async () => {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법:');
    console.log('  node scripts/read-paper.js <DOI 또는 URL>');
    console.log('  node scripts/read-paper.js --batch <_blocked.json 경로>');
    console.log('  node scripts/read-paper.js --refs <DOI>  (References 포함)');
    console.log('  node scripts/read-paper.js --headed <DOI>  (GUI 모드 — 봇 탐지 우회 강화)');
    process.exit(0);
  }

  const isHeaded = args.includes('--headed');
  const hasAuth = fs.existsSync(AUTH_STATE_PATH);
  console.log(`브라우저 시작 중... (${isHeaded ? 'headed' : 'headless'} 모드, 인증: ${hasAuth ? '있음' : '없음'})`);

  const browser = await chromium.launch({
    headless: !isHeaded,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  // storageState로 이전 인증 세션 복원
  const ctxOptions = {
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    },
  };
  if (hasAuth) ctxOptions.storageState = AUTH_STATE_PATH;
  const ctx = await browser.newContext(ctxOptions);

  // 봇 탐지 우회 — navigator 속성 위장
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
    const origQuery = window.navigator.permissions?.query;
    if (origQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    }
  });

  try {
    // 인증 상태 없으면 선행 로그인 시도 — .env의 PROXY_LOGIN_URL 이용
    if (!hasAuth) {
      const loginUrl = process.env.PROXY_LOGIN_URL || '';
      if (!loginUrl) {
        console.log('인증 상태 없음 & PROXY_LOGIN_URL 미설정 — 선행 로그인 스킵 (직접 접근 시도)');
      } else {
        console.log('인증 상태 없음 — EZproxy 로그인 시도...');
        const loginPage = await ctx.newPage();
        try {
          await loginPage.goto(loginUrl, {
            waitUntil: 'domcontentloaded', timeout: 20000,
          });
          await loginPage.waitForTimeout(2000);
          if (await isLoginPage(loginPage)) {
            await doLogin(loginPage);
          }
        } catch (e) {
          console.log(`  ⚠ 선행 로그인 실패: ${e.message}`);
        } finally {
          await loginPage.close();
        }
      }
    }

    const includeRefs = args.includes('--refs');
    const isBatch = args.includes('--batch');

    // 추출 결과를 검증하고, 통과한 경우에만 저장한다.
    // 검증 실패 시 raw_texts를 오염시키지 않고 _fetch_results.json에 needsTier3로 기록한다.
    // (이전 버그: 빈 페이지/오류 페이지가 그대로 raw_texts에 저장되어 음성 결과를 오염시킴)
    function persistIfValid(result, doiOrInput, label) {
      if (!result.success) {
        console.log(`  ✗ 실패: ${result.error}`);
        appendOne({
          doi: doiOrInput,
          needsTier3: true,
          reason: `read-paper 접근 실패: ${result.error}`,
          attempts: [{ tier: 2, source: 'read-paper-cli', error: result.error }],
        });
        return false;
      }

      const validation = validateContent(result.content, doiOrInput);
      if (!validation.valid) {
        console.log(`  ✗ 저장 거부 (${validation.reason}, score: ${validation.score}, ${(result.content.length / 1024).toFixed(1)}KB)`);
        appendOne({
          doi: doiOrInput,
          needsTier3: true,
          reason: `read-paper 검증 실패: ${validation.reason}`,
          score: validation.score,
          attempts: [{ tier: 2, source: 'read-paper-cli', error: `검증 실패: ${validation.reason}`, score: validation.score }],
        });
        return false;
      }

      const filePath = saveResult(result, doiOrInput);
      console.log(`  ✓ 저장: ${filePath} (score: ${validation.score}, ${(result.content.length / 1024).toFixed(1)}KB)`);
      // 성공도 누적 기록 (다음 호출에서 needsTier3에서 자동 제거되도록)
      appendOne({
        doi: doiOrInput,
        success: true,
        tier: 2,
        source: 'read-paper-cli',
        file: filePath,
        size: result.content.length,
        score: validation.score,
      }, 'succeeded');
      return true;
    }

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
        const ok = persistIfValid(result, paper.doi || url, paper.title);
        console.log('');
        results.push({ ...paper, success: ok });
        if (i < papers.length - 1) await new Promise(r => setTimeout(r, 2000));
      }
      const okCount = results.filter(r => r.success).length;
      console.log(`\n완료: 성공 ${okCount}건, 실패 ${results.length - okCount}건`);
    } else {
      const input = args.filter(a => !a.startsWith('--'))[0];
      let url = input;
      if (!input.startsWith('http')) url = 'https://doi.org/' + input.replace(/^doi:?\s*/i, '');
      const result = await readPaper(ctx, url, { includeRefs, timeout: 45000 });
      const ok = persistIfValid(result, extractDoi(input) || input);
      if (!ok) process.exit(1);
    }
  } finally {
    await browser.close();
    console.log('브라우저 종료.');
  }
})().catch(err => {
  console.error('치명적 오류:', err.message);
  process.exit(1);
});
} // if (require.main === module)
