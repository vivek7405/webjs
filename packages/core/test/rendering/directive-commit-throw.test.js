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

let html, render, guard, until, watch, ref, asyncAppend, asyncReplace, repeat, signal;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
  ({ guard, until, watch, ref, asyncAppend, asyncReplace } = await import('../../src/directives.js'));
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

  // Drop keys 2 and 3. Key 2 is processed cleanly; key 3's DOM removal
  // refuses part-way.
  assert.throws(() => { render(rows([{ id: 1, n: 'one' }]), container); }, /rm-boom/);
  ul.removeChild = origRemove;

  // `liThree` is the named residual: `removeBetween` itself refused, so those
  // nodes stayed, and the key was already dropped, so nothing tracks them.
  assert.equal(liThree.parentNode, ul);

  // Re-add BOTH dropped keys in ONE render, with no render in between. That
  // ordering is load-bearing rather than incidental: any render that treats
  // key 3 as a leftover again unmaps it under EITHER unmap ordering (its
  // start marker is gone, so `removeBetween` early-returns and the delete
  // runs), which collapses the difference this test exists to catch. Re-added
  // immediately, key 3 is already unmapped, so it MISSES and builds a fresh
  // row beside the remnant. Unmapping after the removal instead would keep
  // that key pointing at a half-removed row, the re-add would take the reuse
  // branch, and `moveRange` would re-attach the lone start marker AFTER its
  // own end marker.
  render(rows([{ id: 1, n: 'one' }, { id: 2, n: 'two' }, { id: 3, n: 'three' }]), container);
  const at = (text) => [...container.querySelectorAll('li')].filter((li) => li.textContent === text);

  assert.equal(at('one').length, 1);
  assert.equal(at('two').length, 1, 'exactly one row for the re-added key');
  assert.notEqual(at('two')[0], liTwo, 'a disposed instance must not be resurrected');
  assert.equal(at('three').length, 2, 'a fresh row for the re-added key, beside the remnant');

  // And the region is still alive. Under the other ordering the removal below
  // walks off the end of the mis-ordered range and takes the repeat part's
  // own marker with it, after which no render ever lands again.
  render(rows([{ id: 1, n: 'one' }, { id: 2, n: 'two' }, { id: 4, n: 'four' }]), container);
  assert.deepEqual(
    [...container.querySelectorAll('li')].map((li) => li.textContent).filter((t) => t !== 'three'),
    ['one', 'two', 'four'],
    'the region still reconciles rather than being dead',
  );
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

// --- plain .map() arrays (the non-keyed child reconciler) ---

/** Rendered markup of the array region, with the renderer's markers stripped. */
function regionHTML(container) {
  return container.querySelector('div').innerHTML.replace(/<!--[^>]*-->/g, '');
}

// The REPLACE branch is the destructive one: it inserts the replacement and
// removes the old slot BEFORE the walk can finish. An in-place update touches
// only values and cannot reach it. Three different things route there, and
// the cases below cover more than one, because narrowing this to "the
// template shape changed" would leave the others untested: the item's
// template shape changed, its slot KIND changed (text, template, empty), or
// the array GREW past the old length, where there is no old slot to compare
// against at all.

test('array: a mid-walk throw does not strand a row on the next valid render', () => {
  const container = document.createElement('div');
  const view = (items) => html`<div>${items.map((it) => (
    it.kind === 'a' ? html`<p>${it.v}</p>` : html`<b>${it.v}</b>`
  ))}</div>`;

  render(view([{ kind: 'a', v: '1' }, { kind: 'a', v: '2' }]), container);
  assert.equal(regionHTML(container), '<p>1</p><p>2</p>');

  // Item 0 changes shape (destructive) and item 1's child hole then throws.
  assert.throws(() => {
    render(view([{ kind: 'b', v: '1' }, { kind: 'a', v: poison }]), container);
  }, /boom/);

  // The freshly built <b> used to be tracked by nothing, so it survived
  // alongside a rebuilt copy of itself: <b>1</b><b>1</b><p>2</p>.
  render(view([{ kind: 'b', v: '1' }, { kind: 'a', v: '2' }]), container);
  assert.equal(regionHTML(container), '<b>1</b><p>2</p>');

  // Not merely delayed by one render.
  render(view([{ kind: 'b', v: '1' }, { kind: 'a', v: '2' }]), container);
  assert.equal(regionHTML(container), '<b>1</b><p>2</p>');
});

