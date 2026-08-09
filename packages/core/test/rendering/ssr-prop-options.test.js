// SSR coverage for the reactive-prop `default` and custom `attribute` options.
// SSR runs the constructor + render() (not connectedCallback), so a `default`
// must appear in the first paint, and a custom `attribute` on a parent-rendered
// tag must coerce to the right property server-side (the JS-off contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebComponent, prop } from '../../index.js';
import { html } from '../../src/html.js';
import { renderToString } from '../../src/render-server.js';
import NAMED_ENTITIES, { LEGACY_NAMES } from '../../src/html-entities.js';

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
// in `packages/core/src/attribute-reader.js`, so the converter runs on both
// sides, ahead of type coercion, and is handed decoded text on both.
// The browser half of the agreement (a REAL element upgrade against
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

// --- The SSR reader sees the browser's attribute set (#1341) -----------------
//
// `applyAttrsToInstance` used to walk the parsed source tag with its own name
// resolver, while the browser goes through `observedAttributes` after
// lowercasing every name and decoding every character reference. The two
// disagreed on four shapes, all reachable only from hand-written markup, and
// each one SSR'd one value and hydrated to another with nothing erroring. Both
// readers now resolve through `resolveAttributeProperty` in
// `packages/core/src/attribute-reader.js`, and the SSR caller supplies the name
// the platform would deliver.
//
// The browser half of each case is asserted for real, through an element
// upgrade, in `browser/ssr-client-parity.test.js`. These are the SSR halves.

class SsrStateObj extends WebComponent({ cfg: prop(Object, { state: true }) }) {
  constructor() { super(); this.cfg = { fromCtor: true }; }
  render() { return html`<i>val=${JSON.stringify(this.cfg)}</i>`; }
}
SsrStateObj.register('ssr-state-obj');

class SsrCamel extends WebComponent({ cfgData: prop(String) }) {
  constructor() { super(); this.cfgData = 'CTOR'; }
  render() { return html`<i>val=${String(this.cfgData)}</i>`; }
}
SsrCamel.register('ssr-camel');

class SsrUnknown extends WebComponent({ known: prop(String) }) {
  constructor() { super(); this.known = ''; }
  render() {
    return html`<i>known=${String(this.known)} class=${String(this.class)} cfgData=${String(this.cfgData)}</i>`;
  }
}
SsrUnknown.register('ssr-unknown');

class SsrStr extends WebComponent({ s: prop(String), n: prop(Number) }) {
  constructor() { super(); this.s = ''; this.n = 0; }
  render() { return html`<i>val=${String(this.s)}|n=${String(this.n)}|attr=${String(this.getAttribute('s'))}</i>`; }
}
SsrStr.register('ssr-str');

class SsrObj extends WebComponent({ cfg: prop(Object) }) {
  constructor() { super(); this.cfg = null; }
  render() { return html`<i>val=${JSON.stringify(this.cfg)}</i>`; }
}
SsrObj.register('ssr-obj');

test('a state:true prop is not populated from a source attribute at SSR (#1341)', async () => {
  // `observedAttributes` excludes state props, so the browser never delivers
  // this attribute to any reader and the upgraded element keeps the
  // constructor value. SSR now skips it for the same reason.
  const out = await renderToString(html([`<ssr-state-obj cfg="oops"></ssr-state-obj>`]));
  assert.ok(out.includes('val={"fromCtor":true}'), out);
  assert.ok(!out.includes('val=null'), `the attribute still reached the reader: ${out}`);
});

test('a state:true prop still receives a .prop binding at SSR (#1341)', async () => {
  // The hydration channel a `state` prop is SUPPOSED to receive an SSR value
  // through: `consumePropAttrs` reads and deletes every `data-webjs-prop-*`
  // entry BEFORE `applyAttrsToInstance` runs, so the Decision 1 filter cannot
  // reach it. This must stay green across the whole change.
  const out = await renderToString(html`<ssr-state-obj .cfg=${{ viaProp: 1 }}></ssr-state-obj>`);
  assert.ok(out.includes('val={"viaProp":1}'), out);
});

