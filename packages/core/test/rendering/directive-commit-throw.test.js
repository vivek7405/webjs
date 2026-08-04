/**
 * A throw part-way through a directive's commit must not leave that
 * directive's bookkeeping describing a DOM that no longer exists.
 *
 * Every case here throws from a value whose `toString` throws, which is what
 * any attribute commit does to its value. That is deliberately unrelated to
 * the form-action guard, so none of these depend on that guard existing.
 *
 * The corruption is SILENT after the first throw: the renders that expose it
 * are fully valid and log nothing. So the assertion that matters is always
 * the DOM after a subsequent VALID render, never the throwing one, and never
 * "an error was reported".
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

let html, render, guard, until, watch, repeat, signal;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
  ({ guard, until, watch } = await import('../../src/directives.js'));
  ({ repeat } = await import('../../src/repeat.js'));
  ({ signal } = await import('../../src/signal.js'));
});

/** A value that throws when a commit stringifies it. */
const poison = { toString() { throw new Error('boom'); } };

/** Text content of the rendered rows, ignoring marker comments. */
function rowTexts(container) {
  return [...container.querySelectorAll('li')].map((li) => li.textContent);
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// --- repeat() ---

test('repeat: a mid-walk throw does not duplicate a row on the next valid render', () => {
  const container = document.createElement('div');
  const rows = (items) => html`<ul>${repeat(
    items,
    (it) => it.id,
    (it) => html`<li><span title=${it.title ?? ''}>${it.label}</span></li>`,
  )}</ul>`;

  const good = [
    { id: 1, label: 'one' },
    { id: 2, label: 'two' },
    { id: 3, label: 'three' },
  ];

  render(rows(good), container);
  assert.deepEqual(rowTexts(container), ['one', 'two', 'three']);

  // Throw while reconciling row 2, AFTER row 1 has already been moved into
  // the local replacement map and deleted from the live one.
  assert.throws(() => {
    render(rows([
      { id: 1, label: 'one' },
      { id: 2, label: 'two', title: poison },
      { id: 3, label: 'three' },
    ]), container);
  }, /boom/);

  // A fully valid render. This is where the corruption used to show: key 1
  // had been dropped from the map while its <li> stayed in the document, so
  // a second "one" was built and the orphan was never removed.
  render(rows(good), container);
  assert.deepEqual(rowTexts(container), ['one', 'two', 'three']);

  // And it stays correct, rather than settling into a permanently wrong list.
  render(rows(good), container);
  assert.deepEqual(rowTexts(container), ['one', 'two', 'three']);
});

test('repeat: keeps reconciling normally after recovering from a throw', () => {
  const container = document.createElement('div');
  const rows = (items) => html`<ul>${repeat(
    items,
    (it) => it.id,
    (it) => html`<li><span title=${it.title ?? ''}>${it.label}</span></li>`,
  )}</ul>`;

  render(rows([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]), container);
  assert.throws(() => {
    render(rows([
      { id: 1, label: 'one' },
      { id: 2, label: 'two', title: poison },
    ]), container);
  }, /boom/);

  // Rebuild, then a normal keyed reorder on the rebuilt state.
  render(rows([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]), container);
  render(rows([{ id: 2, label: 'two' }, { id: 1, label: 'one' }]), container);
  assert.deepEqual(rowTexts(container), ['two', 'one']);

  render(rows([{ id: 2, label: 'TWO' }]), container);
  assert.deepEqual(rowTexts(container), ['TWO']);
});

// --- guard() ---

test('guard: a throw during the commit does not blank the region forever', () => {
  const container = document.createElement('div');
  const view = (dep, body) => html`<div>${guard([dep], () => body)}<b>${dep}</b></div>`;

  render(view(0, html`<p>view</p>`), container);
  assert.equal(container.querySelector('p')?.textContent, 'view');

  // New deps, and the commit throws part-way through. The nested-template
  // commit tears the previous child down first, so the region is left empty.
  assert.throws(() => {
    render(view(1, html`<section title=${poison}>next</section>`), container);
  }, /boom/);

  // Same deps as the throwing render, and a body that commits cleanly. The
  // deps must NOT have been recorded by the failed commit, or this hits the
  // shallow-equal short-circuit and the region stays blank for good.
  render(view(1, html`<p>recovered</p>`), container);
  assert.equal(container.querySelector('p')?.textContent, 'recovered');
});

test('guard: still short-circuits on equal deps after a successful commit', () => {
  const container = document.createElement('div');
  let calls = 0;
  const view = (dep) => html`<div>${guard([dep], () => { calls++; return html`<p>${dep}</p>`; })}</div>`;

  render(view(0), container);
  render(view(0), container);
  render(view(0), container);
  assert.equal(calls, 1, 'equal deps must still skip the producer');

  render(view(1), container);
  assert.equal(calls, 2);
  assert.equal(container.querySelector('p')?.textContent, '1');
});

// --- watch() ---

test('watch: a commit throw reaches the component boundary, not the window', async () => {
  const container = document.createElement('div');
  /** @type {Error[]} */
  const seen = [];
  container._handleRenderError = (err) => { seen.push(err); };

  const sig = signal(html`<p>ok</p>`);
  render(html`<div>${watch(sig)}</div>`, container);
  assert.equal(container.querySelector('p')?.textContent, 'ok');

  sig.set(html`<section title=${poison}>bad</section>`);
  await tick();

  assert.equal(seen.length, 1, 'the throw must land on the boundary');
  assert.match(seen[0].message, /boom/);

  // Mildest of the three: the next signal value repaints the region.
  sig.set(html`<p>healed</p>`);
  await tick();
  assert.equal(container.querySelector('p')?.textContent, 'healed');
});

// --- until() ---

test('until: a commit throw reaches the boundary and does not wedge the priority', async () => {
  const container = document.createElement('div');
  /** @type {Error[]} */
  const seen = [];
  container._handleRenderError = (err) => { seen.push(err); };

  let resolveHigh;
  let resolveLow;
  const high = new Promise((r) => { resolveHigh = r; });
  const low = new Promise((r) => { resolveLow = r; });

  render(html`<div>${until(high, low, html`<p>fallback</p>`)}</div>`, container);
  assert.equal(container.querySelector('p')?.textContent, 'fallback');

  // The highest-priority promise wins the race and its commit throws.
  resolveHigh(html`<section title=${poison}>bad</section>`);
  await tick();
  assert.equal(seen.length, 1, 'the throw must land on the boundary');
  assert.match(seen[0].message, /boom/);

  // `highestResolved` must not have advanced to the failed index, or the
  // lower-priority resolution below is refused and the region stays empty.
  resolveLow(html`<p>low</p>`);
  await tick();
  assert.equal(container.querySelector('p')?.textContent, 'low');
});
