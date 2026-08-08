// Tests for the FRAMEWORK's cleanup-merged-worktree PostToolUse hook
// (.claude/hooks/cleanup-merged-worktree.sh). After a `gh pr merge`, it sweeps
// the repo's git worktrees and removes the ones whose branch is MERGED (an
// ancestor of the base ref, or a merged GitHub PR) AND whose tree is clean,
// while KEEPING anything dirty, unmerged, the current directory, or the primary
// checkout. It never blocks the tool (always exits 0).
//
// Each case builds a throwaway repo with real worktrees, feeds the hook a
// PostToolUse payload, and asserts which worktrees survive. Merges are made with
// real `git merge` so the ancestor-of-base signal fires WITHOUT needing gh (a
// no-remote temp repo makes `gh pr list` a harmless no-op).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.claude/hooks/cleanup-merged-worktree.sh',
);

/** Init a throwaway repo (primary on `main`) with one baseline commit. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-wtcleanup-'));
  const main = join(dir, 'main');
  const git = (...args) => execFileSync('git', args, { cwd: main, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', main], { stdio: 'pipe' });
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, main, git };
}

/** Add a worktree on a new branch with one commit; optionally merge it into main. */
function addWorktree({ git, dir, main }, name, { merged, dirty } = {}) {
  const path = join(dir, name);
  git('branch', name);
  git('worktree', 'add', '-q', path, name);
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'work'], { cwd: path, stdio: 'pipe' });
  if (merged) git('merge', '-q', '--no-ff', name, '-m', `merge ${name}`);
  if (dirty) writeFileSync(join(path, 'scratch.txt'), 'uncommitted\n');
  return path;
}

/**
 * A fake `gh` on PATH emulating the REST call the hook makes for squash merges,
 * `gh api "repos/{owner}/{repo}/pulls?...&head={owner}:<branch>&..." --jq ...`.
 * It prints a PR number when `<branch>` is in `mergedBranches`, and nothing
 * otherwise. `bannerLine`, when set, is printed to STDOUT first, reproducing a
 * PATH wrapper (a mise shim does this locally) that would otherwise land inside
 * the hook's `$(gh ...)` capture.
 */
function fakeGhDir(mergedBranches, bannerLine = '') {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-wtgh-'));
  const gh = join(dir, 'gh');
  writeFileSync(
    gh,
    [
      '#!/usr/bin/env bash',
      bannerLine ? `echo ${JSON.stringify(bannerLine)}` : '',
      'for a in "$@"; do',
      '  case "$a" in',
      '    *head=*)',
      '      br="${a##*:}"; br="${br%%&*}"',
      `      for m in ${mergedBranches.map((b) => `'${b}'`).join(' ')}; do`,
      '        if [ "$br" = "$m" ]; then echo 4242; exit 0; fi',
      '      done ;;',
      '  esac',
      'done',
      '',
    ].join('\n'),
  );
  chmodSync(gh, 0o755);
  return dir;
}

