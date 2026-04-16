// 프로젝트 루트의 .env 파일을 process.env 에 주입하는 공용 로더.
// 이전에는 setup-auth / read-paper / fetch-paper / download-si / conference-search /
// tier1-apis 가 각자 비슷하지만 미묘하게 다른 loadEnv() 를 구현하고 있어
// 따옴표 처리·빈 줄 취급이 조금씩 달라질 위험이 있었다.
// 이 파일 하나로 통일하고, 나머지 스크립트는 `require('./lib/env-loader').loadEnv()` 만 호출한다.
//
// 규칙:
//   - 기존 process.env 값은 덮어쓰지 않는다 (shell export 가 우선)
//   - 주석(#) 및 빈 줄 무시
//   - 값을 감싼 따옴표(single/double)가 있으면 제거
//   - 여러 번 호출해도 중복 파싱하지 않음 (reload:true 로 강제 가능)

'use strict';

const fs = require('fs');
const path = require('path');

// 이 파일은 scripts/lib/ 에 있으므로 프로젝트 루트까지 두 단계 상위.
const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(PROJECT_DIR, '.env');

let _loaded = false;

function loadEnv(options = {}) {
  const { reload = false } = options;
  if (_loaded && !reload) return;
  if (!fs.existsSync(ENV_PATH)) {
    _loaded = true;
    return;
  }

  const raw = fs.readFileSync(ENV_PATH, 'utf-8').split('\n');
  for (const rawLine of raw) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx).trim();
    let val = line.substring(eqIdx + 1).trim();
    // 값 주위 따옴표 제거 (shell과 호환되도록)
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.substring(1, val.length - 1);
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = val;
    }
  }
  _loaded = true;
}

module.exports = { loadEnv, ENV_PATH, PROJECT_DIR };
