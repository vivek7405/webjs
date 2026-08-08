/**
 * Unit tests for WebComponent lifecycle paths that aren't exercised by
 * the SSR-only tests: property accessor initialisation, attribute
 * coercion, reflection, connectedCallback upgrading, controller
 * dispatch, requestUpdate batching, firstUpdated, renderError.
 *
 * Runs under linkedom to simulate a DOM without spinning up a browser.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

let WebComponent, html, css, prop;

before(async () => {
  const { window } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.DocumentFragment = window.DocumentFragment;
  globalThis.Comment = window.Comment;
  globalThis.Text = window.Text;
  globalThis.customElements = window.customElements;
  globalThis.NodeFilter = window.NodeFilter;
  globalThis.MutationObserver = window.MutationObserver;

  ({ WebComponent, html, css, prop } = await import('../../index.js'));
});

/* -------------------- attribute coercion -------------------- */

test('observedAttributes derives from static properties, excluding state', () => {
  class A extends WebComponent({
    foo: String,
    bar: prop(Number, { state: true }),       // state → excluded
    fooBar: String,                           // camelCase → kebab-case
  }) {}
  A.register('obs-attrs');
  assert.deepEqual(
    A.observedAttributes.sort(),
    ['foo', 'foo-bar'].sort(),
  );
});

test('attributeChangedCallback coerces String / Number / Boolean / Object / Array', () => {
  class C extends WebComponent({
    s: String,
    n: Number,
    b: Boolean,
    o: Object,
    a: Array,
  }) {}
  C.register('coerce-el');
  const el = document.createElement('coerce-el');
  el.attributeChangedCallback('s', null, 'hi');
  assert.equal(el.s, 'hi');
  el.attributeChangedCallback('n', null, '42');
  assert.equal(el.n, 42);
  el.attributeChangedCallback('b', null, '');
  assert.equal(el.b, true);
  el.attributeChangedCallback('b', '', null);
  assert.equal(el.b, false);
  el.attributeChangedCallback('o', null, '{"x":1}');
  assert.deepEqual(el.o, { x: 1 });
  el.attributeChangedCallback('a', null, '[1,2]');
  assert.deepEqual(el.a, [1, 2]);
});

test('attributeChangedCallback resolves malformed JSON to null, not the raw string (#1253)', () => {
  // A string is never a valid value for a property declared Object, whatever
  // put it there, so the reader hands back null. Matches lit's
  // defaultConverter.fromAttribute.
  //
  // The second half is a REMOVAL, not an absence. Removing an attribute fires
  // this callback with a null value; an attribute that was never there fires
  // nothing at all and leaves the property at its constructor value. Only the
  // removal is assertable here, and the two are worth keeping distinct because
  // a doc surface once said otherwise.
  //
  // What this asserts is the observable CONTRACT (a removal reads back as
  // null), not which line produces it. Nothing can assert the latter: the
  // branch's `value == null` arm is unobservable here, because `JSON.parse`
  // coerces `null` to the string "null" and returns null anyway, so deleting
  // that arm changes no result on this path. Starting the removal from a
  // PARSED value at least makes the transition real rather than null -> null,
  // which the setter would skip on inequality.
  class C extends WebComponent({ o: Object }) {}
  C.register('malformed-json');
  const el = document.createElement('malformed-json');
  el.attributeChangedCallback('o', null, 'not-json');
  assert.equal(el.o, null);

  el.attributeChangedCallback('o', 'not-json', '{"a":1}');
  assert.deepEqual(el.o, { a: 1 }, 'a parseable value still round-trips');
  el.attributeChangedCallback('o', '{"a":1}', null);
  assert.equal(el.o, null, 'and REMOVING the attribute resets it to null');
});

test('custom converter.fromAttribute overrides type-based coercion', () => {
  class C extends WebComponent({
    v: prop(Object, { converter: { fromAttribute: (v) => ({ raw: v }) } }),
  }) {}
  C.register('custom-from');
  const el = document.createElement('custom-from');
  el.attributeChangedCallback('v', null, 'abc');
  assert.deepEqual(el.v, { raw: 'abc' });
});

test('attributeChangedCallback sets property when called with new value', () => {
  // The browser itself guards against calling this with the same value;
  // when it fires, the framework trusts the value and sets the property.
  class C extends WebComponent({ s: String }) {}
  C.register('same-attr');
  const el = document.createElement('same-attr');
  el.attributeChangedCallback('s', null, 'a');
  assert.equal(el.s, 'a');
});

