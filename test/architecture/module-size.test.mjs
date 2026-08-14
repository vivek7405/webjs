/**
 * D3: a module produced by the #1365 split targets 800 lines and must not
 * exceed 1000, measured with a RAW line count, exactly as the issue's own
 * acceptance command (`wc -l`) measures it.
 *
 * The criterion binds ONLY the ten trees below and the modules produced from
 * them. Nothing else in the repo is in scope, which matters because several
 * files outside it were already over the line before this work started.
 *
 * An earlier revision of this guard counted CODE lines (comments and blanks
 * skipped), which put every module under the ceiling with no exemptions. That
 * redefinition was reverted: #1365 specifies raw `wc -l` plus a NAMED exemption
 * for a module that genuinely cannot be split, and changing the metric so a
 * failing criterion passes is not meeting it. The number this guard reports is
 * the number you see when you open the file.
 *
 * The exemptions below are the project's decided answer (2026-08-14), each
 * with the reason it cannot or should not go under the ceiling:
 *
 * - `component/lifecycle.js`: lit parity. It is the one core tree whose code
 *   genuinely tracks lit (`reactive-element.ts`, kept WHOLE upstream at 1754
 *   lines), and the project's standing decision is to keep lit-derived code as
 *   close to lit as possible. The WebJs-original parts (the factory, the SSR
 *   element shim) are already split out beside it.
 * - `render-client/parts.js`: mutual recursion. The apply and instance group
 *   calls back into itself (applyPart -> applyChild -> updateInstance /
 *   buildDetached -> applyPart), so any real split creates the import cycle D4
 *   forbids, and the escape (a runtime dispatch registry) trades a static
 *   import edge for a mutable slot. lit keeps its equivalent (`lit-html.ts`)
 *   whole at 2303 lines for the same reason.
 * - `dev/handler.js`: one closure. `createRequestHandler` is a single closure
 *   over shared mutable request state (rebuildInFlight, readyDone, the base
 *   path); decomposing it means threading that state through a context object,
 *   a high-risk rewrite of the boot path of every app for zero behaviour gain.
 *   #1365's P9 itself calls it "the only file whose main function must be
 *   decomposed rather than moved".
 *
 * Each exemption carries a CAP a little above its current size, so an exempt
 * module can still grow a little without churn here, while unbounded growth
 * (the thing an exemption must not become) still fails.
 *
 * A barrel is exempt from the whole check: its length is a function of its
 * export count, and router-client.js alone re-exports 68 names.
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
 * The named exemptions, per the header. Key is the repo-relative path, value
 * is the cap raw-line growth must stay under.
 */
const EXEMPT = new Map([
  ['packages/core/src/render-client/parts.js', 2100],
  ['packages/core/src/component/lifecycle.js', 1600],
  ['packages/server/src/dev/handler.js', 1500],
]);

/** Raw line count, the same number `wc -l` prints. */
function rawLines(src) {
  return src.split('\n').length;
}

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

test('D3: no split module exceeds 1000 raw lines, save the named exemptions', () => {
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
      const n = rawLines(readFileSync(file, 'utf8'));
      const cap = EXEMPT.get(rel) ?? CEILING;
      if (n > cap) {
        over.push(
          EXEMPT.has(rel)
            ? `${rel}: ${n} lines, over its exemption cap of ${cap}`
            : `${rel}: ${n} lines, over the ${CEILING} ceiling`,
        );
      }
    }
  }
  assert.deepEqual(over, [], `modules over their limit:\n  ${over.join('\n  ')}`);
});

test('D3: every exemption still exists and still needs to be one', () => {
  // An exempt module that shrinks under the ceiling must lose its entry, so
  // the list can only ever name modules that genuinely need it.
  for (const [rel, cap] of EXEMPT) {
    const n = rawLines(readFileSync(join(REPO, rel), 'utf8'));
    assert.ok(
      n > CEILING,
      `${rel} is now ${n} lines, under the ${CEILING} ceiling. Drop its exemption.`,
    );
    assert.ok(cap >= n, `${rel} is ${n} lines but its cap is ${cap}`);
  }
});