test('array: a GROWN array reaches the same branch, with no shape change at all', () => {
  // Every item here is the same template shape, so nothing about this render
  // is a "shape change". The new tail index simply has no old slot to reuse,
  // which routes it to the same build-insert-remove branch.
  const container = document.createElement('div');
  const view = (items) => html`<div>${items.map((v) => html`<p>${v}</p>`)}</div>`;

  render(view(['1']), container);
  assert.throws(() => { render(view(['1', '2', poison]), container); }, /boom/);

  render(view(['1', '2', '3']), container);
  assert.equal(regionHTML(container), '<p>1</p><p>2</p><p>3</p>');
  render(view([]), container);
  assert.equal(regionHTML(container), '');
});

test('array: an EMPTY render after a throw leaves nothing behind', () => {
  const container = document.createElement('div');
  const view = (items) => html`<div>${items.map((it) => (
    it.kind === 'a' ? html`<p>${it.v}</p>` : html`<b>${it.v}</b>`
  ))}</div>`;

  render(view([{ kind: 'a', v: '1' }, { kind: 'a', v: '2' }]), container);
  assert.throws(() => {
    render(view([{ kind: 'b', v: '1' }, { kind: 'a', v: poison }]), container);
  }, /boom/);

  // The sharpest probe there is: the only code that could remove a slot walks
  // the tracked list, so anything tracked by nothing outlives even a render
  // that asks for no rows at all.
  render(view([]), container);
  assert.equal(regionHTML(container), '');
});

test('array: a throw in the SHRINK loop leaves no slot describing a detached row', () => {
  // The shrink loop advances through the old slots while the replacement list
  // stops growing, so this is the case that separates the processed-slot
  // cursor from the replacement list's length. Splicing from the latter would
  // re-describe an already-removed slot, and the bug only surfaces later, on a
  // render that GROWS the array back.
  const container = document.createElement('div');
  const view = (items) => html`<div>${items.map((v) => html`<p>${v}</p>`)}</div>`;

  render(view(['1', '2', '3', '4']), container);
  const region = container.querySelector('div');
  const fourth = [...region.querySelectorAll('p')][3];

  const origRemove = region.removeChild.bind(region);
  region.removeChild = (node) => {
    if (node === fourth) throw new Error('rm-boom');
    return origRemove(node);
  };

  // Drop the last two. Slot 2 is removed cleanly, slot 3 refuses part-way.
  assert.throws(() => { render(view(['1', '2']), container); }, /rm-boom/);
  region.removeChild = origRemove;

  // Grow back. The already-removed slot must not still be described, or its
  // detached instance matches by shape, is updated in place, and that row
  // silently never appears.
  render(view(['1', '2', '3', '4']), container);
  assert.equal([...region.querySelectorAll('p')].length, 4, 'every row must render');
  assert.deepEqual([...region.querySelectorAll('p')].map((p) => p.textContent), ['1', '2', '3', '4']);
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

    // `fire` may be async: an async-stream case has to let its first chunk
    // commit before the directive nested inside that chunk even exists.
    await fire();
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

// --- asyncAppend / asyncReplace ---

/**
 * Run `fn` with nothing allowed to escape. Asserting only that the boundary
 * was called cannot tell "routed" from "routed AND also escaped", and an
 * escape is the whole failure being fixed here. The commit runs in a
 * microtask, so a `watch` rethrow surfaces as an uncaughtException and a
 * promise rejection as an unhandledRejection; watch for both.
 */
async function assertNothingEscapes(fn) {
  const escaped = [];
  const onUncaught = (err) => { escaped.push(err); };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUncaught);
  try {
    await fn();
    await tick();
  } finally {
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUncaught);
  }
  assert.deepEqual(escaped.map((e) => e?.message ?? String(e)), [], 'nothing may reach the window');
}

// `consumeAsyncStream` is the third out-of-band commit site. It commits with
// no render on the stack, so a directive installed BY that commit used to see
// no owner, was never stamped, and its own later throw fell through to a bare
// rethrow inside a microtask.

