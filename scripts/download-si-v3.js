#!/usr/bin/env node
// SI/Supplementary PDF 다운로드 — Playwright 브라우저 직접 다운로드
// EZproxy 미사용, 논문 페이지에서 SI 섹션 찾아 클릭 다운로드

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'downloads', 'si-papers');

function isValidPdf(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const buf = fs.readFileSync(filePath);
  return buf.length > 5000 && buf.slice(0, 5).toString() === '%PDF-';
}

// 다운로드 대상
const TASKS = [
  // ACS SI — 무료 접근, 논문 페이지 경유
  {
    outName: '2_Sugita2021_JCIM_SI.pdf',
    articleUrl: 'https://pubs.acs.org/doi/10.1021/acs.jcim.1c00380',
    siSelector: 'a[href*="suppl_file"][href*=".pdf"]',
    description: 'Sugita (2021) JCIM SI',
  },
  {
    outName: '3_Kim2025_SI_001.pdf',
    articleUrl: 'https://pubs.acs.org/doi/10.1021/acs.jcim.5c01600',
    siSelector: 'a[href*="suppl_file"][href*=".pdf"]',
    siIndex: 0,
    description: 'Kim (2025) JCIM SI #1',
  },
  {
    outName: '3_Kim2025_SI_002.pdf',
    articleUrl: 'https://pubs.acs.org/doi/10.1021/acs.jcim.5c01600',
    siSelector: 'a[href*="suppl_file"][href*=".pdf"]',
    siIndex: 1,
    description: 'Kim (2025) JCIM SI #2',
  },
  {
    outName: '4_Ash2017_SI.pdf',
    articleUrl: 'https://pubs.acs.org/doi/10.1021/acs.jcim.7b00048',
    siSelector: 'a[href*="suppl_file"][href*=".pdf"]',
    description: 'Ash (2017) JCIM SI',
  },
  // OUP / Springer — 직접 접근 시도
  {
    outName: '5a_Kulkarni_Hopfinger_2001.pdf',
    articleUrl: 'https://academic.oup.com/toxsci/article/59/2/335/1667202',
    siSelector: null, // 본문 PDF 다운로드
    description: 'Kulkarni & Hopfinger (2001) 본문',
  },
  {
    outName: '5b_Kulkarni_Hopfinger_1999.pdf',
    articleUrl: 'https://link.springer.com/article/10.1023/A:1014853731428',
    siSelector: null,
    description: 'Kulkarni & Hopfinger (1999) 본문',
  },
];

