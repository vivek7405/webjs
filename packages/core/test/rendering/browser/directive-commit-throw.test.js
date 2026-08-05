/**
 * Real-browser assertions for the mid-commit-throw recovery.
 *
 * `repeat()` reconciliation is DOM-identity-sensitive (it MOVES existing
 * nodes rather than rebuilding them), so linkedom alone is not enough to
 * prove the region recovers: the corruption is an orphaned node that no map
 * entry points at, and node identity is the thing that shows it.
 *
 * The throw comes from a value whose `toString` throws, which is what any
 * attribute commit does to its value, so nothing here depends on the
 * form-action guard. Where the poison sits matters: an attribute commit
 * stringifies before touching the DOM, so a throw there changes nothing,
 * while a CHILD commit tears the old content down first and a throw leaves
 * the region empty. Both kinds appear below.
 */
import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';
import { repeat } from '../../../src/repeat.js';
import { watch, ref, asyncReplace } from '../../../src/directives.js';
import { signal } from '../../../src/signal.js';
import { WebComponent } from '../../../src/component.js';

import { assert } from '../../../../../test/browser-assert.js';

/** A value that throws when a commit stringifies it. */
const poison = { toString() { throw new Error('boom'); } };

/**
 * Assert `fn` throws, and that the thrown message matches. The shared
 * `assert.throws` takes a failure MESSAGE as its second argument rather than a
 * matcher, and is async, so passing a regex there would accept ANY throw (a
 * renderer TypeError included) and would not be awaited. These tests depend on
 * the throw being the poison one, so they check it directly.
 */
function throwsMatching(fn, re) {
  let caught;
  try { fn(); } catch (err) { caught = err; }
  assert.ok(caught, 'expected a throw');
  assert.ok(re.test(caught.message), `expected ${re} to match ${caught.message}`);
}