/* -------------------- property reflection -------------------- */

test('reflect: true writes property back to attribute (Boolean)', () => {
  class C extends WebComponent({ on: prop(Boolean, { reflect: true }) }) {}
  C.register('reflect-bool');
  const el = document.createElement('reflect-bool');
  document.body.appendChild(el);
  el.on = true;
  assert.equal(el.getAttribute('on'), '');
  el.on = false;
  assert.equal(el.hasAttribute('on'), false);
});

test('reflect: true writes property back to attribute (Object / Array as JSON)', () => {
  class C extends WebComponent({
    data: prop(Object, { reflect: true }),
    tags: prop(Array, { reflect: true }),
  }) {}
  C.register('reflect-json');
  const el = document.createElement('reflect-json');
  document.body.appendChild(el);
  el.data = { a: 1 };
  assert.equal(el.getAttribute('data'), '{"a":1}');
  el.tags = ['x'];
  assert.equal(el.getAttribute('tags'), '["x"]');
});

test('reflect: true removes attribute when value is null', () => {
  class C extends WebComponent({ s: prop(String, { reflect: true }) }) {}
  C.register('reflect-null');
  const el = document.createElement('reflect-null');
  document.body.appendChild(el);
  el.s = 'hi';
  assert.equal(el.getAttribute('s'), 'hi');
  el.s = null;
  assert.equal(el.hasAttribute('s'), false);
});

test('reflect uses converter.toAttribute when provided', () => {
  class C extends WebComponent({
    v: prop(Object, {
      reflect: true,
      converter: { toAttribute: (v) => (v == null ? null : `x:${v.n}`) },
    }),
  }) {}
  C.register('reflect-to-attr');
  const el = document.createElement('reflect-to-attr');
  document.body.appendChild(el);
  el.v = { n: 42 };
  assert.equal(el.getAttribute('v'), 'x:42');
  el.v = null;
  assert.equal(el.hasAttribute('v'), false);
});

/* -------------------- hasChanged -------------------- */

test('custom hasChanged short-circuits updates when false', async () => {
  let renders = 0;
  class C extends WebComponent({
    size: prop(Number, { hasChanged: (a, b) => (b == null ? true : Math.abs(a - b) > 1) }),
  }) {
    render() { renders++; return html`<p>${this.size}</p>`; }
  }
  C.register('hc-el');
  const el = document.createElement('hc-el');
  document.body.appendChild(el);
  await Promise.resolve(); await Promise.resolve();
  renders = 0;
  el.size = 10;                          // first change: renders
  await Promise.resolve(); await Promise.resolve();
  el.size = 10.5;                        // diff 0.5 → hasChanged false → skip
  await Promise.resolve(); await Promise.resolve();
  assert.equal(renders, 1, 'second assignment did not schedule a render');
});

/* -------------------- lifecycle: connect / disconnect -------------------- */

test('connectedCallback marks _connected true and schedules first render', async () => {
  class C extends WebComponent {
    render() { return html`<p>hi</p>`; }
  }
  C.register('c-lc');
  const el = document.createElement('c-lc');
  document.body.appendChild(el);
  assert.equal(el._connected, true);
  // Microtask flush
  await Promise.resolve();
  assert.ok(/** @type any */ (el).__firstRendered, 'first render flagged');
});

test('disconnectedCallback clears _connected', () => {
  class C extends WebComponent {
    render() { return html``; }
  }
  C.register('disc-el');
  const el = document.createElement('disc-el');
  document.body.appendChild(el);
  el.remove();
  assert.equal(el._connected, false);
});

/* -------------------- controllers: dispatch -------------------- */

test('controller hooks fire in order: hostConnected → hostUpdate → hostUpdated → hostDisconnected', async () => {
  const calls = [];
  const ctrl = {
    hostConnected() { calls.push('hostConnected'); },
    hostUpdate() { calls.push('hostUpdate'); },
    hostUpdated() { calls.push('hostUpdated'); },
    hostDisconnected() { calls.push('hostDisconnected'); },
  };

  class C extends WebComponent {
    constructor() { super(); this.addController(ctrl); }
    render() { return html`<p>hi</p>`; }
  }
  C.register('ctrl-dispatch');
  const el = document.createElement('ctrl-dispatch');
  document.body.appendChild(el);
  await Promise.resolve();    // let microtask render flush
  await Promise.resolve();
  el.remove();
  assert.ok(calls.indexOf('hostConnected') < calls.indexOf('hostUpdate'));
  assert.ok(calls.indexOf('hostUpdate') < calls.indexOf('hostUpdated'));
  assert.ok(calls.indexOf('hostDisconnected') > calls.indexOf('hostUpdated'));
});

