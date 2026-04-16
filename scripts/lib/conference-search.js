// Semantic Scholar + OpenAlex API로 학회별 생물/화학 논문을 검색한다.
// S2가 rate limit에 걸리면 OpenAlex를 폴백으로 사용한다.

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────

const S2_API = 'https://api.semanticscholar.org/graph/v1';
const S2_FIELDS = 'title,authors,year,venue,externalIds,openAccessPdf,abstract,fieldsOfStudy';
const OPENALEX_API = 'https://api.openalex.org';
const PAGE_SIZE = 100;
const MAX_OFFSET = 999;

// .env 로드 — 공용 로더로 통일
require('./env-loader').loadEnv();

const hasS2Key = !!(process.env.SEMANTIC_SCHOLAR_API_KEY && process.env.SEMANTIC_SCHOLAR_API_KEY.length > 5);
const userEmail = process.env.UNPAYWALL_EMAIL || 'research-pipeline@example.com';

// ─────────────────────────────────────────────
// HTTP 유틸리티
// ─────────────────────────────────────────────

function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 20000;
    const headers = {
      'User-Agent': `research-pipeline/1.0 (mailto:${userEmail})`,
      'Accept': 'application/json',
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
        if (res.statusCode === 429) return reject(new Error('RATE_LIMITED'));
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('타임아웃')); });
    };

    follow(url);
  });
}

// ─────────────────────────────────────────────
// S2 Rate Limiter
// ─────────────────────────────────────────────

let s2LastRequest = 0;
const S2_INTERVAL = hasS2Key ? 150 : 5500;

async function s2Get(url) {
  const now = Date.now();
  const wait = Math.max(0, s2LastRequest + S2_INTERVAL - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  s2LastRequest = Date.now();

  const headers = {};
  if (hasS2Key) headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await httpGet(url, { headers });
    } catch (err) {
      if (err.message === 'RATE_LIMITED' && attempt < 2) {
        const backoff = (attempt + 1) * 20000;
        console.log(`    ⏳ S2 rate limited — ${backoff / 1000}초 대기...`);
        await new Promise(r => setTimeout(r, backoff));
        s2LastRequest = Date.now();
        continue;
      }
      throw err;
    }
  }
}

// ─────────────────────────────────────────────
// OpenAlex 검색 (S2 폴백용, rate limit 매우 관대)
// ─────────────────────────────────────────────

// OpenAlex 학회명 → source ID 매핑 (미리 조회한 값)
const OPENALEX_VENUES = {
  'NeurIPS': 'S1127419573',
  'NIPS': 'S1127419573',
  'ICML': 'S1184914352',
  'ICLR': 'S2766755739',
  'AAAI': 'S1177592043',
  'CVPR': 'S1197900043',
  'ICCV': 'S1130895703',
  'ECCV': 'S2764354382',
  'ACL': 'S41208073',
  'EMNLP': 'S4395127',
  'NAACL': 'S2041107109',
  'NAACL-HLT': 'S2041107109',
  'IJCAI': 'S1203315464',
  'KDD': 'S1186681515',
};

// OpenAlex 분야 concept ID (Biology, Chemistry, Medicine)
const OPENALEX_CONCEPTS = {
  'Biology': 'C86803240',
  'Chemistry': 'C185592680',
  'Medicine': 'C71924100',
};

/**
 * OpenAlex API로 학회 논문을 검색한다.
 * @param {string} venueName - 학회 이름
 * @param {object} options - { concept, query, cursor }
 * @returns {Promise<Array>} - 통일 형식 논문 배열
 */