for (const [label, makeDirective] of [
  ['asyncAppend', (gen) => asyncAppend(gen)],
  ['asyncReplace', (gen) => asyncReplace(gen)],
]) {
  test(`${label}: a watch nested in a chunk routes its throw to the boundary`, async () => {
    const seen = [];
    const owner = document.createElement('owner-el');
    owner._handleRenderError = (err) => { seen.push(err); };

    const inner = signal(html`<p>b</p>`);
    async function* gen() { yield html`<span>${watch(inner)}</span>`; }
    render(html`<div>${makeDirective(gen())}</div>`, owner);

    await assertNothingEscapes(async () => {
      await tick();
      inner.set(html`<section title=${poison}>bad</section>`);
      await tick();
    });

    assert.equal(seen.length, 1, 'the nested directive must inherit the owner');
    assert.match(seen[0].message, /boom/);
  });
}

test('asyncReplace: an until nested in a chunk routes its throw to the boundary', async () => {
  // The two directives stamp independently, so covering one says nothing
  // about the other.
  const seen = [];
  const owner = document.createElement('owner-el');
  owner._handleRenderError = (err) => { seen.push(err); };

  let resolveIt;
  const pending = new Promise((r) => { resolveIt = r; });
  async function* gen() { yield html`<span>${until(pending, html`<p>fallback</p>`)}</span>`; }
  render(html`<div>${asyncReplace(gen())}</div>`, owner);

  await assertNothingEscapes(async () => {
    await tick();
    resolveIt(html`<section title=${poison}>bad</section>`);
    await tick();
  });

  assert.equal(seen.length, 1);
  assert.match(seen[0].message, /boom/);
});

ownershipTest('asyncAppend: a nested watch routes to the template that owns the part', (owner) => {
  const inner = signal(html`<p>b</p>`);
  async function* gen() { yield html`<span>${watch(inner)}</span>`; }
  render(html`<child-el>${asyncAppend(gen())}</child-el>`, owner);
  return async () => {
    await tick();
    inner.set(html`<section title=${poison}>bad</section>`);
  };
});

test('asyncReplace: the stream\'s OWN chunk commit throw reaches the boundary and stops it', async () => {
  const seen = [];
  const logged = [];
  const owner = document.createElement('owner-el');
  owner._handleRenderError = (err) => { seen.push(err); };

  let yielded = 0;
  async function* gen() {
    yielded++; yield html`<p>${poison}</p>`;
    yielded++; yield html`<p>after</p>`;
  }

  const origError = console.error;
  console.error = (...args) => { logged.push(args.join(' ')); };
  try {
    render(html`<div>${asyncReplace(gen())}</div>`, owner);
    await assertNothingEscapes(async () => { await tick(); });
  } finally {
    console.error = origError;
  }

  // A chunk commit is a render of the component whose template holds the
  // binding, so it belongs to that component's boundary, not to the console.
  // Routing the nested case but not this one would be an indefensible seam.
  assert.equal(seen.length, 1, 'the chunk commit throw must reach the boundary');
  assert.match(seen[0].message, /boom/);
  assert.deepEqual(logged, [], 'and must NOT also be logged as an iteration error');

  // The stream stops: the boundary is about to render an error state, and
  // appending into a region it may have replaced is not a recovery.
  await tick();
  assert.equal(yielded, 1, 'no further chunk may be pulled');
  assert.equal(owner.querySelector('p'), null);
});

test('asyncReplace: an ITERATION throw is unchanged, logged and never routed', async () => {
  const seen = [];
  const logged = [];
  const owner = document.createElement('owner-el');
  owner._handleRenderError = (err) => { seen.push(err); };

  async function* gen() {
    yield html`<p>ok</p>`;
    throw new Error('generator-boom');
  }

  const origError = console.error;
  console.error = (...args) => { logged.push(args.join(' ')); };
  try {
    render(html`<div>${asyncReplace(gen())}</div>`, owner);
    await assertNothingEscapes(async () => { await tick(); });
  } finally {
    console.error = origError;
  }

  // The author's generator failing is not a render, and an author's iterable
  // is expected to handle its own errors. Deliberately left as it was.
  assert.equal(seen.length, 0, 'an iteration throw must NOT reach the boundary');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /generator-boom/);
  // It also ENDS the stream, and always has: the catch used to sit outside
  // the loop, so there has never been a resume path.
  assert.equal(owner.querySelector('p')?.textContent, 'ok');
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
