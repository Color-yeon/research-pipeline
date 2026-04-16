// Playwright 인증 설정 스크립트
// --auto: .env의 ID/PW로 headless 자동 로그인
// (인자 없음): headed 브라우저에서 수동 로그인
// 인증 상태를 .playwright-auth.json (storageState)에 저장
//
// 환경변수(.env):
//   PROXY_BASE_URL              — 프록시 베이스 URL (예: https://<프록시호스트>/?url=)
//   PROXY_LOGIN_URL             — 도서관/프록시 로그인 페이지 URL
//   PROXY_VERIFY_URL            — 로그인 검증용 테스트 URL (옵션)
//   PROXY_PORTAL_ID / _PW       — 자동 로그인용 자격 증명
//   PROXY_LOGIN_ID_SELECTOR     — 로그인 폼 ID 입력 셀렉터 (기본: #user-id)
//   PROXY_LOGIN_PW_SELECTOR     — 로그인 폼 비밀번호 입력 셀렉터 (기본: #user-pw)
//   PROXY_LOGIN_SUBMIT_SELECTOR — 로그인 버튼 셀렉터 (기본: button[type="submit"])
//   PROXY_LOGIN_PRECLICK_SELECTOR — 로그인 전 클릭 필요 요소(예: 사용자 유형 라디오)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
const AUTH_STATE_PATH = path.join(PROJECT_DIR, '.playwright-auth.json');

// .env 파일에서 환경변수 로드
function loadEnv() {
  const envPath = path.join(PROJECT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// 환경변수에서 프록시 설정을 읽어 기본 셀렉터로 보강한다.
function getProxyConfig() {
  const loginUrl = process.env.PROXY_LOGIN_URL || '';
  const baseUrl = process.env.PROXY_BASE_URL || '';
  // 검증 URL 기본값: 프록시 베이스 + nature.com
  const verifyUrl = process.env.PROXY_VERIFY_URL
    || (baseUrl ? `${baseUrl}https://www.nature.com` : '');
  return {
    loginUrl,
    verifyUrl,
    idSelector: process.env.PROXY_LOGIN_ID_SELECTOR || '#user-id',
    pwSelector: process.env.PROXY_LOGIN_PW_SELECTOR || '#user-pw',
    submitSelector: process.env.PROXY_LOGIN_SUBMIT_SELECTOR || 'button[type="submit"]',
    preClickSelector: process.env.PROXY_LOGIN_PRECLICK_SELECTOR || '',
  };
}

// 자동 로그인 모드 (headless)
async function autoMode() {
  loadEnv();
  const cfg = getProxyConfig();
  const id = process.env.PROXY_PORTAL_ID;
  const pw = process.env.PROXY_PORTAL_PW;

  if (!cfg.loginUrl) {
    console.error('오류: .env에 PROXY_LOGIN_URL을 설정하세요. (bash scripts/setup-proxy.sh 로 대화형 설정 가능)');
    process.exit(1);
  }
  if (!id || !pw) {
    console.error('오류: .env에 PROXY_PORTAL_ID와 PROXY_PORTAL_PW를 설정하세요.');
    process.exit(1);
  }

  console.log('자동 로그인 모드 (headless)...');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 로그인 폼 대기
    await page.waitForSelector(cfg.idSelector, { timeout: 15000 });

    // (선택) 로그인 전 사전 클릭 — 예: 사용자 유형 라디오 버튼
    if (cfg.preClickSelector) {
      const pre = await page.$(cfg.preClickSelector);
      if (pre) await pre.click();
    }

    // 아이디/비밀번호 입력
    await page.fill(cfg.idSelector, id);
    await page.fill(cfg.pwSelector, pw);

    // 로그인 버튼 클릭 + 네비게이션 대기
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      page.click(cfg.submitSelector),
    ]);
    await page.waitForTimeout(3000);

    // 로그인 성공 확인 — 로그인 폼이 더 이상 보이지 않으면 성공으로 간주
    const stillOnForm = await page.evaluate((sel) => {
      try { return !!document.querySelector(sel); } catch (e) { return false; }
    }, cfg.idSelector).catch(() => false);
    if (stillOnForm) {
      console.error('✗ 로그인 실패: 아이디 또는 비밀번호를 확인하세요.');
      process.exit(1);
    }

    // storageState로 인증 상태 저장
    await ctx.storageState({ path: AUTH_STATE_PATH });
    console.log('✓ 로그인 성공');
    console.log(`✓ 인증 상태 저장: ${AUTH_STATE_PATH}`);
  } finally {
    await browser.close();
  }
}

// 수동 로그인 모드 (headed)
async function manualMode() {
  loadEnv();
  const cfg = getProxyConfig();
  if (!cfg.loginUrl) {
    console.error('오류: .env에 PROXY_LOGIN_URL을 설정하세요. (bash scripts/setup-proxy.sh 로 대화형 설정 가능)');
    process.exit(1);
  }

  console.log('브라우저를 여는 중...');
  console.log('');
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });

  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(cfg.loginUrl);

    console.log('브라우저가 열렸습니다.');
    console.log('도서관/프록시 계정으로 로그인하세요.');
    console.log('로그인 완료 후 이 터미널에서 Enter를 누르세요.');
    console.log('');

    // 사용자가 로그인할 때까지 대기
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    // storageState로 인증 상태 저장
    await ctx.storageState({ path: AUTH_STATE_PATH });
    console.log(`✓ 인증 상태 저장: ${AUTH_STATE_PATH}`);
  } finally {
    await browser.close();
  }
}

// 메인 실행
(async () => {
  const isAuto = process.argv.includes('--auto');

  if (isAuto) {
    await autoMode();
  } else {
    await manualMode();
  }

  console.log('');
  console.log('✓ 인증 완료! read-paper.js가 이 세션을 자동으로 사용합니다.');
})().catch(err => {
  console.error('에러:', err.message);
  process.exit(1);
});
