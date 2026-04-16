#!/usr/bin/env node

/**
 * 프로젝트 라이브러리 — 연구 프로젝트 아카이브/복원
 *
 * 루트의 활성 연구 상태(research-config.json, prd.json, findings/, .ralph-tui/ 일부)를
 * archive/{slug}-{YYYYMMDD-HHMMSS}/ 로 이동해 "라이브러리"처럼 보관하고,
 * 필요 시 다시 루트로 복원할 수 있게 한다.
 *
 * 이 모듈은 start-research.sh 의 deep/trend 모드에서
 * 새 인테이크 직전에 자동 호출되고, library/restore 서브커맨드에서도 호출된다.
 *
 * ## 사용법 (CLI)
 *   node scripts/lib/project-archive.mjs archive [--name <slug>] [--reason <text>]
 *   node scripts/lib/project-archive.mjs list
 *   node scripts/lib/project-archive.mjs restore <slug>
 *
 * ## 사용법 (함수 import)
 *   import { archiveCurrent, listArchived, restoreArchived } from './project-archive.mjs';
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  renameSync,
  cpSync,
  rmSync,
  mkdirSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { buildCheckpoint } from './checkpoint.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const ARCHIVE_DIR = join(PROJECT_ROOT, 'archive');
const CONFIG_PATH = join(PROJECT_ROOT, 'research-config.json');
const PRD_PATH = join(PROJECT_ROOT, 'prd.json');
const FINDINGS_DIR = join(PROJECT_ROOT, 'findings');
const RALPH_DIR = join(PROJECT_ROOT, '.ralph-tui');
const RALPH_LOCK = join(RALPH_DIR, 'ralph.lock');

// .ralph-tui 에서 아카이브에 **복사만** 할 항목 (루트에도 남김 — 다음 세션의 설정)
const RALPH_COPY_ONLY = ['config.toml', 'templates'];
// .ralph-tui 에서 아카이브로 **이동** 할 항목 (루트에서 제거해 다음 세션을 깨끗하게 시작)
const RALPH_MOVE = ['progress.md', 'iterations', 'reports'];
// 절대 아카이브하지 않음: session.json, session-meta.json, ralph.lock (프로세스·절대경로에 묶임)

// ─── 헬퍼 ─────────────────────────────────────────────────────────────

/**
 * 임의의 문자열을 ASCII kebab-case slug 로 변환.
 * 한글이나 기호는 전부 하이픈으로 치환되며 결과가 비면 'unnamed'.
 */
function toKebab(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'unnamed'
  );
}

/**
 * 방어적 경로 가드.
 * 계산된 slug/디렉토리가 실제로 기대한 부모 디렉토리 내부를 가리키는지 확인한다.
 * toKebab 이 이미 경로 구분자(`/`, `\`, `:` 등)와 `..` 시퀀스를 모두 하이픈으로
 * 치환하므로 현재 구현에서는 이론적으로 걸릴 일이 없지만, 미래에 toKebab 이 바뀌거나
 * slug 가 외부 입력에서 그대로 흘러 들어올 때 경로 탈출(즉, archive/ 바깥으로 쓰기)을
 * 프로세스 전체에서 마지막에 거르는 안전 레일이다.
 *
 * @param {string} childPath — join(PARENT, ...something) 결과
 * @param {string} parentDir — 허용된 부모 디렉토리
 * @throws Error — childPath 가 parentDir 아래가 아니면 즉시 throw
 */
function assertWithin(childPath, parentDir) {
  const resolvedChild = resolve(childPath);
  const resolvedParent = resolve(parentDir);
  const parentWithSep = resolvedParent.endsWith('/') ? resolvedParent : resolvedParent + '/';
  if (resolvedChild !== resolvedParent && !resolvedChild.startsWith(parentWithSep)) {
    throw new Error(
      `경로 가드 실패: '${resolvedChild}' 가 '${resolvedParent}' 내부가 아닙니다. (slug/입력 확인 필요)`,
    );
  }
  return resolvedChild;
}

/** YYYYMMDD-HHMMSS 형식 타임스탬프. */
function tsNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * slug 결정 순서:
 *   1) 명시적 --name 값
 *   2) research-config.json 의 첫 키워드 kebab-case
 *   3) 'unnamed'
 */
function deriveSlug(name) {
  if (name && String(name).trim()) return toKebab(name);
  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      const kw = config?.keywords?.[0];
      if (kw) return toKebab(kw);
    } catch {
      /* 무시 */
    }
  }
  return 'unnamed';
}

