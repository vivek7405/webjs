// Two guards on the same branch chain, kept in one file because the BOUNDARY
// between them is the thing that is easy to get wrong.
//
// #1169: a `reflect: true` property holding a function must never write that
// function into its HTML attribute.
//
// #1253: a JSON-typed `reflect: true` property holding a value
// `JSON.stringify` cannot serialize at all (a cycle, a `BigInt`, a throwing
// `toJSON`) must drop its attribute rather than throw out of reflection.
//
// A wrong implementation makes exactly one of two neighbouring assertions red:
// `[1, 2, fn]` still reflecting as `[1,2,null]` versus a cyclic value dropping.
// Reading them together is what shows where the line sits, and #1169 had to
// revert precisely that boundary once.
//
// The fall-through branch of `_reflectAttribute` used to run `String(value)`,
// and `String(fn)` is the function's SOURCE. So assigning an imported
// `'use server'` action to a reflected property shipped the action's whole
// body, closure secrets included, to every visitor. It was never specific to a
// property NAMED `action`: the same happened for `title`, for `label`, for any
// name at all, because the leak is the generic reflection path stringifying
// whatever it is handed. That makes it a sibling of the form-action leak
// (#1154 / #1167) rather than a case of it, and it needs its own guard.
//
// What these tests pin, in order of how much it would cost to get wrong:
//   - the source never reaches the SSR output, for a String-typed prop, an
//     untyped one, and a custom `attribute` name
//   - a normal string value still reflects byte-identically, since a guard
//     that also broke ordinary reflection would be a worse bug than the leak
//   - a custom `converter.toAttribute` still wins, because an author who
//     writes one has taken responsibility for the serialization
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

let html, renderToString, WebComponent, prop;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ renderToString } = await import('../../src/render-server.js'));
  ({ WebComponent, prop } = await import('../../src/component.js'));
});

// The sentinel lives inside the function body, so it appears in the output only
// if the function was stringified. A closure constant is exactly the shape a
// leaked server action would expose.
async function secretAction() {
  const CONNECTION = 'postgres://user:REFLECT_LEAK_MARKER@host/db';
  return CONNECTION;
}

/**
 * Render `template`, capturing the dev warnings the guard emits so a passing
 * run does not print a wall of warnings that read as failures. The capture
 * spans the await, which is why it is a wrapper rather than a bare
 * try/finally at each call site.
 *
 * @returns {Promise<{ out: string, warnings: string[] }>}
 */
async function renderCapturingWarnings(template) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { out: await renderToString(template), warnings };
  } finally {
    console.warn = original;
  }
}

