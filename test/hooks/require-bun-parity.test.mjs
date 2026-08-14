// Tests for the framework's Bun-parity PreToolUse gate
// (.claude/hooks/require-bun-parity-with-runtime-src.sh). On a `git commit`
// that stages RUNTIME-SENSITIVE framework source (the serializer, listener,
// request / CSRF / action / SSR path, streams, crypto, auth/session/cors)
// with NO test/bun/** test, it HARD-BLOCKS (exit 2). It allows the commit
// when a test/bun file is staged, when WEBJS_BUN_VERIFIED=1, or when the
// source is not runtime-sensitive.
//
// Each case builds a throwaway repo shaped like the framework monorepo,
// stages a specific change, and feeds the hook the commit payload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.claude/hooks/require-bun-parity-with-runtime-src.sh',
);

/** Init a throwaway monorepo-shaped repo with a committed baseline. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-bun-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'packages/server/src'), { recursive: true });
  mkdirSync(join(dir, 'test/bun'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'docs\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, git };
}

function w(dir, rel, body = 'export const x = 1\n') {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

/** Run the hook in `dir` with a commit payload + env. */
function runHook(dir, env = {}) {
  return spawnSync('bash', [HOOK], {
    cwd: dir,
    input: JSON.stringify({ tool_input: { command: 'git commit -m x' } }),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('runtime-sensitive src with no test/bun BLOCKS (exit 2)', () => {
  const { dir, git } = makeRepo();
  try {
    w(dir, 'packages/server/src/csrf.js');
    git('add', 'packages/server/src/csrf.js');
    const r = runHook(dir);
    assert.equal(r.status, 2, 'a runtime-sensitive change with no Bun test must block');
    assert.match(r.stderr, /BLOCKED: this commit changes runtime-sensitive source/);
    assert.match(r.stderr, /csrf\.js/);
    assert.match(r.stderr, /WEBJS_BUN_VERIFIED=1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the SPLIT ssr/ and dev/ trees trip the gate, not just the barrels (#1365)', () => {
  // The #1365 split moved the real code out of `src/ssr.js` and `src/dev.js`
  // into `src/ssr/*.js` and `src/dev/*.js`, leaving 30-line barrels behind.
  // The gate matched on the monolith FILENAMES, so every runtime-sensitive
  // edit the split produced sailed past it: the same change that blocks on
  // main stopped blocking here, silently.
  for (const f of [
    'packages/server/src/ssr/render.js',
    'packages/server/src/ssr/head.js',
    'packages/server/src/ssr/responses.js',
    'packages/server/src/dev/handler.js',
    'packages/server/src/dev/serve.js',
  ]) {
    const { dir, git } = makeRepo();
    try {
      w(dir, f);
      git('add', f);
      const r = runHook(dir);
      assert.equal(r.status, 2, `${f} must trip the Bun-parity gate`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a barrel-shaped sibling that is NOT runtime-sensitive still passes', () => {
  // The widened pattern must not turn into "anything under a directory whose
  // name starts with ssr or dev". `component-scanner.js` and
  // `component-elision.js` sit next to the runtime path and are not on it.
  for (const f of [
    'packages/server/src/component-scanner.js',
    'packages/server/src/component-elision.js',
  ]) {
    const { dir, git } = makeRepo();
    try {
      w(dir, f);
      git('add', f);
      const r = runHook(dir);
      assert.equal(r.status, 0, `${f} is not runtime-sensitive and must not block`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the request path (ssr / actions / dev / auth) all trip the gate', () => {
  for (const f of [
    'packages/server/src/ssr.js',
    'packages/server/src/actions.js',
    'packages/server/src/dev.js',
    'packages/server/src/auth.js',
    'packages/server/src/conditional-get.js',
    'packages/server/src/json.js',
  ]) {
    const { dir, git } = makeRepo();
    try {
      w(dir, f);
      git('add', f);
      assert.equal(runHook(dir).status, 2, `${f} should be runtime-sensitive`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('staging a test/bun file alongside ALLOWS the commit (exit 0)', () => {
  const { dir, git } = makeRepo();
  try {
    w(dir, 'packages/server/src/csrf.js');
    w(dir, 'test/bun/csrf.mjs', '// cross-runtime assertion\n');
    git('add', 'packages/server/src/csrf.js', 'test/bun/csrf.mjs');
    assert.equal(runHook(dir).status, 0, 'a staged test/bun test satisfies the gate');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('WEBJS_BUN_VERIFIED=1 ACKNOWLEDGES existing coverage (exit 0)', () => {
  const { dir, git } = makeRepo();
  try {
    w(dir, 'packages/server/src/csrf.js');
    git('add', 'packages/server/src/csrf.js');
    // Counterfactual: the SAME input blocks without the ack flag.
    assert.equal(runHook(dir).status, 2);
    assert.equal(runHook(dir, { WEBJS_BUN_VERIFIED: '1' }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a NON-runtime-sensitive src change is not gated (exit 0)', () => {
  const { dir, git } = makeRepo();
  try {
    w(dir, 'packages/server/src/check.js');
    git('add', 'packages/server/src/check.js');
    assert.equal(runHook(dir).status, 0, 'check.js is not a runtime-divergence surface');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a docs-only commit (no src) is not gated (exit 0)', () => {
  const { dir, git } = makeRepo();
  try {
    w(dir, 'AGENTS.md', '# docs\n');
    git('add', 'AGENTS.md');
    assert.equal(runHook(dir).status, 0, 'no packages/*/src change, so no gate');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a non-commit Bash call is ignored (exit 0)', () => {
  const { dir, git } = makeRepo();
  try {
    w(dir, 'packages/server/src/csrf.js');
    git('add', 'packages/server/src/csrf.js');
    const r = spawnSync('bash', [HOOK], {
      cwd: dir,
      input: JSON.stringify({ tool_input: { command: 'git status' } }),
      env: process.env,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, 'the gate only fires on git commit');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
