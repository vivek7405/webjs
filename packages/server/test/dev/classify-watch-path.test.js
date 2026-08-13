/**
 * #1398: the pure live-reload classifier. A dev edit to a page or a layout can
 * be applied in place, because pages and layouts never hydrate, so the freshly
 * rendered server HTML is the complete truth for them. A dev edit to anything
 * the BROWSER holds cannot, because `customElements.define` is once-per-tag and
 * a module URL is fetched once per document.
 *
 * The ladder is exercised here against a synthetic `ctx` so the decision is
 * testable without booting a server. `classify-live.test.js` is the end-to-end
 * counterfactual that the verdict actually reaches the wire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyChangedPath, strongerVerdict, RELOAD_VERDICTS } from '../../src/dev-classify.js';

const APP = '/app';
const p = (rel) => `${APP}/${rel}`;

/** A ctx describing a small app with one page, one layout, one component. */
function ctx(over = {}) {
  return {
    appDir: APP,
    sep: '/',
    analysisReady: true,
    // What the browser can ACTUALLY load: the component, a util it imports, and
    // an action file it imports (the graph keeps a `.server.*` node and stops).
    shippedFiles: new Set([
      p('components/counter.ts'),
      p('lib/utils/format.ts'),
      p('modules/todos/actions/create.server.ts'),
    ]),
    // Every app source the graph walked, shipped or not.
    graphFiles: new Set([
      p('app/page.ts'),
      p('app/layout.ts'),
      p('app/blog/[slug]/page.ts'),
      p('components/counter.ts'),
      p('lib/utils/format.ts'),
      p('modules/todos/actions/create.server.ts'),
      p('modules/posts/queries/list.server.ts'),
    ]),
    pageFiles: new Set([p('app/page.ts'), p('app/blog/[slug]/page.ts')]),
    ...over,
  };
}

test('a page module morphs in place', () => {
  const v = classifyChangedPath(p('app/page.ts'), ctx());
  assert.equal(v.v, 'page');
  assert.equal(v.why, 'page-module');
  assert.equal(v.by, 'app/page.ts', 'the diagnostic path is app-relative');

  assert.equal(classifyChangedPath(p('app/blog/[slug]/page.ts'), ctx()).v, 'page');
});

test('a layout module takes the whole-body shell swap', () => {
  // A layout's OWN markup sits outside every `<!--wj:children:...-->` range, so
  // a boundary morph would silently do nothing. It is not a page and not
  // shipped, so it falls to the server-only rung.
  const v = classifyChangedPath(p('app/layout.ts'), ctx());
  assert.equal(v.v, 'shell');
  assert.equal(v.why, 'server-only-module');
});

test('a component module is a full reload', () => {
  const v = classifyChangedPath(p('components/counter.ts'), ctx());
  assert.equal(v.v, 'reload');
  assert.equal(v.why, 'ships-to-browser');
});

// The reachability answer, and the reason the classification cannot be a
// path-shape heuristic. Nothing about `lib/utils/format.ts` says "component".
test('a util reachable from a component is a full reload, by reachability alone', () => {
  assert.equal(classifyChangedPath(p('lib/utils/format.ts'), ctx()).v, 'reload');
});

// A page that imports a client-effecting non-component util SHIPS WHOLE (the
// import-only rule, #605 / #963), and editing it changes browser-bound JS. The
// shipped closure is checked BEFORE the page rung precisely so this wins.
test('a page that ships to the browser reloads despite being a page', () => {
  const c = ctx();
  c.shippedFiles.add(p('app/page.ts'));
  const v = classifyChangedPath(p('app/page.ts'), c);
  assert.equal(v.v, 'reload');
  assert.equal(v.why, 'ships-to-browser');
});

test('an action reachable from a shipping component reloads; one reachable only from a page does not', () => {
  // Adding an export to an action a shipping component imports changes the
  // generated RPC stub the browser holds, so it must reload.
  assert.equal(classifyChangedPath(p('modules/todos/actions/create.server.ts'), ctx()).v, 'reload');
  // The same kind of file, reached only from a page, never enters the browser.
  const v = classifyChangedPath(p('modules/posts/queries/list.server.ts'), ctx());
  assert.equal(v.v, 'shell');
  assert.equal(v.why, 'server-only-module');
});

// The case a naive implementation gets wrong, and the one that silently does
// NOTHING if morphed: `mergeHead` preserves stylesheets unconditionally (#936),
// so swapping in a re-render would never re-fetch the changed CSS.
test('a public/ asset is a full reload, never a morph', () => {
  const v = classifyChangedPath(p('public/app.css'), ctx());
  assert.equal(v.v, 'reload');
  assert.equal(v.why, 'unknown-path');
});

test('a brand-new or deleted file the graph has never seen is a full reload', () => {
  const v = classifyChangedPath(p('components/brand-new.ts'), ctx());
  assert.equal(v.v, 'reload');
  assert.equal(v.why, 'unknown-path');
});

// An extra `webjs.dev.watch` root (#894) is content the server reads at render
// time, never a browser module, and any layout may render it.
test('a path outside the appDir takes the shell swap', () => {
  const v = classifyChangedPath('/repo/content/post.md', ctx());
  assert.equal(v.v, 'shell');
  assert.equal(v.why, 'extra-watch-root');
  assert.equal(v.by, '/repo/content/post.md', 'an unrelativizable path reports absolute');
});

// A sibling directory sharing a prefix is NOT containment.
test('a sibling dir sharing the appDir prefix is not treated as inside it', () => {
  const v = classifyChangedPath('/app-old/app/page.ts', ctx());
  assert.equal(v.why, 'extra-watch-root');
});

// Vite's pessimistic seed: an empty or unresolvable result is a reload.
test('a cold analysis reloads for every input', () => {
  const cold = ctx({ analysisReady: false });
  for (const f of ['app/page.ts', 'app/layout.ts', 'components/counter.ts', 'public/app.css']) {
    const v = classifyChangedPath(p(f), cold);
    assert.equal(v.v, 'reload', `${f} reloads while the analysis is cold`);
    assert.equal(v.why, 'analysis-cold');
  }
});

test('an empty path reloads', () => {
  assert.equal(classifyChangedPath('', ctx()).v, 'reload');
});

test('RELOAD_VERDICTS is ordered strongest first', () => {
  assert.deepEqual([...RELOAD_VERDICTS], ['reload', 'shell', 'page']);
});

// Every ordered pair, both directions, so a comparison that got the sign
// backwards cannot pass. A window mixing a page edit and a component edit is a
// component edit.
test('strongerVerdict picks the strongest over all ordered pairs', () => {
  const mk = (v) => ({ v, by: v, why: v });
  for (const a of RELOAD_VERDICTS) {
    for (const b of RELOAD_VERDICTS) {
      const expected = RELOAD_VERDICTS.indexOf(a) <= RELOAD_VERDICTS.indexOf(b) ? a : b;
      assert.equal(strongerVerdict(mk(a), mk(b)).v, expected, `${a} vs ${b}`);
    }
  }
});

test('strongerVerdict treats null as weakest and an unknown name as strongest', () => {
  const page = { v: 'page', by: '', why: '' };
  assert.equal(strongerVerdict(null, page), page);
  assert.equal(strongerVerdict(page, null), page);
  assert.equal(strongerVerdict(null, null), null);
  assert.equal(strongerVerdict(page, { v: 'nonsense', by: '', why: '' }).v, 'nonsense',
    'an unrecognised verdict ranks strongest, so it can only ever over-reload');
});
