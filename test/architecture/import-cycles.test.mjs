/**
 * D4: the #1365 split must not leave the framework's module graph tangled.
 *
 * `main` has zero import cycles across the three package source trees. This
 * branch introduced 70, in four components spanning 31 modules. Almost all of
 * that was misfiled code rather than real recursion, and removing it took the
 * graph to the two components asserted below.
 *
 * The criterion is therefore amended from "zero cycles" to "exactly these two,
 * and nothing new". The two that remain are mutual recursion by design:
 *
 * - The client router: a navigation fetches, the fetch applies a swap, the swap
 *   upgrades the new elements, and an upgraded element can start a navigation.
 * - Light-DOM slots: projecting assignments installs the mutation interceptors,
 *   and an intercepted mutation re-projects.
 *
 * Breaking either needs a late-bound seam (a module holding a mutable function
 * slot the engine registers into), which trades a static import edge for a
 * runtime one. That is a real cost here rather than a stylistic one, because
 * the elision analyser reads this same module graph statically to decide what
 * the browser downloads; an edge it cannot see is an edge it cannot follow.
 *
 * Cycles are not inherently broken in ESM: a function declaration is hoisted,
 * so mutual recursion between function bodies resolves fine. The failure mode
 * the plan worried about is a TDZ error on a `const` or `class` read during
 * module evaluation, which shows up as a blank page in the minified bundle
 * rather than as a test failure. The browser suite running against the built
 * bundle on Chromium, Firefox and WebKit is what covers that.
 *
 * This test's job is to stop a THIRD component appearing unnoticed, and to
 * notice if one of these two ever grows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const ROOTS = ['packages/core/src', 'packages/server/src', 'packages/cli/lib'];

/** Modules allowed to sit in a cycle, by the component they belong to. */
const ALLOWED = {
  'client router': [
    'packages/core/src/router-client/dom-differ.js',
    'packages/core/src/router-client/events.js',
    'packages/core/src/router-client/fetch-apply.js',
    'packages/core/src/router-client/navigator.js',
    'packages/core/src/router-client/stream.js',
    'packages/core/src/router-client/swap.js',
    'packages/core/src/router-client/upgrade.js',
  ],
  'light-DOM slots': [
    'packages/core/src/slot/assignment.js',
    'packages/core/src/slot/interception.js',
    'packages/core/src/slot/polyfills.js',
    'packages/core/src/slot/project.js',
    'packages/core/src/slot/sensors.js',
    'packages/core/src/slot/state.js',
  ],
};

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'dist') out.push(...jsFiles(p));
    } else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Build the relative-import graph the same way scripts/find-cycles.mjs does. */
function buildGraph() {
  const files = ROOTS.flatMap((r) => jsFiles(join(REPO, r)));
  const RE = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;
  const graph = new Map();
  for (const f of files) {
    const deps = [];
    for (const m of readFileSync(f, 'utf8').matchAll(RE)) {
      const rel = m[1] || m[2];
      let r = resolve(dirname(f), rel);
      if (!r.endsWith('.js') && !r.endsWith('.mjs')) r += '.js';
      deps.push(r);
    }
    graph.set(f, deps);
  }
  return graph;
}

/** Tarjan's strongly connected components. */
function components(graph) {
  let idx = 0;
  const index = new Map(); const low = new Map(); const onStack = new Set();
  const stack = []; const out = [];
  const strong = (v) => {
    index.set(v, idx); low.set(v, idx); idx += 1;
    stack.push(v); onStack.add(v);
    for (const w of graph.get(v) || []) {
      if (!graph.has(w)) continue;
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      out.push(comp);
    }
  };
  for (const v of graph.keys()) if (!index.has(v)) strong(v);
  return out;
}

test('D4: the only import cycles are the two documented mutual-recursion components', () => {
  const graph = buildGraph();
  const cyclic = components(graph)
    .filter((c) => c.length > 1 || (graph.get(c[0]) || []).includes(c[0]))
    .map((c) => c.map((f) => relative(REPO, f).split('\\').join('/')).sort());

  const expected = Object.values(ALLOWED).map((c) => [...c].sort());
  const key = (c) => c.join('|');
  const got = new Set(cyclic.map(key));
  const want = new Set(expected.map(key));

  const unexpected = cyclic.filter((c) => !want.has(key(c)));
  assert.deepEqual(
    unexpected,
    [],
    `new import cycle(s) introduced:\n${unexpected.map((c) => '  - ' + c.join('\n    ')).join('\n')}\n\n`
      + 'Break it by moving the shared code to a leaf, which is what every cycle\n'
      + 'this split introduced turned out to need. Only add an entry to ALLOWED\n'
      + 'for genuine mutual recursion, with the reason.',
  );

  const missing = expected.filter((c) => !got.has(key(c)));
  assert.deepEqual(
    missing,
    [],
    `a documented cycle is gone or changed shape:\n${missing.map((c) => '  - ' + c.join('\n    ')).join('\n')}\n\n`
      + 'If it was broken on purpose, delete its entry from ALLOWED.',
  );
});

test('D4: no tree outside the two documented components has any cycle', () => {
  const graph = buildGraph();
  const allowed = new Set(Object.values(ALLOWED).flat());
  const inCycle = components(graph)
    .filter((c) => c.length > 1 || (graph.get(c[0]) || []).includes(c[0]))
    .flat()
    .map((f) => relative(REPO, f).split('\\').join('/'));

  const strays = inCycle.filter((f) => !allowed.has(f)).sort();
  assert.deepEqual(strays, [], `modules in an undocumented cycle:\n  ${strays.join('\n  ')}`);
});
