// Tests for the release-global-update PostToolUse hook
// (.claude/hooks/release-global-update.sh). After a RELEASE PR (chore/release-*
// branch or "chore: release" title) merges via `gh pr merge`, it injects a
// reminder to run `npm update -g webjsdev` + `bun add -g webjsdev` once the
// publish lands. A normal PR merge, a non-merge command, and the escape hatch
// produce no reminder. It never blocks the tool (always exits 0).
//
// The hook reads the PR title over the REST pulls endpoint (`gh api`), NOT
// `gh pr view`, because every `gh pr *` porcelain command spends the GraphQL
// point budget that agent sessions here exhaust. A fake `gh` on PATH stubs that
// call so the test is offline and deterministic.
//
// The fake also covers a trap the real environment has: a `gh` earlier on PATH
// may be a WRAPPER that prints a banner to stdout before exec'ing the real
// binary (a mise shim does exactly this locally). That banner lands inside any
// `$(gh ...)` capture, so the hook asks for a single scalar and takes the last
// line instead of capturing JSON and parsing it. `bannerLine` exercises that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.claude/hooks/release-global-update.sh',
);

/**
 * A fake `gh` on PATH emulating `gh api <endpoint> --jq <expr>`: it reads the
 * `--jq` expression and prints the matching scalar, the way the real command
 * does. `bannerLine`, when set, is printed to STDOUT first, reproducing a PATH
 * wrapper that announces itself before running.
 */
function fakeGhDir(headRefName, title, bannerLine = '') {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-relhook-'));
  const gh = join(dir, 'gh');
  writeFileSync(
    gh,
    [
      '#!/usr/bin/env bash',
      bannerLine ? `echo ${JSON.stringify(bannerLine)}` : '',
      'expr=""',
      'prev=""',
      'for a in "$@"; do',
      '  if [ "$prev" = "--jq" ]; then expr="$a"; fi',
      '  prev="$a"',
      'done',
      'case "$expr" in',
      `  *.title*) echo ${JSON.stringify(title)} ;;`,
      `  *head.ref*) echo ${JSON.stringify(headRefName)} ;;`,
      '  *) ;;',
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(gh, 0o755);
  return dir;
}

function runHook(command, { headRefName = '', title = '', bannerLine = '', env = {} } = {}) {
  const ghDir = fakeGhDir(headRefName, title, bannerLine);
  try {
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${ghDir}${delimiter}${process.env.PATH}`, ...env },
    });
    return { code: r.status, out: (r.stdout || '') };
  } finally {
    rmSync(ghDir, { recursive: true, force: true });
  }
}

test('reminds after a chore/release-* branch PR merge', () => {
  const { code, out } = runHook('gh pr merge 839 --squash --admin --delete-branch', {
    headRefName: 'chore/release-2026-07-08b',
    title: 'chore: release server 0.8.43',
  });
  assert.equal(code, 0);
  assert.match(out, /npm update -g webjsdev/, 'reminds about npm global update');
  assert.match(out, /bun add -g webjsdev/, 'reminds about bun global add');
  assert.match(out, /mise use -g npm:webjsdev/, 'reminds about the mise-shimmed CLI update');
});

test('reminds when the title is "chore: release" even if the branch differs', () => {
  const { out } = runHook('gh pr merge 1 --squash', {
    headRefName: 'some-branch',
    title: 'chore: release cli 0.10.32',
  });
  assert.match(out, /npm update -g webjsdev/);
});

test('does NOTHING for a normal (non-release) PR merge', () => {
  const { code, out } = runHook('gh pr merge 840 --squash', {
    headRefName: 'feat/thing',
    title: 'feat: a normal feature',
  });
  assert.equal(code, 0);
  assert.doesNotMatch(out, /webjsdev/, 'no reminder for a non-release PR');
});

test('does NOTHING for a chore/release-* branch that is not a package release (the #841 false positive)', () => {
  const { code, out } = runHook('gh pr merge 841 --squash --admin --delete-branch', {
    headRefName: 'chore/release-hook-mise',
    title: 'chore: also refresh the mise-shimmed webjs CLI after a release',
  });
  assert.equal(code, 0);
  assert.doesNotMatch(out, /webjsdev/, 'a chore/release-* branch with a non-release title must not fire');
});

test('survives a `gh` wrapper that prints a banner to stdout before the payload', () => {
  const { code, out } = runHook('gh pr merge 839 --squash', {
    headRefName: 'chore/release-2026-07-08b',
    title: 'chore: release server 0.8.43',
    bannerLine: 'mise ~/.config/mise/config.toml tools: gh@2.97.0',
  });
  assert.equal(code, 0);
  assert.match(out, /npm update -g webjsdev/, 'a stdout banner must not swallow the title');
});

test('a banner alone, with no title, does not fire the reminder', () => {
  const { code, out } = runHook('gh pr merge 839 --squash', {
    headRefName: '',
    title: '',
    bannerLine: 'mise ~/.config/mise/config.toml tools: gh@2.97.0',
  });
  assert.equal(code, 0);
  assert.doesNotMatch(out, /webjsdev/, 'the banner must never be mistaken for a release title');
});

test('does NOTHING for a command that is not `gh pr merge`', () => {
  const { out } = runHook('git status', { headRefName: 'chore/release-x', title: 'chore: release x' });
  assert.doesNotMatch(out, /webjsdev/);
});

test('honours the WEBJS_NO_RELEASE_GLOBAL_UPDATE escape hatch', () => {
  const { out } = runHook('gh pr merge 839 --squash', {
    headRefName: 'chore/release-2026-07-08b',
    title: 'chore: release server 0.8.43',
    env: { WEBJS_NO_RELEASE_GLOBAL_UPDATE: '1' },
  });
  assert.doesNotMatch(out, /webjsdev/);
});