test('a camelCase source attribute is ignored at SSR, as the browser ignores it (#1341)', async () => {
  // The HTML parser lowercases `cfgData` to `cfgdata`, which matches nothing in
  // `observedAttributes` (the entry there is `cfg-data`), so the browser leaves
  // the constructor value. SSR lowercases the source name before resolving and
  // reaches the same nothing.
  const out = await renderToString(html([`<ssr-camel cfgData="oops"></ssr-camel>`]));
  assert.ok(out.includes('val=CTOR'), out);
  assert.ok(!out.includes('val=oops'), `the camelCase name still resolved: ${out}`);
});

test('the kebab-cased attribute still resolves at SSR (#1341)', async () => {
  const out = await renderToString(html([`<ssr-camel cfg-data="ok"></ssr-camel>`]));
  assert.ok(out.includes('val=ok'), out);
});

test('a prop declaring a custom attribute does NOT answer to its property name (#1341)', async () => {
  // `open: prop(Boolean, { attribute: 'is-open' })` puts exactly `is-open` in
  // `observedAttributes`, so a browser never delivers `open` to any reader and
  // the upgraded element keeps its constructor value. A `props[name]` fallback
  // used to sit after the resolver's loop and made SSR read it anyway, which is
  // the same read-more-than-the-platform bug as the camelCase case. Both
  // readers carried the fallback, but only the SSR one could reach it.
  assert.deepEqual(SsrAttr.observedAttributes, ['is-open'], 'the platform fact this rests on');
  const out = await renderToString(html([`<ssr-attr open></ssr-attr>`]));
  assert.match(out, />CLOSED</, `the property name resolved at SSR: ${out}`);
});

test('an attribute matching no declared property is ignored at SSR (#1341)', async () => {
  // It used to become an instance property, which no browser upgrade ever
  // reproduces and which on a real HTMLElement can mutate DOM state.
  const out = await renderToString(
    html([`<ssr-unknown known="k" cfgData="j" class="c"></ssr-unknown>`]),
  );
  assert.ok(out.includes('known=k'), out);
  assert.ok(out.includes('class=undefined'), `an undeclared attribute became a property: ${out}`);
  assert.ok(out.includes('cfgData=undefined'), `an undeclared attribute became a property: ${out}`);
});

// A browser decodes every character reference before any reader sees the value,
// so SSR decodes once, ahead of the type coercion, on EVERY branch. The two
// `&amp;` rows are the double-decoding counterfactuals: a single-pass replace
// never rescans a replacement, so `&amp;lt;` is the literal `&lt;` and never
// `<`. They are asserted individually rather than folded into the loop, so a
// future edit cannot weaken them without deleting a named test.
const ENTITY_MATRIX = [
  ['a&hellip;b', 'a…b', 'a named reference'],
  ['&lt;script&gt;', '<script>', 'both halves of a tag, not the old half-decoded `<script&gt;`'],
  ['&#x7b;', '{', 'a hexadecimal reference'],
  ['&#X7B;', '{', 'an uppercase-X hexadecimal reference'],
  ['&#123', '{', 'the missing-semicolon numeric form, which a tokenizer still decodes'],
  ['&#128;', '€', 'the C1 range through the windows-1252 table'],
  ['&#0;', '�', 'a null code point'],
  ['&#xD800;', '�', 'a lone surrogate'],
  ['&#x110000;', '�', 'a code point past U+10FFFF'],
  ['&nbsp', ' ', 'a legacy semicolon-less name, which a browser really does decode'],
  ['&copy', '©', 'another legacy name, at the end of the value'],
  ['&amp', '&', 'the legacy form of the one name that must not double-decode'],
  ['&not', '¬', 'a legacy name that is also a prefix of longer ones'],
  ['&nbspx', '&nbspx', 'the whole run is captured, and `nbspx` is not a legacy name'],
  ['&nbsp=x', '&nbsp=x', 'the carve-out: an `=` follows, the one shape the lookahead decides'],
  ['&notin', '&notin', 'same, `notin` is not a legacy name; a browser gets there via `&not` plus `i`'],
  ['&notreal;', '&notreal;', 'an unrecognised name, left literal as a browser leaves it'],
  ['plain', 'plain', 'a value with no reference at all'],
];

