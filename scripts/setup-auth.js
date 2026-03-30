// Playwright 인증 설정 스크립트
// --auto: .env의 ID/PW로 headless 자동 로그인
// (인자 없음): headed 브라우저에서 수동 로그인
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
const MAIN_PROFILE = path.join(PROJECT_DIR, '.playwright-profile');
const TEMP_PROFILE = path.join(PROJECT_DIR, '.playwright-auth-temp');
const TARGET_URL = 'https://oca.korea.ac.kr/link.n2s?url=https://www.nature.com';

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

// 쿠키 파일을 메인 프로필로 복사
function copyCookies() {
  const cookieSrc = path.join(TEMP_PROFILE, 'Default', 'Cookies');
  const cookieDst = path.join(MAIN_PROFILE, 'Default', 'Cookies');

  if (fs.existsSync(cookieSrc)) {
    const dstDir = path.dirname(cookieDst);
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }
    fs.copyFileSync(cookieSrc, cookieDst);

    const journalSrc = cookieSrc + '-journal';
    const journalDst = cookieDst + '-journal';
    if (fs.existsSync(journalSrc)) {
      fs.copyFileSync(journalSrc, journalDst);
    }
    return true;
  }
  return false;
}

// 임시 프로필 정리
function cleanup() {
  if (fs.existsSync(TEMP_PROFILE)) {
    fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
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

  cleanup();
  console.log('자동 로그인 모드 (headless)...');

  const ctx = await chromium.launchPersistentContext(TEMP_PROFILE, {
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
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

    console.log('✓ 로그인 성공');
  } finally {
    await ctx.close();
  }

  // 쿠키 복사
  if (copyCookies()) {
    console.log('✓ 쿠키가 메인 프로필로 복사되었습니다.');
  } else {
    console.error('⚠ 쿠키 파일을 찾을 수 없습니다.');
  }

  cleanup();
  console.log('');
  console.log('✓ 인증 완료!');
}

// 수동 로그인 모드 (headed)
async function manualMode() {
  cleanup();
  console.log('브라우저를 여는 중...');
  console.log('');

  const ctx = await chromium.launchPersistentContext(TEMP_PROFILE, {
    headless: false,
    args: ['--no-sandbox'],
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(TARGET_URL);

  console.log('브라우저가 열렸습니다.');
  console.log('고려대 포털 ID로 로그인하세요.');
  console.log('로그인 완료 후 브라우저를 닫으면 쿠키가 자동 저장됩니다.');
  console.log('');

  // 브라우저가 닫힐 때까지 대기
  await new Promise(resolve => ctx.on('close', resolve));

  if (copyCookies()) {
    console.log('✓ 쿠키가 메인 프로필로 복사되었습니다.');
  } else {
    console.log('⚠ 쿠키 파일을 찾을 수 없습니다. 로그인이 완료되지 않았을 수 있습니다.');
  }

  cleanup();
  console.log('');
  console.log('✓ 인증 완료!');
  console.log('  Playwright MCP를 재시작하면 새 쿠키가 적용됩니다.');
  console.log('  (Claude Code를 껐다 켜면 MCP가 자동 재시작됩니다)');
}

// 메인 실행
(async () => {
  const isAuto = process.argv.includes('--auto');

  if (isAuto) {
    await autoMode();
  } else {
    await manualMode();
  }
})().catch(err => {
  console.error('에러:', err.message);
  cleanup();
  process.exit(1);
});
