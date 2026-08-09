// SSR coverage for the reactive-prop `default` and custom `attribute` options.
// SSR runs the constructor + render() (not connectedCallback), so a `default`
// must appear in the first paint, and a custom `attribute` on a parent-rendered
// tag must coerce to the right property server-side (the JS-off contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebComponent, prop } from '../../index.js';
import { html } from '../../src/html.js';
import { renderToString } from '../../src/render-server.js';

class SsrDefault extends WebComponent({ label: prop(String, { default: 'hi' }) }) {
  render() { return html`<span>${this.label}</span>`; }
}
SsrDefault.register('ssr-default');

class SsrAttr extends WebComponent({ open: prop(Boolean, { attribute: 'is-open' }) }) {
  render() { return html`<span>${this.open ? 'OPEN' : 'CLOSED'}</span>`; }
}
SsrAttr.register('ssr-attr');

test('default option lands in the SSR first paint', async () => {
  const out = await renderToString(html`<ssr-default></ssr-default>`);
  assert.match(out, />hi</, 'the default "hi" is rendered server-side without any attribute');
});

test('custom attribute coerces to its property at SSR', async () => {
  const out = await renderToString(html`<ssr-attr is-open></ssr-attr>`);
  assert.match(out, />OPEN</, 'the is-open attribute maps to the `open` prop during SSR');
});

test('custom attribute SSR counterfactual: absent attribute leaves the prop falsy', async () => {
  const out = await renderToString(html`<ssr-attr></ssr-attr>`);
  assert.match(out, />CLOSED</, 'without is-open, `open` is falsy in the SSR output');
});

// --- converter.fromAttribute at SSR (#1340) ---------------------------------
//
// The SSR reader used to dispatch on `def.type` alone, so a prop declaring a
// `converter` was read one way server-side and another way the moment the
// element upgraded. Both readers now go through the one `readAttributeValue`
// in `component.js`, so the converter runs on both sides, ahead of type
// coercion. The browser half of the agreement (a REAL element upgrade against
// this same markup) lives in
// `packages/core/test/rendering/browser/reflect-function-guard.test.js`.

class SsrConverter extends WebComponent({
  mode: prop(String, { converter: { fromAttribute: (v) => String(v).toUpperCase() } }),
}) {
  render() { return html`<span>${this.mode}</span>`; }
}
SsrConverter.register('ssr-converter');

class SsrConverterObj extends WebComponent({
  v: prop(Object, { converter: { fromAttribute: (v) => ({ raw: v }) } }),
}) {
  render() { return html`<i>${JSON.stringify(this.v)}</i>`; }
}
SsrConverterObj.register('ssr-converter-obj');

class SsrConverterThrows extends WebComponent({
  v: prop(String, { converter: { fromAttribute: () => { throw new Error('converter blew up'); } } }),
}) {
  render() { return html`<i>never-rendered</i>`; }
}
SsrConverterThrows.register('ssr-converter-throws');

class SsrNoConverter extends WebComponent({
  s: String,
  n: Number,
  b: Boolean,
  o: prop(Object),
  a: prop(Array),
}) {
  render() {
    // Every value goes through `JSON.stringify` on purpose. A text hole elides
    // a boolean and renders an empty string for `''`, so painting the values
    // directly would make the Boolean and String branches unobservable and the
    // assertion below non-discriminating. This form pins the TYPE as well as
    // the value, which is what the extraction has to keep identical.
    const parts = [this.s, this.n, this.b, this.o, this.a];
    return html`<i>${parts.map((p) => JSON.stringify(p)).join('|')}</i>`;
  }
}
SsrNoConverter.register('ssr-no-converter');

test('converter.fromAttribute runs at SSR, ahead of type coercion', async () => {
  const out = await renderToString(html`<ssr-converter mode="a"></ssr-converter>`);
  assert.match(out, />A</, 'the converter upper-cased the attribute during SSR');
  assert.doesNotMatch(out, />a</, 'the raw attribute text never reaches the property');
});

test('the converter wins over the declared type at SSR, matching the client', async () => {
  // The same declaration the client test at
  // `packages/core/test/lifecycle/component-lifecycle.test.js` pins, so the two
  // files assert one declaration on both sides. Without the converter arm the
  // Object branch would JSON.parse `abc`, throw, and fall back to `null`.
  const out = await renderToString(html`<ssr-converter-obj v="abc"></ssr-converter-obj>`);
  assert.match(out, /\{"raw":"abc"\}/, 'the converter result is the property value');
  assert.doesNotMatch(out, />null</, 'the type-based JSON fallback did not run');
});

test('the converter is handed DECODED text at SSR, matching what the DOM hands the client', async () => {
  // The SSR reader walks the raw source tag, so `raw` is the literal characters
  // between the quotes, while the client's value came out of the DOM already
  // decoded. Handing the encoded text to a converter would read the SAME
  // attribute differently on the two sides for anything carrying a quote or an
  // ampersand, and a JSON-parsing converter (the documented reason to write
  // one) would throw server-side on markup `escapeAttr` itself produced.
  const seen = [];
  class Probe extends WebComponent({
    cfg: prop(Object, {
      converter: { fromAttribute: (v) => { seen.push(v); return JSON.parse(v); } },
    }),
  }) {
    render() { return html`<i>${JSON.stringify(this.cfg)}</i>`; }
  }
  Probe.register('ssr-converter-entities');

  const out = await renderToString(html`<ssr-converter-entities cfg="{&quot;a&quot;:1,&quot;b&quot;:&quot;x&amp;y&quot;}"></ssr-converter-entities>`);
  assert.deepEqual(seen, ['{"a":1,"b":"x&y"}'], 'the converter must receive decoded text');
  assert.match(out, /\{"a":1,"b":"x&amp;y"\}/, 'and the parsed value renders');
});

test('a throwing converter is not caught by the reader, so the component renders its SSR error state', async () => {
  // Decision recorded on `readAttributeValue`: an author who supplies a
  // converter owns the read, so a throw propagates on BOTH sides rather than
  // being caught on one and manufacturing a fresh divergence. At SSR it lands
  // in per-component error isolation, which logs and drops the content.
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  let out;
  try {
    out = await renderToString(html`<ssr-converter-throws v="x"></ssr-converter-throws>`);
  } finally {
    console.error = original;
  }
  assert.doesNotMatch(out, /never-rendered/, 'the component did not render its own content');
  assert.ok(
    errors.some((e) => e.includes('SSR failed for') && e.includes('ssr-converter-throws')),
    `expected an SSR-failure log naming the tag, got: ${JSON.stringify(errors)}`,
  );
});

test('a prop with NO converter is byte-identical to what SSR emitted before the extraction', async () => {
  // The neutrality proof for routing the SSR reader through the client's chain.
  // Covers a bare boolean attribute, an empty-string attribute, unparseable
  // JSON, and an entity-encoded JSON attribute. This is the test that fires if
  // someone later "simplifies" one of the client's null guards away.
  const out = await renderToString(
    html`<ssr-no-converter s="" n="" b o="oops" a="[&quot;x&quot;,1]"></ssr-no-converter>`,
  );
  assert.equal(
    out,
    '<ssr-no-converter s="" n="" b o="oops" a="[&quot;x&quot;,1]" data-wj-host>'
      + '<!--webjs-hydrate--><i>""|0|true|null|["x",1]</i></ssr-no-converter>',
  );
});
