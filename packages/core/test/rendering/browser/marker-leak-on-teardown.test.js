/**
 * Real-browser assertions for the teardown that takes its own end marker.
 *
 * The unit suite proves the accounting under linkedom. Two things it cannot
 * reach live here. A component drives its re-renders through the update
 * pipeline rather than a bare `render()` call, so the leak has to be shown on
 * that path too. And linkedom never runs `disconnectedCallback`, while a real
 * browser runs it SYNCHRONOUSLY from inside `removeChild`, so author code
 * executes part-way through the removal walk, on a range the walk is still
 * stepping through. Nothing in the unit suite exercises that at all.
 */
import { html } from '../../../src/html.js';
import { MARKER } from '../../../src/html.js';
import { repeat } from '../../../src/repeat.js';
import { WebComponent } from '../../../src/component.js';

import { assert } from '../../../../../test/browser-assert.js';

let uid = 0;
const tagName = (p) => `${p}-${uid++}`;

const tick = () => new Promise((r) => queueMicrotask(() => queueMicrotask(r)));

/** Count renderer bookends under `root`, at any depth. */
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

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, t: `row ${i}` }));

suite('teardown takes its own end marker', () => {
  test('a component churning a repeat() list stays flat on marker count', async () => {
    const tag = tagName('marker-churn');
    class C extends WebComponent({ items: Array }) {
      constructor() {
        super();
        this.items = rows(4);
      }
      render() {
        return html`<ul>${repeat(this.items, (it) => it.id, (it) => html`<li>${it.t}</li>`)}</ul>`;
      }
    }
    C.register(tag);

    const host = document.createElement(tag);
    document.body.appendChild(host);
    await host.updateComplete;
    await tick();

    try {
      const baseline = countBookends(host);
      assert.equal(baseline.s, baseline.e, 'baseline is paired');
      assert.ok(baseline.e > 0, 'the list really rendered bookends');
      const survivor = host.querySelector('li');

      for (let i = 0; i < 5; i++) {
        host.items = rows(2);
        await host.updateComplete;
        host.items = rows(4);
        await host.updateComplete;
      }
      await tick();

      const got = countBookends(host);
      assert.equal(got.s, got.e, `bookends unpaired: ${got.s} start, ${got.e} end`);
      assert.equal(got.e, baseline.e, 'end markers drifted from baseline');
      assert.equal(host.querySelectorAll('li').length, 4, 'all four rows rendered');
      assert.equal(host.querySelector('li'), survivor, 'a row that never left kept its identity');
    } finally {
      host.remove();
    }
  });

  test('a disconnectedCallback running mid-walk does not derail the removal', async () => {
    // This reds on the reverted fix like the case above (it counts bookends
    // too), but that is not what it is for. It exists to prove the removal
    // finishes, and the region stays renderable, while a `disconnectedCallback`
    // runs synchronously in the middle of the walk, which is the property
    // linkedom cannot express at all.
    //
    // The callback here writes OUTSIDE the range being torn down, which is what
    // ordinary author code does. It deliberately does not move a node the walk
    // is about to step onto: a range mutated underneath the walk overruns, that
    // is true before and after this fix, and this case is not the place to
    // claim otherwise.
    const seen = [];
    // A fixed tag, because a tag NAME is not a hole position in an `html`
    // template; only attribute and child positions are.
    const cellTag = 'marker-leak-cell';
    class Cell extends WebComponent({ label: String }) {
      disconnectedCallback() {
        super.disconnectedCallback?.();
        // Author code, running synchronously from inside `removeChild`, that
        // writes to a container OUTSIDE the range being torn down.
        seen.push(this.label);
        const note = document.createElement('i');
        note.className = 'gone';
        note.textContent = this.label;
        document.querySelector('#marker-sink')?.appendChild(note);
      }
      render() {
        return html`<span>${this.label}</span>`;
      }
    }
    Cell.register(cellTag);

    const tag = tagName('marker-host');
    class C extends WebComponent({ items: Array }) {
      constructor() {
        super();
        this.items = rows(4);
      }
      render() {
        return html`<ul>${repeat(
          this.items,
          (it) => it.id,
          (it) => html`<li><marker-leak-cell label=${it.t}></marker-leak-cell></li>`,
        )}</ul>`;
      }
    }
    C.register(tag);

    const sink = document.createElement('div');
    sink.id = 'marker-sink';
    document.body.appendChild(sink);
    const host = document.createElement(tag);
    document.body.appendChild(host);
    await host.updateComplete;
    await tick();

    try {
      const baseline = countBookends(host);
      assert.equal(baseline.s, baseline.e, 'baseline is paired');

      host.items = rows(1);
      await host.updateComplete;
      await tick();

      assert.ok(seen.length > 0, 'a disconnectedCallback really ran during the removal');
      assert.equal(host.querySelectorAll('li').length, 1, 'the shrink completed');
      assert.equal(host.querySelector('li span').textContent, 'row 0', 'the survivor is intact');

      // The region is still usable: the part marker survived the walk, so a
      // later grow renders back into the same place.
      host.items = rows(4);
      await host.updateComplete;
      await tick();

      assert.equal(host.querySelectorAll('li').length, 4, 'the region still renders after the walk');
      const got = countBookends(host);
      assert.equal(got.s, got.e, `bookends unpaired: ${got.s} start, ${got.e} end`);
      assert.equal(got.e, baseline.e, 'end markers drifted from baseline');
    } finally {
      host.remove();
      sink.remove();
    }
  });
});