/** Run the hook with a given command, from a given cwd. Returns {code, out}. */
function runHook(command, cwd, { mergedBranches = null, bannerLine = '' } = {}) {
  // Default: no stub, so the no-remote temp repo makes gh a harmless no-op
  // regardless of host auth, and only the ancestor-of-base signal fires.
  const ghDir = mergedBranches ? fakeGhDir(mergedBranches, bannerLine) : null;
  const env = { ...process.env, GH_NO_UPDATE_NOTIFIER: '1' };
  if (ghDir) env.PATH = `${ghDir}${delimiter}${process.env.PATH}`;
  const r = spawnSync('bash', [HOOK], {
    cwd,
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('removes a merged + clean worktree, keeps dirty and unmerged ones', () => {
  const repo = makeRepo();
  const clean = addWorktree(repo, 'feat-merged-clean', { merged: true });
  const dirty = addWorktree(repo, 'feat-merged-dirty', { merged: true, dirty: true });
  const unmerged = addWorktree(repo, 'feat-unmerged', {});

  const { code } = runHook('gh pr merge 1 --squash --admin --delete-branch', repo.main);

  assert.equal(code, 0, 'hook never blocks the tool');
  assert.ok(!existsSync(clean), 'merged + clean worktree is removed');
  assert.ok(existsSync(dirty), 'merged but dirty worktree is kept');
  assert.ok(existsSync(unmerged), 'unmerged worktree is kept');
  assert.ok(existsSync(repo.main), 'primary checkout is never removed');
});

// A squash merge leaves the branch NOT an ancestor of base, so the git signal
// cannot see it and the REST lookup is the only thing that can. This is the path
// that silently stopped working while it went through GraphQL: an exhausted
// point budget returned nothing, every squash-merged branch read as unmerged,
// and its worktree leaked, which is the failure the hook exists to prevent.
test('removes a squash-merged worktree that git alone cannot see as merged', () => {
  const repo = makeRepo();
  const squashed = addWorktree(repo, 'feat-squashed', {});
  const unmerged = addWorktree(repo, 'feat-really-unmerged', {});

  // Neither branch is an ancestor of main; only `feat-squashed` has a merged PR.
  const { code } = runHook('gh pr merge 1 --squash', repo.main, {
    mergedBranches: ['feat-squashed'],
  });

  assert.equal(code, 0);
  assert.ok(!existsSync(squashed), 'a squash-merged branch is detected over REST and removed');
  assert.ok(existsSync(unmerged), 'a branch with no merged PR is still kept');
});

test('squash-merge detection survives a `gh` wrapper that banners to stdout', () => {
  const repo = makeRepo();
  const squashed = addWorktree(repo, 'feat-squashed', {});

  const { code } = runHook('gh pr merge 1 --squash', repo.main, {
    mergedBranches: ['feat-squashed'],
    bannerLine: 'mise ~/.config/mise/config.toml tools: gh@2.97.0',
  });

  assert.equal(code, 0);
  assert.ok(!existsSync(squashed), 'a stdout banner must not hide the PR number');
});

test('a banner with no PR number does not make an unmerged branch look merged', () => {
  const repo = makeRepo();
  const unmerged = addWorktree(repo, 'feat-unmerged', {});

  const { code } = runHook('gh pr merge 1 --squash', repo.main, {
    mergedBranches: [],
    bannerLine: 'mise ~/.config/mise/config.toml tools: gh@2.97.0',
  });

  assert.equal(code, 0);
  assert.ok(existsSync(unmerged), 'banner text must never be read as a PR number');
});

test('does nothing on a command that is not `gh pr merge`', () => {
  const repo = makeRepo();
  const clean = addWorktree(repo, 'feat-merged-clean', { merged: true });

  const { code } = runHook('git status', repo.main);

  assert.equal(code, 0);
  assert.ok(existsSync(clean), 'a non-merge command leaves worktrees untouched');
});

test('never removes the worktree the merge was run from (current directory)', () => {
  const repo = makeRepo();
  const clean = addWorktree(repo, 'feat-merged-clean', { merged: true });

  // Run the hook FROM inside the merged worktree.
  const { code } = runHook('gh pr merge 1 --squash', clean);

  assert.equal(code, 0);
  assert.ok(existsSync(clean), 'the current worktree is kept even when merged + clean');
});

test('honours the WEBJS_NO_WORKTREE_CLEANUP escape hatch', () => {
  const repo = makeRepo();
  const clean = addWorktree(repo, 'feat-merged-clean', { merged: true });

  const r = spawnSync('bash', [HOOK], {
    cwd: repo.main,
    input: JSON.stringify({ tool_input: { command: 'gh pr merge 1 --squash' } }),
    encoding: 'utf8',
    env: { ...process.env, WEBJS_NO_WORKTREE_CLEANUP: '1' },
  });

  assert.equal(r.status, 0);
  assert.ok(existsSync(clean), 'the escape hatch disables all cleanup');
});
