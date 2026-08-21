/**
 * `npm publish --workspace=<pkg>` ships the version in the WORKSPACE's
 * package.json, not the version the changelog file being processed is named
 * for. scripts/publish-npm.js took its idempotency check from the changelog
 * and its publish from the tree, so the two disagreed the moment an older
 * changelog file was republished through the `republish_paths` dispatch input
 * in .github/workflows/release.yml.
 *
 * That is not hypothetical. Republishing changelog/core/0.7.52.md shipped
 * 0.7.53 (the tree's version) while logging `published @webjsdev/core@0.7.52`,
 * and the next file in the batch then failed with
 * `E403 cannot publish over the previously published versions: 0.7.53`,
 * killing every remaining package under `set -e`.
 *
 * This locks the guard:
 *   1. A changelog version the workspace has moved past is SKIPPED (exit 0)
 *      with a message naming both versions.
 *   2. Counterfactual: a changelog version that MATCHES the workspace does
 *      NOT take that skip path, proving the guard is keyed on the mismatch
 *      rather than skipping everything.
 *
 * Both cases are offline. The guard deliberately runs before the `npm view`
 * registry call, since a version whose source is gone cannot be published
 * whatever the registry says, and that ordering is what keeps this test from
 * needing the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(ROOT, 'scripts/publish-npm.js');

/** The version @webjsdev/core actually carries in this tree. */
function treeVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8')).version;
}

/** Write a changelog file naming @webjsdev/core at `version`, run the script. */
function runFor(version) {
  const dir = mkdtempSync(join(tmpdir(), 'publish-npm-'));
  const file = join(dir, `${version}.md`);
  writeFileSync(
    file,
    `---\npackage: "@webjsdev/core"\nversion: ${version}\ndate: 2026-01-01T00:00:00.000Z\ncommit_count: 1\n---\n## Fixes\n\n- something\n`,
  );
  try {
    return spawnSync('node', [SCRIPT, file], { cwd: ROOT, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a changelog version the workspace has moved past is skipped, not published', () => {
  // 0.0.1 can never be the tree's version, so this is a guaranteed mismatch
  // without depending on which release the repo currently sits on.
  const r = runFor('0.0.1');
  assert.equal(r.status, 0, `expected a clean skip, got status ${r.status}\n${r.stderr}`);
  assert.match(r.stdout, /skip @webjsdev\/core@0\.0\.1/);
  // The message must name the version that WOULD have shipped, since that is
  // the fact the old log line hid.
  assert.ok(
    r.stdout.includes(treeVersion()),
    `the skip message should name the tree version ${treeVersion()}, got: ${r.stdout}`,
  );
});

test('counterfactual: a changelog version matching the workspace is not skipped by the guard', () => {
  const r = runFor(treeVersion());
  // It proceeds past the guard to the registry check, which may then skip as
  // already-published or fail offline. Either is fine. What must NOT appear is
  // the mismatch skip, which would mean the guard fires unconditionally and
  // the first assertion proves nothing.
  assert.doesNotMatch(
    r.stdout,
    /can no longer be published from this tree/,
    `the guard must not fire when the versions agree, got: ${r.stdout}`,
  );
});
