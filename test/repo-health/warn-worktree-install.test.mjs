// The warn-worktree-install `preinstall` reporter names what an install in a
// LINKED worktree did to the primary checkout's node_modules (#1442). It must
// ALWAYS exit 0: a non-zero preinstall blocks `npm ci`, which would red every CI
// job, and it cannot prevent the damage anyway (npm removes the symlink before
// preinstall runs, `npm ci` has already emptied the primary, and Bun ignores the
// exit code). Prevention lives in the PreToolUse hook instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/warn-worktree-install.mjs'
);

function run(cwd) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
}

/**
 * A real primary checkout plus a real linked worktree, so `git rev-parse
 * --git-common-dir` resolves the way it does in the repo rather than against a
 * hand-faked gitdir pointer.
 */
function makePair() {
  const root = mkdtempSync(join(tmpdir(), 'warn-install-'));
  const primary = join(root, 'primary');
  const worktree = join(root, 'worktree');
  mkdirSync(primary, { recursive: true });
  const g = (cmd) => execSync(`git ${cmd}`, { cwd: primary, stdio: 'pipe' });
  g('init -q -b main');
  g('config user.email t@t');
  g('config user.name t');
  writeFileSync(join(primary, 'package.json'), '{"name":"primary"}\n');
  g('add .');
  g('commit -q -m init');
  g(`worktree add -q -b feat ${worktree}`);
  mkdirSync(join(primary, 'node_modules'), { recursive: true });
  writeFileSync(join(primary, 'node_modules', '.keep'), '');
  return { root, primary, worktree };
}

test('silent and exit 0 in the PRIMARY checkout, which is the CI and normal-clone shape', () => {
  const { root, primary } = makePair();
  try {
    const r = run(primary);
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '', `expected silence, got: ${r.stderr}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('with the symlink intact, warns BEFORE the fact and names the primary (the Bun shape)', () => {
  const { root, primary, worktree } = makePair();
  try {
    symlinkSync(join(primary, 'node_modules'), join(worktree, 'node_modules'));
    const r = run(worktree);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /node_modules is a SYMLINK/);
    assert.ok(r.stderr.includes(join(primary, 'node_modules')), 'names the primary tree');
    assert.match(r.stderr, /worktree:link/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('with a real node_modules and an EMPTY primary, names the `npm ci` aftermath and the repair', () => {
  const { root, primary, worktree } = makePair();
  try {
    rmSync(join(primary, 'node_modules'), { recursive: true, force: true });
    mkdirSync(join(worktree, 'node_modules'), { recursive: true });
    const r = run(worktree);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /EMPTY or missing/);
    assert.ok(r.stderr.includes(`cd ${primary} && npm install`), 'prints the exact repair command');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('with a real node_modules and a POPULATED primary, reports the detach', () => {
  const { root, worktree } = makePair();
  try {
    mkdirSync(join(worktree, 'node_modules'), { recursive: true });
    const r = run(worktree);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /its OWN node_modules/);
    assert.match(r.stderr, /npm run worktree:link/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('COUNTERFACTUAL: exit is 0 even when the gitdir pointer names a path that does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'warn-install-broken-'));
  try {
    writeFileSync(join(dir, '.git'), 'gitdir: /nonexistent/path/.git/worktrees/x\n');
    mkdirSync(join(dir, 'node_modules'));
    const r = run(dir);
    assert.equal(r.status, 0, 'the reporter must never be able to block an install');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
