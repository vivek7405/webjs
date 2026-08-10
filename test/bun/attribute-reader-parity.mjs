/**
 * Cross-runtime proof that the SSR attribute reader (#1341) behaves identically
 * under WHICHEVER runtime executes this file. Run it under both:
 *
 *   node test/bun/attribute-reader-parity.mjs
 *   bun  test/bun/attribute-reader-parity.mjs
 *
 * The SSR reader used to see a different attribute SET from the browser's, so
 * hand-written markup could SSR one value and hydrate to another. It now
 * resolves every name through the one `resolveAttributeProperty`, lowercases
 * the source name because the parser does, ignores an attribute that maps to no
 * attribute-backed property, and decodes every character reference before the
 * type coercion runs.
 *
 * Four halves, each chosen because it is a place two engines could plausibly
 * differ rather than because it is merely part of the fix:
 *   - the entity matrix. `String.fromCodePoint`, the regex engine's handling of
 *     an alternation with unmatched capture groups (the callback receives
 *     `undefined` for the arms that did not match, which is what selects the
 *     decimal / hex / named branch), and astral and replacement-character
 *     handling are all engine surface.
 *   - the `state: true` skip, plus the `.prop=${value}` channel that is the
 *     legitimate way such a prop receives an SSR value. That channel runs
 *     through the rich serializer, which is the single most runtime-sensitive
 *     thing in the framework.
 *   - the source-name lowercasing, and that the kebab form still resolves.
 *   - an attribute matching no property leaving no own property behind, read
 *     through `Object.getOwnPropertyNames` rather than through the render
 *     output, so a shim difference between the two runtimes would show.
 *
 * A plain assert script (not `*.test.mjs`, so the node:test runner does not
 * double-run it); it exits non-zero on failure. Run from the repo root so the
 * bare `@webjsdev/core` specifier resolves to the workspace package. That
 * specifier resolves to the BUILT bundle, so rebuild it (`npm run build:dist
 * --workspace=@webjsdev/core`) after editing `packages/core/src`, or this
 * asserts against stale bytes and passes vacuously.
 */
import assert from 'node:assert/strict';
import { html, WebComponent, prop } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

/** Render source markup as-is, with no template holes to interpret. */
const ssr = (markup) => renderToString(html([markup]));

/**
 * The rendered value went through `escapeText`, so reverse exactly those three
 * substitutions to recover the property value. Deliberately NOT the decoder
 * under test, which would make every entity assertion tautological.
 */
const unescapeRendered = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

class StrProbe extends WebComponent({ s: prop(String), n: prop(Number) }) {
  constructor() { super(); this.s = ''; this.n = 0; }
  render() { return html`<i>val=${String(this.s)}|n=${String(this.n)}</i>`; }
}
StrProbe.register('bun-attr-str');

class ObjProbe extends WebComponent({ cfg: prop(Object) }) {
  constructor() { super(); this.cfg = null; }
  render() { return html`<i>val=${JSON.stringify(this.cfg)}</i>`; }
}
ObjProbe.register('bun-attr-obj');

class StateProbe extends WebComponent({ cfg: prop(Object, { state: true }) }) {
  constructor() { super(); this.cfg = { fromCtor: true }; }
  render() { return html`<i>val=${JSON.stringify(this.cfg)}</i>`; }
}
StateProbe.register('bun-attr-state');

class CamelProbe extends WebComponent({ cfgData: prop(String) }) {
  constructor() { super(); this.cfgData = 'CTOR'; }
  render() { return html`<i>val=${String(this.cfgData)}</i>`; }
}
CamelProbe.register('bun-attr-camel');

class CustomAttrProbe extends WebComponent({ open: prop(Boolean, { attribute: 'is-open' }) }) {
  constructor() { super(); this.open = false; }
  render() { return html`<i>open=${String(this.open)}</i>`; }
}
CustomAttrProbe.register('bun-attr-custom');

class UnknownProbe extends WebComponent({ known: prop(String) }) {
  constructor() { super(); this.known = ''; }
  render() {
    return html`<i>known=${String(this.known)}|class=${String(this.class)}|cfgData=${String(this.cfgData)}</i>`;
  }
}
UnknownProbe.register('bun-attr-unknown');

// --- 1. The entity matrix ---------------------------------------------------

