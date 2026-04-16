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
 * │                                                             │
 * │     └─ SKILL.md           →  .gemini/commands/<name>.toml   │
 * │        (TOML 래퍼로 감싸서 Gemini CLI가 슬래시 커맨드로     │
 * │         호출할 수 있게 한다)                                 │
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
  writeFileSync,
  statSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const CLAUDE_SKILLS_DIR = join(PROJECT_ROOT, '.claude', 'skills');
const CODEX_SKILLS_DIR = join(PROJECT_ROOT, '.codex', 'skills');
const GEMINI_COMMANDS_DIR = join(PROJECT_ROOT, '.gemini', 'commands');

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
 * SKILL.md의 YAML frontmatter 파싱 (의존성 없이 정규식으로)
 * 반환: { frontmatter: {name, description, ...}, body: string }
 */
function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: content };

  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    // 앞뒤 따옴표 제거 (단일/이중)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[kv[1]] = value;
  }
  return { frontmatter: fm, body: m[2] };
}

/**
 * Gemini CLI용 TOML 커맨드 파일 생성
 *
 * Gemini CLI 스펙:
 *   description = "..."       # 선택
 *   prompt      = "..."       # 필수
 *
 * SKILL.md 본문에 이스케이프 충돌을 피하기 위해 TOML literal multi-line
 * string('''...''')으로 감싼다. literal은 이스케이프 시퀀스를 해석하지
 * 않으므로 마크다운/코드블록을 원본 그대로 전달 가능.
 * 단, 본문에 ''' 가 3개 연속 등장하면 조기 종료되므로 경고한다.
 */
function generateGeminiToml(name, skillContent) {
  const { frontmatter } = parseFrontmatter(skillContent);
  const description = frontmatter.description || `${name} 스킬`;

  // description은 TOML basic string이라 " 와 \ 는 이스케이프 필요
  const safeDescription = description
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  if (skillContent.includes("'''")) {
    console.warn(
      `  ⚠ ${name}: SKILL.md 안에 "'''" (싱글쿼트 세 개)가 있어 ` +
        `Gemini TOML literal multi-line string이 조기 종료될 수 있습니다. ` +
        `필요 시 해당 부분을 수정하거나 basic string("""...""")으로 변경하세요.`,
    );
  }

  return `# ─────────────────────────────────────────────────────────────
# 자동 생성 파일 — 직접 편집하지 마세요.
# 정본: .claude/skills/${name}/SKILL.md
# 재생성: npm run sync-agents
# ─────────────────────────────────────────────────────────────

description = "${safeDescription}"

prompt = '''
${skillContent}
'''
`;
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
  clearDir(GEMINI_COMMANDS_DIR);

  const skillNames = readdirSync(CLAUDE_SKILLS_DIR).filter((name) => {
    const p = join(CLAUDE_SKILLS_DIR, name);
    return statSync(p).isDirectory();
  });

  let codexOk = 0;
  let geminiOk = 0;

  for (const name of skillNames) {
    const srcDir = join(CLAUDE_SKILLS_DIR, name);
    const skillMdPath = join(srcDir, 'SKILL.md');

    if (!existsSync(skillMdPath)) {
      console.warn(`  ⚠ ${name}: SKILL.md 없음 — 스킵`);
      continue;
    }

    // 1) Codex: 디렉토리 전체를 그대로 복사 (SKILL.md + docs/ + agents/ 등)
    const codexDst = join(CODEX_SKILLS_DIR, name);
    copyDirRecursive(srcDir, codexDst);
    codexOk += 1;

    // 2) Gemini: SKILL.md → TOML 래퍼
    const skillContent = readFileSync(skillMdPath, 'utf-8');
    const tomlContent = generateGeminiToml(name, skillContent);
    writeFileSync(join(GEMINI_COMMANDS_DIR, `${name}.toml`), tomlContent);
    geminiOk += 1;
  }

  console.log('✓ sync-agent-assets 완료');
  console.log(`  - .codex/skills/     → ${codexOk}개 스킬 디렉토리 복사`);
  console.log(`  - .gemini/commands/  → ${geminiOk}개 TOML 커맨드 생성`);
  console.log('');
  console.log('ℹ 정본 수정 후 이 스크립트를 다시 실행하면 파생물이 갱신됩니다.');
}

main();
