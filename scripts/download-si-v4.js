#!/usr/bin/env node
// SI PDF 다운로드 — PDF 뷰어 비활성화 + response intercept 방식

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'downloads', 'si-papers');

function isValidPdf(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const buf = fs.readFileSync(filePath);
  return buf.length > 5000 && buf.slice(0, 5).toString() === '%PDF-';
}

const DOWNLOADS = [
  // ACS SI
  { outName: '2_Sugita2021_JCIM_SI.pdf', url: 'https://pubs.acs.org/doi/suppl/10.1021/acs.jcim.1c00380/suppl_file/ci1c00380_si_001.pdf' },
  { outName: '3_Kim2025_SI_001.pdf', url: 'https://pubs.acs.org/doi/suppl/10.1021/acs.jcim.5c01600/suppl_file/ci5c01600_si_001.pdf' },
  { outName: '3_Kim2025_SI_002.pdf', url: 'https://pubs.acs.org/doi/suppl/10.1021/acs.jcim.5c01600/suppl_file/ci5c01600_si_002.pdf' },
  { outName: '4_Ash2017_SI.pdf', url: 'https://pubs.acs.org/doi/suppl/10.1021/acs.jcim.7b00048/suppl_file/ci7b00048_si_001.pdf' },
  // 오픈 액세스 가능한 대안 시도
  { outName: '5a_Kulkarni_Hopfinger_2001.pdf', url: 'https://academic.oup.com/toxsci/article-pdf/59/2/335/10886712/059335.pdf' },
  { outName: '5b_Kulkarni_Hopfinger_1999.pdf', url: 'https://link.springer.com/content/pdf/10.1023/A:1014853731428.pdf' },
];

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // PDF 뷰어 비활성화하여 자동 다운로드되도록 설정
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true,
    locale: 'en-US',
  });

  // ACS 쿠키를 먼저 획득 — ACS 홈페이지 방문
  console.log('[준비] ACS 홈페이지 방문하여 쿠키 획득...');
  const warmup = await context.newPage();
  await warmup.goto('https://pubs.acs.org/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Cloudflare 챌린지 대기
  let title = await warmup.title().catch(() => '');
  if (title.includes('Just a moment') || title.includes('Attention')) {
    console.log('  Cloudflare 챌린지 대기 중...');
    await warmup.waitForFunction(
      () => !document.title.includes('Just a moment') && !document.title.includes('Attention'),
      { timeout: 30000 }
    ).catch(() => {});
    await warmup.waitForTimeout(3000);
  }
  title = await warmup.title().catch(() => '');
  console.log(`  ACS 홈: "${title.substring(0, 50)}"`);

  // 각 파일에 대해 response intercept 방식으로 다운로드
  for (const item of DOWNLOADS) {
    const outPath = path.join(OUTPUT_DIR, item.outName);
    if (isValidPdf(outPath)) {
      console.log(`[스킵] ${item.outName}`);
      continue;
    }

    console.log(`\n[다운로드] ${item.outName}`);

    const page = await context.newPage();

    // response intercept — PDF 바이너리를 캡처
    let pdfBuffer = null;
    page.on('response', async (response) => {
      const ct = response.headers()['content-type'] || '';
      const url = response.url();
      if ((ct.includes('pdf') || ct.includes('octet-stream')) && url.includes('.pdf')) {
        try {
          pdfBuffer = await response.body();
        } catch (e) {}
      }
    });

    try {
      // 다운로드 이벤트와 네비게이션 동시 대기
      const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);

      await page.goto(item.url, {
        waitUntil: 'commit',
        timeout: 30000,
      }).catch(() => null);

      // 다운로드 이벤트 확인
      const download = await Promise.race([
        downloadPromise,
        new Promise(r => setTimeout(() => r(null), 10000)),
      ]);

      if (download) {
        const filePath = await download.path();
        if (filePath && fs.existsSync(filePath)) {
          fs.copyFileSync(filePath, outPath);
          if (isValidPdf(outPath)) {
            console.log(`  ✓ download event → ${(fs.statSync(outPath).size / 1024).toFixed(1)}KB`);
            await page.close();
            continue;
          }
        }
      }

      // response intercept 결과 확인
      await page.waitForTimeout(3000);
      if (pdfBuffer && pdfBuffer.length > 5000 && pdfBuffer.slice(0, 5).toString() === '%PDF-') {
        fs.writeFileSync(outPath, pdfBuffer);
        console.log(`  ✓ response intercept → ${(pdfBuffer.length / 1024).toFixed(1)}KB`);
        await page.close();
        continue;
      }

      // 페이지 자체가 PDF 뷰어인 경우 — JS로 PDF 데이터 추출 시도
      const pageUrl = page.url();
      if (pageUrl.includes('.pdf')) {
        // PDF가 브라우저 내에서 렌더링 중 — CDP로 fetch
        console.log('  PDF 뷰어 감지, CDP fetch 시도...');
        const cdp = await page.context().newCDPSession(page);
        try {
          const result = await cdp.send('Page.printToPDF', {
            printBackground: true,
            preferCSSPageSize: true,
          });
          if (result.data) {
            const buf = Buffer.from(result.data, 'base64');
            if (buf.length > 5000) {
              fs.writeFileSync(outPath, buf);
              console.log(`  ✓ CDP printToPDF → ${(buf.length / 1024).toFixed(1)}KB`);
              await page.close();
              continue;
            }
          }
        } catch (e) {
          console.log(`  CDP 실패: ${e.message}`);
        }
      }

      // 최후 수단: fetch API로 직접 요청
      console.log('  fetch API로 직접 다운로드 시도...');
      const fetchResult = await page.evaluate(async (url) => {
        try {
          const resp = await fetch(url, { credentials: 'include' });
          if (!resp.ok) return { ok: false, status: resp.status };
          const blob = await resp.blob();
          const buf = await blob.arrayBuffer();
          // base64 인코딩
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          return { ok: true, data: btoa(binary), size: bytes.byteLength };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }, item.url).catch(() => ({ ok: false, error: 'evaluate failed' }));

      if (fetchResult.ok && fetchResult.size > 5000) {
        const buf = Buffer.from(fetchResult.data, 'base64');
        fs.writeFileSync(outPath, buf);
        if (isValidPdf(outPath)) {
          console.log(`  ✓ fetch API → ${(buf.length / 1024).toFixed(1)}KB`);
          await page.close();
          continue;
        }
      }

      console.log(`  ✗ 모든 방법 실패`);
      if (fetchResult.status) console.log(`    HTTP ${fetchResult.status}`);
    } catch (err) {
      console.log(`  ✗ 에러: ${err.message}`);
    }

    await page.close().catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
  }

  await warmup.close();

  // 최종 결과
  console.log('\n=== 최종 결과 ===');
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => !f.startsWith('_') && !f.startsWith('.'));
  for (const f of files) {
    const fp = path.join(OUTPUT_DIR, f);
    const size = fs.statSync(fp).size;
    const valid = isValidPdf(fp) ? '✓ PDF' : (f.endsWith('.zip') ? '✓ ZIP' : '✗ 무효');
    console.log(`  ${valid} ${f} (${(size / 1024).toFixed(1)}KB)`);
  }

  await context.close();
  await browser.close();
}

main().catch(err => {
  console.error('치명적 에러:', err);
  process.exit(1);
});
