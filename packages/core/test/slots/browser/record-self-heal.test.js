/**
 * Round-16 review fixes: the record self-heals against legitimate non-record
 * writers (a parent component's hole committed inside a projected slot, a
 * library writing into the assigned container, a raw bypass move), the
 * manual-assignment overlay is honoured everywhere (park step, router seam,
 * last-wins), placement never reparents surviving assigned nodes, and the
 * interceptors keep native error/coercion fidelity for stale-record inputs.
 * Runs in a REAL browser via WTR + Playwright.
 */
import { WebComponent } from '../../../src/component.js';
import { html, MARKER } from '../../../src/html.js';
import { repeat, cache, asyncAppend } from '../../../src/directives.js';
import { projectAuthored, isAuthoredContentSlot } from '../../../src/slot.js';

import { assert } from '../../../../../test/browser-assert.js';

function tick() {
  return new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
}

/** Bounded poll so async-path tests never race a loaded CI runner. */
async function waitFor(cond, budgetMs = 2000) {
  const start = Date.now();
  while (!cond() && Date.now() - start < budgetMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

let n = 0;
const tagName = (p) => `${p}-${n++}`;

async function mount(tag, render) {
  class C extends WebComponent {
    render() { return render(); }
  }
  C.register(tag);
  const host = document.createElement(tag);
  document.body.appendChild(host);
  await tick();
  return host;
}

/** Shared slotted shell, defined once so every test can run in isolation. */
const fixedShell = 'heal-shell-fixed';
function ensureFixedShell() {
  if (!customElements.get(fixedShell)) {
    class FixedShell extends WebComponent {
      render() { return html`<div class="shell"><slot></slot></div>`; }
    }
    FixedShell.register(fixedShell);
  }
}

suite('Record self-heal + overlay coherence (review round 16)', () => {
  test('a parent hole committed inside the slot SURVIVES a later record-driven apply', async () => {
    // The one-writer seam: the parent's child-part marker projects into the
    // child's slot, so array growth commits divB directly there with no
    // record fold. The author's appendChild must not destroy it.
    ensureFixedShell();
    const parentTag2 = tagName('heal-parent2');
    class Parent2 extends WebComponent({ items: Array }) {
      constructor() { super(); this.items = ['a']; }
      render() {
        return html`<heal-shell-fixed>${this.items.map(
          (i) => html`<p class="item">${i}</p>`,
        )}</heal-shell-fixed>`;
      }
    }
    Parent2.register(parentTag2);
    const parent = document.createElement(parentTag2);
    document.body.appendChild(parent);
    await tick();
    try {
      const shell = parent.querySelector(fixedShell);
      const slot = shell.querySelector('slot[data-webjs-light]');
      assert.equal(slot.querySelectorAll('.item').length, 1, 'one item projected');

      parent.items = ['a', 'b'];
      await parent.updateComplete;
      await tick();
      assert.equal(slot.querySelectorAll('.item').length, 2, 'renderer grew the list inside the slot');

      // The sanctioned author write that used to wipe the renderer's node.
      const extra = document.createElement('aside');
      extra.id = 'author-extra';
      shell.appendChild(extra);
      await tick();
      assert.equal(slot.querySelectorAll('.item').length, 2, 'renderer-committed item SURVIVED the apply');
      assert.ok(slot.querySelector('#author-extra'), 'the author write landed too');

      // The surviving node is still LIVE renderer DOM: a later parent update
      // must reach it (a detached part target would go nowhere).
      parent.items = ['a', 'B2'];
      await parent.updateComplete;
      await tick();
      const texts = Array.from(slot.querySelectorAll('.item')).map((e) => e.textContent);
      assert.deepEqual(texts, ['a', 'B2'], 'the part still updates the surviving node in place');
    } finally {
      parent.remove();
    }
  });

  test('a renderer REMOVAL inside the slot is adopted (no resurrection)', async () => {
    ensureFixedShell();
    const parentTag = tagName('heal-shrink');
    class P extends WebComponent({ items: Array }) {
      constructor() { super(); this.items = ['a', 'b']; }
      render() {
        return html`<heal-shell-fixed>${this.items.map(
          (i) => html`<p class="item">${i}</p>`,
        )}</heal-shell-fixed>`;
      }
    }
    P.register(parentTag);
    const parent = document.createElement(parentTag);
    document.body.appendChild(parent);
    await tick();
    try {
      const shell = parent.querySelector(fixedShell);
      const slot = shell.querySelector('slot[data-webjs-light]');
      assert.equal(slot.querySelectorAll('.item').length, 2, 'two items projected');
      parent.items = ['a'];
      await parent.updateComplete;
      await tick();
      assert.equal(slot.querySelectorAll('.item').length, 1, 'renderer shrank the list');
      shell.appendChild(document.createElement('aside'));
      await tick();
      assert.equal(slot.querySelectorAll('.item').length, 1, 'the removed item was NOT resurrected');
    } finally {
      parent.remove();
    }
  });

  test('a list churning inside the slot leaves no bookends behind and does not perturb the record', async () => {
    // A teardown removes the row's own boundary markers, and inside a slot that
    // removal is seen by the backstop as one extra `removedNodes` entry per
    // row. Those comments were never in the authored record (they sit between
    // the host instance's own bookends, so `instanceOwns` claims them for the
    // renderer), so churning the list must leave the record and the assignment
    // exactly where they started. The marker count is asserted directly,
    // because the leak is invisible to `querySelectorAll`.
    ensureFixedShell();
    const parentTag = tagName('heal-churn');
    const rows = (n) => Array.from({ length: n }, (_, i) => `i${i}`);
    class P extends WebComponent({ items: Array }) {
      constructor() { super(); this.items = rows(4); }
      render() {
        return html`<heal-shell-fixed>${this.items.map(
          (i) => html`<p class="item">${i}</p>`,
        )}</heal-shell-fixed>`;
      }
    }
    P.register(parentTag);
    const parent = document.createElement(parentTag);
    document.body.appendChild(parent);
    await tick();
    try {
      const shell = parent.querySelector(fixedShell);
      const slot = shell.querySelector('slot[data-webjs-light]');
      // Reads MARKER for the prefix, but spells the `e` suffix here, so it
      // still tracks only half the marker text. The non-zero assertion below
      // is what actually stops a counter that has gone blind from passing on
      // 0 against 0; reading MARKER on its own would not.
      const endMarkers = (root) =>
        [...root.childNodes].filter((n) => n.nodeType === 8 && n.data === `${MARKER}e`).length;

      assert.equal(slot.querySelectorAll('.item').length, 4, 'four items projected');
      const baseMarkers = endMarkers(slot);
      assert.ok(baseMarkers > 0, 'the projected rows really carry end markers to count');
      const baseAssigned = slot.assignedNodes().length;

      for (let i = 0; i < 5; i++) {
        parent.items = rows(1);
        await parent.updateComplete;
        await tick();
        parent.items = rows(4);
        await parent.updateComplete;
        await tick();
      }

      assert.equal(endMarkers(slot), baseMarkers, 'end markers under the slot drifted');
      assert.equal(slot.querySelectorAll('.item').length, 4, 'all four items are projected again');
      assert.equal(slot.assignedNodes().length, baseAssigned, 'the assigned set drifted');
    } finally {
      parent.remove();
    }
  });

  test('a library write into the assigned container survives the next apply', async () => {
    const tag = tagName('lib-write');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      // The documented target for generic DOM libraries: the assigned
      // container, NOT the host. A sortable/virtualizer writing here is a
      // legitimate non-record writer.
      const libNode = document.createElement('u');
      libNode.id = 'lib-node';
      slot.appendChild(libNode);
      host.appendChild(document.createElement('strong'));
      await tick();
      assert.ok(slot.querySelector('#lib-node'), 'the library node survived the record-driven apply');
      assert.equal(slot.children.length, 3, 'em + lib node + strong all present');
    } finally {
      host.remove();
    }
  });

  test('assign() of an attribute-less node onto a NAMED slot sticks (no self-park)', async () => {
    const tag = tagName('assign-named');
    const host = await mount(tag, () => html`<div><slot name="x"></slot></div>`);
    try {
      const div = document.createElement('div');
      div.id = 'no-attr';
      host.appendChild(div); // no slot attribute, no default slot: parked
      await tick();
      const xSlot = host.querySelector('slot[name="x"]');
      assert.ok(!xSlot.contains(div), 'starts parked (no matching name)');
      xSlot.assign(div);
      await tick();
      assert.equal(div.parentElement, xSlot, 'manual assign placed it in slot x');
      // A later unrelated apply must not park it back out (the park step now
      // uses the same effective key as repartition).
      host.appendChild(document.createElement('span'));
      await tick();
      assert.equal(div.parentElement, xSlot, 'STAYED in slot x across the next apply');
    } finally {
      host.remove();
    }
  });

  test('appending a sibling never reparents surviving assigned nodes', async () => {
    if (!customElements.get('reparent-probe')) {
      class Probe extends HTMLElement {
        constructor() { super(); this.connects = 0; }
        connectedCallback() { this.connects += 1; }
      }
      customElements.define('reparent-probe', Probe);
    }
    const tag = tagName('no-reparent');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const a = document.createElement('a-el');
      const probe = document.createElement('reparent-probe');
      const c = document.createElement('c-el');
      host.append(a, probe, c);
      await tick();
      assert.equal(probe.connects, 1, 'probe connected once on placement');
      host.appendChild(document.createElement('d-el'));
      await tick();
      assert.equal(probe.connects, 1, 'appending d did NOT bounce the probe through disconnect/connect');
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(slot.children.length, 4, 'all four assigned');
    } finally {
      host.remove();
    }
  });

  test('a raw bypass MOVE back onto the host is repaired with no slotchange', async () => {
    const tag = tagName('bypass-move');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const child = document.createElement('p');
      host.appendChild(child);
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(child.parentElement, slot, 'projected');
      let fires = 0;
      slot.addEventListener('slotchange', () => { fires += 1; });
      // Raw native call: moves the node from the slot to a direct host child,
      // observed only by the backstop.
      Node.prototype.appendChild.call(host, child);
      assert.equal(child.parentElement, host, 'bypass-moved to a direct host child');
      await tick();
      await tick();
      assert.equal(child.parentElement, slot, 'repaired back into the slot');
      assert.equal(fires, 0, 'no slotchange: the assigned SET never changed');
    } finally {
      host.remove();
    }
  });

  test('slotchange fires for a mutation made while the host is disconnected', async () => {
    const tag = tagName('detached-change');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      let fires = 0;
      slot.addEventListener('slotchange', () => { fires += 1; });
      host.remove();
      host.appendChild(document.createElement('strong')); // interception is live for life
      await tick();
      assert.equal(fires, 1, 'the event was delivered, not silently dropped');
      assert.equal(slot.children.length, 2, 'assignment applied while disconnected');
    } finally {
      host.remove();
    }
  });

  test('manual assignment is LAST-assign-wins across slots', async () => {
    const tag = tagName('last-wins');
    const host = await mount(tag, () => html`<div><slot name="a"></slot><slot name="b"></slot></div>`);
    try {
      const slotA = host.querySelector('slot[name="a"]');
      const slotB = host.querySelector('slot[name="b"]');
      const child = document.createElement('x-el');
      host.appendChild(child);
      slotA.assign(child);
      await tick();
      assert.equal(child.parentElement, slotA, 'assigned to a');
      slotB.assign(child);
      await tick();
      assert.equal(child.parentElement, slotB, 'the LATER assign wins (native semantics)');
    } finally {
      host.remove();
    }
  });

  test('append(42) coerces to the text "42" (WebIDL Node-or-DOMString)', async () => {
    const tag = tagName('coerce');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.append(42, null);
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(slot.textContent, '42null', 'non-Node args stringified like native');
    } finally {
      host.remove();
    }
  });

  test('an orphan light slot reports NO assigned nodes', async () => {
    const orphan = document.createElement('slot');
    orphan.setAttribute('data-webjs-light', '');
    orphan.textContent = 'fallback';
    document.body.appendChild(orphan);
    try {
      assert.deepEqual(orphan.assignedNodes(), [], 'no data-projection means nothing is assigned');
    } finally {
      orphan.remove();
    }
  });

  test('removeChild of a node bypass-moved into a fragment throws NotFoundError', async () => {
    const tag = tagName('stale-remove');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const child = document.createElement('p');
      host.appendChild(child);
      await tick();
      document.createDocumentFragment().appendChild(child); // out-of-band move
      let threw = null;
      try { host.removeChild(child); } catch (e) { threw = e; }
      assert.equal(threw && threw.name, 'NotFoundError', 'native fidelity for a stale record entry');
    } finally {
      host.remove();
    }
  });

  test('a write during the unfinalized-slot window does not corrupt the record (nested-template slot)', async () => {
    // A slot inside a NESTED TemplateResult hole gets its slot-part finalize
    // deferred one microtask on the first client render. A write landing in
    // that window (firstUpdated is the canonical author spot) used to treat
    // the unfinalized slot as fallback-mode: it destroyed the compiled
    // fallback, then the deferred finalize hijacked the placed nodes as
    // "fallback", leaving visible-but-record-dead content.
    const tag = tagName('unfinalized-write');
    class C extends WebComponent {
      firstUpdated() {
        const el = document.createElement('mark');
        el.textContent = 'window-write';
        this.appendChild(el);
      }
      render() {
        return html`<div>${html`<slot>compiled fallback</slot>`}</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    document.body.appendChild(host);
    await tick();
    await tick();
    try {
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(slot.getAttribute('data-projection'), 'actual', 'slot settled as ACTUAL');
      const assigned = slot.assignedNodes();
      assert.ok(
        assigned.some((n) => n.textContent === 'window-write'),
        'the window write is record-live (assignedNodes sees it)',
      );
      assert.ok(!slot.textContent.includes('compiled fallback'), 'fallback not shown with content present');
      // The fallback must have SURVIVED (not been destroyed): remove the
      // content and the compiled fallback must come back.
      const el = assigned.find((n) => n.textContent === 'window-write');
      host.removeChild(el);
      await tick();
      assert.ok(slot.textContent.includes('compiled fallback'), 'compiled fallback restored after removal');
    } finally {
      host.remove();
    }
  });

  test('an author write does not revert a pending renderer reorder of OTHER nodes', async () => {
    // Node-scoped order authority: the parent reorders a keyed list inside
    // the shell's slot (no apply fires), then the author appends a banner.
    // The append must land at the end WITHOUT fighting the reorder back.
    ensureFixedShell();
    const parentTag = tagName('reorder-keep');
    class P extends WebComponent({ items: Array }) {
      constructor() { super(); this.items = ['a', 'b']; }
      render() {
        return html`<heal-shell-fixed>${repeat(
          this.items,
          (i) => i,
          (i) => html`<p class="item">${i}</p>`,
        )}</heal-shell-fixed>`;
      }
    }
    P.register(parentTag);
    const parent = document.createElement(parentTag);
    document.body.appendChild(parent);
    await tick();
    try {
      const shell = parent.querySelector('heal-shell-fixed');
      const slot = shell.querySelector('slot[data-webjs-light]');
      parent.items = ['b', 'a']; // keyed reorder INSIDE the slot
      await parent.updateComplete;
      await tick();
      assert.deepEqual(
        Array.from(slot.querySelectorAll('.item')).map((e) => e.textContent),
        ['b', 'a'],
        'renderer reordered in place',
      );
      const banner = document.createElement('aside');
      banner.id = 'kept-banner';
      shell.appendChild(banner); // the record op that used to revert the order
      await tick();
      assert.deepEqual(
        Array.from(slot.querySelectorAll('.item')).map((e) => e.textContent),
        ['b', 'a'],
        'the reorder SURVIVED the author write',
      );
      assert.ok(slot.querySelector('#kept-banner'), 'the banner landed');
      assert.equal(slot.lastElementChild.id, 'kept-banner', 'appended at the end');
    } finally {
      parent.remove();
    }
  });

  test('appendChild of a non-Node throws TypeError with zero record change', async () => {
    const tag = tagName('arg-validity');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      let threw = null;
      try { host.appendChild(/** @type {any} */ ({})); } catch (e) { threw = e; }
      assert.ok(threw instanceof TypeError, 'TypeError like native');
      assert.equal(slot.children.length, 1, 'record and placement untouched');
      host.appendChild(document.createElement('strong')); // still functional
      assert.equal(slot.children.length, 2, 'later writes unaffected');
    } finally {
      host.remove();
    }
  });

  test('assign() on the SECOND duplicate slot targets that element', async () => {
    const tag = tagName('dup-assign');
    const host = await mount(tag, () => html`<div><slot name="x"></slot><slot name="x"></slot></div>`);
    try {
      const dupes = host.querySelectorAll('slot[name="x"]');
      const child = document.createElement('span');
      host.appendChild(child);
      dupes[1].assign(child);
      await tick();
      assert.equal(child.parentElement, dupes[1], 'manual assignment bound to the RECEIVING element');
      assert.ok(!dupes[0].contains(child), 'not routed to the first-wins duplicate');
    } finally {
      host.remove();
    }
  });

  test('assign() before the node is a child is honoured on the later append', async () => {
    const tag = tagName('assign-first');
    const host = await mount(tag, () => html`<div><slot></slot><slot name="x"></slot></div>`);
    try {
      const slots = host.querySelectorAll('slot[data-webjs-light]');
      const xSlot = slots[1];
      const node = document.createElement('span'); // detached, no slot attr
      xSlot.assign(node); // native-legal ordering: assign first
      host.appendChild(node); // append later
      await tick();
      assert.equal(node.parentElement, xSlot, 'the earlier manual assignment routed the append');
    } finally {
      host.remove();
    }
  });

  test('a manual assignment to a TORN-DOWN slot element goes dormant, not lost', async () => {
    // Element-keyed assign() + a conditional re-render that disposes and
    // recreates the slot: the dead element must not keep excluding the node
    // from every slot (permanent limbo). The node falls back to attribute
    // routing (here: parked, connected) while the entry stays dormant.
    const tag = tagName('dead-target');
    class C extends WebComponent({ open: Boolean }) {
      constructor() { super(); this.open = true; }
      render() {
        return this.open
          ? html`<div><slot name="x"></slot></div>`
          : html`<div>closed</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    document.body.appendChild(host);
    await tick();
    try {
      const oldSlot = host.querySelector('slot[name="x"]');
      const node = document.createElement('span');
      node.id = 'dormant-node';
      host.appendChild(node); // no slot attr
      oldSlot.assign(node);
      await tick();
      assert.equal(node.parentElement, oldSlot, 'manually assigned');
      host.open = false; // tears the slot down
      await host.updateComplete;
      await tick();
      host.open = true; // recreates a NEW slot element with the same name
      await host.updateComplete;
      await tick();
      await tick();
      assert.ok(node.isConnected, 'node still connected (not lost in limbo)');
      // The dead-element entry is dormant: the attribute-less node parks
      // (native unassigned-but-connected) rather than vanishing.
      assert.equal(
        node.parentElement.tagName.toLowerCase(),
        'wj-slot-park',
        'fell back to attribute routing (parked)',
      );
    } finally {
      host.remove();
    }
  });

  test('content written in the unfinalized window is placed with NO park bounce', async () => {
    if (!customElements.get('reparent-probe')) {
      class Probe extends HTMLElement {
        constructor() { super(); this.connects = 0; }
        connectedCallback() { this.connects += 1; }
      }
      customElements.define('reparent-probe', Probe);
    }
    const tag = tagName('window-probe');
    class C extends WebComponent {
      firstUpdated() {
        const probe = document.createElement('reparent-probe');
        this.appendChild(probe);
      }
      render() {
        return html`<div>${html`<slot></slot>`}</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    document.body.appendChild(host);
    await tick();
    await tick();
    try {
      const probe = host.querySelector('reparent-probe');
      assert.ok(probe, 'probe placed');
      assert.equal(probe.parentElement.tagName.toLowerCase(), 'slot', 'in the slot');
      assert.equal(
        /** @type {any} */ (probe).connects,
        1,
        'connected exactly once: never bounced through the park while the slot was pending',
      );
    } finally {
      host.remove();
    }
  });

  test('replaceChildren fully replaces even when a third writer diverged the slot', async () => {
    const tag = tagName('wholesale-diverge');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const a = document.createElement('a-el');
      host.appendChild(a);
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      // Third-writer divergence: a library node directly in the container.
      const lib = document.createElement('u');
      lib.id = 'lib';
      slot.appendChild(lib);
      // Wholesale replacement: the displaced children must NOT resurrect.
      const fresh = document.createElement('strong');
      host.replaceChildren(fresh);
      await tick();
      assert.ok(!slot.contains(a), 'displaced child did not resurrect');
      assert.ok(slot.contains(fresh), 'new content placed');
      assert.ok(slot.contains(lib), 'the third writer node was folded, not destroyed');
    } finally {
      host.remove();
    }
  });

  test('removeChild drops the node even when a renderer write diverged the slot', async () => {
    const tag = tagName('remove-diverge');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const a = document.createElement('a-el');
      const b = document.createElement('b-el');
      host.append(a, b);
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      slot.appendChild(document.createElement('u')); // divergence
      host.removeChild(a);
      await tick();
      assert.ok(!slot.contains(a), 'removed node is gone (not resurrected by the resync)');
      assert.ok(!a.isConnected, 'detached like native');
      assert.ok(slot.contains(b), 'sibling intact');
    } finally {
      host.remove();
    }
  });

  test('a rename of the receiving slot carries its manual assignment along', async () => {
    const tag = tagName('rename-manual');
    const host = await mount(tag, () => html`<div><slot name="x"></slot><slot name="y"></slot></div>`);
    try {
      const xSlot = host.querySelector('slot[name="x"]');
      const node = document.createElement('span');
      node.setAttribute('slot', 'y'); // attribute says y
      host.appendChild(node);
      await tick();
      xSlot.assign(node); // manual overrides to x
      await tick();
      assert.equal(node.parentElement, xSlot, 'manually in x');
      xSlot.setAttribute('name', 'z'); // rename the RECEIVING element
      await tick();
      await tick();
      assert.equal(node.parentElement, xSlot, 'assignment followed the ELEMENT through the rename');
    } finally {
      host.remove();
    }
  });

  test('appendChild of a non-insertable Node throws HierarchyRequestError untouched', async () => {
    const tag = tagName('bad-nodetype');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      let threw = null;
      try { host.appendChild(/** @type {any} */ (document.createAttribute('data-x'))); } catch (e) { threw = e; }
      assert.equal(threw && threw.name, 'HierarchyRequestError', 'Attr rejected like native');
      assert.equal(slot.children.length, 1, 'zero state change');
    } finally {
      host.remove();
    }
  });

  test('slots inside a repeat() item finalize and project (client-only mount)', async () => {
    // buildDetached items apply their slot parts like every other template
    // path; the deferred finalize retry lands after the caller's synchronous
    // insert. Without it, content for these slots was permanently
    // unplaceable (excluded from placement AND exempted from the park).
    const tag = tagName('repeat-slots');
    class C extends WebComponent({ names: Array }) {
      constructor() { super(); this.names = ['top', 'side']; }
      render() {
        return html`<div>${repeat(
          this.names,
          (n) => n,
          (n) => html`<section><slot name=${n}></slot></section>`,
        )}</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    const a = document.createElement('em');
    a.setAttribute('slot', 'top');
    a.textContent = 'TOP';
    const b = document.createElement('strong');
    b.setAttribute('slot', 'side');
    b.textContent = 'SIDE';
    host.append(a, b);
    document.body.appendChild(host);
    await tick();
    await tick();
    try {
      const slots = host.querySelectorAll('slot[data-webjs-light]');
      assert.equal(slots.length, 2, 'both repeat-item slots rendered');
      assert.ok(slots[0].contains(a), 'first item slot received its content');
      assert.ok(slots[1].contains(b), 'second item slot received its content');
      assert.equal(slots[0].getAttribute('data-projection'), 'actual', 'finalized + applied');
    } finally {
      host.remove();
    }
  });

  test('a library write into a NAMED slot stays in that slot (adopted key)', async () => {
    const tag = tagName('named-fold');
    const host = await mount(
      tag,
      () => html`<div><slot></slot><slot name="side"></slot></div>`,
    );
    try {
      const child = document.createElement('em');
      child.setAttribute('slot', 'side');
      host.appendChild(child);
      await tick();
      const sideSlot = host.querySelector('slot[name="side"]');
      // The sanctioned third-party write: into the assigned CONTAINER of a
      // NAMED slot, with a node that has no slot attribute.
      const badge = document.createElement('u');
      badge.id = 'badge';
      sideSlot.appendChild(badge);
      // Any record-driven apply used to teleport it to the default slot.
      host.appendChild(document.createElement('span'));
      await tick();
      assert.equal(badge.parentElement, sideSlot, 'the badge STAYED in the named slot');
      // An explicit later slot= change still wins over the adoption.
      badge.setAttribute('slot', '');
      await tick();
      await tick();
      const defSlot = host.querySelector('slot[data-webjs-light]:not([name])');
      assert.ok(defSlot.contains(badge), 'explicit attribute reclaimed routing');
    } finally {
      host.remove();
    }
  });

  test('projectAuthored preserves the slot= attribute of a manually assigned node', async () => {
    const tag = tagName('proj-attr-keep');
    const host = await mount(
      tag,
      () => html`<div><slot></slot><slot name="side"></slot></div>`,
    );
    try {
      const el = document.createElement('em');
      el.setAttribute('slot', 'side');
      host.appendChild(el);
      await tick();
      const slots = host.querySelectorAll('slot[data-webjs-light]');
      const defSlot = slots[0];
      defSlot.assign(el); // manual: element-bound to the DEFAULT slot
      await tick();
      assert.equal(el.parentElement, defSlot, 'manually in the default slot');
      // The router's morph re-projects the default slice from its physical
      // children; the manual node's latent attribute must survive.
      projectAuthored(host, null, Array.from(defSlot.childNodes));
      await tick();
      assert.equal(el.getAttribute('slot'), 'side', 'latent slot= attribute intact');
      assert.equal(el.parentElement, defSlot, 'still manually routed');
      // Releasing the overlay restores attribute routing.
      defSlot.assign();
      await tick();
      assert.equal(el.parentElement, slots[1], 'released back to the named slot');
    } finally {
      host.remove();
    }
  });

  test('a BATCH of slot= flips clears every adoption (no first-record early exit)', async () => {
    const tag = tagName('batch-flip');
    const host = await mount(
      tag,
      () => html`<div><slot></slot><slot name="a"></slot><slot name="b"></slot></div>`,
    );
    try {
      const aSlot = host.querySelector('slot[name="a"]');
      const bSlot = host.querySelector('slot[name="b"]');
      // Attribute-routed content puts both named slots in ACTUAL mode (the
      // self-heal only folds applied actual slots).
      const seedA = document.createElement('span');
      seedA.setAttribute('slot', 'a');
      const seedB = document.createElement('span');
      seedB.setAttribute('slot', 'b');
      host.append(seedA, seedB);
      await tick();
      // Two library writes create two adoptions.
      const n1 = document.createElement('u');
      const n2 = document.createElement('i');
      aSlot.appendChild(n1);
      bSlot.appendChild(n2);
      host.appendChild(document.createElement('em')); // fold both adoptions
      await tick();
      assert.equal(n1.parentElement, aSlot, 'n1 adopted into a');
      assert.equal(n2.parentElement, bSlot, 'n2 adopted into b');
      // BOTH flips in one task = one MutationObserver batch.
      n1.setAttribute('slot', '');
      n2.setAttribute('slot', '');
      await tick();
      await tick();
      const defSlot = host.querySelector('slot[data-webjs-light]:not([name])');
      assert.ok(defSlot.contains(n1), 'first flip honoured');
      assert.ok(defSlot.contains(n2), 'SECOND flip honoured too (no early exit)');
    } finally {
      host.remove();
    }
  });

  test('an author record op on an adopted node restores attribute routing', async () => {
    const tag = tagName('op-clears-adopt');
    const host = await mount(
      tag,
      () => html`<div><slot></slot><slot name="side"></slot></div>`,
    );
    try {
      const seed = document.createElement('span');
      seed.setAttribute('slot', 'side'); // puts the side slot in ACTUAL mode
      host.appendChild(seed);
      await tick();
      const sideSlot = host.querySelector('slot[name="side"]');
      const node = document.createElement('u');
      sideSlot.appendChild(node); // library write
      host.appendChild(document.createElement('em')); // fold: node adopted to side
      await tick();
      assert.equal(node.parentElement, sideSlot, 'adopted into side');
      // Author takes over: detach + re-append via the record API in ways the
      // flip sensor never sees. Attribute intent (no attr = default) wins.
      host.removeChild(node);
      host.appendChild(node);
      await tick();
      const defSlot = host.querySelector('slot[data-webjs-light]:not([name])');
      assert.ok(defSlot.contains(node), 'record op ended the adoption; attribute routing resumed');
    } finally {
      host.remove();
    }
  });

  test('a slot inside asyncAppend chunk content finalizes and projects', async () => {
    const tag = tagName('stream-chunk-slot');
    async function* gen() {
      yield html`<section><slot name="x"></slot></section>`;
    }
    class C extends WebComponent {
      render() { return html`<div>${asyncAppend(gen())}</div>`; }
    }
    C.register(tag);
    const host = document.createElement(tag);
    const child = document.createElement('em');
    child.setAttribute('slot', 'x');
    child.textContent = 'streamed-slot-content';
    host.appendChild(child);
    document.body.appendChild(host);
    // Let the chunk land + the deferred finalize + its queued apply run.
    await waitFor(
      () => host.querySelector('slot[name="x"]')?.getAttribute('data-projection') === 'actual',
    );
    await tick();
    try {
      const slot = host.querySelector('slot[name="x"]');
      assert.ok(slot, 'the chunk slot rendered');
      assert.equal(slot.getAttribute('data-projection'), 'actual', 'finalized and applied');
      assert.ok(slot.contains(child), 'authored content projected into the streamed slot');
    } finally {
      host.remove();
    }
  });

  test('cache() toggle-back re-applies: parked content returns to the slot', async () => {
    const tag = tagName('cache-slot');
    class C extends WebComponent({ showA: Boolean }) {
      constructor() { super(); this.showA = true; }
      render() {
        return html`<div>${cache(
          this.showA ? html`<slot name="x"></slot>` : html`<em>alt</em>`,
        )}</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    const child = document.createElement('strong');
    child.setAttribute('slot', 'x');
    child.textContent = 'cached-away';
    host.appendChild(child);
    document.body.appendChild(host);
    await tick();
    try {
      assert.equal(child.parentElement.getAttribute('name'), 'x', 'projected initially');
      host.showA = false; // stash the branch (slot + child leave the doc)
      await host.updateComplete;
      // An authored write while stashed: the apply cannot reach the stashed
      // slot, so the child parks (or is held by the record).
      host.appendChild(document.createElement('span'));
      await tick();
      host.showA = true; // re-attach the cached branch
      await host.updateComplete;
      await tick();
      await tick();
      const slot = host.querySelector('slot[name="x"]');
      assert.ok(slot, 'slot re-attached');
      assert.ok(slot.contains(child), 'the child RETURNED to the slot on toggle-back (no strand)');
      assert.ok(child.isConnected, 'connected');
    } finally {
      host.remove();
    }
  });

  test('a snapshot restore keeps an adopted node in the slot the markup shows', async () => {
    const tag = tagName('restore-adopt');
    const host = await mount(
      tag,
      () => html`<div><slot></slot><slot name="side"></slot></div>`,
    );
    const holder = document.createElement('div');
    try {
      const seed = document.createElement('span');
      seed.setAttribute('slot', 'side');
      host.appendChild(seed);
      await tick();
      const sideSlot = host.querySelector('slot[name="side"]');
      const lib = document.createElement('u');
      lib.id = 'restored-adopted';
      sideSlot.appendChild(lib); // library write
      host.appendChild(document.createElement('em')); // fold: adopted to side
      await tick();
      assert.equal(lib.parentElement, sideSlot, 'adopted before snapshot');

      const serialized = host.outerHTML; // lib sits in the side slot, NO attribute
      host.remove();
      await tick();
      document.body.appendChild(holder);
      holder.innerHTML = serialized.replace('data-wj-host', 'data-wj-host data-wj-serialized');
      await tick();
      await tick();
      const restored = holder.querySelector(tag);
      const relib = restored.querySelector('#restored-adopted');
      assert.ok(relib, 'node restored');
      const reSide = restored.querySelector('slot[name="side"]');
      assert.ok(reSide.contains(relib), 'STAYED in the slot the restored markup showed it in');
    } finally {
      host.remove();
      holder.remove();
    }
  });

  test('projectAuthored on an ADOPTED node ends its adoption (router takes over)', async () => {
    const tag = tagName('proj-clears-adopt');
    const host = await mount(
      tag,
      () => html`<div><slot></slot><slot name="side"></slot></div>`,
    );
    try {
      const seed = document.createElement('span');
      seed.setAttribute('slot', 'side');
      host.appendChild(seed);
      await tick();
      const sideSlot = host.querySelector('slot[name="side"]');
      const node = document.createElement('u');
      sideSlot.appendChild(node); // library write
      host.appendChild(document.createElement('em')); // fold: adopted to side
      await tick();
      assert.equal(node.parentElement, sideSlot, 'adopted into side');
      // The router seam projects the node into the DEFAULT slice (a morph
      // list can contain it). The projection is a record op: the adoption
      // must end, and the node (attribute-less after the stamp) must route
      // to the default slot and STAY there on later applies.
      projectAuthored(host, null, [node]);
      await tick();
      const defSlot = host.querySelector('slot[data-webjs-light]:not([name])');
      assert.ok(defSlot.contains(node), 'projected into the default slice');
      host.appendChild(document.createElement('i')); // a later unrelated apply
      await tick();
      assert.ok(defSlot.contains(node), 'no stale adoption pulled it back to side');
    } finally {
      host.remove();
    }
  });

  test('a slot= flip on a node detached in the SAME task still clears its adoption', async () => {
    const tag = tagName('detached-flip-clear');
    const host = await mount(
      tag,
      () => html`<div><slot></slot><slot name="side"></slot></div>`,
    );
    try {
      const seed = document.createElement('span');
      seed.setAttribute('slot', 'side');
      host.appendChild(seed);
      await tick();
      const sideSlot = host.querySelector('slot[name="side"]');
      const node = document.createElement('u');
      sideSlot.appendChild(node); // library write
      host.appendChild(document.createElement('em')); // fold: adopted to side
      await tick();
      assert.equal(node.parentElement, sideSlot, 'adopted into side');
      // Same task: explicit attribute change, then a RAW-NATIVE detach that
      // bypasses interception (so commitAuthored's own adoption-clear never
      // runs). The sensor batch arrives with the node departed; the
      // unconditional delete must run anyway, or the later re-append routes
      // by the stale adopted key.
      node.setAttribute('slot', '');
      Node.prototype.removeChild.call(node.parentNode, node);
      await tick();
      await tick();
      host.appendChild(node);
      await tick();
      const defSlot = host.querySelector('slot[data-webjs-light]:not([name])');
      assert.ok(defSlot.contains(node), 're-append routed by the attribute, not the stale adoption');
    } finally {
      host.remove();
    }
  });

  test('cache() re-apply reaches slots in NESTED templates inside the cached branch', async () => {
    const tag = tagName('cache-nested-slot');
    class C extends WebComponent({ showA: Boolean }) {
      constructor() { super(); this.showA = true; }
      render() {
        return html`<div>${cache(
          this.showA
            ? html`<section>${html`<slot name="x"></slot>`}</section>`
            : html`<em>alt</em>`,
        )}</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    const child = document.createElement('strong');
    child.setAttribute('slot', 'x');
    child.textContent = 'nested-cached';
    host.appendChild(child);
    document.body.appendChild(host);
    await tick();
    await tick();
    try {
      assert.equal(child.parentElement.getAttribute('name'), 'x', 'projected initially');
      host.showA = false;
      await host.updateComplete;
      host.appendChild(document.createElement('span')); // apply while stashed
      await tick();
      host.showA = true;
      await host.updateComplete;
      await tick();
      await tick();
      const slot = host.querySelector('slot[name="x"]');
      assert.ok(slot, 'nested slot re-attached');
      assert.ok(slot.contains(child), 'the DEEP re-apply pulled the child back (shallow scan missed it)');
    } finally {
      host.remove();
    }
  });

  test('assignedSlot answers only for direct slottables (descendants read null)', async () => {
    const tag = tagName('slottable-depth');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const child = document.createElement('div');
      const grand = document.createElement('span');
      child.appendChild(grand);
      host.appendChild(child);
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(child.assignedSlot, slot, 'the slottable itself reports its slot');
      assert.equal(grand.assignedSlot, null, 'a DESCENDANT of assigned content reads null (native)');
    } finally {
      host.remove();
    }
  });

  test('a projected TEXT node reports its assignedSlot (Slottable covers Text)', async () => {
    const tag = tagName('text-slottable');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const text = document.createTextNode('hello');
      host.appendChild(text);
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(text.assignedSlot, slot, 'Text.assignedSlot answers in light mode');
    } finally {
      host.remove();
    }
  });

  test('a non-template render survives a DOM move with no park growth', async () => {
    const tag = tagName('string-move');
    class C extends WebComponent {
      render() { return 'plain text output'; }
    }
    C.register(tag);
    const host = document.createElement(tag);
    document.body.appendChild(host);
    await tick();
    const other = document.createElement('div');
    document.body.appendChild(other);
    try {
      assert.ok(host.textContent.includes('plain text output'), 'renders');
      // Each move is a disconnect + reconnect: the sweep must NOT fold the
      // renderer's bare text output into the record and park it.
      other.appendChild(host);
      await tick();
      await tick();
      document.body.appendChild(host);
      await tick();
      await tick();
      assert.ok(host.textContent.includes('plain text output'), 'still renders after moves');
      assert.equal(host.querySelector('wj-slot-park'), null, 'no park was ever created');
    } finally {
      host.remove();
      other.remove();
    }
  });

  test('appendChild of a FAKE node object throws before any record mutation', async () => {
    const tag = tagName('fake-node');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      let threw = null;
      try {
        host.appendChild(/** @type {any} */ ({ nodeType: 1, contains: () => false }));
      } catch (e) { threw = e; }
      assert.ok(threw instanceof TypeError, 'duck-typed fake rejected with TypeError');
      // The pipeline is NOT wedged: later operations still work.
      host.appendChild(document.createElement('strong'));
      await tick();
      assert.equal(slot.children.length, 2, 'record intact, pipeline functional');
    } finally {
      host.remove();
    }
  });

  test('the apply does not steal a node the author moved into a FOREIGN detached slot', async () => {
    const tag = tagName('foreign-steal');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const child = document.createElement('p');
      host.appendChild(child);
      await tick();
      // A detached light slot from some other component's torn-down branch.
      const foreign = document.createElement('slot');
      foreign.setAttribute('data-webjs-light', '');
      foreign.appendChild(child); // the author's deliberate move
      host.appendChild(document.createElement('span')); // any later apply
      await tick();
      assert.equal(child.parentElement, foreign, 'the move STUCK (no steal-back)');
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.ok(!slot.contains(child), 'not re-inserted into the host slot');
    } finally {
      host.remove();
    }
  });

  test('cache() re-apply reaches a slot inside a repeat() item in the cached branch', async () => {
    const tag = tagName('cache-repeat-slot');
    class C extends WebComponent({ showA: Boolean }) {
      constructor() { super(); this.showA = true; }
      render() {
        return html`<div>${cache(
          this.showA
            ? html`<ul>${repeat(
                ['only'],
                (k) => k,
                () => html`<li><slot name="x"></slot></li>`,
              )}</ul>`
            : html`<em>alt</em>`,
        )}</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    const child = document.createElement('strong');
    child.setAttribute('slot', 'x');
    child.textContent = 'repeat-cached';
    host.appendChild(child);
    document.body.appendChild(host);
    await tick();
    await tick();
    try {
      assert.equal(child.parentElement.getAttribute('name'), 'x', 'projected initially');
      host.showA = false;
      await host.updateComplete;
      host.appendChild(document.createElement('span')); // apply while stashed
      await tick();
      host.showA = true;
      await host.updateComplete;
      await tick();
      await tick();
      const slot = host.querySelector('slot[name="x"]');
      assert.ok(slot, 'repeat-item slot re-attached');
      assert.ok(slot.contains(child), 'the DOM-walk sweep reached the repeat-item slot');
    } finally {
      host.remove();
    }
  });

  test('append of a fake node object coerces to text like native WebIDL', async () => {
    const tag = tagName('fake-coerce');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.append(/** @type {any} */ ({ nodeType: 3 }));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(slot.textContent, '[object Object]', 'stringified, not thrown, not admitted as a node');
    } finally {
      host.remove();
    }
  });

  test('a bypass write while disconnected BEFORE the first render survives it', async () => {
    const tag = tagName('preinstance-bypass');
    class C extends WebComponent {
      render() { return html`<div><slot></slot></div>`; }
    }
    C.register(tag);
    const host = document.createElement(tag);
    document.body.appendChild(host); // connect; first render is DEFERRED
    host.remove(); // disconnect before the render ran
    const el = document.createElement('p');
    el.id = 'early-bypass';
    Node.prototype.appendChild.call(host, el); // raw bypass, sensors down
    document.body.appendChild(host); // reconnect in the same task
    await tick();
    await tick();
    try {
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.ok(slot, 'rendered');
      assert.ok(slot.querySelector('#early-bypass'), 'the pre-render bypass write was folded and projected');
    } finally {
      host.remove();
    }
  });

  test('removing an adopted child before the first apply is honoured (no resurrection)', async () => {
    const tag = tagName('adopt-remove');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    const holder = document.createElement('div');
    try {
      const child = document.createElement('p');
      child.id = 'adopt-removed';
      host.appendChild(child);
      await tick();
      const serialized = host.outerHTML;
      host.remove();
      await tick();
      document.body.appendChild(holder);
      holder.innerHTML = serialized.replace('data-wj-host', 'data-wj-host data-wj-serialized');
      // Synchronously after upgrade+adopt, BEFORE any apply: author removes
      // the projected child out-of-band.
      const restored = holder.querySelector(tag);
      const rechild = restored.querySelector('#adopt-removed');
      rechild.remove();
      await tick();
      await tick();
      assert.ok(!rechild.isConnected, 'stayed removed');
      assert.ok(!restored.querySelector('#adopt-removed'), 'not resurrected by the first apply');
    } finally {
      host.remove();
      holder.remove();
    }
  });

  test('innerHTML with table-section markup matches the native in-body context', async () => {
    const tag = tagName('td-context');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.innerHTML = '<td>x</td>';
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(slot.querySelector('td'), null, 'the td token was dropped like native');
      assert.equal(slot.textContent, 'x', 'only the text remains');
    } finally {
      host.remove();
    }
  });

  test('textContent nullable coercion and innerHTML LegacyNullToEmptyString match native', async () => {
    // Verified against real engines: textContent is a NULLABLE DOMString?
    // (undefined converts to null, so BOTH empty), while innerHTML carries
    // [LegacyNullToEmptyString] (null empties, undefined stringifies).
    const tag = tagName('coercion-fidelity');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const slot = host.querySelector('slot[data-webjs-light]');
      host.textContent = 'seed';
      await tick();
      host.textContent = /** @type {any} */ (undefined);
      await tick();
      assert.equal(slot.textContent, '', 'textContent = undefined EMPTIES (nullable DOMString)');
      host.textContent = 'seed2';
      await tick();
      host.textContent = null;
      await tick();
      assert.equal(slot.textContent, '', 'textContent = null empties');
      host.innerHTML = '<em>seed3</em>';
      await tick();
      host.innerHTML = /** @type {any} */ (null);
      await tick();
      assert.equal(slot.textContent, '', 'innerHTML = null CLEARS (LegacyNullToEmptyString)');
      host.innerHTML = /** @type {any} */ (undefined);
      await tick();
      assert.equal(slot.textContent, 'undefined', 'innerHTML = undefined stringifies');
    } finally {
      host.remove();
    }
  });

  test('a pre-render reconnect of a serialized-restored host does not hoover its own markup', async () => {
    // The adopt path's window: a hydrated/restored host reconnected in the
    // SAME task as its upgrade (before the deferred first render) must not
    // fold its own rendered wrappers into the record (that bricked
    // placement with a HierarchyRequestError, or parked the whole subtree
    // for named-slot hosts).
    const tag = tagName('prerender-reconnect');
    const host = await mount(tag, () => html`<div class="shell"><slot></slot></div>`);
    const holder = document.createElement('div');
    try {
      const child = document.createElement('p');
      child.id = 'reconnect-child';
      host.appendChild(child);
      await tick();
      const serialized = host.outerHTML;
      host.remove();
      await tick();
      document.body.appendChild(holder);
      holder.innerHTML = serialized.replace('data-wj-host', 'data-wj-host data-wj-serialized');
      // SAME task as the upgrade: reparent the restored host (disconnect +
      // reconnect before the deferred first render).
      const restored = holder.querySelector(tag);
      const wrapper = document.createElement('section');
      holder.appendChild(wrapper);
      wrapper.appendChild(restored);
      await tick();
      await tick();
      assert.equal(restored.querySelectorAll('.shell').length, 1, 'exactly one rendered shell (no hoover, no brick)');
      const slot = restored.querySelector('slot[data-webjs-light]');
      assert.ok(slot.querySelector('#reconnect-child'), 'the authored child is projected');
    } finally {
      host.remove();
      holder.remove();
    }
  });

  test('append(Symbol()) throws TypeError like WebIDL ToString', async () => {
    const tag = tagName('symbol-arg');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      let threw = null;
      try { host.append(/** @type {any} */ (Symbol('x'))); } catch (e) { threw = e; }
      assert.ok(threw instanceof TypeError, 'Symbol rejected like native DOMString conversion');
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(slot.children.length, 0, 'no state change');
    } finally {
      host.remove();
    }
  });

  test('appendChild of a fake fragment object throws before touching anything', async () => {
    const tag = tagName('fake-frag');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      let threw = null;
      try {
        host.appendChild(/** @type {any} */ ({ nodeType: 11, childNodes: [] }));
      } catch (e) { threw = e; }
      assert.ok(threw instanceof TypeError, 'duck-typed fragment rejected');
      assert.equal(slot.children.length, 1, 'zero state change');
    } finally {
      host.remove();
    }
  });

  test('a pre-render backstop bypass write survives the first render', async () => {
    // The drain must PROCESS records for a never-rendered host (symbol
    // absent): a bypass write followed by a patched write in the same task
    // used to have its record drained-and-discarded at the park window
    // close, so the first render silently destroyed the node.
    const tag = tagName('prerender-drain');
    class C extends WebComponent {
      render() { return html`<div><slot></slot></div>`; }
    }
    C.register(tag);
    const host = document.createElement(tag);
    document.body.appendChild(host); // connect; render deferred
    const extra = document.createElement('p');
    extra.id = 'drained-bypass';
    Node.prototype.appendChild.call(host, extra); // bypass: backstop queues
    host.appendChild(document.createElement('em')); // patched write, same task
    await tick();
    await tick();
    try {
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.ok(slot.querySelector('#drained-bypass'), 'the bypass write survived (record processed, not discarded)');
      assert.ok(slot.querySelector('em'), 'the patched write landed too');
    } finally {
      host.remove();
    }
  });

  test('cache() re-apply reaches a slot inside an asyncAppend chunk in the cached branch', async () => {
    const tag = tagName('cache-stream-slot');
    async function* gen() {
      yield html`<section><slot name="x"></slot></section>`;
    }
    class C extends WebComponent({ showA: Boolean }) {
      constructor() { super(); this.showA = true; this.gen = gen(); }
      render() {
        return html`<div>${cache(
          this.showA ? html`<b>${asyncAppend(this.gen)}</b>` : html`<em>alt</em>`,
        )}</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    const child = document.createElement('strong');
    child.setAttribute('slot', 'x');
    child.textContent = 'stream-cached';
    host.appendChild(child);
    document.body.appendChild(host);
    await waitFor(
      () => host.querySelector('slot[name="x"]')?.getAttribute('data-projection') === 'actual',
    );
    await tick();
    try {
      assert.ok(host.querySelector('slot[name="x"]').contains(child), 'projected initially');
      host.showA = false;
      await host.updateComplete;
      host.appendChild(document.createElement('span')); // apply while stashed
      await tick();
      host.showA = true;
      await host.updateComplete;
      await tick();
      await tick();
      const slot = host.querySelector('slot[name="x"]');
      assert.ok(slot, 'chunk slot re-attached');
      assert.ok(slot.contains(child), 'the DOM-range sweep reached the streamed-chunk slot');
    } finally {
      host.remove();
    }
  });

  test('object coercion uses ToString order (toString wins over valueOf)', async () => {
    const tag = tagName('tostring-order');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.append(/** @type {any} */ ({ valueOf: () => 42, toString: () => 'hi' }));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(slot.textContent, 'hi', 'WebIDL DOMString conversion is toString-first');
      host.textContent = /** @type {any} */ ({ valueOf: () => 1, toString: () => 'tc' });
      await tick();
      assert.equal(slot.textContent, 'tc', 'textContent coercion is toString-first too');
      host.innerHTML = /** @type {any} */ ({ valueOf: () => 2, toString: () => '<i>ih</i>' });
      await tick();
      assert.equal(slot.textContent, 'ih', 'innerHTML coercion is toString-first too');
    } finally {
      host.remove();
    }
  });

  test('a spoofed rendered-looking bypass chunk does not suppress the reconnect fold', async () => {
    const tag = tagName('spoof-chunk');
    class C extends WebComponent {
      render() { return html`<div><slot></slot></div>`; }
    }
    C.register(tag);
    const host = document.createElement(tag);
    document.body.appendChild(host); // capture branch; first render deferred
    host.remove(); // disconnect before the render
    // A bypass write that LOOKS like rendered markup (a light slot with a
    // projection stamp under plain wrappers) plus an unrelated plain write.
    const fake = document.createElement('div');
    fake.innerHTML = '<slot data-webjs-light data-projection="actual"></slot>';
    const plain = document.createElement('p');
    plain.id = 'plain-bypass';
    Node.prototype.appendChild.call(host, fake);
    Node.prototype.appendChild.call(host, plain);
    document.body.appendChild(host); // reconnect: the fold must still run
    await tick();
    await tick();
    try {
      const projected = host.querySelector('#plain-bypass');
      assert.ok(projected, 'the plain bypass write survived the first render');
      assert.equal(
        projected.parentElement.tagName.toLowerCase(),
        'slot',
        'the plain write was folded and projected (the spoof did not gate the fold)',
      );
    } finally {
      host.remove();
    }
  });

  test('a SLOTLESS restored host survives a pre-render reconnect (no park hoover)', async () => {
    // The adopt flag must cover hosts whose template has NO own slot: the
    // structural gate it replaced returned false for them, so a same-task
    // reparent folded the rendered wrappers and parked the entire visible
    // markup (blank host + permanent stale nodes).
    const tag = tagName('slotless-restore');
    const host = await mount(tag, () => html`<div class="chrome">static ui</div>`);
    const holder = document.createElement('div');
    try {
      await tick();
      const serialized = host.outerHTML;
      host.remove();
      await tick();
      document.body.appendChild(holder);
      holder.innerHTML = serialized.replace('data-wj-host', 'data-wj-host data-wj-serialized');
      // SAME task as the upgrade: reparent before the deferred first render.
      const restored = holder.querySelector(tag);
      const wrapper = document.createElement('section');
      holder.appendChild(wrapper);
      wrapper.appendChild(restored);
      await tick();
      await tick();
      assert.equal(restored.querySelectorAll('.chrome').length, 1, 'exactly one rendered chrome');
      assert.equal(restored.querySelector('wj-slot-park'), null, 'nothing was parked');
      assert.ok(restored.textContent.includes('static ui'), 'visible markup intact');
      // The deeper harm was RETENTION: hoovered wrappers stayed in the
      // record, and any later apply re-attached the park with the stale tree
      // inside (hidden duplicate content). Trigger an apply and count.
      restored.appendChild(document.createElement('span'));
      await tick();
      assert.equal(
        (restored.textContent.match(/static ui/g) || []).length,
        1,
        'no stale hoovered copy resurfaced via the park',
      );
    } finally {
      host.remove();
      holder.remove();
    }
  });

  test('a same-batch raw add-then-remove stays removed (no resurrection)', async () => {
    const tag = tagName('batch-add-remove');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const n = document.createElement('p');
      n.id = 'ghost';
      // Both raw: one observer batch carries the add AND the remove.
      Node.prototype.appendChild.call(host, n);
      Node.prototype.removeChild.call(host, n);
      await tick();
      await tick();
      assert.ok(!n.isConnected, 'the removed node stayed removed');
      assert.equal(host.querySelector('#ghost'), null, 'not resurrected by the apply');
    } finally {
      host.remove();
    }
  });

  test('insertBefore and replaceChild validate parameter 1 first (WebIDL order)', async () => {
    const tag = tagName('param-order');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const child = document.createElement('em');
      host.appendChild(child);
      await tick();
      let e1 = null;
      try { host.insertBefore(/** @type {any} */ (42), /** @type {any} */ ({})); } catch (e) { e1 = e; }
      assert.ok(e1 instanceof TypeError, 'insertBefore(nonNode, nonNode) is a parameter-1 TypeError');
      let e2 = null;
      try { host.insertBefore(/** @type {any} */ ({}), document.createElement('u')); } catch (e) { e2 = e; }
      assert.ok(e2 instanceof TypeError, 'insertBefore(nonNode, realNonChild) is TypeError, not NotFoundError');
      let e3 = null;
      try { host.insertBefore(host, document.createElement('u')); } catch (e) { e3 = e; }
      assert.equal(e3 && e3.name, 'HierarchyRequestError', 'the cycle check precedes the ref check');
      let e4 = null;
      try { host.replaceChild(/** @type {any} */ (42), child); } catch (e) { e4 = e; }
      assert.ok(e4 instanceof TypeError, 'replaceChild(nonNode, authoredChild) is a parameter-1 TypeError');
    } finally {
      host.remove();
    }
  });

  test('a same-batch raw add-then-move into a fragment is not stolen back', async () => {
    const tag = tagName('batch-add-move');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const n = document.createElement('p');
      n.id = 'frag-bound';
      const frag = document.createDocumentFragment();
      // One observer batch: raw add to the host, then a move into the
      // author's own fragment.
      Node.prototype.appendChild.call(host, n);
      frag.appendChild(n);
      await tick();
      await tick();
      assert.equal(n.parentNode, frag, 'the node stayed in the author fragment (no theft-back)');
      assert.equal(host.querySelector('#frag-bound'), null, 'not resurrected into the host');
    } finally {
      host.remove();
    }
  });

  test('a rescue-detached record value survives a stale placement record', async () => {
    // The placement move (host to slot) queues a host-childList removal
    // record with containment TRUE at creation; if a conditional collapse
    // rescues the node before the record is processed, the node is a
    // parentless marked record value and the processing must RETAIN it.
    const tag = tagName('stale-rescue');
    class C extends WebComponent({ open: Boolean }) {
      constructor() { super(); this.open = true; }
      render() {
        return this.open
          ? html`<div><slot name="a"></slot></div>`
          : html`<div>closed</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    const x = document.createElement('em');
    x.setAttribute('slot', 'a');
    x.id = 'rescued-x';
    host.appendChild(x);
    document.body.appendChild(host);
    await tick();
    try {
      // Bypass-move X onto the host: the repair placement (host back to
      // slot) queues the stale record; collapse the conditional in the same
      // task so the rescue lands before the record is processed.
      Node.prototype.appendChild.call(host, x);
      host.open = false;
      await host.updateComplete;
      await tick();
      await tick();
      host.open = true; // the slot returns: the record value must re-place
      await host.updateComplete;
      await tick();
      await tick();
      const slot = host.querySelector('slot[name="a"]');
      assert.ok(slot, 'slot re-rendered');
      assert.ok(slot.querySelector('#rescued-x'), 'the record value SURVIVED the stale record');
    } finally {
      host.remove();
    }
  });

  test('an SSR-serialized forwarded slot does not collide with a same-named own slot at adopt', async () => {
    // The serialized shape: a forwarded actual slot rides INSIDE the inner
    // host's own default slot. Without the adopt-time authored-content
    // exclusion, first-wins adopted the forwarded slot under name x and the
    // later legitimate own x slot's children were destroyed at first apply.
    const tag = tagName('fwd-adopt');
    class C extends WebComponent {
      render() { return html`<div><slot></slot><slot name="x"></slot></div>`; }
    }
    C.register(tag);
    const holder = document.createElement('div');
    document.body.appendChild(holder);
    try {
      holder.innerHTML =
        `<${tag} data-wj-host data-wj-serialized><div>` +
        `<slot data-webjs-light data-projection="actual">` +
        `<slot data-webjs-light data-projection="actual" name="x">P-content</slot>` +
        `</slot>` +
        `<slot data-webjs-light data-projection="actual" name="x"><b id="own-d">D</b></slot>` +
        `</div></${tag}>`;
      await tick();
      await tick();
      const host = holder.querySelector(tag);
      const d = host.querySelector('#own-d');
      assert.ok(d, 'the own slot child exists');
      assert.ok(d.isConnected, 'D was not destroyed');
      const ownX = Array.from(host.querySelectorAll('slot[name="x"]')).find(
        (sl) => sl.querySelector('#own-d'),
      );
      assert.ok(ownX, 'D is still inside an x slot (the own slot kept its children)');
    } finally {
      holder.remove();
    }
  });

  test('both-invalid insertBefore throws the parameter-2 TypeError (conversions precede DOM steps)', async () => {
    const tag = tagName('both-invalid');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      let e1 = null;
      try { host.insertBefore(host, /** @type {any} */ ({})); } catch (e) { e1 = e; }
      assert.ok(e1 instanceof TypeError, 'cycle-invalid param 1 + non-node param 2 is a TypeError');
      // Type validity (step 4) comes AFTER the ref NotFound (step 3).
      const doctype = document.implementation.createDocumentType('html', '', '');
      let e2 = null;
      try { host.insertBefore(doctype, document.createElement('u')); } catch (e) { e2 = e; }
      assert.equal(e2 && e2.name, 'NotFoundError', 'the ref check precedes the node-type check');
    } finally {
      host.remove();
    }
  });

  test('append(frag, Symbol) throws with the fragment INTACT', async () => {
    const tag = tagName('frag-intact');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createElement('em'));
      frag.appendChild(document.createElement('u'));
      let threw = null;
      try { host.append(frag, /** @type {any} */ (Symbol('x'))); } catch (e) { threw = e; }
      assert.ok(threw instanceof TypeError, 'the later argument conversion threw');
      assert.equal(frag.childNodes.length, 2, 'the fragment was NOT drained (all conversions precede any move)');
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.equal(slot.children.length, 0, 'zero state change');
    } finally {
      host.remove();
    }
  });

  test('isAuthoredContentSlot discriminates authored chunks from template slots', async () => {
    const tag = tagName('acs-export');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const chunk = document.createElement('div');
      chunk.innerHTML = '<slot data-webjs-light data-projection="actual" name="q"></slot>';
      host.appendChild(chunk);
      await tick();
      const spoof = chunk.querySelector('slot');
      const real = host.querySelector('slot[data-webjs-light]:not([name])');
      assert.equal(isAuthoredContentSlot(host, spoof), true, 'a slot inside an authored chunk is content');
      assert.equal(isAuthoredContentSlot(host, real), false, 'the template slot is not content');
    } finally {
      host.remove();
    }
  });

  test('a bypass move + intercepted write + same-task collapse loses nothing', async () => {
    // BEHAVIORAL coverage (not a counterfactual): this interleaving is
    // handled by the window-close drains + retention conjuncts even without
    // the end-of-apply source drain (verified empirically in round 28); the
    // drain remains as documented defense-in-depth for the twice-traced
    // stale-placement race no suite sequence has reproduced.
    const tag = tagName('interleave-loss');
    class C extends WebComponent({ cond: Boolean }) {
      constructor() { super(); this.cond = true; }
      render() {
        return this.cond
          ? html`<div><slot name="a"></slot></div>`
          : html`<div>off</div>`;
      }
    }
    C.register(tag);
    const host = document.createElement(tag);
    const n = document.createElement('em');
    n.setAttribute('slot', 'a');
    n.id = 'kept-n';
    host.appendChild(n);
    document.body.appendChild(host);
    await tick();
    try {
      // One author task: collapse queued, bypass move, intercepted write.
      host.cond = false;
      Node.prototype.appendChild.call(host, n);
      host.appendChild(document.createElement('span'));
      await host.updateComplete;
      await tick();
      await tick();
      host.cond = true;
      await host.updateComplete;
      await tick();
      await tick();
      const slot = host.querySelector('slot[name="a"]');
      assert.ok(slot, 'slot re-rendered');
      assert.ok(slot.querySelector('#kept-n'), 'the authored node SURVIVED the interleaving');
    } finally {
      host.remove();
    }
  });

  test('append(host, Symbol) throws the conversion TypeError first', async () => {
    const tag = tagName('conv-first');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      let threw = null;
      try { host.append(host, /** @type {any} */ (Symbol('s'))); } catch (e) { threw = e; }
      assert.ok(threw instanceof TypeError, 'all conversions precede any DOM validity step');
    } finally {
      host.remove();
    }
  });

  test('a reentrant author write from a disconnectedCallback survives the pass', async () => {
    if (!customElements.get('reentrant-probe')) {
      class Probe extends HTMLElement {
        disconnectedCallback() {
          const owner = /** @type {any} */ (this).__owner;
          if (owner && !owner.__reentered) {
            owner.__reentered = true;
            const c = document.createElement('mark');
            c.id = 'reentrant-c';
            c.textContent = 'C';
            owner.appendChild(c); // author write MID-PASS
          }
        }
      }
      customElements.define('reentrant-probe', Probe);
    }
    const tag = tagName('reentrant-host');
    const host = await mount(tag, () => html`<div><slot>fb-content</slot></div>`);
    try {
      const a = document.createElement('reentrant-probe');
      /** @type {any} */ (a).__owner = host;
      host.appendChild(a);
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.ok(slot.contains(a), 'probe projected');
      host.textContent = ''; // removal fires the reentrant write mid-pass
      await tick();
      await tick();
      assert.ok(slot.querySelector('#reentrant-c'), 'the reentrant write was placed, not destroyed');
      assert.equal(slot.getAttribute('data-projection'), 'actual', 'projection state consistent');
      assert.ok(!slot.textContent.includes('fb-content'), 'fallback not shown alongside content');
      const assigned = slot.assignedNodes();
      assert.ok(
        assigned.some((n) => /** @type {Element} */ (n).id === 'reentrant-c'),
        'assignedNodes reflects the reentrant write',
      );
    } finally {
      host.remove();
    }
  });

  test('a repeated Node argument nets one placement in the last position', async () => {
    const tag = tagName('dup-arg');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const a = document.createElement('em');
      a.textContent = 'a';
      const b = document.createElement('u');
      b.textContent = 'b';
      host.append(a, b, a); // native nets [b, a]
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      assert.deepEqual(
        Array.from(slot.children).map((e) => e.textContent),
        ['b', 'a'],
        'keep-last dedup matches native move semantics',
      );
      // The DISCRIMINATING probe (red without dedup/unique-build): a
      // duplicate record entry desyncs the snapshot, so a NO-OP trigger
      // (append of the current last child) would heal the record and fire a
      // spurious slotchange; a clean record fires none.
      let fires = 0;
      slot.addEventListener('slotchange', () => { fires += 1; });
      host.appendChild(a); // a IS the current last child: a true no-op
      await tick();
      assert.equal(fires, 0, 'no spurious heal slotchange (record was never desynced)');
      host.appendChild(document.createElement('i')); // real change still fires
      await tick();
      assert.equal(fires, 1, 'a real change fires exactly once');
    } finally {
      host.remove();
    }
  });

  test('two reentrant record ops in one pass both keep their authority', async () => {
    // The union-under-latch: op2 must not clobber op1's touched set, or the
    // reapply iteration's resync folds op1's removed node straight back in.
    if (!customElements.get('double-op-probe')) {
      class Probe extends HTMLElement {
        disconnectedCallback() {
          const o = /** @type {any} */ (this).__ctx;
          if (o && !o.done) {
            o.done = true;
            o.host.removeChild(o.x); // op1: expressed removal
            const y = document.createElement('ins');
            y.id = 'op2-y';
            o.host.appendChild(y); // op2: would clobber op1's set
            o.slot.appendChild(document.createElement('wbr')); // divergence
          }
        }
      }
      customElements.define('double-op-probe', Probe);
    }
    const tag = tagName('double-op');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    try {
      const x = document.createElement('em');
      x.id = 'op1-x';
      const probe = document.createElement('double-op-probe');
      host.append(x, probe);
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      /** @type {any} */ (probe).__ctx = { host, x, slot, done: false };
      host.removeChild(probe); // its slot-removal fires both ops MID-PASS
      await tick();
      await tick();
      assert.ok(!x.isConnected, 'op1 removal HELD (not resurrected by the resync fold)');
      assert.equal(host.querySelector('#op1-x'), null, 'x is gone');
      assert.ok(slot.querySelector('#op2-y'), 'op2 write placed');
    } finally {
      host.remove();
    }
  });

  test('a reaction reparenting the host into a sibling arg throws atomically', async () => {
    // TOCTOU: boomer's detach-into-scratch fires a reaction that puts the
    // HOST inside wrapper (a later plain-node argument). The re-guard must
    // throw HierarchyRequestError BEFORE the record receives the
    // host-containing node (native throws the same class after conversion,
    // with boomer likewise lost to the conversion fragment).
    if (!customElements.get('boomer-probe')) {
      class Probe extends HTMLElement {
        disconnectedCallback() {
          const c = /** @type {any} */ (this).__cycle;
          if (c && !c.done) {
            c.done = true;
            c.wrapper.appendChild(c.host);
          }
        }
      }
      customElements.define('boomer-probe', Probe);
    }
    const tag = tagName('toctou-cycle');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    const holder = document.createElement('div');
    document.body.appendChild(holder);
    holder.appendChild(host); // give the host a re-parentable position
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      const boomer = document.createElement('boomer-probe');
      host.appendChild(boomer);
      await tick();
      const wrapper = document.createElement('div');
      /** @type {any} */ (boomer).__cycle = { host, wrapper, done: false };
      let threw = null;
      try { host.append(boomer, wrapper); } catch (e) { threw = e; }
      assert.equal(threw && threw.name, 'HierarchyRequestError', 'atomic throw');
      assert.ok(!slot.contains(wrapper), 'the host-containing node never entered the slot');
      // The DISCRIMINATING assert: without the guards, placement partially
      // ran before the deep throw, leaving boomer placed in the slot; at
      // head, boomer is lost to the conversion fragment (native parity).
      assert.ok(!slot.contains(boomer), 'no partial placement (atomicity held)');
      host.appendChild(document.createElement('strong')); // still functional
      await tick();
      assert.ok(slot.querySelector('strong'), 'pipeline intact after the throw');
    } finally {
      host.remove();
      holder.remove();
    }
  });

  test('a LATER arg reaction poisoning an EARLIER scratch child throws atomically', async () => {
    // Mirror ordering of the toctou test: append(wrapper, boomer). Boomer's
    // detach reaction reparents the host into wrapper, which ALREADY sits in
    // the scratch: only the final assembled guardCycle catches this shape.
    if (!customElements.get('boomer-probe-2')) {
      class Probe extends HTMLElement {
        disconnectedCallback() {
          const c = /** @type {any} */ (this).__cycle;
          if (c && !c.done) {
            c.done = true;
            c.wrapper.appendChild(c.host);
          }
        }
      }
      customElements.define('boomer-probe-2', Probe);
    }
    const tag = tagName('toctou-mirror');
    const host = await mount(tag, () => html`<div><slot></slot></div>`);
    const holder = document.createElement('div');
    document.body.appendChild(holder);
    holder.appendChild(host);
    try {
      host.appendChild(document.createElement('em'));
      await tick();
      const slot = host.querySelector('slot[data-webjs-light]');
      const boomer = document.createElement('boomer-probe-2');
      host.appendChild(boomer);
      await tick();
      const wrapper = document.createElement('div');
      /** @type {any} */ (boomer).__cycle = { host, wrapper, done: false };
      let threw = null;
      try { host.append(wrapper, boomer); } catch (e) { threw = e; }
      assert.equal(threw && threw.name, 'HierarchyRequestError', 'atomic throw');
      assert.ok(!slot.contains(wrapper), 'poisoned node never entered the slot');
      assert.ok(!slot.contains(boomer), 'no partial placement');
      host.appendChild(document.createElement('strong'));
      await tick();
      assert.ok(slot.querySelector('strong'), 'pipeline intact');
    } finally {
      host.remove();
      holder.remove();
    }
  });

  test('a latched projection does not end a co-pending manual adoption', async () => {
    // The scoped adoption-clear: a probe's disconnect fires (op1) a manual
    // assign of an ADOPTED node and (op2) a reentrant router projection of
    // the default slice. The projection must clear adoptions only for ITS
    // nodes; with the old union-wide clear, releasing the manual assignment
    // later routed the node by its (absent) attribute instead of its
    // adopted container key.
    if (!customElements.get('proj-probe')) {
      class Probe extends HTMLElement {
        disconnectedCallback() {
          const c = /** @type {any} */ (this).__ctx;
          if (c && !c.done) {
            c.done = true;
            c.sideSlot.assign(c.n); // op1: manual (outranks adoption)
            projectAuthored(c.host, null, [document.createElement('p')]); // op2
          }
        }
      }
      customElements.define('proj-probe', Probe);
    }
    const tag = tagName('scoped-clear');
    const host = await mount(
      tag,
      () => html`<div><slot></slot><slot name="side"></slot></div>`,
    );
    try {
      const seed = document.createElement('span');
      seed.setAttribute('slot', 'side');
      host.appendChild(seed);
      await tick();
      const sideSlot = host.querySelector('slot[name="side"]');
      const n = document.createElement('u');
      n.id = 'adopted-n';
      sideSlot.appendChild(n); // library write
      const probe = document.createElement('proj-probe');
      host.appendChild(probe); // fold: n adopted to side
      await tick();
      assert.equal(n.parentElement, sideSlot, 'adopted into side');
      /** @type {any} */ (probe).__ctx = { host, sideSlot, n, done: false };
      host.removeChild(probe); // fires op1 + op2 mid-pass
      await tick();
      await tick();
      assert.equal(n.parentElement, sideSlot, 'manually held in side');
      sideSlot.assign(); // release the manual assignment
      await tick();
      await tick();
      // With the scoped clear, n's ADOPTION survives the co-pending
      // projection and still routes it to side after release.
      assert.equal(n.parentElement, sideSlot, 'adoption survived the latched projection');
    } finally {
      host.remove();
    }
  });

  test('a fully poisoned slice degrades to FALLBACK and the node is reaped', async () => {
    // The placement-time cycle shield, correctly located: a departing
    // reaction poisons the incoming named-slice node (reparents the host
    // into it). The named slot must show its FALLBACK (not an
    // actual-stamped blank), and the poisoned node must be REAPED by the
    // next pass's prune (its exemption is cleared at filter time), never
    // living immortally in the record.
    if (!customElements.get('poison-probe')) {
      class Probe extends HTMLElement {
        disconnectedCallback() {
          const c = /** @type {any} */ (this).__ctx;
          if (c && !c.done) {
            c.done = true;
            c.n.appendChild(c.host); // poison the incoming node
          }
        }
      }
      customElements.define('poison-probe', Probe);
    }
    const tag = tagName('poison-slice');
    const host = await mount(
      tag,
      () => html`<div><slot></slot><slot name="a">fb-a</slot></div>`,
    );
    const holder = document.createElement('div');
    document.body.appendChild(holder);
    holder.appendChild(host);
    try {
      const probe = document.createElement('poison-probe');
      host.appendChild(probe); // default slice
      await tick();
      const aSlot = host.querySelector('slot[name="a"]');
      assert.ok(aSlot.textContent.includes('fb-a'), 'fallback showing initially');
      const n = document.createElement('div');
      n.setAttribute('slot', 'a');
      /** @type {any} */ (probe).__ctx = { host, n, done: false };
      // One call: displaces the probe (firing the poisoning reaction during
      // the default slice's departure) and brings in the poisoned n.
      host.replaceChildren(n);
      await tick();
      await tick();
      assert.ok(aSlot.textContent.includes('fb-a'), 'slot a shows FALLBACK, not a blank actual');
      assert.notEqual(aSlot.getAttribute('data-projection'), 'actual', 'not stamped actual-empty');
      // Reap check: a later unrelated apply must not resurrect n.
      host.appendChild(document.createElement('em'));
      await tick();
      assert.ok(!aSlot.contains(n), 'the poisoned node was never placed');
      assert.ok(aSlot.textContent.includes('fb-a'), 'fallback persists');
    } finally {
      host.remove();
      holder.remove();
    }
  });

  test('router projectAuthored on the default slice leaves a manual assignment intact', async () => {
    const tag = tagName('proj-manual');
    const host = await mount(tag, () => html`<div><slot></slot><slot name="x"></slot></div>`);
    try {
      const slots = host.querySelectorAll('slot[data-webjs-light]');
      const xSlot = slots[1];
      const div = document.createElement('div');
      div.id = 'manual-div';
      host.appendChild(div); // attribute-less: default slice
      await tick();
      xSlot.assign(div);
      await tick();
      assert.equal(div.parentElement, xSlot, 'manually assigned into x');
      // The router's seam replacing the DEFAULT slice must key by the
      // effective assignment, not the raw attribute, or it evicts the
      // manually-assigned node.
      const p = document.createElement('p');
      projectAuthored(host, null, [p]);
      await tick();
      assert.equal(div.parentElement, xSlot, 'the manual assignment survived the default-slice projection');
      assert.ok(slots[0].contains(p), 'the projected default content landed');
    } finally {
      host.remove();
    }
  });
});
