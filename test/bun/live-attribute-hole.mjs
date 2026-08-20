/**
 * Cross-runtime proof that `live()` in an ATTRIBUTE hole resolves identically
 * under WHICHEVER runtime executes this file (#1443). Run it under both:
 *
 *   node test/bun/live-attribute-hole.mjs
 *   bun  test/bun/live-attribute-hole.mjs
 *
 * SSR string output is the surface that must agree byte for byte across
 * runtimes: the same page served from Node and from Bun has to carry the same
 * attributes, or a Bun-hosted app hydrates against markup its own client code
 * did not expect. The bug this guards was exactly a server/client disagreement
 * (the wrapper object is truthy, so a falsy `?bool=${live(v)}` emitted its
 * attribute anyway and hydration then removed it), so a per-runtime version of
 * the same divergence is the failure worth pinning.
 *
 * Both server dispatch sites are exercised, since they are separate machines
 * that have drifted before: the buffered renderer (`renderToString`) and the
 * streaming one (`renderToStream({ ssr: false })`, i.e. `streamTemplate`).
 *
 * A plain assert script (not `*.test.mjs`, so the node:test runner does not
 * double-run it); it exits non-zero on failure. Run from the repo root so the
 * bare `@webjsdev/core` specifier resolves to the workspace package.
 */
import assert from 'node:assert/strict';
import { html } from '@webjsdev/core';
import { renderToString, renderToStream } from '@webjsdev/core/server';
import { live } from '@webjsdev/core/directives';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

async function drain(stream) {
  let out = '';
  const reader = stream.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += typeof value === 'string' ? value : dec.decode(value);
  }
  return out;
}

const buffered = (tr) => renderToString(tr);
const streamed = (tr) => drain(renderToStream(tr, { ssr: false }));

for (const [who, run] of [['buffered', buffered], ['streamed', streamed]]) {
  // A falsy boolean hole omits its attribute. The headline case: this is what
  // painted webjs.dev's nav menu open on mobile before the fix.
  const falsy = await run(html`<details ?open=${live(false)}></details>`);
  assert.ok(
    !/\bopen\b/.test(falsy),
    `${runtime} ${who}: ?open=\${live(false)} must omit the attribute, got ${falsy}`,
  );

  // A truthy one still emits it.
  const truthy = await run(html`<details ?open=${live(true)}></details>`);
  assert.match(
    truthy,
    /\bopen=""/,
    `${runtime} ${who}: ?open=\${live(true)} must emit the attribute, got ${truthy}`,
  );

  // live() is TRANSPARENT: wrapped output equals bare output, on every runtime.
  for (const v of [false, true]) {
    const bare = await run(html`<details ?open=${v}></details>`);
    const wrapped = await run(html`<details ?open=${live(v)}></details>`);
    assert.equal(
      wrapped,
      bare,
      `${runtime} ${who}: live(${v}) must render exactly as ${v}`,
    );
  }

  // A plain attribute hole emits the inner value, never the wrapper's
  // stringification. `[object Object]` is what a missed unwrap looks like, and
  // it is a runtime-independent shape, so a divergence here would be a real
  // engine difference rather than a spelling one.
  const attr = await run(html`<div title=${live('hi')}></div>`);
  assert.match(attr, /title="hi"/, `${runtime} ${who}: title=\${live('hi')} must emit the inner value, got ${attr}`);
  assert.ok(!/object Object/.test(attr), `${runtime} ${who}: the wrapper must not be stringified, got ${attr}`);
}

// The .prop hole is buffered-only: `renderToStream({ ssr: false })` drops every
// .prop by design (no injectDSD pre-pass on that path to consume the attribute),
// so there is no streamed prop emit to compare.
const prop = await renderToString(html`<my-el .foo=${live(1)}></my-el>`);
assert.match(prop, /data-webjs-prop-foo="1"/, `${runtime}: .prop must serialize the inner value, got ${prop}`);
assert.ok(!/_\$webjs/.test(prop), `${runtime}: the wrapper must not reach the hydration payload, got ${prop}`);

console.log(`[live-attribute-hole] OK on ${runtime}: live() resolves identically in ?bool, plain-attr and .prop holes across the buffered and streaming renderers`);
