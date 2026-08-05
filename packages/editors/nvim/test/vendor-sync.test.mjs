/**
 * Drift guard for the vendored @webjsdev/intellisense inside webjs.nvim (#398).
 *
 * webjs.nvim bundles a verbatim copy of the standalone intellisense (it has no
 * install-time build step) and points tsserver at it. That copy MUST stay in
 * sync with `packages/editors/intellisense`, both its `src/` tree and its
 * manifest apart from the `version`. This test fails if either drifts, telling
 * you to re-run `node packages/editors/nvim/scripts/vendor-intellisense.mjs`
 * then `git add -f packages/editors/nvim/vendor`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(DIR, '../../intellisense/src');
const VENDORED = join(DIR, '../vendor/node_modules/@webjsdev/intellisense/src');

function walk(root, base = root, out = []) {
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full));
  }
  return out;
}

test('vendored intellisense src is byte-identical to packages/editors/intellisense/src', () => {
  assert.ok(existsSync(VENDORED), 'vendored src dir exists (run scripts/vendor-intellisense.mjs)');
  const srcFiles = walk(SRC).sort();
  const vendoredFiles = walk(VENDORED).sort();
  assert.deepEqual(vendoredFiles, srcFiles, 'same file set (re-run the vendor script)');
  for (const f of srcFiles) {
    assert.equal(
      readFileSync(join(VENDORED, f), 'utf8'),
      readFileSync(join(SRC, f), 'utf8'),
      `vendored ${f} drifted; re-run node packages/editors/nvim/scripts/vendor-intellisense.mjs`,
    );
  }
});

test('vendored package.json main resolves to the bundled entry', () => {
  const pkg = JSON.parse(
    readFileSync(join(DIR, '../vendor/node_modules/@webjsdev/intellisense/package.json'), 'utf8'),
  );
  assert.equal(pkg.name, '@webjsdev/intellisense');
  assert.ok(existsSync(join(DIR, '../vendor/node_modules/@webjsdev/intellisense', pkg.main)), 'main entry exists');
});

test('vendored package.json matches the source manifest apart from its version', () => {
  // The script copies the whole manifest, but this only ever checked `name`
  // and `main`, so an edit to any other field left a stale copy that ships to
  // the standalone webjs.nvim repo. That happened with the description
  // (#1100), which drifted back to text the source had already fixed.
  //
  // `version` is excluded, and that carve-out is load-bearing rather than
  // lazy. Nothing in the release path re-vendors (no workflow or script
  // invokes vendor-intellisense.mjs), so a release that bumps intellisense
  // leaves the copy behind by design: #978 bumped it to 0.5.4 and the vendored
  // copy did not catch up until #1117, roughly 140 commits later. Comparing
  // the version too would red CI on every release commit, for a field the
  // bundled copy never reads. Everything else is compared, which is where the
  // drift that actually matters lives.
  const stripVersion = (s) => s.replace(/^[ \t]*"version":[^\n]*\n/m, '');
  assert.equal(
    stripVersion(readFileSync(join(DIR, '../vendor/node_modules/@webjsdev/intellisense/package.json'), 'utf8')),
    stripVersion(readFileSync(join(SRC, '..', 'package.json'), 'utf8')),
    'vendored package.json drifted; re-run node packages/editors/nvim/scripts/vendor-intellisense.mjs',
  );
});
