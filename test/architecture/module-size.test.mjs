/**
 * D3: a module produced by the #1365 split targets 800 lines and must not
 * exceed 1000, counted in CODE lines.
 *
 * The criterion binds ONLY the ten trees below and the modules produced from
 * them. Nothing else in the repo is in scope, which matters because several
 * files outside it were already over the line before this work started.
 *
 * **Why code lines and not raw lines.** The ceiling is a proxy for cohesion:
 * the thing it is trying to prevent is a module that does too much. Comments do
 * not make a module do more, and counting them has an actively harmful
 * incentive, because the cheapest way to get back under a raw-line ceiling is
 * to delete the explanation. This PR is the proof: restoring the ~1,300
 * explanatory comment lines its splits had dropped pushed two files back over a
 * raw-line ceiling they had only been under BECAUSE the documentation was
 * missing. A gate that reads that as a regression is measuring the wrong thing.
 *
 * Measured in code lines, every module in these trees is under 1000, including
 * the two that needed an exemption under the raw count: `render-client/parts.js`
 * is 938 code lines inside 1986 raw, and `component/lifecycle.js` is 535 inside
 * 1481. So there is no exemption list here at all, which is the outcome the
 * plan wanted and the one a raw count could not reach.
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
 * Modules allowed past the ceiling, each with its measured size and reason.
 * Empty on purpose: nothing in these trees needs one once size is measured in
 * code. Adding an entry means arguing that a module genuinely cannot be split,
 * having tried.
 */
const EXEMPT = new Map();

/** Lines that are neither blank nor comment-only. */
function codeLines(src) {
  let inBlock = false;
  let n = 0;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) {
        inBlock = false;
        // code trailing a block-comment close still counts
        const after = line.slice(line.indexOf('*/') + 2).trim();
        if (after) n += 1;
      }
      continue;
    }
    if (!line) continue;
    if (line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      else {
        const after = line.slice(line.lastIndexOf('*/') + 2).trim();
        if (after) n += 1;
      }
      continue;
    }
    n += 1;
  }
  return n;
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

test('D3: no split module exceeds 1000 code lines', () => {
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
      const n = codeLines(readFileSync(file, 'utf8'));
      const cap = EXEMPT.get(rel) ?? CEILING;
      if (n > cap) {
        over.push(
          EXEMPT.has(rel)
            ? `${rel}: ${n} code lines, over its exemption cap of ${cap}`
            : `${rel}: ${n} code lines, over the ${CEILING} ceiling`,
        );
      }
    }
  }
  assert.deepEqual(over, [], `modules over their limit:\n  ${over.join('\n  ')}`);
});

test('D3: every exemption still exists and still needs to be one', () => {
  for (const [rel, cap] of EXEMPT) {
    const n = codeLines(readFileSync(join(REPO, rel), 'utf8'));
    assert.ok(
      n > CEILING,
      `${rel} is now ${n} code lines, under the ${CEILING} ceiling. Drop its exemption.`,
    );
    assert.ok(cap >= n, `${rel} is ${n} code lines but its cap is ${cap}`);
  }
});

test('D3: the measurement ignores comments, which is the point', () => {
  // A guard on the guard. If this ever starts counting comment lines again, the
  // incentive flips back to deleting explanation to stay under the ceiling,
  // which is exactly the defect the #1365 splits shipped.
  const src = [
    'function a() {',
    '  // one',
    '  // two',
    '  /* three',
    '     four */',
    '  return 1;',
    '}',
    '',
  ].join('\n');
  assert.equal(codeLines(src), 3, 'signature, return and closing brace only');
});