/**
 * Ralph TUI 가 **실제로** 실행 중인지 확인한다.
 * ralph.lock 파일이 있어도 기록된 PID 가 이미 죽었으면 stale 락으로 간주한다.
 * 반환:
 *   { running: true }                       — 살아있음
 *   { running: false, stale: false }        — 락 파일 없음
 *   { running: false, stale: true, pid }    — stale 락 발견
 */
function checkRalphState() {
  if (!existsSync(RALPH_LOCK)) return { running: false, stale: false };
  let lock;
  try {
    lock = JSON.parse(readFileSync(RALPH_LOCK, 'utf8'));
  } catch {
    // 락 파일이 깨졌으면 보수적으로 running=true 취급 (덮어쓰지 말 것)
    return { running: true };
  }
  const pid = lock?.pid;
  if (typeof pid !== 'number') return { running: true };
  try {
    // 신호 0 = 존재 여부만 확인. ESRCH 면 프로세스 없음.
    process.kill(pid, 0);
    return { running: true };
  } catch (e) {
    if (e.code === 'ESRCH') return { running: false, stale: true, pid };
    // EPERM 등 = 프로세스는 있으나 내가 신호 못 보냄 → 살아있는 것으로 간주
    return { running: true };
  }
}

/** 루트에 아카이브할 만한 상태가 있는지 여부. */
function hasActiveProject() {
  if (existsSync(CONFIG_PATH)) return true;
  if (existsSync(PRD_PATH)) return true;
  if (existsSync(FINDINGS_DIR)) {
    try {
      if (readdirSync(FINDINGS_DIR).length > 0) return true;
    } catch {
      /* 무시 */
    }
  }
  return false;
}

// ─── archiveCurrent ───────────────────────────────────────────────────

/**
 * 루트의 활성 프로젝트를 archive/{slug}-{ts}/ 로 옮긴다.
 *
 * 반환:
 *   { archived: true,  path, slug, dirName, manifest }  — 성공
 *   { archived: false, reason }                         — 옮길 게 없거나 불가
 */
export function archiveCurrent({ name, reason } = {}) {
  if (!hasActiveProject()) {
    return {
      archived: false,
      reason: '루트에 아카이브할 프로젝트 상태가 없습니다.',
    };
  }

  const ralphState = checkRalphState();
  if (ralphState.running) {
    return {
      archived: false,
      reason:
        'Ralph TUI가 실행 중입니다 (.ralph-tui/ralph.lock 의 PID 살아있음). 먼저 중단한 뒤 다시 시도하세요.',
    };
  }
  if (ralphState.stale) {
    // 죽은 프로세스가 남긴 락은 조용히 정리
    try {
      rmSync(RALPH_LOCK, { force: true });
    } catch {
      /* 무시 */
    }
  }

  const slug = deriveSlug(name);
  const ts = tsNow();
  const dirName = `${slug}-${ts}`;
  const destDir = join(ARCHIVE_DIR, dirName);

  // 방어적 가드 — slug 가 어떻게 들어와도 결과 경로가 archive/ 내부이어야 한다.
  assertWithin(destDir, ARCHIVE_DIR);

  if (existsSync(destDir)) {
    return {
      archived: false,
      reason: `이미 존재하는 아카이브 경로입니다: archive/${dirName}/`,
    };
  }

  // manifest 먼저 계산 (이동 전에 체크포인트 스냅샷)
  let config = null;
  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      /* 무시 */
    }
  }
  const checkpoint = buildCheckpoint();
  const manifest = {
    slug,
    dir_name: dirName,
    archived_at: new Date().toISOString(),
    reason: reason || 'manual',
    agent: process.env.AGENT || null,
    topic: config?.topic || null,
    mode: config?.mode || null,
    keywords: config?.keywords || [],
    papers_collected: checkpoint.papers_collected,
    dois_count: checkpoint.dois.length,
    current_phase: checkpoint.current_phase,
    tasks_completed: checkpoint.tasks_completed.length,
    tasks_remaining: checkpoint.tasks_remaining.length,
  };

  mkdirSync(destDir, { recursive: true });
  writeFileSync(
    join(destDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );

  // 핵심 아티팩트 이동 (rename — 같은 파일시스템 내 atomic)
  if (existsSync(CONFIG_PATH)) renameSync(CONFIG_PATH, join(destDir, 'research-config.json'));
  if (existsSync(PRD_PATH)) renameSync(PRD_PATH, join(destDir, 'prd.json'));
  if (existsSync(FINDINGS_DIR)) renameSync(FINDINGS_DIR, join(destDir, 'findings'));

  // .ralph-tui 일부도 같이 아카이브 (복사 + 선택적 이동)
  if (existsSync(RALPH_DIR)) {
    const ralphDest = join(destDir, 'ralph-session');
    mkdirSync(ralphDest, { recursive: true });

    // 1) 복사만 — config.toml, templates/ 는 다음 세션에도 필요하므로 루트에 남김
    for (const item of RALPH_COPY_ONLY) {
      const src = join(RALPH_DIR, item);
      if (existsSync(src)) {
        cpSync(src, join(ralphDest, item), { recursive: true });
      }
    }
    // 2) 이동 — progress.md / iterations / reports 는 루트에서 제거해
    //    다음 세션이 깨끗한 로그로 시작하도록 함
    for (const item of RALPH_MOVE) {
      const src = join(RALPH_DIR, item);
      if (existsSync(src)) {
        cpSync(src, join(ralphDest, item), { recursive: true });
        rmSync(src, { recursive: true, force: true });
      }
    }
  }

  return { archived: true, path: destDir, slug, dirName, manifest };
}

