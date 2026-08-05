/**
 * Tearing an instance out takes its OWN bookend markers with it.
 *
 * Every rendered template instance is bracketed by a `wjm-s` / `wjm-e` comment
 * pair, and `removeBetween` is what takes a range back out. It used to remove
 * the start marker, the content, and then skip the end marker, because the
 * guard deciding whether to remove it read `start.parentNode` AFTER the walk
 * had already detached `start`. One orphan comment per teardown, accumulating
 * for the life of the region.
 *
 * The leak is invisible to `textContent` and to `querySelectorAll`, which is
 * exactly why nothing caught it for so long. So the six LEAK cases count
 * comment nodes directly, and assert BOTH halves of the accounting: the pair
 * count is balanced (`s === e`), and it is back to the baseline the first
 * render established. Each also asserts the rendered output, so none of them
 * can pass by rendering nothing at all. One case per distinct caller, since
 * they reach `removeBetween` through different paths and a repair on one
 * branch says nothing about the others.
 *
 * The LAST case is not one of those and does not count markers at all. It
 * pins the guard, which is a separate decision from the leak, and it is green
 * with or without the fix by design. Its own comment says so.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

before(() => {
  const { window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = window.document;
  globalThis.DocumentFragment = window.DocumentFragment;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.Comment = window.Comment;
  globalThis.Text = window.Text;
  globalThis.NodeFilter = window.NodeFilter;
  globalThis.HTMLElement = window.HTMLElement;
});

let html, render, repeat, MARKER;
before(async () => {
  ({ html, MARKER } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
  ({ repeat } = await import('../../src/repeat.js'));
});

/**
 * Count renderer bookends under `root`, at any depth. Reads MARKER rather than
 * hardcoding the prefix, so a rename of the marker text cannot leave this
 * silently counting nothing and passing.
 */
function countBookends(root) {
  let s = 0;
  let e = 0;
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 8) {
        if (c.data === `${MARKER}s`) s++;
        else if (c.data === `${MARKER}e`) e++;
      } else walk(c);
    }
  };
  walk(root);
  return { s, e };
}

/** Assert the bookends are paired AND back to `baseline`. */
function assertBookends(el, baseline, label) {
  const got = countBookends(el);
  assert.equal(got.s, got.e, `${label}: bookends unpaired (${got.s} start, ${got.e} end)`);
  assert.deepEqual(got, baseline, `${label}: bookend count drifted from baseline`);
}

const texts = (el, sel) => [...el.querySelectorAll(sel)].map((n) => n.textContent);
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, t: `row ${i}` }));

/* ------------------------------------------------------------------ *
 * U1: the leftover-removal loop in reconcileRepeat.
 * ------------------------------------------------------------------ */

test('repeat(): rows removed across many cycles leave no orphan markers', () => {
  const el = document.createElement('div');
  const view = (items) =>
    html`<ul>${repeat(items, (it) => it.id, (it) => html`<li>${it.t}</li>`)}</ul>`;

  render(view(rows(4)), el);
  const baseline = countBookends(el);
  assert.equal(baseline.s, baseline.e, 'baseline is paired');
  // The row at index 0 is present in every render below, so keyed
  // reconciliation must hand back the SAME element each time. This is the
  // teardown-only guarantee: removing rows 2 and 3 must not perturb the rows
  // that stayed.
  const survivor = el.querySelector('li');

  for (let i = 0; i < 5; i++) {
    render(view(rows(2)), el);
    render(view(rows(4)), el);
  }

  assertBookends(el, baseline, 'repeat after 5 shrink/grow cycles');
  assert.deepEqual(texts(el, 'li'), ['row 0', 'row 1', 'row 2', 'row 3']);
  assert.equal(el.querySelector('li'), survivor, 'a row that never left kept its node identity');
});

/* ------------------------------------------------------------------ *
 * U2: the shape-mismatch branch in reconcileRepeat, where a key SURVIVES
 * but its template shape changes, so the old instance is torn out and a
 * fresh one built under the same key.
 * ------------------------------------------------------------------ */

test('repeat(): a same-key template swap leaves no orphan markers', () => {
  const el = document.createElement('div');
  const view = (flip) =>
    html`<ul>${repeat(
      rows(3),
      (it) => it.id,
      (it) => (flip ? html`<li><em>${it.t}</em></li>` : html`<li><b>${it.t}</b></li>`),
    )}</ul>`;

  render(view(false), el);
  const baseline = countBookends(el);

  for (let i = 0; i < 5; i++) {
    render(view(true), el);
    render(view(false), el);
  }

  assertBookends(el, baseline, 'repeat after 5 same-key shape swaps');
  assert.deepEqual(texts(el, 'li b'), ['row 0', 'row 1', 'row 2']);
});

/* ------------------------------------------------------------------ *
 * U3: removeArrayItem, the plain .map() path. A different reconciler
 * (positional, not keyed) reaching the same helper.
 * ------------------------------------------------------------------ */

