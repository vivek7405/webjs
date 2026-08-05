/**
 * `scripts/link-worktree-deps.mjs` links a fresh worktree's dependencies to the
 * primary checkout's (#1287).
 *
 * The behaviours asserted here are the ones whose absence produced real
 * breakage while the script was written: linking only the ROOT `node_modules`
 * leaves a ws version skew that fails hundreds of assertions elsewhere, and a
 * naive implementation clobbered a git-tracked directory that happened to be
 * named `node_modules`.
 *
 * These drive the script as a subprocess against a synthetic "primary" and
 * "worktree" pair in a temp dir, so nothing touches the real checkout.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, lstatSync, readlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/link-worktree-deps.mjs', import.meta.url));

/** Build a fake primary checkout with the nested-tree shape this repo has. */
function makePrimary() {
  const root = mkdtempSync(join(tmpdir(), 'wjprimary-'));
  writeFileSync(join(root, 'package.json'), '{"name":"fake-primary"}');
  for (const d of [
    'node_modules/ws',
    'packages/server/node_modules/ws',
    'packages/ui/node_modules',
    'website/node_modules',
    'packages/core/dist',
  ]) mkdirSync(join(root, d), { recursive: true });
  // a third-party package with its OWN nested node_modules, which must never
  // be treated as a link target
  mkdirSync(join(root, 'node_modules/some-dep/node_modules/inner'), { recursive: true });
  return root;
}

function makeWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'wjworktree-'));
  writeFileSync(join(root, 'package.json'), '{"name":"fake-worktree"}');
  mkdirSync(join(root, 'packages/server'), { recursive: true });
  return root;
}

/** @returns {string} combined stdout of the script run inside `cwd` */
function run(cwd, primary) {
  return execFileSync(process.execPath, [SCRIPT, primary], { cwd, encoding: 'utf8' });
}

describe('link-worktree-deps (#1287)', () => {
  test('links the nested node_modules, not just the root', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      run(wt, primary);
      // The root alone is the trap this whole script exists to close.
      assert.ok(lstatSync(join(wt, 'node_modules')).isSymbolicLink(), 'root linked');
      assert.ok(
        lstatSync(join(wt, 'packages/server/node_modules')).isSymbolicLink(),
        'packages/server nested node_modules linked (the ws@7 vs ws@8 skew)',
      );
      assert.ok(lstatSync(join(wt, 'packages/ui/node_modules')).isSymbolicLink(), 'packages/ui linked');
      assert.ok(lstatSync(join(wt, 'website/node_modules')).isSymbolicLink(), 'website linked');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('links packages/core/dist, which is built and not committed', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      run(wt, primary);
      assert.ok(lstatSync(join(wt, 'packages/core/dist')).isSymbolicLink(), 'core dist linked');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('never descends into node_modules looking for more node_modules', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      const out = run(wt, primary);
      // Assert on what the script CLAIMS to have linked, not on the filesystem:
      // the worktree's `node_modules` is a symlink to the primary's, so a
      // third-party nested tree is visible THROUGH it either way, and an
      // existsSync check here passes for the wrong reason.
      const linkedPaths = out.split('\n').filter((l) => l.includes('linked ')).map((l) => l.trim());
      for (const l of linkedPaths) {
        assert.equal(
          (l.match(/node_modules/g) || []).length <= 1,
          true,
          `must not link a tree nested inside node_modules, got: ${l}`,
        );
      }
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('is idempotent and never clobbers a real install', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      // a REAL directory where a link would otherwise go, as if npm install ran
      mkdirSync(join(wt, 'node_modules/already-here'), { recursive: true });
      const out = run(wt, primary);
      assert.ok(!lstatSync(join(wt, 'node_modules')).isSymbolicLink(), 'real node_modules left as a directory');
      assert.ok(existsSync(join(wt, 'node_modules/already-here')), 'existing contents untouched');
      assert.match(out, /already present/, 'reports it skipped something');
      // second run changes nothing
      const out2 = run(wt, primary);
      assert.match(out2, /0 linked/, 're-running links nothing new');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('skips a source that does not exist rather than creating a dangling link', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      rmSync(join(primary, 'packages/core/dist'), { recursive: true, force: true });
      const out = run(wt, primary);
      assert.ok(!existsSync(join(wt, 'packages/core/dist')), 'no dist link created');
      let dangling = false;
      try { dangling = lstatSync(join(wt, 'packages/core/dist')).isSymbolicLink(); } catch { /* absent, good */ }
      assert.equal(dangling, false, 'a dangling link resolves more confusingly than a missing one');
      assert.match(out, /not built in the primary/, 'says why it skipped');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });

  test('defaultPrimary() resolves the real primary from this checkout', () => {
    // Every other test passes `primary` as argv[2], so without this the
    // git-derived default branch never executes at all.
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    // Run from the repo itself, so it must recognise the primary and no-op
    // rather than linking anything.
    assert.match(out, /this IS the primary checkout|linking from \//);
  });

  test('refuses to link a checkout to itself', () => {
    const primary = makePrimary();
    try {
      const out = run(primary, primary);
      assert.match(out, /this IS the primary checkout/);
      assert.ok(!lstatSync(join(primary, 'node_modules')).isSymbolicLink(), 'root untouched');
    } finally { rmSync(primary, { recursive: true, force: true }); }
  });

  test('leaves an existing symlink alone instead of stacking a second one', () => {
    const primary = makePrimary();
    const wt = makeWorktree();
    try {
      symlinkSync(join(primary, 'node_modules'), join(wt, 'node_modules'));
      run(wt, primary);
      assert.equal(readlinkSync(join(wt, 'node_modules')), join(primary, 'node_modules'));
      assert.ok(!existsSync(join(wt, 'node_modules/node_modules')), 'no link nested inside the existing one');
    } finally { rmSync(primary, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }); }
  });
});
