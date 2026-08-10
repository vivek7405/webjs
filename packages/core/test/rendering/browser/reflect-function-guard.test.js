/**
 * The reflect-a-function guard, in a REAL browser (#1169).
 *
 * The node-side coverage in `../reflect-function-guard.test.js` renders through
 * the SSR walker, where reflection writes into a server attribute shim backed by
 * a Map and the walker reads it back out into the emitted tag. That proves the
 * SSR half. It cannot prove the CLIENT half, which is the other place the leak
 * lived: `_reflectAttribute` also runs from the property setter and from
 * `_activate`, against a live element in a real document, and that path only
 * exists in a browser.
 *
 * The distinction matters because the two halves reach the guard by different
 * routes. SSR calls it once from `performServerUpdate`; the client calls it on
 * connect and again on every subsequent assignment, through a setter wrapped in
 * a re-entrancy guard that `setAttribute` / `removeAttribute` re-enters via
 * `attributeChangedCallback`. A guard that returned early in the wrong place
 * would leave that flag stuck and silently kill all later reflection, which is
 * a failure only a live DOM can show.
 *
 * The same argument brought two more suites here (#1253): the unserializable
 * WRITE-side drop, which reaches the guard by those same client routes, and the
 * unparseable-attribute READ side, which is a different mechanism (no `reflect`
 * involved) that needs a browser for the same underlying reason, since only a
 * browser calls `attributeChangedCallback` on upgrade.
 */

import { html } from '../../../src/html.js';
import { WebComponent, prop } from '../../../src/component.js';
import { renderToString } from '../../../src/render-server.js';

import { assert } from '../../../../../test/browser-assert.js';

// The sentinel lives inside the function body, so it appears anywhere only if
// the function was stringified. A closure constant is the shape a leaked server
// action would expose.
async function secretAction() {
  const CONNECTION = 'postgres://user:BROWSER_REFLECT_MARKER@host/db';
  return CONNECTION;
}

class ReflectProbe extends WebComponent({
  label: prop(String, { reflect: true }),
  tokenValue: prop(String, { reflect: true, attribute: 'data-token' }),
}) {
  render() {
    return html`<span>probe</span>`;
  }
}
ReflectProbe.register('reflect-fn-probe');

class ConverterProbe extends WebComponent({
  label: prop(String, {
    reflect: true,
    converter: { toAttribute: (v) => `custom:${typeof v}` },
  }),
}) {
  render() {
    return html`<span>probe</span>`;
  }
}
ConverterProbe.register('reflect-fn-converter-probe');

class UnserializableProbe extends WebComponent({
  cfg: prop(Object, { reflect: true }),
  tokenCfg: prop(Object, { reflect: true, attribute: 'data-cfg' }),
}) {
  render() {
    return html`<span>probe</span>`;
  }
}
UnserializableProbe.register('reflect-unser-probe');

// Assigns in the CONSTRUCTOR on purpose: `_activate` reflects declared
// attributes before the render root is set up, so this is the upgrade path
// rather than the setter path.
class UnserializableCtorProbe extends WebComponent({
  cfg: prop(Object, { reflect: true }),
}) {
  constructor() {
    super();
    const o = { a: 1 };
    o.self = o;
    this.cfg = o;
  }
  render() {
    return html`<span>ctor-probe-content</span>`;
  }
}
UnserializableCtorProbe.register('reflect-unser-ctor-probe');

// Renders its own prop value, so the READ side is observable in the DOM rather
// than only through the property.
class UnserializableReaderProbe extends WebComponent({ cfg: prop(Object) }) {
  render() {
    return html`<i>val=${JSON.stringify(this.cfg)}</i>`;
  }
}
UnserializableReaderProbe.register('reflect-unser-reader');

// Same shape, one arm earlier in the reader: this one declares a custom
// `converter.fromAttribute` and renders what the reader made of the attribute.
class ConverterReaderProbe extends WebComponent({
  mode: prop(String, { converter: { fromAttribute: (v) => String(v).toUpperCase() } }),
}) {
  render() {
    return html`<i>mode=${this.mode}</i>`;
  }
}
ConverterReaderProbe.register('converter-read-probe');

