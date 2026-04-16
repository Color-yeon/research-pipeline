#!/usr/bin/env node
// ACS SI 다운로드 — 논문 페이지 경유 Cloudflare 우회
// EZproxy 경유 구독 논문 다운로드 포함

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const https = require('https');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'downloads', 'si-papers');
const AUTH_STATE_PATH = path.resolve(__dirname, '..', '.playwright-auth.json');
const PROXY_BASE = 'https://oca.korea.ac.kr/link.n2s?url=';

// ACS 논문별 SI 다운로드
const ACS_PAPERS = [
  {
    doi: '10.1021/acs.jcim.1c00380',
    siFiles: [
      { suffix: 'ci1c00380_si_001.pdf', outName: '2_Sugita2021_JCIM_SI.pdf' },
    ],
  },
  {
    doi: '10.1021/acs.jcim.5c01600',
    siFiles: [
      { suffix: 'ci5c01600_si_001.pdf', outName: '3_Kim2025_SI_001.pdf' },
      { suffix: 'ci5c01600_si_002.pdf', outName: '3_Kim2025_SI_002.pdf' },
    ],
  },
  {
    doi: '10.1021/acs.jcim.7b00048',
    siFiles: [
      { suffix: 'ci7b00048_si_001.pdf', outName: '4_Ash2017_SI.pdf' },
    ],
  },
];

// 프록시 경유 논문
const PROXY_PAPERS = [
  {
    outName: '5a_Kulkarni_Hopfinger_2001.pdf',
    articleUrl: 'https://doi.org/10.1093/toxsci/59.2.335',
    description: 'Kulkarni & Hopfinger (2001) Toxicological Sciences',
  },
  {
    outName: '5b_Kulkarni_Hopfinger_1999.pdf',
    articleUrl: 'https://doi.org/10.1023/A:1014853731428',
    description: 'Kulkarni & Hopfinger (1999) Pharmaceutical Research',
  },
];

function isValidPdf(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const buf = fs.readFileSync(filePath, { encoding: null, flag: 'r' });
  return buf.length > 5000 && buf.slice(0, 5).toString() === '%PDF-';
}