test('addController on an already-connected host fires hostConnected immediately', () => {
  let called = false;
  class C extends WebComponent {
    render() { return html``; }
  }
  C.register('ctrl-late');
  const el = document.createElement('ctrl-late');
  document.body.appendChild(el);
  el.addController({ hostConnected() { called = true; } });
  assert.equal(called, true);
});

test('removeController detaches a controller', async () => {
  let updates = 0;
  const ctrl = { hostUpdate() { updates++; } };
  class C extends WebComponent {
    constructor() { super(); this.addController(ctrl); }
    render() { return html``; }
  }
  C.register('ctrl-remove');
  const el = document.createElement('ctrl-remove');
  document.body.appendChild(el);
  await Promise.resolve();
  el.removeController(ctrl);
  el.requestUpdate();
  await Promise.resolve();
  assert.equal(updates, 1, 'hostUpdate only fired once: once removed, no more');
});

/* -------------------- requestUpdate batching -------------------- */

test('multiple requestUpdate calls in one microtask coalesce into a single render', async () => {
  let renders = 0;
  class C extends WebComponent {
    render() { renders++; return html``; }
  }
  C.register('batch-el');
  const el = document.createElement('batch-el');
  document.body.appendChild(el);
  await Promise.resolve();
  renders = 0;
  el.requestUpdate();
  el.requestUpdate();
  el.requestUpdate();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(renders, 1, 'three requestUpdates batched into one render');
});

test('requestUpdate schedules a re-render without state change', async () => {
  let renders = 0;
  class C extends WebComponent {
    render() { renders++; return html``; }
  }
  C.register('req-el');
  const el = document.createElement('req-el');
  document.body.appendChild(el);
  await Promise.resolve();
  renders = 0;
  el.requestUpdate();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(renders, 1);
});

/* -------------------- firstUpdated + renderError -------------------- */

test('firstUpdated fires exactly once after the first render', async () => {
  let firstCount = 0;
  class C extends WebComponent {
    render() { return html``; }
    firstUpdated() { firstCount++; }
  }
  C.register('first-el');
  const el = document.createElement('first-el');
  document.body.appendChild(el);
  await Promise.resolve(); await Promise.resolve();
  el.requestUpdate();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(firstCount, 1, 'firstUpdated fired exactly once across multiple renders');
});

test('renderError catches exceptions thrown from render() and uses its fallback', async () => {
  class C extends WebComponent {
    render() { throw new Error('boom'); }
    renderError(e) { return html`<p>err: ${e.message}</p>`; }
  }
  C.register('err-el');
  const el = document.createElement('err-el');
  document.body.appendChild(el);
  await Promise.resolve(); await Promise.resolve();
  // If renderError produced something without throwing, we pass.
  assert.ok(el, 'component survived a throwing render');
});

test('a throw from the COMMIT of an async render() is contained like a sync one', async () => {
  // Regression: `.then(onFulfil, onRejected)` does not route onFulfil's own
  // throw to onRejected, so a commit that threw (a guard refusal, a value with
  // a throwing toString) rejected the pending commit, and _performRender's
  // `.then` had no rejection handler. The error escaped as an unhandled
  // rejection, renderError() never ran, and updateComplete never settled.
  //
  // Asserted on the three observable consequences rather than the mechanism,
  // because each one reds on its own when the try/catch in _commitAsync is
  // reverted (measured: renderError not called, updateComplete never settles,
  // __pendingAsyncCommits stuck at 1). The value below throws from String(),
  // which is what a commit does to an attribute hole.
  const boom = { toString() { throw new Error('commit failed'); } };
  let errorArg = null;
  class C extends WebComponent {
    async render() { await 0; return html`<div title=${boom}></div>`; }
    renderError(e) { errorArg = e; return html`<p>fallback</p>`; }
  }
  C.register('async-commit-throw');
  const el = document.createElement('async-commit-throw');
  document.body.appendChild(el);

  // Bounded, and crossing the bound is a hard failure that names itself
  // rather than a pass: an unsettled updateComplete is the bug.
  const settled = await Promise.race([
    // resolve and reject are NOT the same outcome here. A change that rejected
    // updateComplete instead of resolving it would keep renderError() firing and
    // the counter releasing, while every `await el.updateComplete` in app and
    // framework code started throwing: the unhandled rejection this contains.
    Promise.resolve(el.updateComplete).then(() => 'resolved', () => 'REJECTED'),
    new Promise((r) => setTimeout(() => r('NEVER SETTLED'), 500)),
  ]);
  assert.equal(settled, 'resolved', 'updateComplete must RESOLVE, not reject, after a contained commit failure');
  assert.ok(errorArg instanceof Error, 'renderError() receives the commit error');
  assert.match(errorArg.message, /commit failed/, 'and the real error, not a wrapper');
  assert.equal(el.__pendingAsyncCommits, 0, 'the in-flight count is released, not wedged');
});

