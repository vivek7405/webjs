/**
 * D3: a module produced by the #1365 split targets 800 lines and must not
 * exceed 1000.
 *
 * The criterion binds ONLY the ten trees below and the modules produced from
 * them. Nothing else in the repo is in scope, which matters because several
 * files outside it were already over the line before this work started.
 *
 * A barrel is exempt: its length is a function of its export count, and
 * router-client.js alone re-exports 68 names.
 *
 * This is a test rather than a note in a PR body because the ceiling is only
 * useful if it holds later. The split reduced six files below it; without a
 * guard the seventh regression is invisible until someone re-measures by hand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

const TREES = [
  'packages/core/src/router-client',
  'packages/core/src/render-client',
  'packages/core/src/render-server',
  'packages/core/src/component',
  'packages/core/src/slot',
  'packages/server/src/dev',
  'packages/server/src/vendor',
  'packages/server/src/ssr',
  'packages/server/src/check',
  'packages/cli/lib/doctor',
];

const CEILING = 1000;

/**
 * The exemptions D3 allows, each named with its measured size and its reason.
 *
 * Both are cases where getting under the ceiling costs more than it buys, and
 * both were confirmed by attempting the split rather than assumed:
 *
 * - `render-client/parts.js` is mutually recursive with any piece worth
 *   extracting. The core dispatches to the directive appliers (repeat, cache,
 *   until, watch, asyncAppend, asyncReplace) and every one of them calls back
 *   into `commitInto` / `applyPart` / `teardownChild`. Splitting it satisfies
 *   D3 by violating D4, which is not a trade the plan wanted.
 *
 * - `component/lifecycle.js` is ONE class, `WebComponentBase`, spanning 1332 of
 *   its lines. It cannot be split by moving functions at all. The alternative
 *   is extracting method bodies into free functions taking the instance, which
 *   turns the component base class into a dispatch table over helpers that all
 *   take `host` as their first argument.
 *
 * Raising a number here is a deliberate act. Adding a NEW entry should be
 * argued the same way, by trying the split first.
 */
const EXEMPT = new Map([
  ['packages/core/src/render-client/parts.js', 1560],
  ['packages/core/src/component/lifecycle.js', 1520],
]);

/** @param {string} dir @returns {string[]} absolute paths of .js files */
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('D3: no split module exceeds 1000 lines, except the named exemptions', () => {
  /** @type {string[]} */
  const over = [];
  for (const tree of TREES) {
    const abs = join(REPO, tree);
    let stats;
    try {
      stats = statSync(abs);
    } catch {
      assert.fail(`tree ${tree} does not exist; update TREES if it was renamed`);
    }
    assert.ok(stats.isDirectory(), `${tree} should be a directory`);

    for (const file of jsFiles(abs)) {
      const rel = relative(REPO, file).split('\\').join('/');
      const lines = readFileSync(file, 'utf8').split('\n').length;
      const cap = EXEMPT.get(rel) ?? CEILING;
      if (lines > cap) {
        over.push(
          EXEMPT.has(rel)
            ? `${rel}: ${lines} lines, over its exemption cap of ${cap}`
            : `${rel}: ${lines} lines, over the ${CEILING} ceiling`,
        );
      }
    }
  }
  assert.deepEqual(over, [], `modules over their limit:\n  ${over.join('\n  ')}`);
});

test('D3: every exemption still exists and still needs to be one', () => {
  for (const [rel, cap] of EXEMPT) {
    const lines = readFileSync(join(REPO, rel), 'utf8').split('\n').length;
    assert.ok(
      lines > CEILING,
      `${rel} is now ${lines} lines, under the ${CEILING} ceiling. Drop its exemption.`,
    );
    assert.ok(
      cap >= lines,
      `${rel} is ${lines} lines but its cap is ${cap}; this test should have failed above`,
    );
  }
});
