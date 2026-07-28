// The require-worktree-for-edits hook blocks tracked-file edits in a repo's
// PRIMARY checkout and allows everything else: the same file in a linked
// worktree, untracked files, gitignored files, non-repo paths, and the
// WEBJS_NO_WORKTREE_GATE=1 escape hatch. AGENTS.md: one task per git
// worktree, ALWAYS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.claude/hooks/require-worktree-for-edits.sh'
);

function runHook(filePath, env = {}) {
  return spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wt-gate-'));
  const g = (cmd) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'pipe' });
  g('init -q -b main');
  g('config user.email t@t');
  g('config user.name t');
  writeFileSync(join(dir, 'tracked.txt'), 'hello\n');
  writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
  g('add .');
  g('commit -q -m init');
  return dir;
}

test('tracked file in the PRIMARY checkout is blocked (counterfactual: the gate fires)', () => {
  const repo = makeRepo();
  try {
    const r = runHook(join(repo, 'tracked.txt'));
    assert.equal(r.status, 2, `expected block, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /PRIMARY checkout/);
    assert.match(r.stderr, /git worktree add/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('the same tracked file in a LINKED worktree is allowed', () => {
  const repo = makeRepo();
  const wt = `${repo}-wt`;
  try {
    execSync(`git worktree add -q -b feat/x ${wt}`, { cwd: repo, stdio: 'pipe' });
    const r = runHook(join(wt, 'tracked.txt'));
    assert.equal(r.status, 0, r.stderr);
  } finally {
    execSync(`git worktree remove --force ${wt}`, { cwd: repo, stdio: 'pipe' });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('an untracked file in the primary checkout is allowed', () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo, 'scratch-note.md'), 'x');
    assert.equal(runHook(join(repo, 'scratch-note.md')).status, 0);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('a gitignored file in the primary checkout is allowed', () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo, 'ignored.txt'), 'x');
    assert.equal(runHook(join(repo, 'ignored.txt')).status, 0);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('a path outside any git repo is allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wt-norepo-'));
  try {
    writeFileSync(join(dir, 'f.txt'), 'x');
    assert.equal(runHook(join(dir, 'f.txt')).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('WEBJS_NO_WORKTREE_GATE=1 bypasses the block', () => {
  const repo = makeRepo();
  try {
    assert.equal(runHook(join(repo, 'tracked.txt'), { WEBJS_NO_WORKTREE_GATE: '1' }).status, 0);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('a nonexistent-directory path is allowed (new file in a new dir elsewhere)', () => {
  assert.equal(runHook('/nonexistent-dir-xyz/f.txt').status, 0);
});