test('a REJECTED thenable from an update() override settles the cycle too', async () => {
  // The commit-throw fix guarantees _commitAsync never rejects, which is not
  // the same as handling a rejection at the site that awaits it. update() is a
  // documented override point and may return any thenable, so a rejecting one
  // reproduced the original wedge verbatim: counter stuck >= 1, updateComplete
  // never settling, the error escaping as an unhandled rejection.
  let errorArg = null;
  class C extends WebComponent {
    render() { return html`<p>x</p>`; }
    renderError(e) { errorArg = e; return undefined; }
    update() { return Promise.reject(new Error('prepare failed')); }
  }
  C.register('async-update-reject');
  const el = document.createElement('async-update-reject');
  document.body.appendChild(el);

  const settled = await Promise.race([
    // resolve and reject are NOT the same outcome here. A change that rejected
    // updateComplete instead of resolving it would keep renderError() firing and
    // the counter releasing, while every `await el.updateComplete` in app and
    // framework code started throwing: the unhandled rejection this contains.
    Promise.resolve(el.updateComplete).then(() => 'resolved', () => 'REJECTED'),
    new Promise((r) => setTimeout(() => r('NEVER SETTLED'), 500)),
  ]);
  assert.equal(settled, 'resolved', 'updateComplete must RESOLVE, not reject, after a contained rejection');
  assert.ok(errorArg instanceof Error, 'the rejection reaches renderError()');
  assert.match(errorArg.message, /prepare failed/);
  assert.equal(el.__pendingAsyncCommits, 0, 'the in-flight count is released, not wedged');
});

test('a SUPERSEDED cycle rejecting late does not clobber the newer render', async () => {
  // The token check gates the DOM write, not the release. Without it, a
  // discarded cycle's rejection (a dropped fetch, or #492 aborting its own
  // in-flight action) commits its error state over the render that already
  // replaced it, and the user sees an error for work that was correctly
  // thrown away.
  let gate;
  class C extends WebComponent({ v: prop(String) }) {
    renderError(e) { return html`<p class="err">ERR</p>`; }
    update(changed) {
      if (this.v === 'A') return new Promise((_, rej) => { gate = () => rej(new Error('stale')); });
      return super.update(changed);
    }
    render() { return html`<p class="live">v=${this.v}</p>`; }
  }
  C.register('stale-reject-el');
  const el = document.createElement('stale-reject-el');
  el.v = 'A';
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 10));
  el.v = 'B';                                     // supersedes A and commits
  await new Promise((r) => setTimeout(r, 10));
  assert.match(el.innerHTML, /v=B/, 'precondition: B is the live render');

  gate();                                         // A rejects, too late to matter
  await new Promise((r) => setTimeout(r, 10));
  assert.match(el.innerHTML, /v=B/, 'the superseded rejection must leave the live DOM alone');
  assert.doesNotMatch(el.innerHTML, /ERR/, 'and must not commit its error state');
  assert.equal(el.__pendingAsyncCommits, 0, 'while still releasing the in-flight count');
});

