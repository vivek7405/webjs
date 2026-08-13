// Tests for the FRAMEWORK's OWN require-tests-with-src PreToolUse hook
// (.claude/hooks/require-tests-with-src.sh), the stricter self-gate the
// monorepo runs on itself. Unlike the scaffolded hook (which warns by
// default, covered in require-tests-with-src.test.mjs), this one is a
// HARD floor: a `git commit` that stages packages/*/src/** with no test,
// or that net-removes test lines, exits 2 to block it.
//
// Each case builds a throwaway git repo, stages a specific shape of
// change, and feeds the hook the commit payload, asserting the exit code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.claude/hooks/require-tests-with-src.sh',
);

/** Init a throwaway repo with one src file and one test file committed. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-fw-testgate-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'packages/core/src'), { recursive: true });
  mkdirSync(join(dir, 'packages/core/test'), { recursive: true });
  writeFileSync(join(dir, 'packages/core/test/x.test.js'), 'a\nb\nc\nd\ne\n');
  writeFileSync(join(dir, 'packages/core/src/x.js'), 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, git };
}

/** Run the hook in `dir` with a commit payload and the given env. */
function runHookFull(dir, env = {}) {
  return spawnSync('bash', [HOOK], {
    cwd: dir,
    input: JSON.stringify({ tool_input: { command: 'git commit -m x' } }),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

/** Just the exit code, for the blocking cases. */
function runHook(dir, env = {}) {
  return runHookFull(dir, env).status;
}

test('framework hook blocks a commit that stages src with no test', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/x.js'), 'v2\n');
    git('add', 'packages/core/src/x.js');
    assert.equal(runHook(dir), 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('framework hook allows a commit that stages src AND a test', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/x.js'), 'v2\n');
    writeFileSync(join(dir, 'packages/core/test/x.test.js'), 'a\nb\nc\nd\ne\nf\n');
    git('add', '-A');
    assert.equal(runHook(dir), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('framework hook allows a docs-only commit (no src touched)', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'README.md'), 'docs\n');
    git('add', 'README.md');
    assert.equal(runHook(dir), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('framework hook blocks a commit that net-removes test lines alongside src', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/x.js'), 'v3\n');
    writeFileSync(join(dir, 'packages/core/test/x.test.js'), 'a\n'); // shrink 5 -> 1
    git('add', '-A');
    assert.equal(runHook(dir), 2);
    // The override lets an intentional test refactor through.
    assert.equal(runHook(dir, { WEBJS_ALLOW_TEST_REMOVAL: '1' }), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('framework hook: WEBJS_NO_TEST_GATE=1 skips the gate entirely', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/x.js'), 'v2\n');
    git('add', 'packages/core/src/x.js');
    assert.equal(runHook(dir, { WEBJS_NO_TEST_GATE: '1' }), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('framework hook does not fire on a non-commit git command', () => {
  const { dir } = makeRepo();
  try {
    const r = spawnSync('bash', [HOOK], {
      cwd: dir,
      input: JSON.stringify({ tool_input: { command: 'git status' } }),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


/**
 * The client-facing reminder has to survive the #1365 split.
 *
 * The hook selects browser-facing source by path, and the split moved that code
 * out of `component.js` and `slot.js` into `component/` and `slot/`. The
 * pattern matched the old filenames, so a change to the component lifecycle or
 * to slot projection stopped raising the "a unit test alone is not sufficient"
 * reminder, silently, for the whole PR that did the moving.
 */
test('the client-facing reminder fires for the split component/ and slot/ trees', () => {
  for (const f of [
    'packages/core/src/component/lifecycle.js',
    'packages/core/src/slot/project.js',
    'packages/core/src/component.js',
    'packages/core/src/slot.js',
  ]) {
    const { dir, git } = makeRepo();
    try {
      const abs = join(dir, f);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, 'v2\n');
      // stage a test too, so the gate does not block and we can read the output
      writeFileSync(join(dir, 'packages/core/test/x.test.js'), 'a\nb\nc\nd\nf\n');
      git('add', '-A');
      const r = runHookFull(dir);
      assert.match(
        r.stdout, /Client\/browser-facing source changed/,
        `${f} should raise the browser-coverage reminder`,
      );
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the client-facing reminder does NOT fire for a type declaration', () => {
  // `component.d.ts` carries no runtime, so it cannot need browser coverage.
  // An unanchored `component[./]` matched it.
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/component.d.ts'), 'export {};\n');
    writeFileSync(join(dir, 'packages/core/test/x.test.js'), 'a\nb\nc\nd\nf\n');
    git('add', '-A');
    const r = runHookFull(dir);
    assert.doesNotMatch(r.stdout, /Client\/browser-facing source changed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
