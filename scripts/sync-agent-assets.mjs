#!/usr/bin/env node

/**
 * 에이전트 파생 자산 동기화 스크립트
 *
 * ┌────────────────────────────────────────────────────────────┐
 * │  정본(사람이 편집)    →    파생물(자동 생성, .gitignore)   │
 * ├────────────────────────────────────────────────────────────┤
 * │  .claude/skills/<name>/                                     │
 * │     ├─ SKILL.md           →  .codex/skills/<name>/SKILL.md  │
 * │     ├─ docs/*.md          →  .codex/skills/<name>/docs/*.md │
 * │     └─ agents/*.md        →  .codex/skills/<name>/agents/*  │
 * └────────────────────────────────────────────────────────────┘
 *
 * 실행: npm run sync-agents (또는 npm install 시 postinstall로 자동)
 * 정본만 Git에 커밋되며, 파생물은 clone 시 postinstall로 재생성된다.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  copyFileSync,
  readFileSync,
  statSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const CLAUDE_SKILLS_DIR = join(PROJECT_ROOT, '.claude', 'skills');
const CODEX_SKILLS_DIR = join(PROJECT_ROOT, '.codex', 'skills');

/**
 * 디렉토리 재귀 복사 (동일 구조 보존)
 */
function copyDirRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const dstPath = join(dst, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }
}

/**
 * 디렉토리 내부만 비우기 (디렉토리 자체는 유지)
 * — rmSync로 디렉토리 전체를 날리면 에디터가 열고 있는 경로 핸들이 깨질 수 있어,
 *   엔트리 단위로 청소한다.
 */
function clearDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    return;
  }
  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

function main() {
  if (!existsSync(CLAUDE_SKILLS_DIR)) {
    console.error(`❌ 정본 디렉토리가 없습니다: ${CLAUDE_SKILLS_DIR}`);
    process.exit(1);
  }

  // 파생물 클린 빌드
  clearDir(CODEX_SKILLS_DIR);

  const skillNames = readdirSync(CLAUDE_SKILLS_DIR).filter((name) => {
    const p = join(CLAUDE_SKILLS_DIR, name);
    return statSync(p).isDirectory();
  });

  let codexOk = 0;

  for (const name of skillNames) {
    const srcDir = join(CLAUDE_SKILLS_DIR, name);
    const skillMdPath = join(srcDir, 'SKILL.md');

    if (!existsSync(skillMdPath)) {
      console.warn(`  ⚠ ${name}: SKILL.md 없음 — 스킵`);
      continue;
    }

    // Codex: 디렉토리 전체를 그대로 복사 (SKILL.md + docs/ + agents/ 등)
    const codexDst = join(CODEX_SKILLS_DIR, name);
    copyDirRecursive(srcDir, codexDst);
    codexOk += 1;
  }

  console.log('✓ sync-agent-assets 완료');
  console.log(`  - .codex/skills/     → ${codexOk}개 스킬 디렉토리 복사`);
  console.log('');
  console.log('ℹ 정본 수정 후 이 스크립트를 다시 실행하면 파생물이 갱신됩니다.');
}

main();