suite('directive commit throws (browser)', () => {
  let container;

  setup(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  teardown(() => {
    container.remove();
  });

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

  const labels = () => [...container.querySelectorAll('li')].map((li) => li.textContent);

  test('a mid-walk throw leaves no orphaned row behind', () => {
    render(rows(good), container);
    assert.deepEqual(labels(), ['one', 'two', 'three']);

    throwsMatching(() => {
      render(rows([
        { id: 1, label: 'one' },
        { id: 2, label: 'two', title: poison },
        { id: 3, label: 'three' },
      ]), container);
    }, /boom/);

    // A fully valid render. Key 1 used to be dropped from the map while its
    // <li> stayed in the document, so a second "one" was built and the
    // orphan was never removed.
    render(rows(good), container);
    assert.deepEqual(labels(), ['one', 'two', 'three']);
    assert.equal(container.querySelectorAll('li').length, 3);

    // Byte-identical on the next render rather than settling into a
    // permanently wrong list.
    render(rows(good), container);
    assert.deepEqual(labels(), ['one', 'two', 'three']);
    assert.equal(container.querySelectorAll('li').length, 3);
  });

  test('every row after recovery is tracked, so a reorder moves it', () => {
    render(rows(good), container);
    throwsMatching(() => {
      render(rows([
        { id: 1, label: 'one' },
        { id: 2, label: 'two', title: poison },
        { id: 3, label: 'three' },
      ]), container);
    }, /boom/);
    render(rows(good), container);

    // Node identity is what proves the rebuilt rows are genuinely owned by
    // the new map: a keyed reorder MOVES the existing element. An orphan
    // left over from the throw is tracked by nothing, so it would neither
    // move nor be removed here.
    const before = [...container.querySelectorAll('li')];
    render(rows([good[2], good[0], good[1]]), container);
    const after = [...container.querySelectorAll('li')];

    assert.deepEqual(after.map((li) => li.textContent), ['three', 'one', 'two']);
    assert.strictEqual(after[0], before[2]);
    assert.strictEqual(after[1], before[0]);
    assert.strictEqual(after[2], before[1]);
  });

  // The `watch` notify microtask commits outside the update cycle, so it
  // routes through the owner stamped at install time. The SHADOW case is the
  // one the unit tests cannot reach: only there does the render root differ
  // from the boundary-carrying element, so only there does `boundaryOwnerOf`
  // have to resolve a ShadowRoot through its `.host`. The light case is kept
  // alongside it as the contrast, against a real component rather than a
  // container with a boundary stamped on it.
  const watchBoundaryTest = (label, shadow, tag) => {
    test(label, async () => {
      const sig = signal(html`<p>ok</p>`);
      const seen = [];
      class WatchHost extends WebComponent({}) {
        static shadow = shadow;
        renderError(err) { seen.push(err); return html`<p>err</p>`; }
        render() { return html`<div>${watch(sig)}</div>`; }
      }
      WatchHost.register(tag);

      const el = document.createElement(tag);
      document.body.appendChild(el);
      await el.updateComplete;
      const root = shadow ? el.shadowRoot : el;
      assert.equal(root.querySelector('p').textContent, 'ok');

      sig.set(html`<section title=${poison}>bad</section>`);
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(seen.length, 1, 'the throw must reach this component');
      assert.equal(seen[0].message, 'boom');
      el.remove();
    });
  };

  watchBoundaryTest(
    'a watch throw in a LIGHT-DOM component reaches its renderError',
    false,
    'commit-throw-light-watcher',
  );
  watchBoundaryTest(
    'a watch throw in a SHADOW-DOM component reaches its renderError',
    true,
    'commit-throw-shadow-watcher',
  );

  test('recovery repositions the SAME row elements rather than rebuilding them', () => {
    render(rows(good), container);
    const before = [...container.querySelectorAll('li')];

    throwsMatching(() => {
      render(rows([
        { id: 1, label: 'one' },
        { id: 2, label: 'two', title: poison },
        { id: 3, label: 'three' },
      ]), container);
    }, /boom/);

    render(rows(good), container);
    const after = [...container.querySelectorAll('li')];

    // The recovery is a plain reconcile against a repaired key map, NOT a
    // teardown-and-rebuild of the region. The distinction is invisible in the
    // markup and very visible to the user: rebuilding detaches every row,
    // which is what keyed reconciliation exists to avoid (it cancels an
    // in-progress native drag, drops focus, and resets scroll). A rebuild
    // would keep 0 of these 3 identities.
    assert.strictEqual(after[0], before[0]);
    assert.strictEqual(after[1], before[1]);
    assert.strictEqual(after[2], before[2]);
  });

  test('a throw in a CHILD hole recovers, and keeps node identity', () => {
    const childRows = (items) => html`<ul>${repeat(
      items,
      (it) => it.id,
      (it) => html`<li>${it.n}</li>`,
    )}</ul>`;
    const ok = [{ id: 1, n: 'one' }, { id: 2, n: 'two' }, { id: 3, n: 'three' }];

    render(childRows(ok), container);
    const before = [...container.querySelectorAll('li')];

    throwsMatching(() => {
      render(childRows([{ id: 1, n: 'one' }, { id: 2, n: poison }, { id: 3, n: 'three' }]), container);
    }, /boom/);

    // A child commit empties the region before it throws, and the failed
    // hole's `lastValues` entry is left un-advanced holding exactly the value
    // this render supplies. Without the commit-failed sentinel the hole is
    // skipped forever and row two stays permanently blank.
    render(childRows(ok), container);
    assert.deepEqual(labels(), ['one', 'two', 'three']);
    render(childRows(ok), container);
    assert.deepEqual(labels(), ['one', 'two', 'three']);

    const after = [...container.querySelectorAll('li')];
    assert.strictEqual(after[0], before[0]);
    assert.strictEqual(after[2], before[2]);
  });

  test('a throwing ref unbind removes the row, and re-adding it builds a new element', () => {
    // The identity facts linkedom cannot prove: the survivor is MOVED rather
    // than rebuilt, and the resurrected key is a genuinely new element rather
    // than the disposed instance handed back.
    const boom = { set value(v) { if (v === undefined) throw new Error('ref-boom'); }, get value() { return null; } };
    const refRows = (items) => html`<ul>${repeat(
      items,
      (it) => it.id,
      (it) => html`<li><span ${it.id === 9 ? ref(boom) : ref({})}>${it.n}</span></li>`,
    )}</ul>`;

    render(refRows([{ id: 1, n: 'a' }, { id: 9, n: 'doomed' }]), container);
    const before = [...container.querySelectorAll('li')];

    render(refRows([{ id: 1, n: 'a' }]), container);
    assert.deepEqual([...container.querySelectorAll('li')].map((li) => li.textContent), ['a']);
    assert.strictEqual(container.querySelector('li'), before[0]);

    render(refRows([{ id: 1, n: 'a' }, { id: 9, n: 'again' }]), container);
    const after = [...container.querySelectorAll('li')];
    assert.deepEqual(after.map((li) => li.textContent), ['a', 'again']);
    assert.strictEqual(after[0], before[0]);
    assert.ok(after[1] !== before[1], 'the disposed instance must not be resurrected');
  });

  test('a refused DOM removal keeps that row keyed, and does not duplicate it', () => {
    // The ref-unbind case above cannot reach the removal loop's own shape,
    // because the guard makes that step unable to throw at all. This drives
    // the throw from the DOM removal instead, in a real browser, where node
    // identity is the thing that separates "reused the row already there"
    // from "built a second one beside it".
    const idRows = (items) => html`<ul>${repeat(
      items,
      (it) => it.id,
      (it) => html`<li>${it.n}</li>`,
    )}</ul>`;

    render(idRows([{ id: 1, n: 'one' }, { id: 2, n: 'two' }, { id: 3, n: 'three' }]), container);
    const [liOne, liTwo, liThree] = [...container.querySelectorAll('li')];

    const ul = container.querySelector('ul');
    const origRemove = ul.removeChild.bind(ul);
    ul.removeChild = (node) => {
      if (node === liThree) throw new Error('rm-boom');
      return origRemove(node);
    };
    throwsMatching(() => { render(idRows([{ id: 1, n: 'one' }]), container); }, /rm-boom/);
    ul.removeChild = origRemove;

    render(idRows([{ id: 1, n: 'one' }, { id: 2, n: 'two' }]), container);
    const after = [...container.querySelectorAll('li')];

    // Key 1 never left the map, so it is the same element. Key 2 left the map
    // together with its row, so it MISSES and rebuilds rather than having a
    // disposed instance handed back.
    assert.strictEqual(after.filter((li) => li === liOne).length, 1);
    assert.ok(!after.includes(liTwo), 'a removed row must not be resurrected');
    assert.strictEqual(after.filter((li) => li.textContent === 'two').length, 1);

    // `liThree` is the named residual: the DOM removal itself refused, so
    // those nodes stayed, and its key was already dropped, so nothing tracks
    // them. What the trade buys is that the region still RECONCILES, which is
    // the assertion that matters and the one only a real browser settles.
    assert.strictEqual(liThree.parentNode, ul);
    render(idRows([{ id: 1, n: 'one' }, { id: 2, n: 'two' }, { id: 4, n: 'four' }]), container);
    assert.deepEqual(
      [...container.querySelectorAll('li')].map((li) => li.textContent).filter((t) => t !== 'three'),
      ['one', 'two', 'four'],
    );
  });

  test('a plain .map() array recovers a shape-changed row without losing identity', () => {
    // The non-keyed reconciler updates in place, so the rows that were NOT
    // rebuilt must survive the recovery as the same elements. linkedom can
    // show the markup is right; only a real DOM can show it was repaired
    // rather than rebuilt.
    const view = (items) => html`<div>${items.map((it) => (
      it.kind === 'a' ? html`<p>${it.v}</p>` : html`<b>${it.v}</b>`
    ))}</div>`;

    render(view([{ kind: 'a', v: '1' }, { kind: 'a', v: '2' }]), container);
    const before = [...container.querySelectorAll('p')];

    throwsMatching(() => {
      render(view([{ kind: 'b', v: '1' }, { kind: 'a', v: poison }]), container);
    }, /boom/);

    render(view([{ kind: 'b', v: '1' }, { kind: 'a', v: '2' }]), container);
    const region = container.querySelector('div');
    assert.deepEqual(
      [...region.children].map((el) => `${el.tagName.toLowerCase()}:${el.textContent}`),
      ['b:1', 'p:2'],
    );
    // Row 1 changed shape and was legitimately rebuilt; row 2 did not, and
    // holding its identity is what proves this is a reconcile against
    // repaired bookkeeping rather than a teardown of the region.
    assert.strictEqual(region.querySelector('p'), before[1]);

    render(view([]), container);
    assert.equal(container.querySelector('div').children.length, 0);
  });

  // A chunk commits from an async loop with no render on the stack, so a
  // directive installed BY that commit has no owner unless the stream part
  // was stamped when it was installed. SHADOW is the case the unit tests
  // cannot reach: only there does the render root differ from the
  // boundary-carrying element, so only there does `boundaryOwnerOf` have to
  // resolve a ShadowRoot through its `.host`.
  const streamBoundaryTest = (label, shadow, tag) => {
    test(label, async () => {
      const inner = signal(html`<p>ok</p>`);
      const seen = [];
      const escaped = [];
      const onError = (e) => { escaped.push(e); };

      class StreamHost extends WebComponent({}) {
        static shadow = shadow;
        renderError(err) { seen.push(err); return html`<p>err</p>`; }
        render() {
          async function* gen() { yield html`<span>${watch(inner)}</span>`; }
          return html`<div>${asyncReplace(gen())}</div>`;
        }
      }
      StreamHost.register(tag);

      const el = document.createElement(tag);
      document.body.appendChild(el);
      await el.updateComplete;
      await new Promise((r) => setTimeout(r, 20));
      const root = shadow ? el.shadowRoot : el;
      assert.equal(root.querySelector('p').textContent, 'ok');

      // Asserting the boundary was called cannot distinguish routed from
      // routed AND also escaped, and escaping is the failure being fixed.
      window.addEventListener('error', onError);
      try {
        inner.set(html`<section title=${poison}>bad</section>`);
        await new Promise((r) => setTimeout(r, 30));
      } finally {
        window.removeEventListener('error', onError);
      }

      assert.equal(seen.length, 1, 'the nested directive must reach THIS component');
      assert.equal(seen[0].message, 'boom');
      assert.equal(escaped.length, 0, 'nothing may reach the window');
      el.remove();
    });
  };

  streamBoundaryTest(
    'a watch nested in an async chunk reaches a LIGHT-DOM component renderError',
    false,
    'stream-throw-light-host',
  );
  streamBoundaryTest(
    'a watch nested in an async chunk reaches a SHADOW-DOM component renderError',
    true,
    'stream-throw-shadow-host',
  );

  test('removing rows after recovery leaves nothing behind', () => {
    render(rows(good), container);
    throwsMatching(() => {
      render(rows([
        { id: 1, label: 'one' },
        { id: 2, label: 'two', title: poison },
        { id: 3, label: 'three' },
      ]), container);
    }, /boom/);
    render(rows(good), container);

    render(rows([]), container);
    assert.equal(container.querySelectorAll('li').length, 0);
  });
});
