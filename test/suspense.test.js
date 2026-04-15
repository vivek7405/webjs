import { test } from 'node:test';
import assert from 'node:assert/strict';

import { html, Suspense, renderToString } from '../packages/core/index.js';

test('Suspense with suspenseCtx emits fallback and collects pending promise', async () => {
  const ctx = { pending: [], nextId: 1 };
  const content = Promise.resolve(html`<span>loaded</span>`);
  const out = await renderToString(
    html`<p>${Suspense({ fallback: html`<em>loading</em>`, children: content })}</p>`,
    { ssr: true, suspenseCtx: ctx }
  );
  assert.match(out, /<webjs-boundary id="s1"><em>loading<\/em><\/webjs-boundary>/);
  assert.equal(ctx.pending.length, 1);
  assert.equal(ctx.pending[0].id, 's1');
});

test('Suspense without ctx still renders the fallback (no streaming)', async () => {
  const out = await renderToString(
    html`<p>${Suspense({ fallback: html`<em>loading</em>`, children: Promise.resolve('never') })}</p>`
  );
  assert.match(out, /<p><em>loading<\/em><\/p>/);
  assert.doesNotMatch(out, /webjs-boundary/);
});

test('nested Suspense boundaries get unique ids', async () => {
  const ctx = { pending: [], nextId: 1 };
  const tree = html`
    <div>
      ${Suspense({ fallback: html`<p>a</p>`, children: Promise.resolve('x') })}
      ${Suspense({ fallback: html`<p>b</p>`, children: Promise.resolve('y') })}
    </div>
  `;
  const out = await renderToString(tree, { ssr: true, suspenseCtx: ctx });
  assert.match(out, /id="s1"/);
  assert.match(out, /id="s2"/);
  assert.equal(ctx.pending.length, 2);
});
