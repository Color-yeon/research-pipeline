// Playwright 인증 설정 스크립트
// --auto: .env의 ID/PW로 headless 자동 로그인
// (인자 없음): headed 브라우저에서 수동 로그인
// 인증 상태를 .playwright-auth.json (storageState)에 저장
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
const AUTH_STATE_PATH = path.join(PROJECT_DIR, '.playwright-auth.json');
const LOGIN_URL = 'https://library.korea.ac.kr/login';
const VERIFY_URL = 'https://oca.korea.ac.kr/link.n2s?url=https://www.nature.com';

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

// 자동 로그인 모드 (headless)
async function autoMode() {
  loadEnv();
  const id = process.env.KOREA_PORTAL_ID;
  const pw = process.env.KOREA_PORTAL_PW;

  if (!id || !pw || id === '여기에_포털ID_입력') {
    console.error('오류: .env 파일에 KOREA_PORTAL_ID와 KOREA_PORTAL_PW를 설정하세요.');
    process.exit(1);
  }

  console.log('자동 로그인 모드 (headless)...');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 로그인 폼 대기
    await page.waitForSelector('#user-id', { timeout: 15000 });

    // 포털ID 라디오 선택
    const portalRadio = await page.$('#user-type-1');
    if (portalRadio) await portalRadio.click();

    // 아이디/비밀번호 입력
    await page.fill('#user-id', id);
    await page.fill('#user-pw', pw);

    // 로그인 버튼 클릭 + 네비게이션 대기
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(3000);

    // 로그인 성공 확인
    const currentUrl = page.url();
    const stillOnLogin = currentUrl.includes('library.korea.ac.kr/login') || currentUrl.includes('oca.korea.ac.kr/authapi');
    if (stillOnLogin) {
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
  console.log('브라우저를 여는 중...');
  console.log('');
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });

  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(LOGIN_URL);

    console.log('브라우저가 열렸습니다.');
    console.log('고려대 포털 ID로 로그인하세요.');
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
