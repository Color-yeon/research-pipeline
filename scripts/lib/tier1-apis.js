// 티어 1 API 모듈
// 토큰 비용 0으로 논문 전문을 확보하는 무료/공식 API 모음.
// 각 함수는 { success, content, source, format, url } 을 반환한다.

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..', '..');

// .env 로드
function loadEnv() {
  const envPath = path.join(PROJECT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.substring(0, eq).trim();
    const val = t.substring(eq + 1).trim();
    if (!process.env[key] && val) process.env[key] = val;
  }
}
loadEnv();

// HTTP GET 유틸리티
function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 15000;
    const headers = {
      'User-Agent': 'research-pipeline/1.0 (academic research; mailto:' + (process.env.UNPAYWALL_EMAIL || 'user@example.com') + ')',
      'Accept': options.accept || 'application/json',
      ...options.headers,
    };

    const follow = (targetUrl, depth = 0) => {
      if (depth > 5) return reject(new Error('리다이렉트 초과'));
      const mod = targetUrl.startsWith('https') ? https : http;
      const req = mod.get(targetUrl, { headers, timeout }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, targetUrl).href;
          return follow(next, depth + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(body);
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('타임아웃')); });
    };

    follow(url);
  });
}

// DOI 정규화 (bare DOI만 추출)
function normalizeDoi(doi) {
  return doi.replace(/^https?:\/\/doi\.org\//, '').trim();
}

// ─────────────────────────────────────────────
// 1a. Unpaywall API
// ─────────────────────────────────────────────
async function tryUnpaywall(doi) {
  const email = process.env.UNPAYWALL_EMAIL;
  if (!email) {
    return { success: false, error: 'UNPAYWALL_EMAIL 미설정', source: 'unpaywall' };
  }

  const bareDoi = normalizeDoi(doi);
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(bareDoi)}?email=${encodeURIComponent(email)}`;

  try {
    const body = await httpGet(url);
    const data = JSON.parse(body);

    if (!data.is_oa) {
      return { success: false, error: 'OA 버전 없음', source: 'unpaywall' };
    }

    const best = data.best_oa_location || {};
    const pdfUrl = best.url_for_pdf;
    const landingUrl = best.url;

    // PDF URL이 있으면 PDF 추출 시도
    if (pdfUrl) {
      return { success: true, content: pdfUrl, source: 'unpaywall', format: 'pdf', url: pdfUrl };
    }

    // Landing page URL이 있으면 HTML 추출 시도
    if (landingUrl) {
      return { success: true, content: landingUrl, source: 'unpaywall', format: 'html', url: landingUrl };
    }

    return { success: false, error: 'OA이지만 접근 가능한 URL 없음', source: 'unpaywall' };
  } catch (err) {
    return { success: false, error: err.message, source: 'unpaywall' };
  }
}

// ─────────────────────────────────────────────
// 1b. Semantic Scholar API
// ─────────────────────────────────────────────
async function trySemanticScholar(doi) {
  const bareDoi = normalizeDoi(doi);
  const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(bareDoi)}?fields=openAccessPdf,title,abstract`;

  const headers = {};
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }

  try {
    const body = await httpGet(url, { headers });
    const data = JSON.parse(body);

    if (data.openAccessPdf && data.openAccessPdf.url) {
      return {
        success: true,
        content: data.openAccessPdf.url,
        source: 'semanticScholar',
        format: 'pdf',
        url: data.openAccessPdf.url
      };
    }

    return { success: false, error: 'OA PDF 없음', source: 'semanticScholar' };
  } catch (err) {
    return { success: false, error: err.message, source: 'semanticScholar' };
  }
}

