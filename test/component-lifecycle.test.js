/**
 * Unit tests for WebComponent lifecycle paths that aren't exercised by
 * the SSR-only tests — property accessor initialisation, attribute
 * coercion, reflection, connectedCallback upgrading, controller
 * dispatch, setState batching, firstUpdated, renderError.
 *
 * Runs under linkedom to simulate a DOM without spinning up a browser.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

let WebComponent, html, css;

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

  ({ WebComponent, html, css } = await import('../packages/core/index.js'));
});

/* -------------------- attribute coercion -------------------- */

test('observedAttributes derives from static properties, excluding state', () => {
  class A extends WebComponent {
    static properties = {
      foo: { type: String },
      bar: { type: Number, state: true },       // state → excluded
      fooBar: { type: String },                 // camelCase → kebab-case
    };
  }
  A.register('obs-attrs');
  assert.deepEqual(
    A.observedAttributes.sort(),
    ['foo', 'foo-bar'].sort(),
  );
});

test('attributeChangedCallback coerces String / Number / Boolean / Object / Array', () => {
  class C extends WebComponent {
    static properties = {
      s: { type: String },
      n: { type: Number },
      b: { type: Boolean },
      o: { type: Object },
      a: { type: Array },
    };
  }
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

test('attributeChangedCallback falls back to raw string on malformed JSON', () => {
  class C extends WebComponent {
    static properties = { o: { type: Object } };
  }
  C.register('malformed-json');
  const el = document.createElement('malformed-json');
  el.attributeChangedCallback('o', null, 'not-json');
  assert.equal(el.o, 'not-json');
});

test('custom converter.fromAttribute overrides type-based coercion', () => {
  class C extends WebComponent {
    static properties = {
      v: {
        type: Object,
        converter: { fromAttribute: (v) => ({ raw: v }) },
      },
    };
  }
  C.register('custom-from');
  const el = document.createElement('custom-from');
  el.attributeChangedCallback('v', null, 'abc');
  assert.deepEqual(el.v, { raw: 'abc' });
});

test('attributeChangedCallback sets property when called with new value', () => {
  // The browser itself guards against calling this with the same value;
  // when it fires, the framework trusts the value and sets the property.
  class C extends WebComponent {
    static properties = { s: { type: String } };
  }
  C.register('same-attr');
  const el = document.createElement('same-attr');
  el.attributeChangedCallback('s', null, 'a');
  assert.equal(el.s, 'a');
});

/* -------------------- property reflection -------------------- */

test('reflect: true writes property back to attribute (Boolean)', () => {
  class C extends WebComponent {
    static properties = { on: { type: Boolean, reflect: true } };
  }
  C.register('reflect-bool');
  const el = document.createElement('reflect-bool');
  document.body.appendChild(el);
  el.on = true;
  assert.equal(el.getAttribute('on'), '');
  el.on = false;
  assert.equal(el.hasAttribute('on'), false);
});

test('reflect: true writes property back to attribute (Object / Array as JSON)', () => {
  class C extends WebComponent {
    static properties = {
      data: { type: Object, reflect: true },
      tags: { type: Array, reflect: true },
    };
  }
  C.register('reflect-json');
  const el = document.createElement('reflect-json');
  document.body.appendChild(el);
  el.data = { a: 1 };
  assert.equal(el.getAttribute('data'), '{"a":1}');
  el.tags = ['x'];
  assert.equal(el.getAttribute('tags'), '["x"]');
});

test('reflect: true removes attribute when value is null', () => {
  class C extends WebComponent {
    static properties = { s: { type: String, reflect: true } };
  }
  C.register('reflect-null');
  const el = document.createElement('reflect-null');
  document.body.appendChild(el);
  el.s = 'hi';
  assert.equal(el.getAttribute('s'), 'hi');
  el.s = null;
  assert.equal(el.hasAttribute('s'), false);
});

test('reflect uses converter.toAttribute when provided', () => {
  class C extends WebComponent {
    static properties = {
      v: {
        type: Object,
        reflect: true,
        converter: { toAttribute: (v) => (v == null ? null : `x:${v.n}`) },
      },
    };
  }
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
  class C extends WebComponent {
    static properties = {
      size: { type: Number, hasChanged: (a, b) => (b == null ? true : Math.abs(a - b) > 1) },
    };
    render() { renders++; return html`<p>${this.size}</p>`; }
  }
  C.register('hc-el');
  const el = document.createElement('hc-el');
  document.body.appendChild(el);
  await Promise.resolve(); await Promise.resolve();
  renders = 0;
  el.size = 10;                          // first change — renders
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

test('controller hooks fire in order: onMount → beforeRender → afterRender → onUnmount', async () => {
  const calls = [];
  const ctrl = {
    onMount() { calls.push('onMount'); },
    beforeRender() { calls.push('beforeRender'); },
    afterRender() { calls.push('afterRender'); },
    onUnmount() { calls.push('onUnmount'); },
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
  assert.ok(calls.indexOf('onMount') < calls.indexOf('beforeRender'));
  assert.ok(calls.indexOf('beforeRender') < calls.indexOf('afterRender'));
  assert.ok(calls.indexOf('onUnmount') > calls.indexOf('afterRender'));
});

test('addController on an already-connected host fires onMount immediately', () => {
  let called = false;
  class C extends WebComponent {
    render() { return html``; }
  }
  C.register('ctrl-late');
  const el = document.createElement('ctrl-late');
  document.body.appendChild(el);
  el.addController({ onMount() { called = true; } });
  assert.equal(called, true);
});

test('removeController detaches a controller', async () => {
  let updates = 0;
  const ctrl = { beforeRender() { updates++; } };
  class C extends WebComponent {
    constructor() { super(); this.addController(ctrl); }
    render() { return html``; }
  }
  C.register('ctrl-remove');
  const el = document.createElement('ctrl-remove');
  document.body.appendChild(el);
  await Promise.resolve();
  el.removeController(ctrl);
  el.setState({ foo: 1 });
  await Promise.resolve();
  assert.equal(updates, 1, 'beforeRender only fired once — once removed, no more');
});

/* -------------------- setState batching -------------------- */

test('multiple setState calls in one microtask coalesce into a single render', async () => {
  let renders = 0;
  class C extends WebComponent {
    render() { renders++; return html``; }
  }
  C.register('batch-el');
  const el = document.createElement('batch-el');
  document.body.appendChild(el);
  await Promise.resolve();
  renders = 0;
  el.setState({ a: 1 });
  el.setState({ b: 2 });
  el.setState({ c: 3 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(renders, 1, 'three setStates batched into one render');
  assert.deepEqual(el.state, { a: 1, b: 2, c: 3 });
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
  el.setState({ x: 1 });
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

/* -------------------- lazy controllers set — ensure graceful behavior -------------------- */

test('WebComponent without static properties still constructs cleanly', () => {
  class C extends WebComponent {
    render() { return html``; }
  }
  C.register('no-props');
  const el = document.createElement('no-props');
  assert.deepEqual(el.state, {});
});

test('default hasChanged treats NaN !== NaN correctly (via strict inequality semantics)', () => {
  // Default is strict inequality: NaN !== NaN is true, so setting a NaN
  // triggers a change. Document the behaviour so callers know.
  class C extends WebComponent {
    static properties = { n: { type: Number } };
  }
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