// The same read, against an attribute carrying the entities `escapeAttr` emits.
// The browser hands `attributeChangedCallback` text the DOM already decoded, so
// this is the probe that shows whether the SSR reader decodes before handing the
// converter its input.
class ConverterEntityProbe extends WebComponent({
  cfg: prop(Object, { converter: { fromAttribute: (v) => JSON.parse(v) } }),
}) {
  render() {
    return html`<i>cfg=${JSON.stringify(this.cfg)}</i>`;
  }
}
ConverterEntityProbe.register('converter-entity-probe');

const mounted = [];
/**
 * A probe attached to the live document. Reflection runs from `_activate`,
 * which only fires on a connected element, so an unattached one would never
 * reach the code under test.
 *
 * Each probe is removed after its test. Without that, `document.body`
 * accumulates every earlier test's markup and the document-wide leak
 * assertions stop describing the test they sit in.
 */
function mount(tag) {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  mounted.push(el);
  return el;
}

/** Swallow the dev warning the guard emits, and hand back what it said. */
const warnings = [];
let originalWarn;
setup(() => {
  warnings.length = 0;
  originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
});

teardown(() => {
  console.warn = originalWarn;
  while (mounted.length) mounted.pop().remove();
});

suite('reflect:true never stringifies a function, in a real browser', () => {

  test('assigning a function to a reflected prop writes no attribute', async () => {
    const el = mount('reflect-fn-probe');
    await el.updateComplete;

    el.label = secretAction;
    await el.updateComplete;

    assert.equal(el.getAttribute('label'), null, 'the attribute must be absent, not stringified');
    assert.ok(
      !document.body.innerHTML.includes('BROWSER_REFLECT_MARKER'),
      'no source anywhere in the document'
    );
    // The property itself is untouched: the guard governs what reaches the
    // ATTRIBUTE, not what the component may hold.
    assert.equal(el.label, secretAction, 'the property still holds the function');
  });

  test('a function REMOVES an attribute a previous string value had set', async () => {
    // The live-DOM case with the most room to go wrong. Reflection here is not
    // a fresh write into an empty shim, it has to clear what is already there,
    // and a guard that merely declined to write would leave the stale string
    // in place while the property says otherwise.
    const el = mount('reflect-fn-probe');
    el.label = 'a-real-label';
    await el.updateComplete;
    assert.equal(el.getAttribute('label'), 'a-real-label', 'reflection must work here, else this test proves nothing');

    el.label = secretAction;
    await el.updateComplete;

    assert.equal(el.getAttribute('label'), null, 'the stale value must be cleared, not left behind');
    assert.ok(!document.body.innerHTML.includes('BROWSER_REFLECT_MARKER'), 'no source in the document');
  });

  test('reflection still works after a function was dropped, so the re-entrancy flag is not stuck', async () => {
    // `removeAttribute` re-enters the setter through
    // `attributeChangedCallback`, which is what `__reflectingAttribute`
    // guards. If the guard's early exit left that flag set, EVERY later
    // reflection on this element would be silently skipped, and the only
    // symptom would be an attribute that stops updating.
    const el = mount('reflect-fn-probe');
    el.label = secretAction;
    await el.updateComplete;
    assert.equal(el.getAttribute('label'), null);

    el.label = 'back-to-normal';
    await el.updateComplete;
    assert.equal(el.getAttribute('label'), 'back-to-normal', 'reflection must survive the dropped write');

    el.label = 'changed-again';
    await el.updateComplete;
    assert.equal(el.getAttribute('label'), 'changed-again', 'and keep working after that');
  });

  test('a renamed attribute drops the same way', async () => {
    const el = mount('reflect-fn-probe');
    el.tokenValue = secretAction;
    await el.updateComplete;

    assert.equal(el.getAttribute('data-token'), null, 'the custom attribute name is dropped too');
    assert.ok(!document.body.innerHTML.includes('BROWSER_REFLECT_MARKER'), 'no source in the document');
  });

  test('the drop warns, naming the property, the tag, and the attribute, without printing the value', async () => {
    const el = mount('reflect-fn-probe');
    await el.updateComplete;
    warnings.length = 0;

    el.tokenValue = secretAction;
    await el.updateComplete;

    assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}: ${warnings.join(' | ')}`);
    const [message] = warnings;
    assert.ok(message.includes('tokenValue'), message);
    assert.ok(message.includes('reflect-fn-probe'), message);
    assert.ok(message.includes('data-token'), message);
    assert.ok(
      !message.includes('BROWSER_REFLECT_MARKER'),
      `the warning leaked the source it refused to write: ${message}`
    );
  });

  test('a normal string value still reflects, so the guard did not break reflection', async () => {
    const el = mount('reflect-fn-probe');
    el.label = 'plain-string';
    el.tokenValue = 'plain-token';
    await el.updateComplete;

    assert.equal(el.getAttribute('label'), 'plain-string');
    assert.equal(el.getAttribute('data-token'), 'plain-token');
    assert.equal(warnings.length, 0, `an ordinary value must not warn: ${warnings.join(' | ')}`);
  });

  test('a custom converter.toAttribute still receives the function and decides for itself', async () => {
    const el = mount('reflect-fn-converter-probe');
    el.label = secretAction;
    await el.updateComplete;

    assert.equal(el.getAttribute('label'), 'custom:function', 'the author override runs first and wins');
    assert.ok(!document.body.innerHTML.includes('BROWSER_REFLECT_MARKER'), 'and it did not stringify the source');
  });
});

suite('reflect:true drops an unserializable JSON value, in a real browser (#1253)', () => {
  // The client halves the node file structurally cannot reach: the property
  // setter against a live element, and `_activate`, which reflects BEFORE it
  // sets up the render root. Without the guard the first throws out of the
  // author's assignment and the second throws out of `connectedCallback`, so
  // the element never renders at all.

  function cyclic() {
    const o = { a: 1 };
    o.self = o;
    return o;
  }

  test('assigning a cyclic value does not throw, and writes no attribute', async () => {
    const el = mount('reflect-unser-probe');
    await el.updateComplete;

    const value = cyclic();
    el.cfg = value;
    await el.updateComplete;

    assert.equal(el.getAttribute('cfg'), null, 'the attribute must be absent');
    assert.equal(el.cfg, value, 'the property still holds it: the guard governs the ATTRIBUTE only');
  });

  test('a component whose constructor sets a cyclic value still upgrades and RENDERS', async () => {
    // A different failure from the setter one: without the guard the throw
    // lands inside `_activate` before the render root exists, so the element
    // never renders.
    const el = mount('reflect-unser-ctor-probe');
    await el.updateComplete;

    assert.ok(el.textContent.includes('ctor-probe-content'), `rendered empty: ${el.innerHTML}`);
    assert.equal(el.getAttribute('cfg'), null, 'and the attribute is absent');
  });

  test('a later clean assignment still reflects, so __reflectingAttribute is not stuck', async () => {
    const el = mount('reflect-unser-probe');
    await el.updateComplete;

    el.cfg = cyclic();
    await el.updateComplete;
    el.cfg = { ok: 1 };
    await el.updateComplete;
    assert.equal(el.getAttribute('cfg'), '{"ok":1}');

    el.cfg = { ok: 2 };
    await el.updateComplete;
    assert.equal(el.getAttribute('cfg'), '{"ok":2}', 'and again, not just once');
  });

  test('a stale attribute is CLEARED rather than left holding the previous JSON', async () => {
    const el = mount('reflect-unser-probe');
    el.cfg = { was: 'here' };
    await el.updateComplete;
    assert.equal(el.getAttribute('cfg'), '{"was":"here"}');

    el.cfg = cyclic();
    await el.updateComplete;
    assert.equal(el.getAttribute('cfg'), null, 'the previous JSON must not survive');
  });

  test('the drop warns once, naming the property, the tag, and the attribute', async () => {
    const el = mount('reflect-unser-probe');
    await el.updateComplete;
    warnings.length = 0;

    el.tokenCfg = cyclic();
    await el.updateComplete;

    assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}: ${warnings.join(' | ')}`);
    const [message] = warnings;
    assert.ok(message.includes('tokenCfg'), message);
    assert.ok(message.includes('reflect-unser-probe'), message);
    assert.ok(message.includes('data-cfg'), message);
  });

});