async function searchOpenAlex(venueName, options = {}) {
  const sourceId = OPENALEX_VENUES[venueName];
  if (!sourceId) return [];

  const papers = [];
  let cursor = '*';
  let pageCount = 0;
  const maxPages = 20; // 안전 장치

  while (cursor && pageCount < maxPages) {
    const filters = [`primary_location.source.id:https://openalex.org/sources/${sourceId}`];
    if (options.concept) {
      const conceptId = OPENALEX_CONCEPTS[options.concept];
      if (conceptId) filters.push(`concepts.id:https://openalex.org/concepts/${conceptId}`);
    }

    let url = `${OPENALEX_API}/works?filter=${filters.join(',')}&per_page=200&cursor=${cursor}&mailto=${userEmail}`;
    if (options.query) url += `&search=${encodeURIComponent(options.query)}`;

    try {
      const body = await httpGet(url, { timeout: 30000 });
      const data = JSON.parse(body);

      if (!data.results || data.results.length === 0) break;

      // OpenAlex → S2와 동일한 형식으로 변환
      for (const work of data.results) {
        papers.push({
          paperId: work.id || null,
          title: work.title || '',
          authors: (work.authorships || []).map(a => ({
            name: a.author?.display_name || '',
          })),
          year: work.publication_year || null,
          venue: venueName,
          externalIds: { DOI: work.doi?.replace('https://doi.org/', '') || null },
          openAccessPdf: work.open_access?.oa_url ? { url: work.open_access.oa_url } : null,
          abstract: work.abstract_inverted_index
            ? reconstructAbstract(work.abstract_inverted_index)
            : null,
          fieldsOfStudy: (work.concepts || []).map(c => c.display_name),
          _source: 'openalex',
        });
      }

      cursor = data.meta?.next_cursor || null;
      pageCount++;

      // OpenAlex는 관대하지만 예의상 짧은 대기
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`    ⚠ OpenAlex 오류: ${err.message}`);
      break;
    }
  }

  return papers;
}

/**
 * OpenAlex의 inverted index를 원래 초록 텍스트로 복원한다.
 */
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return null;
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.join(' ');
}

// ─────────────────────────────────────────────
// S2 검색
// ─────────────────────────────────────────────

/**
 * S2 Paper Search API로 논문을 검색한다 (자동 페이지네이션).
 */
async function searchS2(query, filters = {}) {
  const papers = [];
  let offset = 0;

  while (offset <= MAX_OFFSET) {
    const params = new URLSearchParams({
      query,
      fields: S2_FIELDS,
      offset: String(offset),
      limit: String(PAGE_SIZE),
    });

    if (filters.venue) params.set('venue', filters.venue);
    if (filters.year) params.set('year', filters.year);
    if (filters.fieldsOfStudy) params.set('fieldsOfStudy', filters.fieldsOfStudy);

    const url = `${S2_API}/paper/search?${params}`;

    try {
      const body = await s2Get(url);
      const data = JSON.parse(body);

      if (!data.data || data.data.length === 0) break;

      for (const p of data.data) {
        p._source = 's2';
      }
      papers.push(...data.data);

      if (data.data.length < PAGE_SIZE || offset + PAGE_SIZE >= (data.total || 0)) break;
      offset += PAGE_SIZE;
    } catch (err) {
      if (err.message === 'RATE_LIMITED') {
        console.log(`    ⚠ S2 rate limit — 현재까지 ${papers.length}건으로 진행`);
        break;
      }
      console.error(`    ⚠ S2 오류 (query="${query}"): ${err.message}`);
      break;
    }
  }

  return papers;
}

// ─────────────────────────────────────────────
// 통합 학회 검색 (S2 → OpenAlex 폴백)
// ─────────────────────────────────────────────

/**
 * 학회별 생물/화학 논문을 종합 검색한다.
 * S2를 우선 시도하고, rate limit 시 OpenAlex로 전환한다.
 * @param {object} conference - { id, names }
 * @param {string[]} searchQueries - 키워드 검색어 목록
 * @param {string[]} fieldsOfStudy - 분야 필터 목록
 * @returns {Promise<Map<string, object>>} - 고유키 → paper 맵
 */
