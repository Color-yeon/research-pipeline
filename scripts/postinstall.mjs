#!/usr/bin/env node

/**
 * 프로젝트 postinstall 엔트리
 *
 * `npm install` 시에 순서대로 수행:
 *   1) scripts/sync-agent-assets.mjs 실행 — 에이전트 파생물(.codex/skills/,
 *      .gemini/commands/) 초기 생성/갱신
 *   2) git config core.hooksPath scripts/git-hooks 설정 — pre-commit 등
 *      프로젝트 훅이 자동 활성화되도록 함
 *
 * Git 리포지토리가 아닌 곳(간혹 CI 등)에서 postinstall 이 실행돼도 깨지지 않도록
 * 각 단계는 실패 시 경고만 출력하고 계속 진행한다. 파이프라인 실행 자체에는
 * 영향이 없는 "베스트 에포트" 훅이다.
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ── 1) 에이전트 파생물 sync ──────────────────────────────────────────
{
  const syncScript = join(__dirname, 'sync-agent-assets.mjs');
  const result = spawnSync(process.execPath, [syncScript], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error('⚠ sync-agent-assets.mjs 실패 — 무시하고 계속 진행합니다.');
  }
}

// ── 2) git hooks 경로 설정 ───────────────────────────────────────────
{
  // .git 디렉토리가 없으면(예: tarball 설치, CI) 스킵
  const dotGit = join(PROJECT_ROOT, '.git');
  if (!existsSync(dotGit)) {
    console.log('ℹ .git 디렉토리가 없어 pre-commit 훅 등록을 건너뜁니다.');
    process.exit(0);
  }

  const desiredPath = 'scripts/git-hooks';
  const showResult = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });
  const current = (showResult.stdout || '').trim();

  if (current === desiredPath) {
    console.log(`ℹ core.hooksPath 이미 '${desiredPath}' 로 설정됨.`);
    process.exit(0);
  }

  const setResult = spawnSync(
    'git',
    ['config', 'core.hooksPath', desiredPath],
    { cwd: PROJECT_ROOT, stdio: 'inherit' },
  );

  if (setResult.status === 0) {
    if (current && current.length > 0) {
      console.log(
        `✓ core.hooksPath 를 '${current}' → '${desiredPath}' 로 변경했습니다.`,
      );
    } else {
      console.log(`✓ core.hooksPath 를 '${desiredPath}' 로 설정했습니다.`);
    }
    console.log('  (해제하려면: git config --unset core.hooksPath)');
  } else {
    console.error(
      '⚠ core.hooksPath 설정 실패 — pre-commit 훅이 수동 등록 전까지 동작하지 않습니다.',
    );
  }
}
