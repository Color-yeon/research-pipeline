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

// .env 파일에서 환경변수 로드 — 공용 로더로 통일
const { loadEnv } = require('./lib/env-loader');

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

  // 실패 사유를 구체적으로 보고하기 위한 헬퍼
  const fail = (code, msg, hint) => {
    console.error(`✗ 로그인 실패 [${code}]: ${msg}`);
    if (hint) console.error(`  → ${hint}`);
    process.exit(1);
  };

  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // 1) 로그인 페이지 접속 자체의 실패를 구분
    try {
      await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      fail('NAV', `로그인 페이지 접속 실패: ${e.message}`,
        `.env 의 PROXY_LOGIN_URL (${cfg.loginUrl}) 이 접근 가능한지, 기관 VPN 이 필요한지 확인하세요.`);
    }
    await page.waitForTimeout(2000);

    // 2) CAPTCHA / 봇 차단 감지 — 로그인 폼 대기 전에 페이지 내용을 스캔
    const pageText = (await page.content().catch(() => '')).toLowerCase();
    if (/cloudflare|captcha|are you a robot|attention required|bot detection/.test(pageText)) {
      fail('CAPTCHA', '페이지에 CAPTCHA / 봇 차단 인터스티셜이 감지되었습니다.',
        '헤드리스 모드로는 통과가 어렵습니다. `bash scripts/setup-auth.sh` (수동 모드) 로 재실행해 주세요.');
    }

    // 3) 로그인 폼(아이디 필드) 셀렉터 대기 — 셀렉터 불일치와 타임아웃을 구분
    try {
      await page.waitForSelector(cfg.idSelector, { timeout: 15000 });
    } catch (e) {
      const title = await page.title().catch(() => '(unknown)');
      const url = page.url();
      fail('SELECTOR', `아이디 입력 셀렉터 '${cfg.idSelector}' 를 ${15}초 안에 찾지 못했습니다.`,
        `현재 페이지 title="${title}", url=${url}. .env 의 PROXY_LOGIN_ID_SELECTOR (기본 #user-id) 가 기관 로그인 폼 HTML과 일치하는지 확인하세요.`);
    }

    // 4) (선택) 로그인 전 사전 클릭 — 예: 사용자 유형 라디오 버튼
    if (cfg.preClickSelector) {
      const pre = await page.$(cfg.preClickSelector);
      if (pre) {
        await pre.click().catch((e) => {
          console.warn(`⚠ 사전 클릭 셀렉터 '${cfg.preClickSelector}' 클릭 실패: ${e.message} (계속 진행)`);
        });
      } else {
        console.warn(`⚠ PROXY_LOGIN_PRECLICK_SELECTOR='${cfg.preClickSelector}' 에 해당하는 요소가 없어 스킵합니다.`);
      }
    }

    // 5) 비밀번호 셀렉터도 별도로 확인 — 잘못된 셀렉터 경우 page.fill 이 타임아웃으로 죽는다
    const pwExists = await page.$(cfg.pwSelector);
    if (!pwExists) {
      fail('SELECTOR', `비밀번호 입력 셀렉터 '${cfg.pwSelector}' 를 찾지 못했습니다.`,
        `.env 의 PROXY_LOGIN_PW_SELECTOR (기본 #user-pw) 가 실제 HTML 과 일치하는지 확인하세요.`);
    }

    // 아이디/비밀번호 입력
    await page.fill(cfg.idSelector, id);
    await page.fill(cfg.pwSelector, pw);

    // 6) 로그인 버튼 클릭 + 네비게이션 대기
    const submitExists = await page.$(cfg.submitSelector);
    if (!submitExists) {
      fail('SELECTOR', `로그인 버튼 셀렉터 '${cfg.submitSelector}' 를 찾지 못했습니다.`,
        `.env 의 PROXY_LOGIN_SUBMIT_SELECTOR (기본 button[type="submit"]) 를 확인하세요.`);
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      page.click(cfg.submitSelector),
    ]);
    await page.waitForTimeout(3000);

    // 7) 로그인 후 상태 판정
    const afterUrl = page.url();
    const afterText = (await page.content().catch(() => '')).toLowerCase();

    // 7-a) 여전히 CAPTCHA/봇 차단
    if (/cloudflare|captcha|are you a robot|attention required|bot detection/.test(afterText)) {
      fail('CAPTCHA', '로그인 제출 후 CAPTCHA / 봇 차단이 떴습니다.',
        '수동 로그인 모드(`bash scripts/setup-auth.sh`)로 재시도하세요.');
    }
    // 7-b) 2FA / OTP 페이지 감지
    if (/otp|one[- ]time|2fa|two[- ]factor|verification code|인증번호|이중\s*인증/.test(afterText)) {
      fail('2FA', '2단계 인증 페이지가 감지되었습니다.',
        '헤드리스 자동 모드는 2FA 를 처리하지 못합니다. `bash scripts/setup-auth.sh` 로 수동 로그인해 세션을 저장하세요.');
    }
    // 7-c) 로그인 폼이 여전히 보이면 자격 증명 오류가 가장 유력
    const stillOnForm = await page.evaluate((sel) => {
      try { return !!document.querySelector(sel); } catch (e) { return false; }
    }, cfg.idSelector).catch(() => false);
    if (stillOnForm) {
      fail('CREDENTIALS', '로그인 제출 후에도 로그인 폼이 그대로 보입니다.',
        `PROXY_PORTAL_ID / PROXY_PORTAL_PW 값과, 필요하다면 PROXY_LOGIN_PRECLICK_SELECTOR(사용자 유형 선택 라디오 등)를 확인하세요. 현재 URL=${afterUrl}`);
    }

    // storageState로 인증 상태 저장
    await ctx.storageState({ path: AUTH_STATE_PATH });
    // 세션 쿠키가 포함된 파일 — 소유자만 읽을 수 있도록 권한 제한
    try { fs.chmodSync(AUTH_STATE_PATH, 0o600); } catch (e) { /* Windows 등에서 실패해도 치명적이지 않음 */ }
    console.log('✓ 로그인 성공');
    console.log(`✓ 인증 상태 저장: ${AUTH_STATE_PATH} (chmod 600)`);
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
    // 세션 쿠키가 포함된 파일 — 소유자만 읽을 수 있도록 권한 제한
    try { fs.chmodSync(AUTH_STATE_PATH, 0o600); } catch (e) { /* Windows 등에서 실패해도 치명적이지 않음 */ }
    console.log(`✓ 인증 상태 저장: ${AUTH_STATE_PATH} (chmod 600)`);
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
