// 논문 전문 콘텐츠 검증 모듈
// 추출된 텍스트가 실제 논문 본문인지 판별한다.
// Cloudflare 챌린지, paywall 페이지, 로그인 페이지 등을 감지하여 거부한다.

// 즉시 거부 패턴 — 이 문자열이 텍스트에 포함되면 논문이 아닌 것으로 판정
const REJECT_PATTERNS = [
  // Cloudflare
  { pattern: /Performing security verification/i, reason: 'cloudflare_challenge' },
  { pattern: /Enable JavaScript and cookies to continue/i, reason: 'cloudflare_challenge' },
  { pattern: /challenge-error-text/i, reason: 'cloudflare_challenge' },
  { pattern: /Checking if the site connection is secure/i, reason: 'cloudflare_challenge' },
  { pattern: /Verifying you are human/i, reason: 'cloudflare_challenge' },
  // 접근 거부
  { pattern: /^Access Denied/i, reason: 'access_denied' },
  { pattern: /^403 Forbidden/i, reason: 'access_denied' },
  // Paywall / 구독 필요
  { pattern: /PDF download \+ Online access/i, reason: 'paywall_page' },
  { pattern: /Purchase this article/i, reason: 'paywall_page' },
  { pattern: /Buy this article/i, reason: 'paywall_page' },
  { pattern: /Add to cart/i, reason: 'paywall_page' },
  { pattern: /Rent this article/i, reason: 'paywall_page' },
];

// 로그인/인증 페이지 패턴 — 복합 조건으로 감지
const LOGIN_INDICATORS = [
  /Log in.*institution/is,
  /Sign in.*access/is,
  /Access through your institution/i,
  /Shibboleth/i,
  /OpenAthens/i,
  /<input[^>]*type="password"/i,
  /id="user-id".*id="user-pw"/is,
];

// 논문 섹션 키워드 — 실제 논문 본문에 등장하는 섹션명
const SECTION_KEYWORDS = [
  /\b(Introduction|서론)\b/i,
  /\b(Abstract|초록)\b/i,
  /\b(Results?|결과)\b/i,
  /\b(Discussion|논의|고찰)\b/i,
  /\b(Conclusion|결론)\b/i,
  /\b(Method(s|ology)?|방법(론)?|Experimental)\b/i,
  /\b(Background|배경)\b/i,
  /\b(Materials?|재료)\b/i,
  /\b(Analysis|분석)\b/i,
  /\b(Supplementary|Supporting Information)\b/i,
];

/**
 * 논문 콘텐츠를 검증한다.
 * @param {string} text - 추출된 텍스트
 * @param {string} doi - DOI (로깅용)
 * @returns {{ valid: boolean, reason: string, score: number, details: object }}
 */
function validateContent(text, doi) {
  if (!text || typeof text !== 'string') {
    return { valid: false, reason: 'empty_content', score: 0, details: {} };
  }

  const trimmed = text.trim();
  const length = trimmed.length;

  // 1. 너무 짧은 텍스트 즉시 거부 (500자 미만)
  if (length < 500) {
    return { valid: false, reason: 'too_short', score: 0, details: { length } };
  }

  // 2. 즉시 거부 패턴 검사
  for (const { pattern, reason } of REJECT_PATTERNS) {
    if (pattern.test(trimmed)) {
      // 짧은 텍스트에서 거부 패턴이 발견되면 확실히 쓰레기
      if (length < 5000) {
        return { valid: false, reason, score: 0, details: { length, matchedPattern: pattern.source } };
      }
      // 긴 텍스트에서는 일부 paywall 문구가 섞여있을 수 있으므로 비율 검사
      // (아래 점수 계산에서 페널티 적용)
    }
  }

  // 3. 로그인 페이지 감지 (짧은 텍스트 + 로그인 지표)
  if (length < 10000) {
    const loginCount = LOGIN_INDICATORS.filter(p => p.test(trimmed)).length;
    if (loginCount >= 2) {
      return { valid: false, reason: 'login_page', score: 0, details: { length, loginIndicators: loginCount } };
    }
  }

  // 4. 점수 계산
  let score = 0;
  const details = { length };

  // 길이 기반 점수 (최대 40점)
  const lengthScore = Math.min(40, Math.floor(length / 2000));
  score += lengthScore;
  details.lengthScore = lengthScore;

  // 섹션 키워드 감지 보너스 (섹션당 +10, 최대 40점)
  const foundSections = SECTION_KEYWORDS.filter(p => p.test(trimmed));
  const sectionScore = Math.min(40, foundSections.length * 10);
  score += sectionScore;
  details.sectionScore = sectionScore;
  details.foundSections = foundSections.length;

  // 거부 패턴 페널티 (각 -20)
  let penaltyScore = 0;
  const penalties = [];
  for (const { pattern, reason } of REJECT_PATTERNS) {
    if (pattern.test(trimmed)) {
      penaltyScore -= 20;
      penalties.push(reason);
    }
  }
  // 로그인 지표 페널티
  const loginCount = LOGIN_INDICATORS.filter(p => p.test(trimmed)).length;
  if (loginCount > 0) {
    penaltyScore -= loginCount * 10;
    penalties.push(`login_indicators(${loginCount})`);
  }
  score += penaltyScore;
  details.penaltyScore = penaltyScore;
  details.penalties = penalties;

  // 최종 점수 클램프
  score = Math.max(0, Math.min(100, score));
  details.finalScore = score;

  // 5. 최소 통과 기준
  // - 3000자 이상
  // - 섹션 키워드 1개 이상
  // - 점수 40 이상
  const valid = length >= 3000 && foundSections.length >= 1 && score >= 40;
  const reason = !valid
    ? (length < 3000 ? 'content_too_short' :
       foundSections.length < 1 ? 'no_paper_sections' :
       'low_score')
    : 'valid';

  return { valid, reason, score, details };
}

/**
 * findings/raw_texts/ 디렉토리의 기존 파일들을 검증한다.
 * @param {string} rawTextsDir - raw_texts 디렉토리 경로
 * @returns {{ results: Array, summary: { total, valid, invalid } }}
 */
function validateExistingFiles(rawTextsDir) {
  const fs = require('fs');
  const path = require('path');

  if (!fs.existsSync(rawTextsDir)) {
    return { results: [], summary: { total: 0, valid: 0, invalid: 0 } };
  }

  const files = fs.readdirSync(rawTextsDir).filter(f => f.endsWith('.md'));
  const results = [];

  for (const file of files) {
    const filePath = path.join(rawTextsDir, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const doi = file.replace(/\.md$/, '').replace(/_/g, '/');
    const validation = validateContent(text, doi);
    const size = Buffer.byteLength(text, 'utf-8');
    results.push({ file, size, ...validation });
  }

  const valid = results.filter(r => r.valid).length;
  return {
    results,
    summary: { total: results.length, valid, invalid: results.length - valid }
  };
}

module.exports = { validateContent, validateExistingFiles, SECTION_KEYWORDS, REJECT_PATTERNS };
