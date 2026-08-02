// Count chunks + measure progressive delivery of renderToStream(ssr:false)
import { html, renderToStream, Suspense } from '@webjsdev/core/server';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function collect(label, stream) {
  const reader = stream.getReader();
  const chunks = [];
  const t0 = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push({ at: Date.now() - t0, len: value.length, head: value.slice(0, 40) });
  }
  console.log(`\n== ${label} ==`);
  for (const c of chunks) console.log(`  +${c.at}ms len=${c.len} ${JSON.stringify(c.head)}`);
  console.log(`  total chunks: ${chunks.length}`);
}

// 1. Template with slow async text holes: progressive flushing?
const slow = sleep(150).then(() => 'SLOW');
await collect(
  'async text holes',
  renderToStream(html`<div>A</div><p>${slow}</p><div>B</div><p>${sleep(300).then(() => 'SLOWER')}</p>`, { ssr: false }),
);

// 2. Suspense inside a template hole (ssr:false raw streaming path)
const boundary = Suspense({
  fallback: html`<em>loading…</em>`,
  children: sleep(200).then(() => html`<strong>resolved</strong>`),
});
const { createSuspenseCtx } = await import('@webjsdev/core/server').catch(() => ({}));
await collect(
  'suspense in template',
  renderToStream(html`<section>${boundary}</section>`, { ssr: false }),
);