const ENTITY_MATRIX = [
  ['a&hellip;b', 'a…b'],
  ['&lt;script&gt;', '<script>'],
  ['&amp;lt;', '&lt;'],          // counterfactual: a replacement is never rescanned
  ['&amp;#123;', '&#123;'],      // counterfactual: same, on the numeric form
  ['&#x7b;', '{'],
  ['&#X7B;', '{'],
  ['&#123', '{'],                // the missing-semicolon numeric form
  ['&#128;', '€'],               // the C1 range, through windows-1252
  ['&#0;', '�'],
  ['&#xD800;', '�'],        // a lone surrogate
  ['&#x110000;', '�'],      // past U+10FFFF
  ['&nbsp', ' '],           // a legacy semicolon-less name, which a browser decodes
  ['&copy', '©'],
  ['&amp', '&'],
  ['&not', '¬'],                 // also a prefix of longer names
  ['&nbspx', '&nbspx'],          // the whole run is captured; `nbspx` is not legacy
  ['&nbsp=x', '&nbsp=x'],        // the carve-out: an `=` follows
  ['&notin', '&notin'],          // same; a browser gets there via `&not` plus `i`
  ['&notreal;', '&notreal;'],    // an unrecognised name, left literal
  ['plain', 'plain'],
  // Names that collide with `Object.prototype`. Reading the table by indexing
  // the imported object returned an inherited FUNCTION rather than `undefined`
  // for each of these and threw out of the decoder, painting the SSR error box
  // for every attribute of every custom element, while a browser leaves them
  // literal. Both engines have the same prototype chain, so both would have
  // thrown; what is cross-runtime here is that neither does now.
  ['&constructor;', '&constructor;'],
  ['&toString;', '&toString;'],
  ['&valueOf;', '&valueOf;'],
  ['&hasOwnProperty;', '&hasOwnProperty;'],
  ['&isPrototypeOf;', '&isPrototypeOf;'],
  ['&propertyIsEnumerable;', '&propertyIsEnumerable;'],
  ['&toLocaleString;', '&toLocaleString;'],
  ['&__proto__;', '&__proto__;'],   // never matches CHAR_REF at all
];

for (const [source, expected] of ENTITY_MATRIX) {
  const out = await ssr(`<bun-attr-str s="${source}"></bun-attr-str>`);
  const m = /val=([^|]*)\|/.exec(out);
  assert.ok(m, `[${runtime}] no rendered value for ${source}: ${out}`);
  assert.equal(
    unescapeRendered(m[1]),
    expected,
    `[${runtime}] entity decoding for ${source}`,
  );
}

{
  const out = await ssr('<bun-attr-obj cfg="&#123;&quot;a&quot;:1&#125;"></bun-attr-obj>');
  assert.ok(out.includes('val={"a":1}'), `[${runtime}] entity decoding did not reach the Object branch: ${out}`);
}

{
  const out = await ssr('<bun-attr-str n="&#49;"></bun-attr-str>');
  assert.ok(out.includes('n=1'), `[${runtime}] entity decoding did not reach the Number branch: ${out}`);
}

// --- 2. A state:true prop -------------------------------------------------

{
  const out = await ssr('<bun-attr-state cfg="oops"></bun-attr-state>');
  assert.ok(
    out.includes('val={"fromCtor":true}'),
    `[${runtime}] a state:true prop was populated from an attribute: ${out}`,
  );
  assert.ok(!out.includes('val=null'), `[${runtime}] the attribute reached the reader: ${out}`);
}

{
  // The channel that MUST keep working: `data-webjs-prop-*` is consumed before
  // the attribute reader runs, so the skip above cannot reach it.
  const out = await renderToString(html`<bun-attr-state .cfg=${{ viaProp: 1 }}></bun-attr-state>`);
  assert.ok(
    out.includes('val={"viaProp":1}'),
    `[${runtime}] the .prop hydration channel stopped reaching a state prop: ${out}`,
  );
}

// --- 3. A camelCase source name -------------------------------------------

{
  const out = await ssr('<bun-attr-camel cfgData="oops"></bun-attr-camel>');
  assert.ok(out.includes('val=CTOR'), `[${runtime}] a camelCase attribute name resolved: ${out}`);
}

{
  const out = await ssr('<bun-attr-camel cfg-data="ok"></bun-attr-camel>');
  assert.ok(out.includes('val=ok'), `[${runtime}] the kebab-cased attribute stopped resolving: ${out}`);
}

{
  // A prop declaring a custom attribute answers to THAT name and to nothing
  // else, because `observedAttributes` holds that name alone and so a browser
  // never delivers the property name to any reader.
  const declared = await ssr('<bun-attr-custom is-open></bun-attr-custom>');
  assert.ok(declared.includes('open=true'), `[${runtime}] the declared attribute stopped resolving: ${declared}`);
  const propName = await ssr('<bun-attr-custom open></bun-attr-custom>');
  assert.ok(propName.includes('open=false'), `[${runtime}] the property name resolved at SSR: ${propName}`);
}

// --- 4. An attribute matching no declared property ------------------------

{
  const out = await ssr('<bun-attr-unknown known="k" cfgData="j" class="c"></bun-attr-unknown>');
  assert.ok(out.includes('known=k'), `[${runtime}] a declared attribute stopped resolving: ${out}`);
  assert.ok(
    out.includes('class=undefined') && out.includes('cfgData=undefined'),
    `[${runtime}] an undeclared attribute became an instance property: ${out}`,
  );
}

console.log(`[${runtime}] attribute-reader parity (#1341): ok`);
