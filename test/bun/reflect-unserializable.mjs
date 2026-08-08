/**
 * Cross-runtime proof that the unserializable-reflection guard (#1253) behaves
 * identically under WHICHEVER runtime executes this file. Run it under both:
 *
 *   node test/bun/reflect-unserializable.mjs
 *   bun  test/bun/reflect-unserializable.mjs
 *
 * Two halves, both on the SSR path and so runtime-sensitive:
 *   - the WRITE side. A `reflect: true` prop declared `Object` or `Array`
 *     whose value cannot pass through `JSON.stringify` drops its attribute and
 *     renders normally, instead of throwing into per-component error isolation
 *     and (in production) emitting an EMPTY component at a 200, or a red
 *     error box in dev. Either way the rendered CONTENT is gone.
 *   - the READ side. `applyAttrsToInstance` resolves an unparseable JSON
 *     attribute to `null`, matching what `attributeChangedCallback` does in the
 *     browser. The two must resolve a PRESENT, unparseable attribute the same
 *     way or hydration diverges, so the SSR half is worth pinning per runtime.
 *     Default-converter path only: the SSR reader has no `fromAttribute` arm.
 *
 * Nothing here asserts on the ENGINE's own `JSON.stringify` message. V8 and
 * JavaScriptCore word it differently, and that difference is not the behaviour
 * under test; the assertions are on the emitted HTML and on the framework's own
 * warning text.
 *
 * A plain assert script (not `*.test.mjs`, so the node:test runner does not
 * double-run it); it exits non-zero on failure. Run from the repo root so the
 * bare `@webjsdev/core` specifier resolves to the workspace package.
 */
import assert from 'node:assert/strict';
import { html, WebComponent, prop } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

/** Render, capturing the framework's warnings across the await. */
async function render(template) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { out: await renderToString(template), warnings };
  } finally {
    console.warn = original;
  }
}

// --- write side -------------------------------------------------------------

const cyc = { a: 1 };
cyc.self = cyc;

class CyclicProbe extends WebComponent({ cfg: prop(Object, { reflect: true }) }) {
  constructor() {
    super();
    this.cfg = cyc;
  }
  render() {
    return html`<i>parity-content</i>`;
  }
}
CyclicProbe.register('bun-reflect-cyclic');

{
  const { out, warnings } = await render(html`<bun-reflect-cyclic></bun-reflect-cyclic>`);
  // The content assertion is the load-bearing one: the failure mode is an
  // isolated EMPTY element that still carries its tag, so a tag-only check
  // passes against the bug.
  assert.ok(out.includes('parity-content'), `[${runtime}] the component rendered empty: ${out}`);
  assert.ok(!out.includes('cfg='), `[${runtime}] the attribute should be absent: ${out}`);
  assert.equal(warnings.length, 1, `[${runtime}] expected one warning: ${warnings.join(' | ')}`);
  assert.match(warnings[0], /cfg/, `[${runtime}] the warning must name the property`);
  assert.match(warnings[0], /bun-reflect-cyclic/, `[${runtime}] the warning must name the tag`);
}

class BigIntProbe extends WebComponent({ cfg: prop(Object, { reflect: true }) }) {
  constructor() {
    super();
    this.cfg = { n: 1n };
  }
  render() {
    return html`<i>parity-bigint</i>`;
  }
}
BigIntProbe.register('bun-reflect-bigint');

{
  // A `BigInt` throws for a different spec reason than a cycle does, and both
  // engines implement both, so this pins that the guard covers the pair rather
  // than only self-reference.
  const { out, warnings } = await render(html`<bun-reflect-bigint></bun-reflect-bigint>`);
  assert.ok(out.includes('parity-bigint'), `[${runtime}] the component rendered empty: ${out}`);
  assert.ok(!out.includes('cfg='), `[${runtime}] the attribute should be absent: ${out}`);
  assert.equal(warnings.length, 1, `[${runtime}] expected one warning: ${warnings.join(' | ')}`);
}

class CleanProbe extends WebComponent({ cfg: prop(Object, { reflect: true }) }) {
  constructor() {
    super();
    this.cfg = { a: 1 };
  }
  render() {
    return html`<i>parity-clean</i>`;
  }
}
CleanProbe.register('bun-reflect-clean');

{
  // The over-refusal regression: a serializable value must still reflect, and
  // must not warn, on either runtime.
  const { out, warnings } = await render(html`<bun-reflect-clean></bun-reflect-clean>`);
  assert.ok(
    out.includes('cfg="{&quot;a&quot;:1}"') || out.includes('cfg="{"a":1}"'),
    `[${runtime}] a serializable value must still reflect: ${out}`
  );
  assert.equal(warnings.length, 0, `[${runtime}] a serializable value must not warn: ${warnings.join(' | ')}`);
}

// --- read side --------------------------------------------------------------

class ReaderProbe extends WebComponent({ cfg: prop(Object) }) {
  render() {
    return html`<i>val=${JSON.stringify(this.cfg)}</i>`;
  }
}
ReaderProbe.register('bun-reflect-reader');

{
  const out = await renderToString(html`<bun-reflect-reader cfg="not-json"></bun-reflect-reader>`);
  assert.ok(out.includes('val=null'), `[${runtime}] the SSR reader kept the raw string: ${out}`);
}

console.log(`[${runtime}] reflect-unserializable parity OK`);