// ─────────────────────────────────────────────
// 1c. PubMed Central E-utilities
// ─────────────────────────────────────────────
async function tryPmc(doi) {
  const bareDoi = normalizeDoi(doi);

  try {
    // Step 1: DOI → PMCID 변환
    const idUrl = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${encodeURIComponent(bareDoi)}&format=json`;
    const idBody = await httpGet(idUrl);
    const idData = JSON.parse(idBody);

    const record = idData.records && idData.records[0];
    if (!record || !record.pmcid) {
      return { success: false, error: 'PMC에 등록되지 않은 논문', source: 'pmc' };
    }

    const pmcid = record.pmcid;

    // Step 2: PMCID → XML 전문
    const xmlUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${pmcid}&rettype=xml`;
    const xml = await httpGet(xmlUrl, { accept: 'text/xml', timeout: 30000 });

    // XML에서 <body> 텍스트 추출 (간단한 정규식 방식)
    const bodyMatch = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) {
      return { success: false, error: 'XML에서 body 추출 실패', source: 'pmc' };
    }

    // XML 태그 제거 → 평문
    let text = bodyMatch[1]
      .replace(/<title[^>]*>([\s\S]*?)<\/title>/gi, '\n## $1\n')  // 제목 보존
      .replace(/<\/?[^>]+>/g, '')  // 모든 태그 제거
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text.length > 80000) text = text.substring(0, 80000);

    if (text.length < 500) {
      return { success: false, error: 'PMC XML 본문이 너무 짧음', source: 'pmc' };
    }

    return { success: true, content: text, source: 'pmc', format: 'text', url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/` };
  } catch (err) {
    return { success: false, error: err.message, source: 'pmc' };
  }
}

// ─────────────────────────────────────────────
// 1d. CORE API
// ─────────────────────────────────────────────
async function tryCore(doi) {
  const apiKey = process.env.CORE_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'CORE_API_KEY 미설정', source: 'core' };
  }

  const bareDoi = normalizeDoi(doi);
  const url = `https://api.core.ac.uk/v3/search/works/?q=doi:"${encodeURIComponent(bareDoi)}"&limit=1`;

  try {
    const body = await httpGet(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    const data = JSON.parse(body);

    const results = data.results || [];
    if (results.length === 0) {
      return { success: false, error: 'CORE에서 논문 미발견', source: 'core' };
    }

    const paper = results[0];
    if (paper.fullText) {
      let text = paper.fullText;
      if (text.length > 80000) text = text.substring(0, 80000);
      return { success: true, content: text, source: 'core', format: 'text', url: paper.downloadUrl || '' };
    }

    if (paper.downloadUrl) {
      return { success: true, content: paper.downloadUrl, source: 'core', format: 'pdf', url: paper.downloadUrl };
    }

    return { success: false, error: 'CORE에 전문 없음', source: 'core' };
  } catch (err) {
    return { success: false, error: err.message, source: 'core' };
  }
}

// ─────────────────────────────────────────────
// 1e. 출판사 TDM API
// ─────────────────────────────────────────────

// Elsevier ScienceDirect TDM
async function tryElsevier(doi) {
  const apiKey = process.env.ELSEVIER_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'ELSEVIER_API_KEY 미설정', source: 'elsevier' };
  }

  const bareDoi = normalizeDoi(doi);
  const url = `https://api.elsevier.com/content/article/doi/${bareDoi}`;

  try {
    const body = await httpGet(url, {
      headers: { 'X-ELS-APIKey': apiKey, 'Accept': 'text/plain' },
      timeout: 20000,
    });

    if (body.length < 500) {
      return { success: false, error: 'Elsevier 응답이 너무 짧음', source: 'elsevier' };
    }

    return { success: true, content: body, source: 'elsevier', format: 'text', url: `https://doi.org/${bareDoi}` };
  } catch (err) {
    return { success: false, error: err.message, source: 'elsevier' };
  }
}

