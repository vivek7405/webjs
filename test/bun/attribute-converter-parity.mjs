/**
 * A custom `converter.fromAttribute` reads identically under Node and Bun
 * (#1340).
 *
 * Both attribute readers now go through one shared `readAttributeValue` in
 * `packages/core/src/attribute-reader.js`: the client `attributeChangedCallback`
 * in `component.js` and the SSR `applyAttrsToInstance` in `render-server.js`.
 * The SSR half is the runtime-sensitive one, because `render-server.js` is on
 * the SSR dispatch path that Node and Bun reach through different listener
 * shells, so the value the server paints is worth pinning per runtime rather
 * than on Node alone.
 *
 * Four assertions, in order of what they protect:
 *
 *   - the converter RUNS at SSR at all, which is the reported bug. Before this,
 *     the SSR reader dispatched on `def.type` alone and painted the raw
 *     attribute text while the browser upgrade held the converted value.
 *   - the converter WINS over the declared type. The declaration is deliberately
 *     `prop(Object)`, whose default branch would `JSON.parse` the attribute,
 *     throw, and fall back to `null`, so a precedence regression is visible as
 *     `null` rather than as a subtly different string.
 *   - the converter is handed DECODED text. The client's value comes out of the
 *     DOM, which decoded it, while the SSR reader walks the raw source tag, so
 *     without a decode the two sides read the same attribute differently and a
 *     parsing converter throws on markup `escapeAttr` itself produced.
 *   - a THROWING converter is not caught by the reader, so it lands in the
 *     per-component error isolation and its SIBLING in the same render still
 *     renders. That interaction between the reader and the isolation `catch` is
 *     the half most worth pinning per runtime.
 *
 * A plain assert script (not `*.test.mjs`, so the node:test runner does not
 * double-run it); it exits non-zero on failure. Run from the repo root so the
 * bare `@webjsdev/core` specifier resolves to the workspace package.
 */
import assert from 'node:assert/strict';
import { html, WebComponent, prop } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

/** Render, capturing the framework's error log across the await. */
async function render(template) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    return { out: await renderToString(template), errors };
  } finally {
    console.error = original;
  }
}

// --- the converter runs at SSR ----------------------------------------------

class UpperProbe extends WebComponent({
  mode: prop(String, { converter: { fromAttribute: (v) => String(v).toUpperCase() } }),
}) {
  render() {
    return html`<i>mode=${this.mode}</i>`;
  }
}
UpperProbe.register('bun-conv-upper');

{
  const { out } = await render(html`<bun-conv-upper mode="a"></bun-conv-upper>`);
  assert.ok(out.includes('mode=A'), `[${runtime}] the converter did not run at SSR: ${out}`);
  assert.ok(!out.includes('mode=a<'), `[${runtime}] the raw attribute text reached the property: ${out}`);
}

// --- the converter beats the declared type ----------------------------------

class ObjProbe extends WebComponent({
  v: prop(Object, { converter: { fromAttribute: (v) => ({ raw: v }) } }),
}) {
  render() {
    return html`<i>${JSON.stringify(this.v)}</i>`;
  }
}
ObjProbe.register('bun-conv-obj');

{
  const { out } = await render(html`<bun-conv-obj v="abc"></bun-conv-obj>`);
  assert.ok(out.includes('{"raw":"abc"}'), `[${runtime}] the converter lost to the type branch: ${out}`);
  assert.ok(!out.includes('>null<'), `[${runtime}] the JSON fallback ran instead of the converter: ${out}`);
}

// --- the converter is handed decoded text -----------------------------------

class EntityProbe extends WebComponent({
  cfg: prop(Object, { converter: { fromAttribute: (v) => JSON.parse(v) } }),
}) {
  render() {
    return html`<i>${JSON.stringify(this.cfg)}</i>`;
  }
}
EntityProbe.register('bun-conv-entities');

{
  const { out } = await render(
    html`<bun-conv-entities cfg="{&quot;a&quot;:1,&quot;b&quot;:&quot;x&amp;y&quot;}"></bun-conv-entities>`,
  );
  // The client's value comes out of the DOM already decoded, so the SSR reader
  // has to decode before handing it over or the two sides read the same
  // attribute differently. Undecoded, this `JSON.parse` throws and the
  // component renders empty instead.
  assert.ok(
    out.includes('{"a":1,"b":"x&amp;y"}'),
    `[${runtime}] the converter was handed entity-encoded text: ${out}`,
  );
}

// --- a throwing converter is isolated, not caught by the reader --------------

class ThrowProbe extends WebComponent({
  v: prop(String, { converter: { fromAttribute: () => { throw new Error('converter blew up'); } } }),
}) {
  render() {
    return html`<i>throw-probe-content</i>`;
  }
}
ThrowProbe.register('bun-conv-throw');

class SiblingProbe extends WebComponent({ s: String }) {
  render() {
    return html`<i>sibling-content</i>`;
  }
}
SiblingProbe.register('bun-conv-sibling');

{
  const { out, errors } = await render(
    html`<div><bun-conv-throw v="x"></bun-conv-throw><bun-conv-sibling s="ok"></bun-conv-sibling></div>`,
  );
  assert.ok(
    !out.includes('throw-probe-content'),
    `[${runtime}] the throwing component should not have rendered its content: ${out}`,
  );
  assert.ok(
    out.includes('sibling-content'),
    `[${runtime}] the sibling must still render, which is what isolation buys: ${out}`,
  );
  assert.ok(
    errors.some((e) => e.includes('SSR failed for') && e.includes('bun-conv-throw')),
    `[${runtime}] expected an SSR-failure log naming the tag: ${errors.join(' | ')}`,
  );
}

console.log(`[${runtime}] attribute-converter parity OK`);