async function downloadTask(task, context) {
  const outPath = path.join(OUTPUT_DIR, task.outName);
  if (isValidPdf(outPath)) {
    console.log(`[스킵] ${task.outName} — 이미 유효한 PDF`);
    return true;
  }

  console.log(`\n[다운로드] ${task.description}`);
  const page = await context.newPage();

  try {
    // 논문 페이지 방문
    await page.goto(task.articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Cloudflare 챌린지 대기
    let title = await page.title().catch(() => '');
    if (title.includes('Just a moment') || title.includes('Attention')) {
      console.log('  Cloudflare 대기 중...');
      await page.waitForFunction(
        () => !document.title.includes('Just a moment') && !document.title.includes('Attention'),
        { timeout: 20000 }
      ).catch(() => {});
      await page.waitForTimeout(2000);
      title = await page.title().catch(() => '');
    }
    console.log(`  페이지: "${title.substring(0, 60)}"`);

    if (task.siSelector) {
      // SI 링크 찾기
      await page.waitForTimeout(2000);

      // Supporting Information 섹션으로 스크롤
      const siSection = await page.$('text=Supporting Information').catch(() => null);
      if (siSection) {
        await siSection.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(1000);
      }

      const siLinks = await page.$$(task.siSelector);
      console.log(`  SI 링크 ${siLinks.length}개 발견`);

      if (siLinks.length === 0) {
        // 대안: 페이지의 모든 PDF 링크 확인
        const allLinks = await page.$$eval('a[href*=".pdf"]', els =>
          els.map(el => ({ href: el.href, text: el.textContent?.trim()?.substring(0, 50) || '' }))
        ).catch(() => []);
        console.log(`  전체 PDF 링크 ${allLinks.length}개:`, allLinks.map(l => l.text).join(', '));
        await page.close();
        return false;
      }

      const idx = task.siIndex || 0;
      if (idx >= siLinks.length) {
        console.log(`  ✗ SI 인덱스 ${idx}가 범위 초과 (${siLinks.length}개)`);
        await page.close();
        return false;
      }

      // 클릭하여 다운로드
      const link = siLinks[idx];
      const href = await link.getAttribute('href');
      console.log(`  SI 링크 클릭: ${href?.substring(0, 60)}...`);

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }),
        link.click(),
      ]).catch(() => [null]);

      if (download) {
        const filePath = await download.path();
        if (filePath) {
          fs.copyFileSync(filePath, outPath);
          if (isValidPdf(outPath)) {
            const size = fs.statSync(outPath).size;
            console.log(`  ✓ ${task.outName} (${(size / 1024).toFixed(1)}KB)`);
            await page.close();
            return true;
          }
        }
      }

      // 다운로드 이벤트 실패 시 새 탭으로 열기
      const fullUrl = href?.startsWith('http') ? href : `https://pubs.acs.org${href}`;
      console.log(`  다운로드 이벤트 실패, 직접 네비게이션 시도...`);
      const dlPage = await context.newPage();
      const resp = await dlPage.goto(fullUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => null);
      if (resp) {
        const body = await resp.body().catch(() => null);
        if (body && body.length > 5000) {
          fs.writeFileSync(outPath, body);
          if (isValidPdf(outPath)) {
            console.log(`  ✓ ${task.outName} (${(body.length / 1024).toFixed(1)}KB)`);
            await dlPage.close();
            await page.close();
            return true;
          }
        }
      }
      await dlPage.close();
    } else {
      // 본문 PDF 다운로드 (Kulkarni 논문)
      await page.waitForTimeout(2000);

      // PDF 링크 찾기 (다양한 패턴)
      const pdfBtn = await page.$('a[href*="article-pdf"], a[href*="content/pdf"], a.pdf-download, a[data-track-action="download pdf"]')
        .catch(() => null);

      if (pdfBtn) {
        const href = await pdfBtn.getAttribute('href');
        console.log(`  PDF 버튼 발견: ${href?.substring(0, 60)}...`);

        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 20000 }),
          pdfBtn.click(),
        ]).catch(() => [null]);

        if (download) {
          const filePath = await download.path();
          if (filePath) {
            fs.copyFileSync(filePath, outPath);
            if (isValidPdf(outPath)) {
              const size = fs.statSync(outPath).size;
              console.log(`  ✓ ${task.outName} (${(size / 1024).toFixed(1)}KB)`);
              await page.close();
              return true;
            }
          }
        }
      }

      // citation_pdf_url meta 태그
      const metaPdf = await page.$eval('meta[name="citation_pdf_url"]', el => el.content).catch(() => '');
      if (metaPdf) {
        console.log(`  Meta PDF URL: ${metaPdf.substring(0, 60)}...`);
        const dlPage = await context.newPage();
        const resp = await dlPage.goto(metaPdf, { waitUntil: 'load', timeout: 20000 }).catch(() => null);
        if (resp) {
          const body = await resp.body().catch(() => null);
          if (body && body.length > 5000) {
            fs.writeFileSync(outPath, body);
            if (isValidPdf(outPath)) {
              console.log(`  ✓ ${task.outName} (${(body.length / 1024).toFixed(1)}KB)`);
              await dlPage.close();
              await page.close();
              return true;
            }
          }
        }
        await dlPage.close();
      }

      console.log(`  ✗ PDF 다운로드 실패 (구독 필요 가능성)`);
    }

    await page.close();
    return false;
  } catch (err) {
    console.log(`  ✗ 에러: ${err.message}`);
    await page.close().catch(() => {});
    return false;
  }
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true,
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const results = { success: [], failed: [] };

  // 같은 articleUrl 공유하는 태스크는 한번만 페이지를 열어야 함
  // 하지만 간단하게 순차 처리
  for (const task of TASKS) {
    const ok = await downloadTask(task, context);
    (ok ? results.success : results.failed).push(task.outName);
    await new Promise(r => setTimeout(r, 3000));
  }

  // 최종 결과
  console.log('\n=== 최종 결과 ===');
  const allFiles = fs.readdirSync(OUTPUT_DIR).filter(f => !f.startsWith('_') && !f.startsWith('.'));
  for (const f of allFiles) {
    const fp = path.join(OUTPUT_DIR, f);
    const size = fs.statSync(fp).size;
    const valid = isValidPdf(fp) ? '✓ PDF' : (f.endsWith('.zip') ? '✓ ZIP' : '✗ 무효');
    console.log(`  ${valid} ${f} (${(size / 1024).toFixed(1)}KB)`);
  }

  console.log(`\n성공: ${results.success.length}, 실패: ${results.failed.length}`);
  if (results.failed.length > 0) {
    console.log('실패 목록:', results.failed.join(', '));
  }

  await context.close();
  await browser.close();
}

main().catch(err => {
  console.error('치명적 에러:', err);
  process.exit(1);
});
