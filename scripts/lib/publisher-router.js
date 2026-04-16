// DOI prefix → 출판사 정보 + 최적 티어 라우팅
// 출판사별 특성에 따라 API 시도 순서와 브라우저 전략을 결정한다.

const ROUTES = {
  // ACS — Cloudflare 매우 강력, 공식 TDM API 없음
  '10.1021': {
    name: 'ACS (American Chemical Society)',
    tier1: ['unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: true, extraDelay: 5000 },
    notes: 'Cloudflare Turnstile 사용, headless 거의 불가'
  },
  // Elsevier / ScienceDirect
  '10.1016': {
    name: 'Elsevier',
    tier1: ['elsevier', 'unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false }
  },
  // Springer
  '10.1007': {
    name: 'Springer',
    tier1: ['springer', 'unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false }
  },
  // Nature (Springer Nature 계열)
  '10.1038': {
    name: 'Nature / Springer Nature',
    tier1: ['springer', 'unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false }
  },
  // Wiley
  '10.1002': {
    name: 'Wiley',
    tier1: ['wiley', 'unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false }
  },
  // Taylor & Francis
  '10.1080': {
    name: 'Taylor & Francis',
    tier1: ['unpaywall', 'semanticScholar', 'pmc', 'core'],
    tier2: { headed: false },
    notes: 'paywall 페이지 캡처 주의'
  },
  // MDPI — 전부 오픈 액세스
  '10.3390': {
    name: 'MDPI',
    tier1: ['unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false, direct: true },
    notes: '전부 OA, 프록시 불필요'
  },
  // PLoS — 전부 오픈 액세스
  '10.1371': {
    name: 'PLoS',
    tier1: ['unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false, direct: true }
  },
  // Frontiers — 전부 오픈 액세스
  '10.3389': {
    name: 'Frontiers',
    tier1: ['unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false, direct: true }
  },
  // RSC (Royal Society of Chemistry)
  '10.1039': {
    name: 'Royal Society of Chemistry',
    tier1: ['unpaywall', 'semanticScholar', 'pmc', 'core'],
    tier2: { headed: false }
  },
  // AIP (American Institute of Physics)
  '10.1063': {
    name: 'AIP Publishing',
    tier1: ['unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false }
  },
  // IEEE
  '10.1109': {
    name: 'IEEE',
    tier1: ['unpaywall', 'semanticScholar', 'core'],
    tier2: { headed: false }
  },
  // APS (American Physical Society)
  '10.1103': {
    name: 'APS',
    tier1: ['unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false }
  },
  // BMC (SpringerOpen) — 오픈 액세스
  '10.1186': {
    name: 'BMC / SpringerOpen',
    tier1: ['unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false, direct: true }
  },
  // AAAS (Science, Science Advances 등)
  '10.1126': {
    name: 'AAAS (Science)',
    tier1: ['unpaywall', 'semanticScholar', 'pmc', 'core'],
    tier2: { headed: false },
    notes: '구독 논문 많음, PMC 등록률 높음'
  },
  // eLife — 전부 오픈 액세스
  '10.7554': {
    name: 'eLife',
    tier1: ['unpaywall', 'semanticScholar', 'pmc'],
    tier2: { headed: false, direct: true }
  },
};

// 기본 라우트 — 매칭되는 prefix가 없을 때
const DEFAULT_ROUTE = {
  name: 'Unknown Publisher',
  tier1: ['unpaywall', 'semanticScholar', 'pmc', 'core'],
  tier2: { headed: false }
};

/**
 * DOI에서 prefix를 추출한다 (예: "10.1021/acs.chemrev.8b00486" → "10.1021")
 * @param {string} doi
 * @returns {string}
 */
function extractPrefix(doi) {
  const clean = doi.replace(/^https?:\/\/doi\.org\//, '');
  const match = clean.match(/^(10\.\d{4,})\//);
  return match ? match[1] : '';
}

/**
 * DOI에 대한 라우팅 정보를 반환한다.
 * @param {string} doi
 * @returns {{ name: string, tier1: string[], tier2: object, notes?: string }}
 */
function getRoute(doi) {
  const prefix = extractPrefix(doi);
  return ROUTES[prefix] || DEFAULT_ROUTE;
}

/**
 * DOI가 오픈 액세스 출판사인지 확인한다.
 * @param {string} doi
 * @returns {boolean}
 */
function isOpenAccess(doi) {
  const prefix = extractPrefix(doi);
  const route = ROUTES[prefix];
  return route ? !!route.tier2?.direct : false;
}

module.exports = { getRoute, extractPrefix, isOpenAccess, ROUTES, DEFAULT_ROUTE };
