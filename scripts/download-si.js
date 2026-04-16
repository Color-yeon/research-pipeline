#!/usr/bin/env node
// SI/Supplementary 자료 PDF 다운로드 스크립트
// ACS 등 봇 차단 사이트에서 Playwright 브라우저로 다운로드
// 사용법: node scripts/download-si.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'downloads', 'si-papers');
const AUTH_STATE_PATH = path.resolve(__dirname, '..', '.playwright-auth.json');

// .env 로드 — 공용 로더로 통일 (PROXY_ENABLED=false면 PROXY_BASE 가 빈 문자열이 되어 useProxy:true 항목은 자동 스킵)
require('./lib/env-loader').loadEnv();
const PROXY_BASE = (process.env.PROXY_ENABLED === 'false') ? '' : (process.env.PROXY_BASE_URL || '');

// 다운로드 대상 목록
const DOWNLOADS = [
  // ACS SI — 무료 접근 가능하지만 봇 차단
  {
    name: '2_Sugita2021_JCIM_SI.pdf',
    url: 'https://pubs.acs.org/doi/suppl/10.1021/acs.jcim.1c00380/suppl_file/ci1c00380_si_001.pdf',
    useProxy: false,
  },
  {
    name: '3_Kim2025_SI_001.pdf',
    url: 'https://pubs.acs.org/doi/suppl/10.1021/acs.jcim.5c01600/suppl_file/ci5c01600_si_001.pdf',
    useProxy: false,
  },
  {
    name: '3_Kim2025_SI_002.pdf',
    url: 'https://pubs.acs.org/doi/suppl/10.1021/acs.jcim.5c01600/suppl_file/ci5c01600_si_002.pdf',
    useProxy: false,
  },
  {
    name: '4_Ash2017_SI.pdf',
    url: 'https://pubs.acs.org/doi/suppl/10.1021/acs.jcim.7b00048/suppl_file/ci7b00048_si_001.pdf',
    useProxy: false,
  },
  // 구독 필요 논문 — EZproxy 경유
  {
    name: '5a_Kulkarni_Hopfinger_2001.pdf',
    url: 'https://academic.oup.com/toxsci/article-pdf/59/2/335/9817395/59-2-335.pdf',
    useProxy: true,
  },
  {
    name: '5b_Kulkarni_Hopfinger_1999.pdf',
    url: 'https://link.springer.com/content/pdf/10.1023/A:1014853731428.pdf',
    useProxy: true,
  },
];

