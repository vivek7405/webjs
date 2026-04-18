/**
 * Coverage for render-server.js paths not exercised by the existing
 * renderToString tests — renderToStream, streamRender/streamTemplate
 * state machine, repeat() in SSR, Suspense in SSR both with and
 * without ctx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderToString,
  renderToStream,
  html,
  repeat,
  Suspense,
} from '../packages/core/index.js';
import { unsafeHTML, live } from '../packages/core/src/directives.js';

/* ---------------- helpers ---------------- */

async function streamText(stream) {
  const reader = stream.getReader();
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return out;
    out += value;
  }
}

/* ---------------- renderToString extra branches ---------------- */

test('renderToString: Promise-valued tree is awaited', async () => {
  const p = Promise.resolve(html`<p>async</p>`);
  const out = await renderToString(p);
  assert.match(out, /<p>async<\/p>/);
});

test('renderToString: false/true/null/undefined render as empty', async () => {
  assert.equal(await renderToString(false), '');
  assert.equal(await renderToString(true), '');
  assert.equal(await renderToString(null), '');
  assert.equal(await renderToString(undefined), '');
});

test('renderToString: array of values is concatenated', async () => {
  const out = await renderToString([html`<a>1</a>`, html`<a>2</a>`]);
  assert.match(out, /<a>1<\/a><a>2<\/a>/);
});

test('renderToString: repeat() renders each item via templateFn', async () => {
  const tpl = repeat(
    [{ id: 1, v: 'a' }, { id: 2, v: 'b' }],
    (x) => x.id,
    (x) => html`<li>${x.v}</li>`,
  );
  const out = await renderToString(tpl);
  assert.match(out, /<li>a<\/li><li>b<\/li>/);
});

test('renderToString: unsafeHTML is injected verbatim (no escaping)', async () => {
  const out = await renderToString(html`<div>${unsafeHTML('<b>bold</b>')}</div>`);
  assert.match(out, /<b>bold<\/b>/);
});

test('renderToString: live(v) unwraps to the raw value', async () => {
  const out = await renderToString(html`<p>${live('hi')}</p>`);
  assert.match(out, /<p>hi<\/p>/);
});

test('renderToString: Suspense without ctx emits only the fallback (no streaming)', async () => {
  const out = await renderToString(
    Suspense({ fallback: html`<p>loading…</p>`, children: Promise.resolve(html`<p>done</p>`) }),
  );
  assert.match(out, /loading…/);
  assert.doesNotMatch(out, /<webjs-boundary/);
  assert.doesNotMatch(out, /done/);
});

test('renderToString: Suspense with ctx emits the boundary + pushes the promise', async () => {
  const ctx = { pending: [], nextId: 1, usedComponents: new Set() };
  const out = await renderToString(
    Suspense({ fallback: html`<p>loading…</p>`, children: Promise.resolve(html`<p>done</p>`) }),
    { ssr: true, suspenseCtx: ctx },
  );
  assert.match(out, /<webjs-boundary id="s1">/);
  assert.match(out, /loading…/);
  assert.match(out, /<\/webjs-boundary>/);
  assert.equal(ctx.pending.length, 1);
  assert.equal(ctx.pending[0].id, 's1');
});

test('renderToString: plain text is HTML-escaped', async () => {
  const out = await renderToString(html`<p>${'<script>alert(1)</script>'}</p>`);
  assert.match(out, /&lt;script&gt;/);
  assert.doesNotMatch(out, /<script>alert/);
});

test('renderToString: ssr:false returns raw HTML without DSD injection', async () => {
  const out = await renderToString(html`<p>plain</p>`, { ssr: false });
  assert.match(out, /<p>plain<\/p>/);
});

/* ---------------- renderToStream coverage ---------------- */

test('renderToStream: basic template produces a readable stream', async () => {
  const stream = renderToStream(html`<p>stream</p>`, { ssr: false });
  const out = await streamText(stream);
  assert.match(out, /<p>stream<\/p>/);
});

