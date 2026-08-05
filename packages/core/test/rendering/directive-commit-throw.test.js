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

let html, render, guard, until, watch, ref, repeat, signal;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
  ({ guard, until, watch, ref } = await import('../../src/directives.js'));
  ({ repeat } = await import('../../src/repeat.js'));
  ({ signal } = await import('../../src/signal.js'));
});

/** A value that throws when a commit stringifies it. */
const poison = { toString() { throw new Error('boom'); } };

/**
 * A ref whose object write throws on UNBIND. Every other poison in this file
 * throws from a COMMIT, and none of them can reach the teardown paths below:
 * a commit stringifies its value on the way into the DOM, while these throws
 * come from tearing a row back out, which is a different code path with a
 * different repair. Only an object ref (or a callback ref) is called during
 * teardown at all, so it is the only way in.
 */
function throwingRef(message) {
  return { set value(v) { if (v === undefined) throw new Error(message); }, get value() { return null; } };
}

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

// A CHILD-position hole is the dangerous kind, and an attribute hole cannot
// stand in for it. An attribute commit stringifies before it touches the DOM,
// so a throw there changes nothing; a child commit tears the old content down
// FIRST, so a throw leaves the region empty. Both then leave `lastValues` for
// that hole un-advanced, holding the pre-throw value, which is exactly what
// the recovering render supplies, so without the sentinel the `Object.is`
// skip would skip the hole forever and the emptied region never comes back.

test('repeat: a throw in a CHILD hole recovers, and keeps node identity', () => {
  const container = document.createElement('div');
  const rows = (items) => html`<ul>${repeat(
    items,
    (it) => it.id,
    (it) => html`<li>${it.n}</li>`,
  )}</ul>`;
  const good = [{ id: 1, n: 'one' }, { id: 2, n: 'two' }, { id: 3, n: 'three' }];

  render(rows(good), container);
  const before = [...container.querySelectorAll('li')];

  assert.throws(() => {
    render(rows([{ id: 1, n: 'one' }, { id: 2, n: poison }, { id: 3, n: 'three' }]), container);
  }, /boom/);

  render(rows(good), container);
  assert.deepEqual(rowTexts(container), ['one', 'two', 'three']);
  render(rows(good), container);
  assert.deepEqual(rowTexts(container), ['one', 'two', 'three']);

  // Recovering must not cost the rows their identity: this is a reconcile
  // against a repaired map, not a rebuild of the region.
  const after = [...container.querySelectorAll('li')];
  assert.equal(after[0], before[0]);
  assert.equal(after[2], before[2]);
});

test('repeat: a throw in a nested-template row recovers', () => {
  const container = document.createElement('div');
  const rows = (items) => html`<ul>${repeat(
    items,
    (it) => it.id,
    (it) => html`<li>${html`<b>${it.n}</b>`}</li>`,
  )}</ul>`;
  const good = [{ id: 1, n: 'one' }, { id: 2, n: 'two' }];

  render(rows(good), container);
  assert.throws(() => {
    render(rows([{ id: 1, n: 'one' }, { id: 2, n: poison }]), container);
  }, /boom/);

  render(rows(good), container);
  assert.deepEqual([...container.querySelectorAll('b')].map((b) => b.textContent), ['one', 'two']);
});

// --- teardown throws (repeat's leftover-removal loop, and clearInstance) ---

