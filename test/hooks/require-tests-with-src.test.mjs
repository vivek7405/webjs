// Tests for the SCAFFOLDED require-tests-with-src PreToolUse hook
// (packages/cli/templates/.claude/hooks/require-tests-with-src.sh, the
// one shipped into every user app by `webjs create`). The hook reads a
// tool-call payload on stdin and, for a `git commit` that stages app
// code (app/, modules/, components/, lib/) without a test, WARNS by
// default (exit 0 + an additionalContext message) and HARD-BLOCKS
// (exit 2) only when WEBJS_TEST_GATE=block opts in.
//
// Each case builds a throwaway git repo, stages a specific shape of
// change, and feeds the hook the commit payload, asserting the exit
// code and (where relevant) the emitted stdout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The scaffolded hook (templates/), NOT the framework's own self-gate.
const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../packages/cli/templates/.claude/hooks/require-tests-with-src.sh',
);

/** Init a throwaway app-shaped repo with one committed baseline file. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-app-testgate-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'modules/posts'), { recursive: true });
  mkdirSync(join(dir, 'components'), { recursive: true });
  mkdirSync(join(dir, 'test/posts'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'docs\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, git };
}

/** Run the hook in `dir` with a commit payload and the given env. */
function runHook(dir, env = {}) {
  const r = spawnSync('bash', [HOOK], {
    cwd: dir,
    input: JSON.stringify({ tool_input: { command: 'git commit -m x' } }),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return r; // { status, stdout, stderr }
}

test('default: app code staged with no test WARNS and allows the commit', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'modules/posts/create.server.ts'), 'export const x = 1\n');
    git('add', 'modules/posts/create.server.ts');
    const r = runHook(dir);
    assert.equal(r.status, 0, 'warn mode must allow the commit (exit 0)');
    // The warning rides additionalContext (the JSON the hook prints to stdout).
    assert.match(r.stdout, /additionalContext/);
    assert.match(r.stdout, /stages app code .* with no test/);
    assert.match(r.stdout, /WEBJS_TEST_GATE=block/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('WEBJS_TEST_GATE=block: app code staged with no test BLOCKS (exit 2)', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'modules/posts/create.server.ts'), 'export const x = 1\n');
    git('add', 'modules/posts/create.server.ts');
    const r = runHook(dir, { WEBJS_TEST_GATE: 'block' });
    assert.equal(r.status, 2, 'hard mode must block (exit 2)');
    assert.match(r.stderr, /BLOCKED: this commit changes app code but stages no test/);
    // Counterfactual: the SAME input is allowed without the env opt-in.
    assert.equal(runHook(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('WEBJS_TEST_GATE=hard is an accepted alias for block', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'modules/posts/create.server.ts'), 'export const x = 1\n');
    git('add', 'modules/posts/create.server.ts');
    assert.equal(runHook(dir, { WEBJS_TEST_GATE: 'hard' }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('app code staged WITH a test: exit 0, no test-gate warning', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'modules/posts/create.server.ts'), 'export const x = 1\n');
    writeFileSync(join(dir, 'test/posts/create.test.ts'), 'test\n');
    git('add', '-A');
    const r = runHook(dir);
    assert.equal(r.status, 0);
    // The no-test warning must not fire when a test is present.
    assert.doesNotMatch(r.stdout, /with no test/);
    // Same under the hard env (a present test passes regardless).
    assert.equal(runHook(dir, { WEBJS_TEST_GATE: 'block' }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('component change WITH a test still warns to add browser coverage', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'components/widget.ts'), 'export const x = 1\n');
    writeFileSync(join(dir, 'test/posts/widget.test.ts'), 'test\n');
    git('add', '-A');
    const r = runHook(dir);
    assert.equal(r.status, 0);
    // The interactive-component reminder fires (a unit test alone is not enough).
    assert.match(r.stdout, /component code/);
    assert.match(r.stdout, /browser test/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('component change with NO test warns about the missing test (subsumes the reminder)', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'components/widget.ts'), 'export const x = 1\n');
    git('add', 'components/widget.ts');
    const r = runHook(dir);
    assert.equal(r.status, 0);
    // A missing test subsumes the component reminder: one warning, valid JSON.
    assert.match(r.stdout, /with no test/);
    assert.doesNotMatch(r.stdout, /Reminder: this commit changes component code/);
    assert.doesNotThrow(() => JSON.parse(r.stdout), 'the emitted JSON must be a single valid object');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('allows a docs-only commit (no app code touched)', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'README.md'), 'more docs\n');
    git('add', 'README.md');
    const r = runHook(dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '', 'no warning for a non-app-code commit');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('WEBJS_NO_TEST_GATE=1 skips the gate entirely (no warn, no block)', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'modules/posts/create.server.ts'), 'export const x = 1\n');
    git('add', 'modules/posts/create.server.ts');
    const r = runHook(dir, { WEBJS_NO_TEST_GATE: '1' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '', 'skip env must emit nothing');
    // It even overrides the hard gate.
    const r2 = runHook(dir, { WEBJS_NO_TEST_GATE: '1', WEBJS_TEST_GATE: 'block' });
    assert.equal(r2.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('does not fire on a non-commit git command', () => {
  const { dir } = makeRepo();
  try {
    const r = spawnSync('bash', [HOOK], {
      cwd: dir,
      input: JSON.stringify({ tool_input: { command: 'git status' } }),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
