/**
 * A JSDoc `import('./x.js')` type reference must resolve to a real file.
 *
 * Moving a module one directory deeper silently breaks every relative type
 * reference in it. The runtime `import` breaks loudly, so it gets fixed; the
 * JSDoc one degrades the annotated symbol to an unresolved type and says
 * nothing, and `packages/` has no tsconfig, so nothing else in CI looks.
 *
 * The #1365 split produced 21 of these across seven modules, and they surfaced
 * one review round at a time: `./module-graph.js` in the vendor scanner, then
 * `./dev-classify.js` threaded through the merge of #1405, each found by a
 * human reading a diff. This is the check that should have found them.
 *
 * Scoped to the ten split trees, since that is where the moves happened.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
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

/**
 * Specifiers that appear inside PROSE as illustrations of what an app author
 * would write, not as type references to anything in this repo. They are
 * matched exactly, so a real reference cannot hide behind one.
 */
const PROSE_EXAMPLES = new Set(['./x.ts', './widget.ts', './x.server.ts']);

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('every relative type import in a split module resolves', () => {
  /** @type {string[]} */
  const broken = [];
  for (const tree of TREES) {
    for (const file of jsFiles(join(REPO, tree))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/import\((['"])(\.[^'"]+)\1\)/g)) {
          const spec = m[2];
          if (PROSE_EXAMPLES.has(spec)) continue;
          if (existsSync(resolve(dirname(file), spec))) continue;
          const rel = relative(REPO, file).split('\\').join('/');
          broken.push(`${rel}:${i + 1}  import('${spec}') does not resolve`);
        }
      });
    }
  }
  assert.deepEqual(
    broken,
    [],
    `unresolvable type import(s):\n  ${broken.join('\n  ')}\n\n`
      + 'A module that moved a directory deeper needs `../` on its JSDoc type\n'
      + 'references too, not only on its runtime imports.',
  );
});