test('repeat: dropping a row whose ref unbind throws still removes that row', () => {
  const container = document.createElement('div');
  const rows = (items) => html`<ul>${repeat(
    items,
    (it) => it.id,
    (it) => html`<li><span ${it.id === 9 ? ref(throwingRef('ref-boom')) : ref({})}>${it.n}</span></li>`,
  )}</ul>`;

  render(rows([{ id: 1, n: 'a' }, { id: 9, n: 'doomed' }]), container);
  assert.deepEqual(rowTexts(container), ['a', 'doomed']);
  const beforeA = container.querySelector('li');

  // The app asked for a one-row list. It used to get a two-row list led by
  // the row it deleted, because the unbind threw out of the removal loop.
  render(rows([{ id: 1, n: 'a' }]), container);
  assert.deepEqual(rowTexts(container), ['a']);

  // And the survivor is the same element, not a rebuild.
  assert.equal(container.querySelector('li'), beforeA);

  // Still reconciling normally afterwards, rather than wedged.
  render(rows([{ id: 1, n: 'A' }]), container);
  assert.deepEqual(rowTexts(container), ['A']);
});

test('repeat: re-adding a key dropped through a throwing unbind builds a fresh row', () => {
  const container = document.createElement('div');
  const rows = (items) => html`<ul>${repeat(
    items,
    (it) => it.id,
    (it) => html`<li><span ${it.id === 9 ? ref(throwingRef('ref-boom')) : ref({})}>${it.n}</span></li>`,
  )}</ul>`;

  render(rows([{ id: 1, n: 'a' }, { id: 9, n: 'doomed' }]), container);
  const doomed = [...container.querySelectorAll('li')][1];

  render(rows([{ id: 1, n: 'a' }]), container);
  render(rows([{ id: 1, n: 'a' }, { id: 9, n: 'again' }]), container);

  assert.deepEqual(rowTexts(container), ['a', 'again']);
  // A disposed, detached instance must never come back: it is unmapped, so
  // the key misses and builds fresh.
  const readded = [...container.querySelectorAll('li')][1];
  assert.notEqual(readded, doomed);
});

test('repeat: a throw INSIDE the removal loop leaves no leftover still mapped', () => {
  // Drives the throw from the loop's OTHER step, so this covers the loop's
  // shape independently of the ref guard above (which makes the dispose step
  // unable to throw at all). Nothing here reaches into module internals: it
  // patches the rows' parent so one DOM removal refuses.
  const container = document.createElement('div');
  const rows = (items) => html`<ul>${repeat(
    items,
    (it) => it.id,
    (it) => html`<li>${it.n}</li>`,
  )}</ul>`;

  render(rows([{ id: 1, n: 'one' }, { id: 2, n: 'two' }, { id: 3, n: 'three' }]), container);
  const [, liTwo, liThree] = [...container.querySelectorAll('li')];

  const ul = container.querySelector('ul');
  const origRemove = ul.removeChild.bind(ul);
  ul.removeChild = (node) => {
    if (node === liThree) throw new Error('rm-boom');
    return origRemove(node);
  };

  // Drop keys 2 and 3. Key 2 is processed cleanly; key 3 refuses part-way.
  assert.throws(() => { render(rows([{ id: 1, n: 'one' }]), container); }, /rm-boom/);
  ul.removeChild = origRemove;

  // Key 2 came out of the map before its row was touched, so re-adding it
  // builds fresh. It used to stay mapped, and the detached instance was
  // moved back in with its refs already unbound.
  render(rows([{ id: 1, n: 'one' }, { id: 2, n: 'two' }]), container);
  const twos = [...container.querySelectorAll('li')].filter((li) => li.textContent === 'two');
  assert.equal(twos.length, 1, 'exactly one row for the re-added key');
  assert.notEqual(twos[0], liTwo, 'a disposed instance must not be resurrected');

  // The survivor keeps its identity, and nothing is duplicated.
  const ones = [...container.querySelectorAll('li')].filter((li) => li.textContent === 'one');
  assert.equal(ones.length, 1);

  // `liThree` is still in the document. That is the one residual this repair
  // names and does not cover: `removeBetween` itself refused, and it only
  // ever calls removeChild on nodes the renderer owns, so nothing short of
  // the DOM lying can reach it.
  assert.equal(liThree.parentNode, ul);
});