async function downloadWithBrowser(item, context) {
  // 프록시 사용 요청이지만 PROXY_BASE가 비어있으면 직접 접근으로 폴백
  if (item.useProxy && !PROXY_BASE) {
    console.log(`[경고] ${item.name} — useProxy=true이지만 PROXY_BASE_URL 미설정, 직접 접근으로 폴백`);
  }
  const targetUrl = (item.useProxy && PROXY_BASE) ? PROXY_BASE + encodeURIComponent(item.url) : item.url;
  const outPath = path.join(OUTPUT_DIR, item.name);

  // 이미 유효한 PDF가 있으면 스킵
  if (fs.existsSync(outPath)) {
    const buf = fs.readFileSync(outPath);
    if (buf.length > 1000 && buf.slice(0, 5).toString() === '%PDF-') {
      console.log(`[스킵] ${item.name} — 이미 유효한 PDF 존재`);
      return true;
    }
  }

  console.log(`[다운로드] ${item.name}`);
  console.log(`  URL: ${targetUrl.substring(0, 100)}...`);

  const page = await context.newPage();
  try {
    // 다운로드 이벤트 대기 설정
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);

    // 직접 PDF URL로 이동 시도
    const response = await page.goto(targetUrl, {
      waitUntil: 'load',
      timeout: 30000,
    });

    // 다운로드 이벤트가 발생했는지 확인
    const download = await Promise.race([
      downloadPromise,
      new Promise(resolve => setTimeout(() => resolve(null), 5000)),
    ]);

    if (download) {
      // 다운로드 이벤트가 발생한 경우
      const filePath = await download.path();
      if (filePath) {
        fs.copyFileSync(filePath, outPath);
        const size = fs.statSync(outPath).size;
        console.log(`  ✓ 다운로드 이벤트로 저장 (${(size / 1024).toFixed(1)}KB)`);
        return true;
      }
    }

    // PDF 응답인지 확인
    const contentType = response?.headers()?.['content-type'] || '';
    if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
      const body = await response.body();
      if (body && body.length > 1000) {
        fs.writeFileSync(outPath, body);
        console.log(`  ✓ 응답 본문에서 저장 (${(body.length / 1024).toFixed(1)}KB)`);
        return true;
      }
    }

    // PDF가 iframe이나 viewer에 있을 수 있음
    const pdfFrame = page.frames().find(f => {
      const url = f.url();
      return url.includes('.pdf') || url.includes('pdfviewer');
    });
    if (pdfFrame) {
      const frameUrl = pdfFrame.url();
      console.log(`  PDF 프레임 발견: ${frameUrl.substring(0, 80)}...`);
      const framePage = await context.newPage();
      const frameResp = await framePage.goto(frameUrl, { waitUntil: 'load', timeout: 20000 });
      const body = await frameResp?.body();
      if (body && body.length > 1000 && body.slice(0, 5).toString() === '%PDF-') {
        fs.writeFileSync(outPath, body);
        console.log(`  ✓ 프레임에서 PDF 저장 (${(body.length / 1024).toFixed(1)}KB)`);
        await framePage.close();
        return true;
      }
      await framePage.close();
    }

    // 페이지에서 PDF 링크 찾기 (ACS SI 페이지의 경우)
    const pdfLinks = await page.$$eval('a[href*=".pdf"], a[href*="suppl_file"]', els =>
      els.map(el => el.href).filter(h => h.includes('.pdf'))
    ).catch(() => []);

    if (pdfLinks.length > 0) {
      console.log(`  PDF 링크 ${pdfLinks.length}개 발견, 첫 번째 시도...`);
      const dlPage = await context.newPage();
      const dlResp = await dlPage.goto(pdfLinks[0], { waitUntil: 'load', timeout: 20000 });
      const body = await dlResp?.body();
      if (body && body.length > 1000) {
        fs.writeFileSync(outPath, body);
        console.log(`  ✓ 링크에서 PDF 저장 (${(body.length / 1024).toFixed(1)}KB)`);
        await dlPage.close();
        return true;
      }
      await dlPage.close();
    }

    // Cloudflare 챌린지 등으로 실패한 경우 — 페이지 내용 확인
    const title = await page.title().catch(() => '');
    const bodyText = await page.textContent('body').catch(() => '');
    console.log(`  ✗ 실패 — 페이지 제목: "${title}"`);
    if (bodyText.includes('Access Denied') || bodyText.includes('403') || bodyText.includes('Forbidden')) {
      console.log(`  ✗ 접근 거부됨`);
    }
    return false;
  } catch (err) {
    console.log(`  ✗ 에러: ${err.message}`);
    return false;
  } finally {
    await page.close();
  }
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 브라우저 시작
  const hasAuth = fs.existsSync(AUTH_STATE_PATH);
  const browser = await chromium.launch({
    headless: false, // headed 모드로 Cloudflare 우회
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const ctxOptions = {
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true,
    locale: 'en-US',
  };
  if (hasAuth) {
    ctxOptions.storageState = AUTH_STATE_PATH;
  }

  const context = await browser.newContext(ctxOptions);

  // 결과 추적
  const results = { success: [], failed: [] };

  for (const item of DOWNLOADS) {
    const ok = await downloadWithBrowser(item, context);
    if (ok) {
      results.success.push(item.name);
    } else {
      results.failed.push(item.name);
    }
    // 요청 간 간격
    await new Promise(r => setTimeout(r, 2000));
  }

  await context.close();
  await browser.close();

  // 결과 출력
  console.log('\n=== 결과 요약 ===');
  console.log(`성공: ${results.success.length}개`);
  results.success.forEach(n => console.log(`  ✓ ${n}`));
  if (results.failed.length > 0) {
    console.log(`실패: ${results.failed.length}개`);
    results.failed.forEach(n => console.log(`  ✗ ${n}`));
  }

  // JSON 결과 저장
  fs.writeFileSync(
    path.join(OUTPUT_DIR, '_download_results.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );
}

main().catch(err => {
  console.error('치명적 에러:', err);
  process.exit(1);
});