suite('an unparseable JSON attribute reads back as null, in a real browser (#1253)', () => {
  // The READ half of #1253, which is a different mechanism from the reflection
  // drop above and does not involve `reflect` at all: this probe declares a
  // plain `prop(Object)`. It earns a browser test because the agreement being
  // claimed is between the SSR reader and what the browser does on UPGRADE, and
  // only a browser calls `attributeChangedCallback` itself. A node test invoking
  // that callback by hand exercises the branch but not the path the divergence
  // lived on.

  test('through a REAL element upgrade, matching what the SSR reader makes of the same markup', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<reflect-unser-reader cfg="not-json"></reflect-unser-reader>';
    document.body.appendChild(host);
    mounted.push(host);

    const el = host.firstElementChild;
    await customElements.whenDefined('reflect-unser-reader');
    await el.updateComplete;

    assert.equal(el.cfg, null, 'the upgraded element must not hold the raw string');
    assert.ok(
      el.textContent.includes('val=null'),
      `and it must RENDER that value: ${el.innerHTML}`
    );

    // The same markup through the SSR reader, so a future change that moves one
    // side without the other fails here rather than in production.
    const ssr = await renderToString(html`<reflect-unser-reader cfg="not-json"></reflect-unser-reader>`);
    assert.ok(ssr.includes('val=null'), `the SSR reader disagreed with the client: ${ssr}`);
  });
});