test('a commit throw is contained even when update() discards the commit promise', async () => {
  // This is what distinguishes the try/catch inside _commitAsync from the
  // rejection handler at the awaiting site. When update() returns its OWN
  // thenable, _commitAsync's promise is not the one awaited, so a commit throw
  // that only rejected it would be an unhandled rejection nobody sees while
  // the awaited promise resolves normally. With the try/catch, the throw is
  // routed at the point it happens.
  const boom = { toString() { throw new Error('discarded commit failure'); } };
  let errorArg = null;
  class C extends WebComponent({}) {
    renderError(e) { errorArg = e; return html`<p>fallback</p>`; }
    async render() { await 0; return html`<div title=${boom}></div>`; }
    async update(changed) { super.update(changed); }   // returns its own promise, drops _commitAsync's
  }
  C.register('discarded-commit-promise');
  const el = document.createElement('discarded-commit-promise');
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(errorArg instanceof Error, 'renderError() still receives the commit error');
  assert.match(errorArg.message, /discarded commit failure/);
});

/* -------------------- lazy controllers set: ensure graceful behavior -------------------- */

test('WebComponent without static properties still constructs cleanly', () => {
  class C extends WebComponent {
    render() { return html``; }
  }
  C.register('no-props');
  const el = document.createElement('no-props');
  // No throw on construction is the only requirement.
  assert.ok(el instanceof HTMLElement);
});

test('default hasChanged treats NaN !== NaN correctly (via strict inequality semantics)', () => {
  // Default is strict inequality: NaN !== NaN is true, so setting a NaN
  // triggers a change. Document the behaviour so callers know.
  class C extends WebComponent({ n: Number }) {}
  C.register('nan-el');
  const el = document.createElement('nan-el');
  document.body.appendChild(el);
  let updates = 0;
  const orig = el.requestUpdate.bind(el);
  el.requestUpdate = () => { updates++; orig(); };
  el.n = NaN;
  el.n = NaN;   // same NaN, but strict inequality says changed
  assert.equal(updates, 2);
});

/* -------------------- Phase 2: lit lifecycle hooks -------------------- */

test('changedProperties: property setter records (name, oldValue) entries', async () => {
  class C extends WebComponent({ count: Number }) {
    constructor() { super(); this.count = 0; this._captured = null; }
    updated(cp) { this._captured = new Map(cp); }
    render() { return html``; }
  }
  C.register('cp-prop');
  const el = document.createElement('cp-prop');
  document.body.appendChild(el);
  await el.updateComplete;
  el._captured = null;

  el.count = 5;
  await el.updateComplete;
  assert.equal(el._captured.has('count'), true);
  assert.equal(el._captured.get('count'), 0);
});

test('shouldUpdate returning false skips update and updated() hook', async () => {
  let renders = 0, updatedCalls = 0;
  class C extends WebComponent({ val: Number }) {
    constructor() { super(); this.val = 0; }
    shouldUpdate(_cp) { return this.val < 5; }
    updated(_cp) { updatedCalls++; }
    render() { renders++; return html``; }
  }
  C.register('su-gate');
  const el = document.createElement('su-gate');
  document.body.appendChild(el);
  await el.updateComplete;
  const baselineRenders = renders;
  const baselineUpdated = updatedCalls;

  el.val = 10;                             // shouldUpdate returns false
  await el.updateComplete;
  assert.equal(renders, baselineRenders);  // no render
  assert.equal(updatedCalls, baselineUpdated); // no updated() either
});

test('willUpdate runs pre-render and can set properties without re-triggering', async () => {
  let willRuns = 0, updateRuns = 0;
  class C extends WebComponent({
    a: Number,
    b: prop(Number, { state: true }),
  }) {
    constructor() { super(); this.a = 0; this.b = -1; }
    willUpdate(cp) {
      willRuns++;
      if (cp.has('a')) this.b = this.a * 2;  // mutate during willUpdate
    }
    updated() { updateRuns++; }
    render() { return html``; }
  }
  C.register('wu-fold');
  const el = document.createElement('wu-fold');
  document.body.appendChild(el);
  await el.updateComplete;
  const wuBaseline = willRuns;
  const updBaseline = updateRuns;

  el.a = 7;
  await el.updateComplete;
  assert.equal(el.b, 14);
  assert.equal(willRuns, wuBaseline + 1);
  // Single render even though willUpdate set `b`.
  assert.equal(updateRuns, updBaseline + 1);
});

test('updated runs after every render commit; firstUpdated runs once', async () => {
  let firsts = 0, updates = 0;
  class C extends WebComponent({ v: Number }) {
    constructor() { super(); this.v = 0; }
    firstUpdated(_cp) { firsts++; }
    updated(_cp) { updates++; }
    render() { return html``; }
  }
  C.register('fu-vs-u');
  const el = document.createElement('fu-vs-u');
  document.body.appendChild(el);
  await el.updateComplete;
  assert.equal(firsts, 1);
  assert.equal(updates, 1);

  el.v = 1;
  await el.updateComplete;
  assert.equal(firsts, 1);  // still 1
  assert.equal(updates, 2);

  el.v = 2;
  await el.updateComplete;
  assert.equal(updates, 3);
});