// ─── listArchived ─────────────────────────────────────────────────────

/**
 * manifest.json 이 있는 archive/ 하위 디렉토리만 수집해
 * archived_at 역순(최신이 위)으로 반환.
 */
export function listArchived() {
  if (!existsSync(ARCHIVE_DIR)) return [];

  const items = [];
  for (const name of readdirSync(ARCHIVE_DIR)) {
    const full = join(ARCHIVE_DIR, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    const manifestPath = join(full, 'manifest.json');
    if (!existsSync(manifestPath)) continue; // legacy 엔트리는 스킵
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      items.push({ dirName: name, ...manifest });
    } catch {
      /* 무시 */
    }
  }

  items.sort((a, b) =>
    String(b.archived_at || '').localeCompare(String(a.archived_at || '')),
  );
  return items;
}

// ─── restoreArchived ──────────────────────────────────────────────────

/**
 * 지정한 아카이브를 루트로 되돌린다.
 * 복원 전에 현재 루트 상태를 자동 아카이브한다 (swap 의미).
 *
 * slug 는 정확한 dirName(`{slug}-{ts}`) 또는 그 접두어.
 * 접두어가 여러 엔트리에 걸치면 에러.
 *
 * 복원 후 아카이브 디렉토리는 껍데기(ralph-session, manifest)가 남으므로 전체 삭제한다.
 * 이전 상태를 보존하고 싶다면 자동 아카이브된 새 엔트리에서 다시 restore 하면 된다.
 *
 * .ralph-tui/ 세션은 복원하지 않는다 (session.json 등은 절대경로·프로세스 의존).
 * 복원 직후엔 `./start-research.sh run` 으로 새 세션을 시작하면 된다.
 */
export function restoreArchived(slug) {
  if (!slug) throw new Error('restoreArchived: slug 인자가 필요합니다.');

  const items = listArchived();
  let target = items.find((i) => i.dirName === slug);
  if (!target) {
    const candidates = items.filter((i) => i.dirName.startsWith(slug));
    if (candidates.length === 0) {
      throw new Error(`아카이브를 찾을 수 없습니다: '${slug}'`);
    }
    if (candidates.length > 1) {
      const names = candidates.map((i) => i.dirName).join(', ');
      throw new Error(`'${slug}' 접두어와 일치하는 아카이브가 여러 개입니다: ${names}`);
    }
    target = candidates[0];
  }

  const srcDir = join(ARCHIVE_DIR, target.dirName);

  // 방어적 가드 — target.dirName 이 디스크에서 읽어온 값이긴 해도,
  // 외부에서 심볼릭 링크 등을 통해 archive/ 바깥을 가리키게 만들 가능성을 차단.
  assertWithin(srcDir, ARCHIVE_DIR);

  // 1) 현재 루트 상태 자동 보존 (swap)
  //    아카이브할 게 없으면 noop — 그대로 복원 진행.
  //    Ralph 가 살아있어서 실패하면 여기서 중단 (데이터 파손 위험).
  const preArchive = archiveCurrent({
    reason: `auto-before-restore(${target.dirName})`,
  });
  if (!preArchive.archived && checkRalphState().running) {
    throw new Error(preArchive.reason);
  }

  // 2) 아카이브 → 루트
  const archivedConfig = join(srcDir, 'research-config.json');
  const archivedPrd = join(srcDir, 'prd.json');
  const archivedFindings = join(srcDir, 'findings');

  if (existsSync(archivedConfig)) renameSync(archivedConfig, CONFIG_PATH);
  if (existsSync(archivedPrd)) renameSync(archivedPrd, PRD_PATH);
  if (existsSync(archivedFindings)) renameSync(archivedFindings, FINDINGS_DIR);

  // 3) 아카이브 껍데기 제거 (ralph-session/ + manifest.json 만 남아있음)
  rmSync(srcDir, { recursive: true, force: true });

  return {
    restored: true,
    from: target.dirName,
    manifest: target,
    preArchived: preArchive.archived ? preArchive.dirName : null,
  };
}