async function searchConference(conference, searchQueries, fieldsOfStudy = []) {
  const paperMap = new Map();
  let s2Failed = false;

  // ===== 시도 1: Semantic Scholar =====
  if (!s2Failed) {
    const venueStr = conference.names.join(',');

    // 전략 1a: fieldsOfStudy 필터
    for (const fos of fieldsOfStudy) {
      process.stdout.write(`  [${conference.id}] S2 fieldsOfStudy="${fos}" ...`);
      try {
        const papers = await searchS2(fos.toLowerCase(), {
          venue: venueStr,
          fieldsOfStudy: fos,
        });
        let newCount = 0;
        for (const p of papers) {
          const key = p.externalIds?.DOI || p.paperId;
          if (key && !paperMap.has(key)) {
            paperMap.set(key, p);
            newCount++;
          }
        }
        console.log(` ${papers.length}건 (신규 ${newCount}건)`);
      } catch (err) {
        if (err.message === 'RATE_LIMITED') {
          console.log(` S2 rate limit → OpenAlex로 전환`);
          s2Failed = true;
          break;
        }
        console.log(` 오류: ${err.message}`);
      }
    }

    // 전략 1b: 키워드 검색
    if (!s2Failed) {
      for (const query of searchQueries) {
        process.stdout.write(`  [${conference.id}] S2 query="${query}" ...`);
        try {
          const papers = await searchS2(query, { venue: venueStr });
          let newCount = 0;
          for (const p of papers) {
            const key = p.externalIds?.DOI || p.paperId;
            if (key && !paperMap.has(key)) {
              paperMap.set(key, p);
              newCount++;
            }
          }
          console.log(` ${papers.length}건 (신규 ${newCount}건)`);
        } catch (err) {
          if (err.message === 'RATE_LIMITED') {
            console.log(` S2 rate limit → OpenAlex로 전환`);
            s2Failed = true;
            break;
          }
          console.log(` 오류: ${err.message}`);
        }
      }
    }
  }

  // ===== 시도 2: OpenAlex (S2 실패 시 또는 보완) =====
  if (s2Failed || paperMap.size === 0) {
    const venueName = conference.names[0];
    console.log(`  [${conference.id}] OpenAlex 검색 시작...`);

    // 전략 2a: concept 필터 (Biology, Chemistry, Medicine)
    for (const concept of fieldsOfStudy) {
      process.stdout.write(`  [${conference.id}] OpenAlex concept="${concept}" ...`);
      const papers = await searchOpenAlex(venueName, { concept });
      let newCount = 0;
      for (const p of papers) {
        const key = p.externalIds?.DOI || p.paperId;
        if (key && !paperMap.has(key)) {
          paperMap.set(key, p);
          newCount++;
        }
      }
      console.log(` ${papers.length}건 (신규 ${newCount}건)`);
    }

    // 전략 2b: 키워드 검색
    for (const query of searchQueries) {
      process.stdout.write(`  [${conference.id}] OpenAlex query="${query}" ...`);
      const papers = await searchOpenAlex(venueName, { query });
      let newCount = 0;
      for (const p of papers) {
        const key = p.externalIds?.DOI || p.paperId;
        if (key && !paperMap.has(key)) {
          paperMap.set(key, p);
          newCount++;
        }
      }
      console.log(` ${papers.length}건 (신규 ${newCount}건)`);
    }
  }

  return paperMap;
}

// ─────────────────────────────────────────────
// Unpaywall PDF URL 폴백
// ─────────────────────────────────────────────

async function getUnpaywallPdfUrl(doi) {
  if (!doi) return null;
  try {
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(userEmail)}`;
    const body = await httpGet(url, { timeout: 10000 });
    const data = JSON.parse(body);
    if (data.is_oa && data.best_oa_location) {
      return data.best_oa_location.url_for_pdf || null;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { searchS2, searchOpenAlex, searchConference, getUnpaywallPdfUrl };