test('renderToStream: ssr:true path runs DSD injection and enqueues full HTML', async () => {
  const stream = renderToStream(html`<p>ssr</p>`);
  const out = await streamText(stream);
  assert.match(out, /<p>ssr<\/p>/);
});

test('renderToStream: streams arrays as consecutive chunks', async () => {
  const stream = renderToStream([html`<a>1</a>`, html`<a>2</a>`], { ssr: false });
  const out = await streamText(stream);
  assert.match(out, /<a>1<\/a><a>2<\/a>/);
});

test('renderToStream: repeat() streams each item', async () => {
  const tpl = repeat(
    [{ id: 1, v: 'x' }, { id: 2, v: 'y' }],
    (x) => x.id,
    (x) => html`<li>${x.v}</li>`,
  );
  const stream = renderToStream(tpl, { ssr: false });
  const out = await streamText(stream);
  assert.match(out, /<li>x<\/li><li>y<\/li>/);
});

test('renderToStream: unsafeHTML is enqueued verbatim', async () => {
  const stream = renderToStream(html`<div>${unsafeHTML('<em>x</em>')}</div>`, { ssr: false });
  const out = await streamText(stream);
  assert.match(out, /<em>x<\/em>/);
});

test('renderToStream: live() unwraps to inner value', async () => {
  const stream = renderToStream(html`<p>${live('hello')}</p>`, { ssr: false });
  const out = await streamText(stream);
  assert.match(out, /<p>hello<\/p>/);
});

test('renderToStream: Promise-valued tree is awaited', async () => {
  const stream = renderToStream(Promise.resolve(html`<p>p</p>`), { ssr: false });
  const out = await streamText(stream);
  assert.match(out, /<p>p<\/p>/);
});