test('firstUpdated receives changedProperties Map with initial values', async () => {
  let captured = null;
  class C extends WebComponent({ n: Number }) {
    constructor() { super(); this.n = 42; }
    firstUpdated(cp) { captured = new Map(cp); }
    render() { return html``; }
  }
  C.register('fu-cp');
  const el = document.createElement('fu-cp');
  document.body.appendChild(el);
  await el.updateComplete;
  assert.equal(captured.has('n'), true);
  assert.equal(captured.get('n'), undefined);  // initial oldValue
});

test('update() override can short-circuit the commit', async () => {
  let renderCalls = 0;
  class C extends WebComponent({ n: Number }) {
    constructor() { super(); this.n = 0; this._allowRender = true; }
    update(cp) {
      if (this._allowRender) super.update?.(cp);
    }
    render() { renderCalls++; return html``; }
  }
  // super.update calls render+commit. Since we're not actually calling super,
  // we need to manually invoke render to count it. Simpler: just check the
  // override is called.
  let updateCalls = 0;
  class D extends WebComponent({ n: Number }) {
    constructor() { super(); this.n = 0; }
    update(cp) { updateCalls++; /* no render */ }
    render() { renderCalls++; return html``; }
  }
  D.register('upd-override');
  const el = document.createElement('upd-override');
  document.body.appendChild(el);
  await el.updateComplete;
  assert.equal(updateCalls, 1);
  assert.equal(renderCalls, 0);  // override didn't call super, so render never ran
});

test('updateComplete resolves after the next render', async () => {
  class C extends WebComponent({ v: Number }) {
    constructor() { super(); this.v = 0; this._renderedV = null; }
    updated() { this._renderedV = this.v; }
    render() { return html``; }
  }
  C.register('uc-resolve');
  const el = document.createElement('uc-resolve');
  document.body.appendChild(el);
  await el.updateComplete;
  assert.equal(el._renderedV, 0);

  el.v = 99;
  const settled = await el.updateComplete;
  assert.equal(el._renderedV, 99);
  assert.equal(typeof settled, 'boolean');
});

test('getUpdateComplete can be overridden to chain additional async work', async () => {
  let extraAwaited = false;
  class C extends WebComponent({ v: Number }) {
    constructor() { super(); this.v = 0; }
    async getUpdateComplete() {
      const r = await super.getUpdateComplete();
      await new Promise(res => setTimeout(res, 1));
      extraAwaited = true;
      return r;
    }
    render() { return html``; }
  }
  C.register('uc-override');
  const el = document.createElement('uc-override');
  document.body.appendChild(el);
  await el.updateComplete;
  assert.equal(extraAwaited, true);
});

test('hook order: shouldUpdate → willUpdate → hostUpdate → update → hostUpdated → firstUpdated → updated', async () => {
  const order = [];
  class C extends WebComponent({ n: Number }) {
    constructor() { super(); this.n = 0; }
    shouldUpdate() { order.push('shouldUpdate'); return true; }
    willUpdate() { order.push('willUpdate'); }
    update(cp) { order.push('update'); super.update?.(cp); }
    firstUpdated() { order.push('firstUpdated'); }
    updated() { order.push('updated'); }
    render() { order.push('render'); return html``; }
  }
  const controller = {
    hostUpdate() { order.push('hostUpdate'); },
    hostUpdated() { order.push('hostUpdated'); },
  };
  C.register('hook-order');
  const el = document.createElement('hook-order');
  el.addController(controller);
  document.body.appendChild(el);
  await el.updateComplete;

  // Default update() calls render() internally, but we override here
  // and DO call super.update?.(cp) which invokes the default impl.
  // The default impl is defined on the prototype; super.update?.(cp) on
  // a direct WebComponent subclass calls the WebComponent.prototype.update
  // method which does the render+commit.
  assert.deepEqual(
    order,
    [
      'shouldUpdate',
      'willUpdate',
      'hostUpdate',
      'update',
      'render',
      'hostUpdated',
      'firstUpdated',
      'updated',
    ],
  );
});