// ─── CLI 출력 포매터 ──────────────────────────────────────────────────

function formatTable(items) {
  if (items.length === 0) {
    return '(아카이브가 비어 있습니다 — archive/ 디렉토리에 manifest.json 을 가진 엔트리 없음)';
  }

  const headers = ['SLUG', 'TOPIC', 'MODE', 'PAPERS', 'PHASE', 'ARCHIVED_AT'];
  const rows = items.map((i) => {
    const topic = String(i.topic || '');
    const topicShort = topic.length > 40 ? topic.slice(0, 39) + '…' : topic;
    return [
      i.dirName,
      topicShort || '-',
      i.mode || '-',
      String(i.papers_collected ?? 0),
      String(i.current_phase || '-'),
      String(i.archived_at || '').slice(0, 19).replace('T', ' '),
    ];
  });

  const widths = headers.map((h, idx) =>
    Math.max(h.length, ...rows.map((r) => r[idx].length)),
  );
  const fmt = (row) => row.map((c, idx) => c.padEnd(widths[idx])).join('  ');
  return [
    fmt(headers),
    fmt(headers.map((_, idx) => '─'.repeat(widths[idx]))),
    ...rows.map(fmt),
  ].join('\n');
}

// ─── CLI 진입점 ──────────────────────────────────────────────────────

const isMainModule = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

function printUsage(stream = console.log) {
  stream('사용법:');
  stream('  node scripts/lib/project-archive.mjs archive [--name <slug>] [--reason <text>]');
  stream('  node scripts/lib/project-archive.mjs list');
  stream('  node scripts/lib/project-archive.mjs restore <slug>');
}

if (isMainModule) {
  const [, , cmd, ...rest] = process.argv;

  // 공통 플래그 파서 (--name, --reason 만 지원)
  const args = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--name' || a === '--reason') {
      args[a.slice(2)] = rest[++i];
    } else if (a.startsWith('--name=')) {
      args.name = a.slice('--name='.length);
    } else if (a.startsWith('--reason=')) {
      args.reason = a.slice('--reason='.length);
    } else {
      args._.push(a);
    }
  }

  try {
    if (cmd === 'archive') {
      const result = archiveCurrent({ name: args.name, reason: args.reason });
      if (!result.archived) {
        console.log(`ℹ ${result.reason}`);
        process.exit(0);
      }
      const m = result.manifest;
      console.log(`✓ 아카이브 완료: archive/${result.dirName}/`);
      console.log(`  주제  : ${m.topic || '(없음)'}`);
      console.log(`  키워드: ${(m.keywords || []).join(', ') || '(없음)'}`);
      console.log(`  논문  : ${m.papers_collected}편, 단계: ${m.current_phase}`);
      process.exit(0);
    }

    if (cmd === 'list') {
      console.log(formatTable(listArchived()));
      process.exit(0);
    }

    if (cmd === 'restore') {
      const slug = args._[0];
      if (!slug) {
        console.error('❌ restore: slug 인자가 필요합니다.');
        printUsage(console.error);
        process.exit(1);
      }
      const result = restoreArchived(slug);
      if (result.preArchived) {
        console.log(`✓ 현재 활성 프로젝트를 archive/${result.preArchived}/ 에 보존`);
      }
      console.log(`✓ 복원 완료: ${result.from} → 루트`);
      console.log('  다음 단계: ./start-research.sh run   (또는 resume)');
      process.exit(0);
    }

    printUsage(console.error);
    process.exit(1);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