async function downloadUrl(url, outPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadUrl(res.headers.location, outPath).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(outPath, buf);
        resolve(buf.length);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function downloadAcsSi(context, paper) {
  const articleUrl = `https://pubs.acs.org/doi/${paper.doi}`;
  console.log(`\n[ACS] ${paper.doi} 논문 페이지 방문 중...`);

  const page = await context.newPage();
  try {
    // 1단계: 논문 abstract 페이지 방문 (Cloudflare 통과)
    await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Cloudflare 챌린지 대기
    await page.waitForTimeout(3000);

    const title = await page.title().catch(() => '');
    console.log(`  페이지 제목: "${title.substring(0, 60)}"`);

    // Cloudflare 챌린지 확인
    if (title.includes('Just a moment') || title.includes('Attention Required')) {
      console.log('  Cloudflare 챌린지 대기 중 (최대 15초)...');
      await page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // 2단계: 쿠키 획득 후 SI 파일 다운로드
    const cookies = await context.cookies('https://pubs.acs.org');
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    for (const si of paper.siFiles) {
      const outPath = path.join(OUTPUT_DIR, si.outName);
      if (isValidPdf(outPath)) {
        console.log(`  [스킵] ${si.outName} — 이미 유효한 PDF`);
        continue;
      }

      const siUrl = `https://pubs.acs.org/doi/suppl/${paper.doi}/suppl_file/${si.suffix}`;
      console.log(`  SI 다운로드: ${si.suffix}`);

      // 브라우저 컨텍스트에서 직접 다운로드
      const dlPage = await context.newPage();
      try {
        const [download] = await Promise.all([
          dlPage.waitForEvent('download', { timeout: 15000 }).catch(() => null),
          dlPage.goto(siUrl, { waitUntil: 'commit', timeout: 20000 }),
        ]);

        if (download) {
          const filePath = await download.path();
          if (filePath) {
            fs.copyFileSync(filePath, outPath);
            if (isValidPdf(outPath)) {
              console.log(`  ✓ ${si.outName} (${(fs.statSync(outPath).size / 1024).toFixed(1)}KB)`);
              await dlPage.close();
              continue;
            }
          }
        }

        // 다운로드 이벤트 없으면 response body 시도
        await dlPage.waitForTimeout(2000);
        const resp = await dlPage.goto(siUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => null);
        if (resp) {
          const ct = resp.headers()['content-type'] || '';
          if (ct.includes('pdf') || ct.includes('octet')) {
            const body = await resp.body().catch(() => null);
            if (body && body.length > 5000) {
              fs.writeFileSync(outPath, body);
              if (isValidPdf(outPath)) {
                console.log(`  ✓ ${si.outName} (${(body.length / 1024).toFixed(1)}KB)`);
                await dlPage.close();
                continue;
              }
            }
          }
        }
        console.log(`  ✗ ${si.outName} 실패`);
      } finally {
        await dlPage.close().catch(() => {});
      }
    }
  } finally {
    await page.close();
  }
}

async function downloadProxyPaper(context, paper) {
  const outPath = path.join(OUTPUT_DIR, paper.outName);
  if (isValidPdf(outPath)) {
    console.log(`[스킵] ${paper.outName} — 이미 유효한 PDF`);
    return true;
  }

  console.log(`\n[프록시] ${paper.description}`);
  const proxyUrl = PROXY_BASE + encodeURIComponent(paper.articleUrl);

  const page = await context.newPage();
  try {
    // 프록시 경유 DOI → 논문 페이지
    await page.goto(proxyUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log(`  현재 URL: ${currentUrl.substring(0, 80)}...`);

    // 로그인 페이지인지 확인
    if (currentUrl.includes('login') || currentUrl.includes('sso')) {
      console.log(`  ✗ 로그인 필요 — 먼저 node scripts/setup-auth.js --auto 실행하세요`);
      await page.close();
      return false;
    }

    // PDF 링크 찾기
    const pdfLinks = await page.$$eval('a[href]', els =>
      els.map(el => ({ href: el.href, text: el.textContent?.trim() || '' }))
        .filter(l => l.href.includes('.pdf') || l.text.toLowerCase().includes('pdf') || l.text.includes('Download'))
    ).catch(() => []);

    console.log(`  PDF 링크 ${pdfLinks.length}개 발견`);

    // PDF 링크 중 article-pdf, content/pdf 등 우선
    const bestLink = pdfLinks.find(l =>
      l.href.includes('article-pdf') || l.href.includes('content/pdf')
    ) || pdfLinks[0];

    if (bestLink) {
      console.log(`  PDF 다운로드: ${bestLink.href.substring(0, 80)}...`);
      const dlPage = await context.newPage();
      const resp = await dlPage.goto(bestLink.href, { waitUntil: 'load', timeout: 30000 }).catch(() => null);
      if (resp) {
        const body = await resp.body().catch(() => null);
        if (body && body.length > 5000) {
          fs.writeFileSync(outPath, body);
          if (isValidPdf(outPath)) {
            console.log(`  ✓ ${paper.outName} (${(body.length / 1024).toFixed(1)}KB)`);
            await dlPage.close();
            await page.close();
            return true;
          }
        }
      }
      await dlPage.close();
    }

    // 직접 PDF URL 생성 시도 (OUP, Springer 패턴)
    if (paper.articleUrl.includes('doi.org')) {
      // 다른 접근: 페이지의 meta PDF URL
      const metaPdf = await page.$eval('meta[name="citation_pdf_url"]', el => el.content).catch(() => '');
      if (metaPdf) {
        const proxyPdfUrl = PROXY_BASE + encodeURIComponent(metaPdf);
        console.log(`  Meta PDF URL 발견, 프록시 경유 다운로드...`);
        const dlPage2 = await context.newPage();
        const resp2 = await dlPage2.goto(proxyPdfUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => null);
        if (resp2) {
          const body2 = await resp2.body().catch(() => null);
          if (body2 && body2.length > 5000) {
            fs.writeFileSync(outPath, body2);
            if (isValidPdf(outPath)) {
              console.log(`  ✓ ${paper.outName} (${(body2.length / 1024).toFixed(1)}KB)`);
              await dlPage2.close();
              await page.close();
              return true;
            }
          }
        }
        await dlPage2.close();
      }
    }

    console.log(`  ✗ ${paper.outName} 실패`);
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

  const hasAuth = fs.existsSync(AUTH_STATE_PATH);
  console.log(`인증 상태: ${hasAuth ? '있음' : '없음'}`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const ctxOptions = {
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true,
    locale: 'en-US',
  };
  if (hasAuth) ctxOptions.storageState = AUTH_STATE_PATH;

  const context = await browser.newContext(ctxOptions);

  // ACS SI 다운로드
  for (const paper of ACS_PAPERS) {
    await downloadAcsSi(context, paper);
    await new Promise(r => setTimeout(r, 3000));
  }

  // 프록시 경유 다운로드
  for (const paper of PROXY_PAPERS) {
    await downloadProxyPaper(context, paper);
    await new Promise(r => setTimeout(r, 3000));
  }

  // 결과 요약
  console.log('\n=== 최종 결과 ===');
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => !f.startsWith('_'));
  for (const f of files) {
    const fp = path.join(OUTPUT_DIR, f);
    const stat = fs.statSync(fp);
    const valid = isValidPdf(fp) ? '✓ PDF' : (f.endsWith('.zip') ? '✓ ZIP' : '✗ 유효하지 않음');
    console.log(`  ${valid} ${f} (${(stat.size / 1024).toFixed(1)}KB)`);
  }

  await context.close();
  await browser.close();
}

main().catch(err => {
  console.error('치명적 에러:', err);
  process.exit(1);
});
