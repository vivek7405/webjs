// Tests for the FRAMEWORK's require-scaffold-with-src PreToolUse hook
// (.claude/hooks/require-scaffold-with-src.sh). It is the scaffold twin of
// require-docs-with-src.sh: a `git commit` that stages framework-FEATURE
// source (packages/(core|server|cli)/src/**) with NO scaffold surface
// (packages/cli/templates/** or packages/cli/lib/**) exits 2 to block it,
// with a WEBJS_NO_SCAFFOLD_GATE=1 escape hatch.
//
// Each case builds a throwaway repo, stages a shape of change, feeds the
// hook the commit payload, and asserts the exit code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.claude/hooks/require-scaffold-with-src.sh',
);

/** Init a throwaway monorepo-shaped repo with a baseline commit. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-scaffoldgate-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  for (const d of [
    'packages/core/src', 'packages/server/src', 'packages/cli/src',
    'packages/cli/lib', 'gallery/app/features/x',
    'packages/editors/vscode/src', '.agents/skills/webjs/references',
  ]) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'packages/core/src/x.js'), 'v1\n');
  writeFileSync(join(dir, 'packages/cli/lib/create.js'), 'gen1\n');
  writeFileSync(join(dir, 'README.md'), 'docs\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return { dir, git };
}

function runHook(dir, env = {}) {
  const r = spawnSync('bash', [HOOK], {
    cwd: dir,
    input: JSON.stringify({ tool_input: { command: 'git commit -m x' } }),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return r.status;
}

test('blocks a feature-src commit that stages no scaffold surface', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/x.js'), 'v2\n');
    git('add', 'packages/core/src/x.js');
    assert.equal(runHook(dir), 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The gallery is the canonical repo-root `gallery/` app since #1370, not the
// old `packages/cli/templates/gallery/` copy (which prepack now generates and
// postpack deletes), so the gate has to recognise a demo at the new path.
test('allows a feature-src commit that also stages a gallery demo', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/server/src/y.js'), 'v2\n');
    writeFileSync(join(dir, 'gallery/app/features/x/page.ts'), 'demo\n');
    git('add', '-A');
    assert.equal(runHook(dir), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('allows a feature-src commit that also stages the agent skill (the durable teacher)', () => {
  // The skill at .agents/skills/webjs/ is the only teaching surface that survives
  // gallery:clear, so a skill update satisfies the gate the same as a gallery demo.
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/x.js'), 'v2\n');
    writeFileSync(join(dir, '.agents/skills/webjs/references/components.md'), '# taught here\n');
    git('add', '-A');
    assert.equal(runHook(dir), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('allows a feature-src commit that also stages a generator (cli/lib)', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/x.js'), 'v2\n');
    writeFileSync(join(dir, 'packages/cli/lib/create.js'), 'gen2\n');
    git('add', '-A');
    assert.equal(runHook(dir), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('allows a scaffold-only commit (no feature src touched)', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/cli/lib/create.js'), 'gen2\n');
    git('add', 'packages/cli/lib/create.js');
    assert.equal(runHook(dir), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('allows an excluded-package src commit (editor plugin does not shape the scaffold)', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/editors/vscode/src/z.js'), 'v2\n');
    git('add', 'packages/editors/vscode/src/z.js');
    assert.equal(runHook(dir), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('escape hatch WEBJS_NO_SCAFFOLD_GATE=1 allows a feature-src-only commit', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/x.js'), 'v2\n');
    git('add', 'packages/core/src/x.js');
    assert.equal(runHook(dir, { WEBJS_NO_SCAFFOLD_GATE: '1' }), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ignores a non-commit git command', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'packages/core/src/x.js'), 'v2\n');
    git('add', 'packages/core/src/x.js');
    const r = spawnSync('bash', [HOOK], {
      cwd: dir,
      input: JSON.stringify({ tool_input: { command: 'git status' } }),
      env: process.env,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