for (const [source, expected, why] of ENTITY_MATRIX) {
  test(`entity decoding on a String prop: ${source} is ${JSON.stringify(expected)} (#1341)`, async () => {
    const out = await renderToString(html([`<ssr-str s="${source}"></ssr-str>`]));
    const m = /val=([^|]*)\|/.exec(out);
    assert.ok(m, `no rendered value in: ${out}`);
    assert.equal(decodeRendered(m[1]), expected, why);
  });
}

test('entity decoding counterfactual: &amp;lt; is the literal &lt;, never < (#1341)', async () => {
  const out = await renderToString(html([`<ssr-str s="&amp;lt;"></ssr-str>`]));
  const m = /val=([^|]*)\|/.exec(out);
  assert.equal(decodeRendered(m[1]), '&lt;', 'a replacement was rescanned, so the decode double-decoded');
});

test('entity decoding counterfactual: &amp;#123; is the literal &#123; (#1341)', async () => {
  const out = await renderToString(html([`<ssr-str s="&amp;#123;"></ssr-str>`]));
  const m = /val=([^|]*)\|/.exec(out);
  assert.equal(decodeRendered(m[1]), '&#123;', 'a replacement was rescanned, so the decode double-decoded');
});

// A name that collides with something on `Object.prototype` is NOT a named
// reference, so a browser leaves it literal. Reading the table by indexing the
// imported object returned an inherited VALUE for these instead of `undefined`
// (a function for all seven below), which threw out of the decoder and rendered
// the whole component as an SSR error box, on a path `seedServerAttrs` reaches
// for EVERY attribute of EVERY custom element. Listed individually rather than
// looped so a regression names the key that broke.
for (const name of [
  'constructor', 'toString', 'valueOf', 'hasOwnProperty',
  'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
]) {
  test(`&${name}; is left literal and does not throw (#1341)`, async () => {
    const out = await renderToString(html([`<ssr-str s="&${name};"></ssr-str>`]));
    assert.ok(!out.includes('data-webjs-error'), `the decoder threw: ${out}`);
    const m = /val=([^|]*)\|/.exec(out);
    assert.equal(decodeRendered(m[1]), `&${name};`);
  });
}

test('&__proto__; is left literal, for a different reason (#1341)', async () => {
  // Kept apart from the seven above because it is NOT a counterfactual for the
  // table lookup: `CHAR_REF` requires `[a-zA-Z]` straight after the `&`, so
  // this never matches and never reaches `decodeNamed` at all. It passed before
  // the Map fix too. What it pins is the regex boundary, which is the only
  // reason the nastiest inherited name cannot reach the lookup.
  const out = await renderToString(html([`<ssr-str s="&__proto__;"></ssr-str>`]));
  assert.ok(!out.includes('data-webjs-error'), `the decoder threw: ${out}`);
  const m = /val=([^|]*)\|/.exec(out);
  assert.equal(decodeRendered(m[1]), '&__proto__;');
});

test('every legacy name is an own entry of the character table (#1341)', async () => {
  // `decodeNamed` looks a legacy name up in the table after the carve-out
  // passes, so a name in one list and not the other would decode to nothing.
  // The two are generated together; this is what keeps them together.
  const missing = LEGACY_NAMES.filter((n) => !Object.hasOwn(NAMED_ENTITIES, n));
  assert.deepEqual(missing, [], 'a legacy name has no entry in the table');
  assert.equal(LEGACY_NAMES.length, 106);
  assert.equal(Object.keys(NAMED_ENTITIES).length, 2125);
});

test('entity decoding reaches the Object branch too (#1341)', async () => {
  const out = await renderToString(html([`<ssr-obj cfg="&#123;&quot;a&quot;:1&#125;"></ssr-obj>`]));
  assert.ok(out.includes('val={"a":1}'), `numeric references did not reach JSON.parse: ${out}`);
});

test('entity decoding reaches the Number branch too (#1341)', async () => {
  const out = await renderToString(html([`<ssr-str n="&#49;"></ssr-str>`]));
  assert.ok(out.includes('n=1'), `a numeric reference on a Number prop stayed NaN: ${out}`);
});