test('clearInstance: a throwing ref unbind does not wedge template swaps', () => {
  const container = document.createElement('div');
  render(html`<p ${ref(throwingRef('clear-boom'))}>A</p>`, container);
  assert.equal(container.querySelector('p')?.textContent, 'A');

  // A template-SHAPE swap runs the container-level teardown. The throw used
  // to skip the replaceChildren() at the end of it, so the old DOM stayed and
  // the instance was never replaced. `lastTarget` is cleared only after the
  // throwing write, so it was permanent: every later swap threw at the same
  // part, which is why this asserts TWO swaps.
  render(html`<b>B</b>`, container);
  assert.equal(container.querySelector('b')?.textContent, 'B');
  assert.equal(container.querySelector('p'), null);

  render(html`<i>C</i>`, container);
  assert.equal(container.querySelector('i')?.textContent, 'C');
});

test('a plain template child hole recovers too (not just repeat)', () => {
  const container = document.createElement('div');
  const view = (x) => html`<div><span>${x}</span></div>`;

  render(view('ok'), container);
  assert.throws(() => { render(view(poison), container); }, /boom/);

  render(view('ok'), container);
  assert.equal(container.querySelector('span').textContent, 'ok');
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

// --- boundary ownership (both out-of-band directives) ---

/**
 * The part below belongs to the OUTER template but sits inside a nested
 * custom element, which is the ordinary shape `html`<child-el>${...}</child-el>``
 * produces. `_handleRenderError` lives on WebComponent's prototype, so every
 * upgraded element on the way up carries one and a structural parent walk
 * meets the CHILD first. Routing there is not just a wrong log line: a
 * light-DOM component's renderError() commits into the component itself, so
 * it would replace the very children holding this part's markers and every
 * later update through the part would be a silent no-op.
 */
function ownershipTest(label, installDirective) {
  test(label, async () => {
    const ownerSeen = [];
    const childSeen = [];
    const owner = document.createElement('owner-el');
    owner._handleRenderError = (err) => { ownerSeen.push(err); };

    const fire = installDirective(owner);

    // The child upgrades and gains the boundary from its prototype.
    owner.querySelector('child-el')._handleRenderError = (err) => { childSeen.push(err); };

    fire();
    await tick();

    assert.equal(ownerSeen.length, 1, 'the OWNING template must get the error');
    assert.match(ownerSeen[0].message, /boom/);
    assert.equal(childSeen.length, 0, 'the nested element does not own this part');
  });
}

ownershipTest('watch: routes to the template that owns the part, not the element it sits in', (owner) => {
  const sig = signal(html`<p>ok</p>`);
  render(html`<child-el>${watch(sig)}</child-el>`, owner);
  return () => sig.set(html`<section title=${poison}>bad</section>`);
});

ownershipTest('until: routes to the template that owns the part, not the element it sits in', (owner) => {
  let resolveIt;
  const pending = new Promise((r) => { resolveIt = r; });
  render(html`<child-el>${until(pending, html`<p>fallback</p>`)}</child-el>`, owner);
  return () => resolveIt(html`<section title=${poison}>bad</section>`);
});

test('a directive installed BY an out-of-band commit still reaches the boundary', async () => {
  const seen = [];
  const owner = document.createElement('owner-el');
  owner._handleRenderError = (err) => { seen.push(err); };

  const outer = signal(html`<p>a</p>`);
  const inner = signal(html`<p>b</p>`);
  render(html`<div>${watch(outer)}</div>`, owner);

  // This commit runs in the notify microtask, with no render on the stack,
  // and the template it commits installs ANOTHER watch. That nested one has
  // to inherit the same owner, or its own throw has nothing to route to and
  // escapes to the window.
  outer.set(html`<span>${watch(inner)}</span>`);
  await tick();

  inner.set(html`<section title=${poison}>bad</section>`);
  await tick();

  assert.equal(seen.length, 1, 'the nested directive must inherit the owner');
  assert.match(seen[0].message, /boom/);
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