// Springer Nature TDM
async function trySpringer(doi) {
  const apiKey = process.env.SPRINGER_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'SPRINGER_API_KEY 미설정', source: 'springer' };
  }

  const bareDoi = normalizeDoi(doi);
  const url = `https://api.springernature.com/openaccess/jats?q=doi:${encodeURIComponent(bareDoi)}&api_key=${apiKey}`;

  try {
    const body = await httpGet(url, { accept: 'application/json', timeout: 20000 });
    const data = JSON.parse(body);

    const records = data.records || [];
    if (records.length === 0) {
      return { success: false, error: 'Springer OA에 없음 (구독 논문일 수 있음)', source: 'springer' };
    }

    // JATS XML에서 본문 추출
    const jats = records[0].body || records[0].abstract || '';
    const text = jats.replace(/<\/?[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

    if (text.length < 500) {
      return { success: false, error: 'Springer 응답 본문이 너무 짧음', source: 'springer' };
    }

    return { success: true, content: text, source: 'springer', format: 'text', url: `https://doi.org/${bareDoi}` };
  } catch (err) {
    return { success: false, error: err.message, source: 'springer' };
  }
}

// Wiley TDM
async function tryWiley(doi) {
  const token = process.env.WILEY_TDM_TOKEN;
  if (!token) {
    return { success: false, error: 'WILEY_TDM_TOKEN 미설정', source: 'wiley' };
  }

  const bareDoi = normalizeDoi(doi);
  const url = `https://api.wiley.com/onlinelibrary/tdm/v1/articles/${encodeURIComponent(bareDoi)}`;

  try {
    const body = await httpGet(url, {
      headers: { 'CR-Clickthrough-Client-Token': token },
      accept: 'application/pdf',
      timeout: 20000,
    });

    // Wiley TDM은 PDF를 반환하므로 URL로 처리
    return { success: true, content: url, source: 'wiley', format: 'pdf', url };
  } catch (err) {
    return { success: false, error: err.message, source: 'wiley' };
  }
}

// ─────────────────────────────────────────────
// HTML에서 본문 추출 (Unpaywall landing page용)
// ─────────────────────────────────────────────
async function extractHtmlContent(url) {
  try {
    const html = await httpGet(url, { accept: 'text/html', timeout: 20000 });
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // 불필요한 요소 제거
    $('script, style, nav, footer, header, .sidebar, .advertisement, .cookie-banner').remove();

    // 본문 추출 시도 (일반적인 학술 논문 HTML 선택자)
    const selectors = [
      'article .article-body',
      'article .fulltext',
      '.article-content',
      '.article__body',
      '#body', '.body',
      'article main',
      'article',
      'main',
      '[role="main"]',
    ];

    let text = '';
    for (const sel of selectors) {
      const el = $(sel);
      if (el.length && el.text().trim().length > 2000) {
        text = el.text().trim();
        break;
      }
    }

    // 선택자 매칭 실패 시 body 전체
    if (!text || text.length < 2000) {
      text = $('body').text().trim();
    }

    // 정리
    text = text.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > 80000) text = text.substring(0, 80000);

    if (text.length < 500) {
      return { success: false, error: 'HTML에서 본문 추출 실패', source: 'html-extractor' };
    }

    return { success: true, content: text, source: 'html-extractor', format: 'text', url };
  } catch (err) {
    return { success: false, error: err.message, source: 'html-extractor' };
  }
}

// ─────────────────────────────────────────────
// API 디스패처 — 이름으로 API 함수 호출
// ─────────────────────────────────────────────
const API_MAP = {
  unpaywall: tryUnpaywall,
  semanticScholar: trySemanticScholar,
  pmc: tryPmc,
  core: tryCore,
  elsevier: tryElsevier,
  springer: trySpringer,
  wiley: tryWiley,
};

/**
 * 이름으로 티어 1 API를 호출한다.
 * @param {string} apiName - API 이름 (unpaywall, semanticScholar, pmc, core, elsevier, springer, wiley)
 * @param {string} doi - DOI
 * @returns {Promise<{ success: boolean, content?: string, source: string, format?: string, url?: string, error?: string }>}
 */
async function callApi(apiName, doi) {
  const fn = API_MAP[apiName];
  if (!fn) {
    return { success: false, error: `알 수 없는 API: ${apiName}`, source: apiName };
  }
  return fn(doi);
}

module.exports = {
  callApi,
  tryUnpaywall,
  trySemanticScholar,
  tryPmc,
  tryCore,
  tryElsevier,
  trySpringer,
  tryWiley,
  extractHtmlContent,
  API_MAP,
};
