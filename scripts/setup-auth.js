// Playwright 인증 설정 스크립트
// 별도 임시 프로필에서 로그인 후, 쿠키를 메인 프로필로 복사
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROJECT_DIR = path.resolve(__dirname, '..');
const MAIN_PROFILE = path.join(PROJECT_DIR, '.playwright-profile');
const TEMP_PROFILE = path.join(PROJECT_DIR, '.playwright-auth-temp');
const TARGET_URL = 'https://oca.korea.ac.kr/link.n2s?url=https://www.nature.com';

(async () => {
  // 임시 프로필 정리
  if (fs.existsSync(TEMP_PROFILE)) {
    fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
  }

  console.log('브라우저를 여는 중...');
  console.log('');

  // 임시 프로필로 headed 브라우저 실행
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

  // 쿠키 파일을 메인 프로필로 복사
  const cookieSrc = path.join(TEMP_PROFILE, 'Default', 'Cookies');
  const cookieDst = path.join(MAIN_PROFILE, 'Default', 'Cookies');

  if (fs.existsSync(cookieSrc)) {
    // 메인 프로필의 Default 디렉토리 확보
    const dstDir = path.dirname(cookieDst);
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }
    fs.copyFileSync(cookieSrc, cookieDst);

    // Cookies-journal도 복사
    const journalSrc = cookieSrc + '-journal';
    const journalDst = cookieDst + '-journal';
    if (fs.existsSync(journalSrc)) {
      fs.copyFileSync(journalSrc, journalDst);
    }

    console.log('✓ 쿠키가 메인 프로필로 복사되었습니다.');
  } else {
    console.log('⚠ 쿠키 파일을 찾을 수 없습니다. 로그인이 완료되지 않았을 수 있습니다.');
  }

  // 임시 프로필 정리
  fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });

  console.log('');
  console.log('✓ 인증 완료!');
  console.log('  Playwright MCP를 재시작하면 새 쿠키가 적용됩니다.');
  console.log('  (Claude Code를 껐다 켜면 MCP가 자동 재시작됩니다)');
})().catch(err => {
  console.error('에러:', err.message);
  // 임시 프로필 정리
  if (fs.existsSync(TEMP_PROFILE)) {
    fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
  }
  process.exit(1);
});