suite('converter.fromAttribute reads identically at SSR and through a real upgrade (#1340)', () => {
  // The same argument as the suite above, one arm earlier in the reader. The
  // SSR reader used to dispatch on `def.type` alone, so a prop declaring a
  // converter was read one way server-side and another way on upgrade. Only a
  // browser calls `attributeChangedCallback` itself, so a node test invoking it
  // by hand would exercise the branch but not the path the divergence lived on.

  test('through a REAL element upgrade, matching what the SSR reader makes of the same markup', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<converter-read-probe mode="a"></converter-read-probe>';
    document.body.appendChild(host);
    mounted.push(host);

    const el = host.firstElementChild;
    await customElements.whenDefined('converter-read-probe');
    await el.updateComplete;

    assert.equal(el.mode, 'A', 'the upgraded element must hold what the converter returned');
    assert.ok(
      el.textContent.includes('mode=A'),
      `and it must RENDER that value: ${el.innerHTML}`
    );

    // The agreement assertion, and the one that reds on a revert: the same
    // markup through the SSR reader has to make the same value of it.
    const ssr = await renderToString(html`<converter-read-probe mode="a"></converter-read-probe>`);
    assert.ok(ssr.includes('mode=A'), `the SSR reader disagreed with the client: ${ssr}`);
  });

  test('and on an ENTITY-ENCODED attribute, where the two readers get their text from different places', async () => {
    // The client's value came out of the DOM, which decoded it; the SSR reader
    // walks the raw source tag and gets the literal characters between the
    // quotes. `escapeAttr` encodes every `"`, so a converter that parses its
    // input (the documented reason to write one) sees valid JSON on one side
    // and an entity soup on the other unless the SSR reader decodes first.
    const markup = '<converter-entity-probe cfg="{&quot;a&quot;:1,&quot;b&quot;:&quot;x&amp;y&quot;}"></converter-entity-probe>';
    const host = document.createElement('div');
    host.innerHTML = markup;
    document.body.appendChild(host);
    mounted.push(host);

    const el = host.firstElementChild;
    await customElements.whenDefined('converter-entity-probe');
    await el.updateComplete;

    assert.deepEqual(el.cfg, { a: 1, b: 'x&y' }, 'the upgraded element parsed the decoded text');

    assert.ok(
      el.textContent.includes('cfg={"a":1,"b":"x&y"}'),
      `and it must RENDER that value: ${el.innerHTML}`
    );

    // Assert on the rendered VALUE rather than on the markup, the way the
    // sibling suite above does. The client's `innerHTML` carries the hydration
    // marker comments that the SSR string has no counterpart for, and the SSR
    // text is escaped for a text node (`&` is `&amp;`) while `textContent`
    // reads back decoded, so a markup comparison never matches by construction
    // even when the two readers agree exactly.
    const ssr = await renderToString(html`<converter-entity-probe cfg="{&quot;a&quot;:1,&quot;b&quot;:&quot;x&amp;y&quot;}"></converter-entity-probe>`);
    assert.ok(
      ssr.includes('cfg={"a":1,"b":"x&amp;y"}'),
      `the SSR reader disagreed with the client: ${ssr}`
    );
  });
});