test('getAttribute() on the SSR instance returns the decoded string (#1341)', async () => {
  // `seedServerAttrs` shares the decoder, so a `this.getAttribute(name)` read
  // inside willUpdate / render returns what a browser would return.
  const out = await renderToString(html([`<ssr-str s="a&hellip;b"></ssr-str>`]));
  const m = /attr=([^<]*)</.exec(out);
  assert.ok(m, out);
  assert.equal(decodeRendered(m[1]), 'a…b');
});

/**
 * The rendered value went through `escapeText`, so reverse exactly those three
 * substitutions to recover the property value. Deliberately NOT the decoder
 * under test: reusing it would make every assertion above tautological.
 * @param {string} s
 */
function decodeRendered(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// --- Framework-emitted markup is byte-identical (#1341) ----------------------
//
// The neutrality proof for widening the decoder from three entities to the full
// WHATWG table and moving it onto every branch. Every string below was captured
// from `origin/main` at 207f2168, BEFORE the change. What it covers is the
// round trips the framework itself writes and then reads: the `data-webjs-prop-*`
// payload (written by `escapeAttr`, read back through the same decoder), a
// `reflect: true` value carrying all three characters `escapeAttr` escapes, and
// the plain type branches including a bare boolean and an empty-string
// attribute that matches no declared property.
//
// `data-webjs-fallback` shares that decoder and is not reachable through
// `renderToString` (it is written on the streaming pre-pass), so its round trip
// is covered by `render-server-streaming.test.js` and
// `ssr-comment-not-an-element.test.js`, which must stay green.
class SsrBaseline extends WebComponent({
  s: prop(String),
  n: prop(Number),
  b: prop(Boolean),
  o: prop(Object),
  a: prop(Array),
  badge: prop(String, { reflect: true }),
}) {
  constructor() {
    super();
    this.s = ''; this.n = 0; this.b = false; this.o = null; this.a = null;
    this.badge = 'a & "b" < c';
  }
  render() {
    return html`<i>s=${String(this.s)} n=${String(this.n)} b=${String(this.b)} o=${JSON.stringify(this.o)} a=${JSON.stringify(this.a)}</i>`;
  }
}
SsrBaseline.register('ssr-baseline');

class SsrPropSink extends WebComponent({ cfg: prop(Object) }) {
  constructor() { super(); this.cfg = null; }
  render() { return html`<i>cfg=${JSON.stringify(this.cfg)}</i>`; }
}
SsrPropSink.register('ssr-prop-sink');

test('framework-emitted markup is byte-identical after the decoder widening (#1341)', async () => {
  const attrs = await renderToString(
    html([`<ssr-baseline s="plain text" n="42" b o="{&quot;a&quot;:1}" a="[1,2]" empty=""></ssr-baseline>`]),
  );
  assert.equal(
    attrs,
    '<ssr-baseline s="plain text" n="42" b o="{&quot;a&quot;:1}" a="[1,2]" empty="" badge="a &amp; &quot;b&quot; &lt; c" data-wj-host><!--webjs-hydrate--><i>s=plain text n=42 b=true o={"a":1} a=[1,2]</i></ssr-baseline>',
  );

  const propBinding = await renderToString(
    html`<ssr-prop-sink .cfg=${{ amp: 'a & b', ent: 'x &hellip; y', esc: '&amp;lt;', lt: '<i>', q: 'say "hi"' }}></ssr-prop-sink>`,
  );
  assert.equal(
    propBinding,
    '<ssr-prop-sink data-webjs-prop-cfg="{&quot;amp&quot;:&quot;a &amp; b&quot;,&quot;ent&quot;:&quot;x &amp;hellip; y&quot;,&quot;esc&quot;:&quot;&amp;amp;lt;&quot;,&quot;lt&quot;:&quot;&lt;i>&quot;,&quot;q&quot;:&quot;say \\&quot;hi\\&quot;&quot;}" data-wj-host><!--webjs-hydrate--><i>cfg={"amp":"a &amp; b","ent":"x &amp;hellip; y","esc":"&amp;amp;lt;","lt":"&lt;i&gt;","q":"say \\"hi\\""}</i></ssr-prop-sink>',
  );
});