test('renderToStream: Suspense without ctx emits only the fallback', async () => {
  const stream = renderToStream(
    Suspense({ fallback: html`<p>loading</p>`, children: Promise.resolve(html`<p>done</p>`) }),
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.match(out, /loading/);
  assert.doesNotMatch(out, /<webjs-boundary/);
});

test('renderToStream: Suspense with ctx emits boundary + streams resolved chunk after', async () => {
  const ctx = { pending: [], nextId: 1, usedComponents: new Set() };
  const stream = renderToStream(
    Suspense({
      fallback: html`<p>loading</p>`,
      children: Promise.resolve(html`<p>done</p>`),
    }),
    { ssr: false, suspenseCtx: ctx },
  );
  const out = await streamText(stream);
  assert.match(out, /<webjs-boundary id="s1">/);
  assert.match(out, /loading/);
  assert.match(out, /done/, 'resolved Suspense content streamed after boundary');
});

test('renderToStream: plain text inside template is HTML-escaped', async () => {
  const stream = renderToStream(html`<p>${'<x>'}</p>`, { ssr: false });
  const out = await streamText(stream);
  assert.match(out, /&lt;x&gt;/);
  assert.doesNotMatch(out, /<x>/);
});

test('renderToStream: false/null/undefined values skip without errors', async () => {
  const stream = renderToStream(html`<p>${false}${null}${undefined}-end</p>`, { ssr: false });
  const out = await streamText(stream);
  assert.match(out, /<p>-end<\/p>/);
});

test('renderToStream: error during render rejects the stream', async () => {
  const broken = { _$webjs: 'template', strings: null, values: [] };
  const stream = renderToStream(broken, { ssr: false });
  let threw = false;
  try { await streamText(stream); } catch { threw = true; }
  assert.ok(threw, 'broken template should reject the stream');
});

/* ---------------- streamTemplate parser: attribute / comment / rawtext ---------------- */

test('renderToStream: quoted attribute interpolation is HTML-escaped', async () => {
  const stream = renderToStream(
    html`<div class="${'foo"bar'}">x</div>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  // Quote inside value must be encoded.
  assert.ok(!/class="foo"bar"/.test(out), 'raw quote must not leak into output');
  assert.ok(out.includes('&quot;') || out.includes('&#34;'), `missing escaped quote in ${out}`);
});

test('renderToStream: unquoted attribute with hole renders as quoted attr', async () => {
  const stream = renderToStream(
    html`<input value=${'hi'}>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.match(out, /value="hi"/);
});

test('renderToStream: boolean attr (?disabled) — true emits attribute, false omits', async () => {
  const on = await streamText(renderToStream(
    html`<button ?disabled=${true}>x</button>`, { ssr: false }));
  assert.match(on, /<button\s+disabled=""\s*>/);

  const off = await streamText(renderToStream(
    html`<button ?disabled=${false}>x</button>`, { ssr: false }));
  assert.ok(!/disabled/.test(off), `disabled should be absent; got ${off}`);
});

test('renderToStream: event attr (@click) is omitted from HTML output', async () => {
  const stream = renderToStream(
    html`<button @click=${() => {}}>x</button>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.ok(!/@click/.test(out));
  assert.ok(!/onclick/.test(out.toLowerCase()));
});

test('renderToStream: property attr (.value) is omitted from HTML output', async () => {
  const stream = renderToStream(
    html`<input .value=${'hi'}>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  // Property binding doesn't surface as HTML attribute.
  assert.ok(!/\.value/.test(out));
  assert.ok(!/value="hi"/.test(out), `.value shouldn't emit a value attribute; got: ${out}`);
});

test('renderToStream: comment body with a hole → hole value baked into comment text', async () => {
  const stream = renderToStream(
    html`<!-- user is ${'alice'} --><p>ok</p>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.match(out, /<!-- user is alice -->/);
  assert.match(out, /<p>ok<\/p>/);
});

test('renderToStream: <style> rawtext preserves interpolated CSS verbatim', async () => {
  const stream = renderToStream(
    html`<style>.a-${'x'} { color: red; }</style><p>ok</p>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.match(out, /\.a-x\s*\{\s*color:\s*red;\s*\}/);
  // Raw text shouldn't be HTML-escaped (no &lt; &gt;)
  assert.doesNotMatch(out, /&lt;/);
});

test('renderToStream: <script> rawtext preserves interpolated JS verbatim', async () => {
  const stream = renderToStream(
    html`<script>window.k = ${'foo'};</script><p>ok</p>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.match(out, /window\.k\s*=\s*foo\s*;/);
});

test('renderToStream: multiple attributes on one tag compose correctly', async () => {
  const stream = renderToStream(
    html`<a href="/x" data-id=${42} class="btn">go</a>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.match(out, /href="\/x"/);
  assert.match(out, /data-id="42"/);
  assert.match(out, /class="btn"/);
});

test('renderToStream: closing tag `</div>` parses cleanly', async () => {
  const stream = renderToStream(
    html`<div>${'a'}</div><span>${'b'}</span>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.match(out, /<div>a<\/div><span>b<\/span>/);
});

test('renderToStream: self-closing-ish void tag with hole works', async () => {
  const stream = renderToStream(
    html`<img src=${'/logo.png'} alt="logo">`,
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.match(out, /<img\s+src="\/logo\.png"\s+alt="logo">/);
});

test('renderToStream: attribute that turns out to be static (no value hole) renders as-is', async () => {
  const stream = renderToStream(
    html`<div id="x" class="y">ok</div>`,
    { ssr: false },
  );
  const out = await streamText(stream);
  assert.match(out, /<div\s+id="x"\s+class="y">ok<\/div>/);
});

/* ---------------- nested Suspense inside a template ---------------- */

test('Suspense nested in a template is replaced by its boundary HTML', async () => {
  const ctx = { pending: [], nextId: 1, usedComponents: new Set() };
  const out = await renderToString(
    html`<main>${Suspense({
      fallback: html`<span>loading</span>`,
      children: Promise.resolve(html`<span>done</span>`),
    })}</main>`,
    { ssr: true, suspenseCtx: ctx },
  );
  assert.match(out, /<main><webjs-boundary id="s1"><span>loading<\/span><\/webjs-boundary><\/main>/);
});
