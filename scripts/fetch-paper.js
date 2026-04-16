#!/usr/bin/env node
// 다단계 논문 전문 수집 오케스트레이터
// 티어 1(API) → 티어 2(브라우저) 순서로 시도하며, 모든 티어에서 콘텐츠 검증을 수행한다.
// 티어 1+2 모두 실패하면 findings/_fetch_results.json에 needsTier3로 기록하여
// 스킬 레이어에서 Playwright MCP(티어 3)로 처리하도록 위임한다.
//
// 사용법:
//   node scripts/fetch-paper.js <DOI>
//   node scripts/fetch-paper.js --batch <파일.json>
//   node scripts/fetch-paper.js --tier1-only <DOI>
//   node scripts/fetch-paper.js --status
//   node scripts/fetch-paper.js --refetch          # 기존 실패 파일 재수집

const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_DIR, 'findings', 'raw_texts');

const { validateContent, validateExistingFiles } = require('./lib/content-validator');
const { callApi, extractHtmlContent } = require('./lib/tier1-apis');
const { extractFromUrl: extractPdf } = require('./lib/pdf-extractor');
const { getRoute, extractPrefix } = require('./lib/publisher-router');
const { mergeResults, RESULTS_PATH } = require('./lib/results-store');

// ─────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────

function doiToSlug(doi) {
  return doi.replace(/^https?:\/\/doi\.org\//, '').replace(/[\/\\:*?"<>|]/g, '_').replace(/_{2,}/g, '_').substring(0, 100);
}

function normalizeDoi(input) {
  // URL 형태든 bare DOI든 bare DOI로 정규화
  return input.replace(/^https?:\/\/doi\.org\//, '').trim();
}

function saveResult(text, doi, meta) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const slug = doiToSlug(doi);
  const filePath = path.join(OUTPUT_DIR, slug + '.md');
  // 메타 정보를 파일 상단에 주석으로 추가
  const header = `<!-- fetch-paper: tier=${meta.tier}, source=${meta.source}, score=${meta.score || '?'}, timestamp=${new Date().toISOString()} -->\n`;
  fs.writeFileSync(filePath, header + text, 'utf-8');
  return filePath;
}

// --json 모드에서는 로그를 stderr로 보내서 stdout의 JSON과 분리
const _jsonMode = process.argv.includes('--json');
function log(msg) {
  if (_jsonMode) {
    process.stderr.write(msg + '\n');
  } else {
    console.log(msg);
  }
}

// ─────────────────────────────────────────────
// 티어 1: API 기반 수집
// ─────────────────────────────────────────────

async function runTier1(doi, apiList) {
  const attempts = [];

  for (const apiName of apiList) {
    log(`  [티어1] ${apiName} 시도 중...`);
    const result = await callApi(apiName, doi);

    if (!result.success) {
      log(`  [티어1] ${apiName}: ${result.error}`);
      attempts.push({ tier: 1, source: apiName, error: result.error });
      continue;
    }

    // API가 URL을 반환한 경우 (PDF 또는 HTML) → 다운로드 + 추출
    let text = result.content;

    if (result.format === 'pdf') {
      log(`  [티어1] ${apiName}: PDF 다운로드 중... (${result.url})`);
      const pdfResult = await extractPdf(result.url);
      if (!pdfResult.success) {
        log(`  [티어1] ${apiName}: PDF 추출 실패 — ${pdfResult.error}`);
        attempts.push({ tier: 1, source: apiName, error: `PDF 추출 실패: ${pdfResult.error}` });
        continue;
      }
      text = pdfResult.text;
    } else if (result.format === 'html') {
      log(`  [티어1] ${apiName}: HTML 추출 중... (${result.url})`);
      const htmlResult = await extractHtmlContent(result.url);
      if (!htmlResult.success) {
        log(`  [티어1] ${apiName}: HTML 추출 실패 — ${htmlResult.error}`);
        attempts.push({ tier: 1, source: apiName, error: `HTML 추출 실패: ${htmlResult.error}` });
        continue;
      }
      text = htmlResult.content;
    }

    // 콘텐츠 검증
    const validation = validateContent(text, doi);
    if (validation.valid) {
      log(`  [티어1] ${apiName}: ✓ 성공 (score: ${validation.score}, ${(text.length / 1024).toFixed(1)}KB)`);
      return { success: true, text, tier: 1, source: apiName, score: validation.score };
    }

    log(`  [티어1] ${apiName}: 콘텐츠 검증 실패 (${validation.reason}, score: ${validation.score})`);
    attempts.push({ tier: 1, source: apiName, error: `검증 실패: ${validation.reason}`, score: validation.score });
  }

  return { success: false, attempts };
}

// ─────────────────────────────────────────────
// 티어 2: 브라우저 자동화 (read-paper.js 활용)
// ─────────────────────────────────────────────

async function runTier2(doi, route) {
  const attempts = [];
  const readPaperMod = require('./read-paper');
  // JSON 모드에서는 read-paper 로그도 stderr로 보냄
  if (_jsonMode) readPaperMod.setLogger((msg) => process.stderr.write(msg + '\n'));
  const { chromium } = require('playwright');
  const bareDoi = normalizeDoi(doi);
  const doiUrl = `https://doi.org/${bareDoi}`;

  // 브라우저 설정
  const hasAuth = fs.existsSync(readPaperMod.AUTH_STATE_PATH);

  // 서브 메서드 목록: headless → headed (필요시) → direct
  const methods = [
    { name: 'ezproxy-headless', headed: false, useProxy: true },
  ];
  if (route.tier2.headed) {
    methods.push({ name: 'ezproxy-headed', headed: true, useProxy: true });
  }
  methods.push({ name: 'direct', headed: false, useProxy: false });

  for (const method of methods) {
    log(`  [티어2] ${method.name} 시도 중...`);

    let browser;
    try {
      browser = await chromium.launch({
        headless: !method.headed,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });

      const ctxOptions = {
        ignoreHTTPSErrors: true,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
      };
      if (hasAuth && method.useProxy) ctxOptions.storageState = readPaperMod.AUTH_STATE_PATH;
      const ctx = await browser.newContext(ctxOptions);

      // 봇 탐지 우회
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
        Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
      });

      // 논문 접근
      const url = method.useProxy
        ? readPaperMod.PROXY_BASE + doiUrl
        : doiUrl;

      const timeout = route.tier2.extraDelay ? 60000 : 45000;
      const result = await readPaperMod.readPaper(ctx, method.useProxy ? doiUrl : doiUrl, {
        includeRefs: false,
        timeout,
      });

      await browser.close();
      browser = null;

      if (!result.success) {
        log(`  [티어2] ${method.name}: 접근 실패 — ${result.error}`);
        attempts.push({ tier: 2, source: method.name, error: result.error });
        continue;
      }

      // 콘텐츠 검증
      const validation = validateContent(result.content, doi);
      if (validation.valid) {
        log(`  [티어2] ${method.name}: ✓ 성공 (score: ${validation.score}, ${(result.content.length / 1024).toFixed(1)}KB)`);
        return { success: true, text: result.content, tier: 2, source: method.name, score: validation.score };
      }

      log(`  [티어2] ${method.name}: 콘텐츠 검증 실패 (${validation.reason}, score: ${validation.score})`);
      attempts.push({ tier: 2, source: method.name, error: `검증 실패: ${validation.reason}`, score: validation.score });
    } catch (err) {
      log(`  [티어2] ${method.name}: 오류 — ${err.message}`);
      attempts.push({ tier: 2, source: method.name, error: err.message });
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  return { success: false, attempts };
}

// ─────────────────────────────────────────────
// 메인 오케스트레이션
// ─────────────────────────────────────────────

async function fetchPaper(doi, options = {}) {
  const bareDoi = normalizeDoi(doi);
  const route = getRoute(bareDoi);
  const allAttempts = [];

  log(`\n📄 ${bareDoi} (${route.name})`);
  log(`   라우트: 티어1=[${route.tier1.join(', ')}], 티어2={headed:${route.tier2.headed}}`);

  // 티어 1: API
  if (!options.skipTier1) {
    const tier1 = await runTier1(bareDoi, route.tier1);
    if (tier1.success) {
      const filePath = saveResult(tier1.text, bareDoi, { tier: tier1.tier, source: tier1.source, score: tier1.score });
      return {
        success: true,
        doi: bareDoi,
        tier: tier1.tier,
        source: tier1.source,
        file: filePath,
        size: tier1.text.length,
        score: tier1.score,
      };
    }
    allAttempts.push(...(tier1.attempts || []));
  }

  // 티어 2: 브라우저
  if (!options.tier1Only) {
    const tier2 = await runTier2(bareDoi, route);
    if (tier2.success) {
      const filePath = saveResult(tier2.text, bareDoi, { tier: tier2.tier, source: tier2.source, score: tier2.score });
      return {
        success: true,
        doi: bareDoi,
        tier: tier2.tier,
        source: tier2.source,
        file: filePath,
        size: tier2.text.length,
        score: tier2.score,
      };
    }
    allAttempts.push(...(tier2.attempts || []));
  }

  // 모든 티어 실패 → 티어 3 필요
  log(`  ✗ 티어 1+2 모두 실패 → 티어 3(MCP) 필요`);
  return {
    success: false,
    doi: bareDoi,
    needsTier3: true,
    attempts: allAttempts,
    reason: allAttempts[allAttempts.length - 1]?.error || 'unknown',
  };
}

// ─────────────────────────────────────────────
// --status: 기존 파일 검증
// ─────────────────────────────────────────────

function runStatus() {
  const { results, summary } = validateExistingFiles(OUTPUT_DIR);

  log(`\n=== findings/raw_texts/ 검증 결과 ===\n`);
  for (const r of results) {
    const sizeStr = r.size >= 1024 ? `${(r.size / 1024).toFixed(1)}KB` : `${r.size}B`;
    const mark = r.valid ? '✓' : '✗';
    const detail = r.valid ? '' : `  (${r.reason})`;
    log(`${mark} ${r.file}  ${sizeStr}  score:${r.score}${detail}`);
  }

  log(`\n합계: ${summary.total}개 중 유효 ${summary.valid}개, 실패 ${summary.invalid}개`);
  if (summary.invalid > 0) {
    log(`재수집 필요: node scripts/fetch-paper.js --refetch`);
  }
}

// ─────────────────────────────────────────────
// --refetch: 검증 실패 파일 재수집
// ─────────────────────────────────────────────

async function runRefetch(options = {}) {
  const { results } = validateExistingFiles(OUTPUT_DIR);
  const failed = results.filter(r => !r.valid);

  if (failed.length === 0) {
    log('모든 파일이 유효합니다. 재수집 불필요.');
    return;
  }

  log(`\n${failed.length}개 파일 재수집 시작...\n`);

  const succeeded = [];
  const needsTier3 = [];

  for (const f of failed) {
    const doi = f.file.replace(/\.md$/, '').replace(/_/g, '/');
    const result = await fetchPaper(doi, options);
    if (result.success) {
      succeeded.push(result);
    } else {
      needsTier3.push(result);
    }
  }

  saveResults(succeeded, needsTier3);
}

// ─────────────────────────────────────────────
// 배치 처리
// ─────────────────────────────────────────────

async function runBatch(jsonPath, options = {}) {
  if (!fs.existsSync(jsonPath)) {
    console.error(`오류: 파일을 찾을 수 없습니다: ${jsonPath}`);
    process.exit(1);
  }

  const papers = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  log(`${papers.length}개 논문 배치 처리 시작...\n`);

  const succeeded = [];
  const needsTier3 = [];

  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    const doi = paper.doi || paper.url || paper;
    log(`[${i + 1}/${papers.length}] ${paper.title || doi}`);

    const result = await fetchPaper(doi, options);
    if (result.success) {
      succeeded.push(result);
    } else {
      needsTier3.push(result);
    }

    // API rate limit 대비 간격
    if (i < papers.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  saveResults(succeeded, needsTier3);
}

// 결과 JSON 저장 — results-store가 기존 파일과 머지하여 누적 보존한다.
// 같은 DOI는 최신 결과가 우선이며, success로 확정된 DOI는 needsTier3에서 자동 제거된다.
function saveResults(succeeded, needsTier3, opts = {}) {
  const merged = mergeResults(succeeded, needsTier3);

  // 호출 단위 요약은 입력 인자 기준 (이번 호출에서 무엇을 처리했는지)
  if (!opts.silent) {
    log(`\n=== 결과 요약 (이번 호출) ===`);
    log(`성공: ${succeeded.length}건`);
    log(`티어3 필요: ${needsTier3.length}건`);
    log(`결과 파일: ${RESULTS_PATH}`);
    log(`(누적) 성공 ${merged.summary.succeeded}건 / 티어3 필요 ${merged.summary.needsTier3}건`);

    if (needsTier3.length > 0) {
      log(`\n티어 3 필요 논문:`);
      for (const p of needsTier3) {
        log(`  - ${p.doi} (${p.reason})`);
      }
      log(`\n→ research-read 스킬에서 티어 3 MCP 프로토콜로 처리하세요.`);
    }
  }
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('사용법:');
    console.log('  node scripts/fetch-paper.js <DOI>                   # 단일 논문 수집');
    console.log('  node scripts/fetch-paper.js --batch <파일.json>     # 배치 수집');
    console.log('  node scripts/fetch-paper.js --tier1-only <DOI>      # API만 시도');
    console.log('  node scripts/fetch-paper.js --status                # 기존 파일 검증');
    console.log('  node scripts/fetch-paper.js --tier2-only <DOI>      # 브라우저만 시도');
    console.log('  node scripts/fetch-paper.js --json <DOI>           # JSON 출력 (파싱용)');
    console.log('  node scripts/fetch-paper.js --refetch               # 실패 파일 재수집');
    console.log('  node scripts/fetch-paper.js --refetch --tier1-only  # API로만 재수집');
    process.exit(0);
  }

  const isBatch = args.includes('--batch');
  const isStatus = args.includes('--status');
  const isRefetch = args.includes('--refetch');
  const tier1Only = args.includes('--tier1-only');
  const tier2Only = args.includes('--tier2-only');
  const jsonOutput = args.includes('--json');

  (async () => {
    if (isStatus) {
      runStatus();
    } else if (isRefetch) {
      await runRefetch({ tier1Only });
    } else if (isBatch) {
      const jsonPath = args[args.indexOf('--batch') + 1];
      await runBatch(jsonPath, { tier1Only });
    } else {
      // 단일 DOI
      const input = args.filter(a => !a.startsWith('--'))[0];
      if (!input) {
        console.error('오류: DOI를 지정하세요.');
        process.exit(1);
      }

      // --tier2-only: 티어 1 건너뛰고 티어 2만 시도
      const options = {};
      if (tier1Only) options.tier1Only = true;
      if (tier2Only) options.skipTier1 = true;

      const result = await fetchPaper(input, options);

      // 단일 DOI 호출도 항상 누적 저장에 반영한다.
      // 성공/실패 모두 results-store에 머지되어, 다음 호출에서 누적 상태를 볼 수 있다.
      // --json 모드에서는 stdout이 단일 결과 JSON이므로 saveResults는 silent로 호출.
      if (result.success) {
        saveResults([result], [], { silent: jsonOutput });
      } else {
        saveResults([], [result], { silent: jsonOutput });
      }

      // --json: 구조화된 JSON 출력 (스킬에서 파싱용)
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.success) {
        log(`\n✓ 완료: ${result.file} (티어 ${result.tier}, ${result.source}, score: ${result.score})`);
      } else {
        process.exit(1);
      }
    }
  })().catch(err => {
    console.error('치명적 오류:', err.message);
    process.exit(1);
  });
}

module.exports = { fetchPaper, runTier1, runTier2, validateContent };