describe('reflect:true never stringifies a function (#1169)', () => {
  test('a String-typed reflected prop drops the function instead of leaking its source', async () => {
    class StringTyped extends WebComponent({
      action: prop(String, { reflect: true }),
    }) {
      constructor() {
        super();
        this.action = secretAction;
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    StringTyped.register('reflect-fn-string');

    const { out } = await renderCapturingWarnings(html`<reflect-fn-string></reflect-fn-string>`);

    assert.ok(
      !out.includes('REFLECT_LEAK_MARKER'),
      `the function source reached the SSR output: ${out}`
    );
    assert.ok(
      !out.includes('action='),
      `the attribute should be removed, not written: ${out}`
    );
  });

  test('an UNTYPED reflected prop drops it too, so this is not a String-branch quirk', async () => {
    class Untyped extends WebComponent({
      payload: prop({ reflect: true }),
    }) {
      constructor() {
        super();
        this.payload = secretAction;
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    Untyped.register('reflect-fn-untyped');

    const { out } = await renderCapturingWarnings(html`<reflect-fn-untyped></reflect-fn-untyped>`);

    assert.ok(!out.includes('REFLECT_LEAK_MARKER'), out);
    assert.ok(!out.includes('payload='), out);
  });

  test('the property NAME is irrelevant: title, label, and data-* leak the same way without the guard', async () => {
    class ManyNames extends WebComponent({
      title: prop(String, { reflect: true }),
      label: prop(String, { reflect: true }),
      tokenValue: prop(String, { reflect: true, attribute: 'data-token' }),
    }) {
      constructor() {
        super();
        this.title = secretAction;
        this.label = secretAction;
        this.tokenValue = secretAction;
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    ManyNames.register('reflect-fn-names');

    const { out } = await renderCapturingWarnings(html`<reflect-fn-names></reflect-fn-names>`);

    assert.ok(!out.includes('REFLECT_LEAK_MARKER'), out);
    for (const attr of ['title=', 'label=', 'data-token=']) {
      assert.ok(!out.includes(attr), `${attr} survived: ${out}`);
    }
  });

  test('an Object-typed reflected prop stops writing the literal string "undefined"', async () => {
    // `JSON.stringify(fn)` is `undefined`, and `setAttribute(name, undefined)`
    // writes the four-character string. That never leaked the source, but it is
    // the same defect: a function is not an attribute value, so the attribute
    // goes rather than being filled with nonsense.
    class ObjectTyped extends WebComponent({
      config: prop(Object, { reflect: true }),
    }) {
      constructor() {
        super();
        this.config = secretAction;
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    ObjectTyped.register('reflect-fn-object');

    const { out } = await renderCapturingWarnings(html`<reflect-fn-object></reflect-fn-object>`);

    assert.ok(!out.includes('config='), `expected no config attribute: ${out}`);
    assert.ok(!out.includes('undefined'), `wrote a literal "undefined": ${out}`);
  });

  test('an ARRAY carrying a function leaks the same way, so the guard cannot be a bare typeof', async () => {
    // `String([fn])` is `Array.prototype.join`, which runs `String()` on each
    // element, so `[serverAction]` writes the same source `serverAction` does.
    // A `typeof value === 'function'` guard misses this entirely and the value
    // falls through to the `String(value)` branch. The form-action guard
    // already carries the recursive predicate for exactly this reason, so the
    // reflect path reuses it rather than re-deriving a weaker one.
    class Wrapped extends WebComponent({
      typed: prop(String, { reflect: true }),
      untyped: prop({ reflect: true }),
      nested: prop(String, { reflect: true }),
    }) {
      constructor() {
        super();
        this.typed = [secretAction];
        this.untyped = [secretAction];
        this.nested = [['x', [secretAction]]];
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    Wrapped.register('reflect-fn-wrapped');

    const { out } = await renderCapturingWarnings(html`<reflect-fn-wrapped></reflect-fn-wrapped>`);

    assert.ok(
      !out.includes('REFLECT_LEAK_MARKER'),
      `an array-carried function reached the SSR output: ${out}`
    );
    for (const attr of ['typed=', 'untyped=', 'nested=']) {
      assert.ok(!out.includes(attr), `${attr} survived: ${out}`);
    }
  });

  test('a JSON-typed prop CARRYING a function keeps its other data', async () => {
    // The guard must not reach across the JSON branch. `JSON.stringify` drops
    // a function to `null` in an array and omits the key in an object, so
    // nothing leaks there and the surrounding data is real. Refusing the whole
    // value would discard the 1 and the 2 to close a hole that is not open,
    // which is a data-loss regression rather than a fix.
    class JsonCarrier extends WebComponent({
      arr: prop(Array, { reflect: true }),
      obj: prop(Object, { reflect: true }),
    }) {
      constructor() {
        super();
        this.arr = [1, 2, secretAction];
        this.obj = { a: 1, b: secretAction };
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    JsonCarrier.register('reflect-fn-json-carrier');

    const { out, warnings } = await renderCapturingWarnings(
      html`<reflect-fn-json-carrier></reflect-fn-json-carrier>`
    );

    assert.ok(!out.includes('REFLECT_LEAK_MARKER'), `JSON must not carry the source: ${out}`);
    assert.ok(out.includes('arr="[1,2,null]"'), `the array's real elements must survive: ${out}`);
    assert.ok(out.includes('a&quot;:1') || out.includes('"a":1'), `the object's real keys must survive: ${out}`);
    assert.equal(warnings.length, 0, `a safely-serialized value must not warn: ${warnings.join(' | ')}`);
  });

  test('a self-referential array does not hang the guard', async () => {
    // `Array.prototype.join` has a cycle guard, so a self-referential array
    // stringifies rather than recursing forever. The predicate has to match
    // that: refusing to leak must not become a new way to blow the stack on a
    // render that used to succeed.
    const cyclic = ['a'];
    cyclic.push(cyclic);

    class Cyclic extends WebComponent({
      items: prop(String, { reflect: true }),
    }) {
      constructor() {
        super();
        this.items = cyclic;
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    Cyclic.register('reflect-fn-cyclic');

    // Reaching this line at all is most of the assertion: a runaway walk would
    // throw a RangeError out of the render instead.
    const { out } = await renderCapturingWarnings(html`<reflect-fn-cyclic></reflect-fn-cyclic>`);
    assert.ok(out.includes('reflect-fn-cyclic'), out);
  });

  test('a normal string value still reflects byte-identically', async () => {
    class Plain extends WebComponent({
      action: prop(String, { reflect: true }),
      count: prop(Number, { reflect: true }),
      open: prop(Boolean, { reflect: true }),
      config: prop(Object, { reflect: true }),
    }) {
      constructor() {
        super();
        this.action = 'plain-string';
        this.count = 42;
        this.open = true;
        this.config = { a: 1 };
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    Plain.register('reflect-fn-plain');

    const out = await renderToString(html`<reflect-fn-plain></reflect-fn-plain>`);

    assert.ok(out.includes('action="plain-string"'), out);
    assert.ok(out.includes('count="42"'), out);
    assert.ok(out.includes('open'), out);
    assert.ok(out.includes('config="{&quot;a&quot;:1}"') || out.includes('config="{"a":1}"'), out);
  });

  test('a custom converter.toAttribute still wins, function value included', async () => {
    class Converted extends WebComponent({
      action: prop(String, {
        reflect: true,
        converter: { toAttribute: (v) => `custom:${typeof v}` },
      }),
    }) {
      constructor() {
        super();
        this.action = secretAction;
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    Converted.register('reflect-fn-converter');

    const out = await renderToString(html`<reflect-fn-converter></reflect-fn-converter>`);

    assert.ok(out.includes('action="custom:function"'), out);
    assert.ok(!out.includes('REFLECT_LEAK_MARKER'), out);
  });

  test('the drop warns, naming the property, the tag, and the attribute', async () => {
    class Warns extends WebComponent({
      tokenValue: prop(String, { reflect: true, attribute: 'data-token' }),
    }) {
      constructor() {
        super();
        this.tokenValue = secretAction;
      }
      render() {
        return html`<span>x</span>`;
      }
    }
    Warns.register('reflect-fn-warns');

    const { warnings } = await renderCapturingWarnings(html`<reflect-fn-warns></reflect-fn-warns>`);

    assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`);
    const [message] = warnings;
    assert.match(message, /tokenValue/);
    assert.match(message, /reflect-fn-warns/);
    assert.match(message, /data-token/);
    // The warning must not print the value: printing the source is the leak
    // this guard exists to prevent, and a server log is not always private.
    assert.ok(
      !message.includes('REFLECT_LEAK_MARKER'),
      `the warning leaked the source it refused to write: ${message}`
    );
  });
});

describe('reflect:true drops an unserializable JSON value (#1253)', () => {
  // These render through `renderToString`, so they ARE the SSR-path proof. The
  // failure mode without the guard is not a thrown render: per-component error
  // isolation catches the `TypeError`. These tests run with NODE_ENV unset, so
  // that surfaces a red error box carrying the tag; in PRODUCTION it emits the
  // component EMPTY at a 200 instead. Either way the CONTENT is gone,
  // so every case here asserts on the rendered CONTENT. A tag-only assertion
  // passes against the bug.
  //
  // Nothing here asserts on the engine's own `JSON.stringify` message. V8 says
  // "Converting circular structure to JSON" and JavaScriptCore says something
  // else, so a message assertion would pass on Node and fail on Bun. The
  // assertions are on the property, tag, and attribute names the framework
  // itself writes.

  test('a self-referential object drops the attribute and still renders', async () => {
    const cyc = { a: 1 };
    cyc.self = cyc;

    class SelfObj extends WebComponent({
      cfg: prop(Object, { reflect: true }),
    }) {
      constructor() {
        super();
        this.cfg = cyc;
      }
      render() {
        return html`<i>ok-content-obj</i>`;
      }
    }
    SelfObj.register('reflect-cyc-object');

    const { out, warnings } = await renderCapturingWarnings(
      html`<reflect-cyc-object></reflect-cyc-object>`
    );

    assert.ok(out.includes('reflect-cyc-object'), out);
    assert.ok(out.includes('ok-content-obj'), `the component rendered empty: ${out}`);
    assert.ok(!out.includes('cfg='), `expected no cfg attribute: ${out}`);
    assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`);
    assert.match(warnings[0], /cfg/);
    assert.match(warnings[0], /reflect-cyc-object/);
  });

  test('a self-referential array drops the same way', async () => {
    const cyc = ['a'];
    cyc.push(cyc);

    class SelfArr extends WebComponent({
      items: prop(Array, { reflect: true }),
    }) {
      constructor() {
        super();
        this.items = cyc;
      }
      render() {
        return html`<i>ok-content-arr</i>`;
      }
    }
    SelfArr.register('reflect-cyc-array');

    const { out, warnings } = await renderCapturingWarnings(
      html`<reflect-cyc-array></reflect-cyc-array>`
    );

    assert.ok(out.includes('ok-content-arr'), `the component rendered empty: ${out}`);
    assert.ok(!out.includes('items='), `expected no items attribute: ${out}`);
    assert.equal(warnings.length, 1, warnings.join(' | '));
    assert.match(warnings[0], /items/);
  });

  test('a MUTUAL cycle between two objects drops too, so the guard is not shaped around self-reference', async () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    a.b = b;
    b.a = a;

    class Mutual extends WebComponent({
      graph: prop(Object, { reflect: true }),
    }) {
      constructor() {
        super();
        this.graph = a;
      }
      render() {
        return html`<i>ok-content-mutual</i>`;
      }
    }
    Mutual.register('reflect-cyc-mutual');

    const { out, warnings } = await renderCapturingWarnings(
      html`<reflect-cyc-mutual></reflect-cyc-mutual>`
    );

    assert.ok(out.includes('ok-content-mutual'), `the component rendered empty: ${out}`);
    assert.ok(!out.includes('graph='), `expected no graph attribute: ${out}`);
    assert.equal(warnings.length, 1, warnings.join(' | '));
  });

  test('a BigInt drops too, which a cycle-only pre-walk would have missed', async () => {
    class Big extends WebComponent({
      cfg: prop(Object, { reflect: true }),
    }) {
      constructor() {
        super();
        this.cfg = { n: 1n };
      }
      render() {
        return html`<i>ok-content-bigint</i>`;
      }
    }
    Big.register('reflect-unser-bigint');

    const { out, warnings } = await renderCapturingWarnings(
      html`<reflect-unser-bigint></reflect-unser-bigint>`
    );

    assert.ok(out.includes('ok-content-bigint'), `the component rendered empty: ${out}`);
    assert.ok(!out.includes('cfg='), `expected no cfg attribute: ${out}`);
    assert.equal(warnings.length, 1, warnings.join(' | '));
    assert.match(warnings[0], /reflect-unser-bigint/);
  });

  test("an author toJSON() that throws drops too", async () => {
    class ThrowingToJson extends WebComponent({
      cfg: prop(Object, { reflect: true }),
    }) {
      constructor() {
        super();
        this.cfg = { toJSON() { throw new Error('boom-from-tojson'); } };
      }
      render() {
        return html`<i>ok-content-tojson</i>`;
      }
    }
    ThrowingToJson.register('reflect-unser-tojson');

    const { out, warnings } = await renderCapturingWarnings(
      html`<reflect-unser-tojson></reflect-unser-tojson>`
    );

    assert.ok(out.includes('ok-content-tojson'), `the component rendered empty: ${out}`);
    assert.ok(!out.includes('cfg='), `expected no cfg attribute: ${out}`);
    assert.equal(warnings.length, 1, warnings.join(' | '));
  });

  test('a serializable Object and Array still reflect byte-identically and warn zero times', async () => {
    // This is the regression the #1169 revert exists to prevent: a guard that
    // over-refuses on this branch discards real data.
    class Clean extends WebComponent({
      cfg: prop(Object, { reflect: true }),
      items: prop(Array, { reflect: true }),
    }) {
      constructor() {
        super();
        this.cfg = { a: 1, nested: { b: 2 } };
        this.items = [1, 'two', null];
      }
      render() {
        return html`<i>ok</i>`;
      }
    }
    Clean.register('reflect-unser-clean');

    const { out, warnings } = await renderCapturingWarnings(
      html`<reflect-unser-clean></reflect-unser-clean>`
    );

    assert.ok(
      out.includes('cfg="{&quot;a&quot;:1,&quot;nested&quot;:{&quot;b&quot;:2}}"')
      || out.includes('cfg="{"a":1,"nested":{"b":2}}"'),
      out
    );
    assert.ok(
      out.includes('items="[1,&quot;two&quot;,null]"') || out.includes('items="[1,"two",null]"'),
      out
    );
    assert.equal(warnings.length, 0, `a serializable value must not warn: ${warnings.join(' | ')}`);
  });

  test('the SSR reader falls back to null too, so it cannot disagree with the client (#1253)', async () => {
    // `applyAttrsToInstance` (render-server.js) and the JSON branch of
    // `attributeChangedCallback` (component.js) must resolve a PRESENT,
    // unparseable attribute the same way. If only one of them falls back to
    // `null`, the same `<my-el cfg="oops">` SSRs holding a string and
    // re-renders holding something else the moment the element upgrades, which
    // is a hydration divergence rather than a fixed round trip. Both readers
    // now call one shared `readAttributeValue` (#1340), so this fallback is
    // shared rather than mirrored; the converter arm sits ahead of it and is
    // covered separately in `ssr-prop-options.test.js`.
    class Reader extends WebComponent({ cfg: prop(Object) }) {
      render() {
        return html`<i>val=${JSON.stringify(this.cfg)}</i>`;
      }
    }
    Reader.register('reflect-unser-reader');

    const out = await renderToString(html`<reflect-unser-reader cfg="not-json"></reflect-unser-reader>`);

    assert.ok(out.includes('val=null'), `the SSR reader kept the raw string: ${out}`);
    assert.ok(!out.includes('val=&quot;not-json&quot;') && !out.includes('val="not-json"'), out);
  });

  // The two tests below pin SSR-ONLY paths: attributes `applyAttrsToInstance`
  // consumes that the client reader never sees at all, so the `null` fallback
  // reaches them too. They are here because the fallback change is observable
  // on these paths and nothing else in this PR covers them, not because the
  // values agree across the two sides. They do NOT agree, and that divergence
  // predates #1253 and is tracked in #1341; what is pinned here is only that
  // the SSR side stops putting a raw STRING into a prop declared `Object`.
  //
  // Both were measured against `origin/main`, where each rendered
  // `val="oops"`. If #1341 changes which attributes SSR reads, these two
  // become the tests that notice.

  test('a state:true prop is read by SSR only, and gets the same null fallback (#1253)', async () => {
    // `observedAttributes` filters state props out, so the browser never calls
    // `attributeChangedCallback` for this attribute and the upgraded element
    // keeps its constructor value.
    class StateProp extends WebComponent({ cfg: prop(Object, { state: true }) }) {
      constructor() {
        super();
        this.cfg = { fromCtor: true };
      }
      render() {
        return html`<i>val=${JSON.stringify(this.cfg)}</i>`;
      }
    }
    StateProp.register('reflect-unser-state');

    const out = await renderToString(html`<reflect-unser-state cfg="oops"></reflect-unser-state>`);

    assert.ok(out.includes('val=null'), `expected the null fallback, got: ${out}`);
    // Scoped to the RENDERED value, not the whole output: SSR echoes the source
    // attribute back into the emitted tag, so `oops` legitimately appears there.
    assert.ok(
      !out.includes('val=&quot;oops&quot;') && !out.includes('val="oops"'),
      `a raw string reached an Object-typed prop: ${out}`
    );
  });

  test('a camelCase source attribute is read by SSR only, and gets the same null fallback (#1253)', async () => {
    // The HTML parser lowercases this to `cfgdata`, which never matches the
    // `cfg-data` entry in `observedAttributes`, so the client never reads it.
    // The SSR resolver matches the source-case name directly and does.
    class CamelAttr extends WebComponent({ cfgData: prop(Object) }) {
      constructor() {
        super();
        this.cfgData = { fromCtor: true };
      }
      render() {
        return html`<i>val=${JSON.stringify(this.cfgData)}</i>`;
      }
    }
    CamelAttr.register('reflect-unser-camel');

    const out = await renderToString(html`<reflect-unser-camel cfgData="oops"></reflect-unser-camel>`);

    assert.ok(out.includes('val=null'), `expected the null fallback, got: ${out}`);
    // Scoped to the RENDERED value, not the whole output: SSR echoes the source
    // attribute back into the emitted tag, so `oops` legitimately appears there.
    assert.ok(
      !out.includes('val=&quot;oops&quot;') && !out.includes('val="oops"'),
      `a raw string reached an Object-typed prop: ${out}`
    );
  });
});