test('plain .map() array: shrinking the array leaves no orphan markers', () => {
  const el = document.createElement('div');
  const view = (n) => html`<ul>${rows(n).map((it) => html`<li>${it.t}</li>`)}</ul>`;

  render(view(4), el);
  const baseline = countBookends(el);

  for (let i = 0; i < 5; i++) {
    render(view(1), el);
    render(view(4), el);
  }

  assertBookends(el, baseline, 'array after 5 shrink/grow cycles');
  assert.deepEqual(texts(el, 'li'), ['row 0', 'row 1', 'row 2', 'row 3']);
});

test('plain .map() array: emptying it entirely leaves no orphan markers', () => {
  const el = document.createElement('div');
  const view = (n) => html`<ul>${rows(n).map((it) => html`<li>${it.t}</li>`)}</ul>`;

  render(view(3), el);
  const baseline = countBookends(el);

  for (let i = 0; i < 5; i++) {
    render(view(0), el);
    render(view(3), el);
  }

  assertBookends(el, baseline, 'array after 5 empty/refill cycles');
  assert.deepEqual(texts(el, 'li'), ['row 0', 'row 1', 'row 2']);
});

/* ------------------------------------------------------------------ *
 * U4: applyChildInnerRaw, a template-shape swap at a plain child hole
 * (no list involved).
 * ------------------------------------------------------------------ */

test('child hole: swapping template shape leaves no orphan markers', () => {
  const el = document.createElement('div');
  // ONE outer template site, so the outer instance UPDATES in place and the
  // swap really reaches the child-hole teardown. Rendering two separate outer
  // literals instead would give the container two different `strings`
  // identities, rebuild the whole instance each time, and wipe the leak with
  // `replaceChildren` before this could ever see it.
  const view = (inner) => html`<div>${inner}</div>`;
  const a = () => html`<span>A</span>`;
  const b = () => html`<em>B</em>`;

  render(view(a()), el);
  const baseline = countBookends(el);

  for (let i = 0; i < 5; i++) {
    render(view(b()), el);
    render(view(a()), el);
  }

  assertBookends(el, baseline, 'child hole after 5 shape swaps');
  assert.equal(el.querySelector('span').textContent, 'A');
  assert.equal(el.querySelector('em'), null);
});

/* ------------------------------------------------------------------ *
 * U5: teardownChild reaching teardownRepeat, when a hole stops being a
 * list at all.
 * ------------------------------------------------------------------ */

test('child hole: swapping a repeat() out for a single template leaves no orphan markers', () => {
  const el = document.createElement('div');
  // One outer template site, for the reason spelled out on the case above.
  const view = (inner) => html`<div>${inner}</div>`;
  const list = () => repeat(rows(3), (it) => it.id, (it) => html`<p>${it.t}</p>`);
  const single = () => html`<span>solo</span>`;

  render(view(list()), el);
  const baseline = countBookends(el);

  for (let i = 0; i < 5; i++) {
    render(view(single()), el);
    assert.equal(el.querySelector('span').textContent, 'solo');
    render(view(list()), el);
  }

  assertBookends(el, baseline, 'child hole after 5 list/single swaps');
  assert.deepEqual(texts(el, 'p'), ['row 0', 'row 1', 'row 2']);
});

/* ------------------------------------------------------------------ *
 * U6: the guard itself. This one pins a DECISION rather than the fix.
 * ------------------------------------------------------------------ */

test('a marker moved under a foreign parent is refused, not reached into', () => {
  // The removal is deliberately NOT an unconditional `end.remove()`. A marker
  // that has been moved somewhere else is not this region's to remove, and
  // removing it would rip a node out of a tree the renderer does not own.
  //
  // Two things this case is NOT claiming. The walk still runs off the end of
  // the child list when the range is desynced like this, taking following
  // siblings with it. That overrun is a property of the walk both before and
  // after this fix, described on `reconcileRepeat`'s catch as the reason a
  // half-removed row is never re-reached, and it is out of scope here: the
  // guard's job starts after the walk, not during it. And linkedom does not
  // necessarily throw for a `removeChild` of a foreign node, so the survival
  // assertion, not an absence of throw, is the arm that holds in every
  // environment.
  const el = document.createElement('div');
  const view = (n) => html`<ul>${rows(n).map((it) => html`<li>${it.t}</li>`)}</ul>`;
  render(view(2), el);

  const ul = el.querySelector('ul');
  const stolen = [...ul.childNodes].find((n) => n.nodeType === 8 && n.data === `${MARKER}e`);
  assert.ok(stolen, 'found an end marker to move');

  const foreign = document.createElement('section');
  el.appendChild(foreign);
  foreign.appendChild(stolen);

  assert.doesNotThrow(() => render(view(0), el));
  assert.equal(stolen.parentNode, foreign, 'the moved marker was left where it was moved to');
});
