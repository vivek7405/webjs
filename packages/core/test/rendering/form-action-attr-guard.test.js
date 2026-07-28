// #1154: a function interpolated into a form-action attribute must throw,
// never stringify. At SSR a `'use server'` import is the REAL function, so
// `String(fn)` would serialize the action's source (secrets included) into
// the served HTML. Covers every hole shape that used to leak (unquoted,
// quoted, mixed, and `formaction` on a submit button), plus the byte-identical
// passthrough for string-valued action attributes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let html, renderToString, renderToStream;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ renderToString, renderToStream } = await import('../../src/render-server.js'));
});

async function drain(stream) {
  let out = '';
  for await (const c of stream) out += typeof c === 'string' ? c : new TextDecoder().decode(c);
  return out;
}

// The secret sentinel must never appear in any output, thrown or not.
const SECRET = 'postgres://user:SECRET@host/db';
async function leaky(input) { const conn = SECRET; return { success: true, conn, input }; }

test('unquoted action=${fn} throws instead of leaking source', async () => {
  await assert.rejects(
    () => renderToString(html`<form method="post" action=${leaky}></form>`, { ssr: true }),
    /function was interpolated into action=/,
  );
});

test('quoted action="${fn}" throws identically', async () => {
  await assert.rejects(
    () => renderToString(html`<form method="post" action="${leaky}"></form>`, { ssr: true }),
    /function was interpolated into action=/,
  );
});

test('mixed hole action="/x/${fn}" throws', async () => {
  await assert.rejects(
    () => renderToString(html`<form method="post" action="/x/${leaky}"></form>`, { ssr: true }),
    /function was interpolated into action=/,
  );
});

test('formaction=${fn} on a submit button throws', async () => {
  await assert.rejects(
    () => renderToString(html`<form method="post"><button formaction=${leaky}>Go</button></form>`, { ssr: true }),
    /function was interpolated into formaction=/,
  );
});

test('no thrown message ever carries the function source', async () => {
  for (const tpl of [
    html`<form action=${leaky}></form>`,
    html`<form action="${leaky}"></form>`,
  ]) {
    let msg = '';
    try { await renderToString(tpl, { ssr: true }); } catch (e) { msg = String(e && e.message); }
    assert.ok(msg.length > 0, 'render must throw');
    assert.ok(!msg.includes('SECRET'), 'error message must not embed the source');
  }
});

test('string-valued action renders byte-identically to before', async () => {
  assert.equal(
    await renderToString(html`<form method="post" action=${'/submit'}></form>`, { ssr: true }),
    '<form method="post" action="/submit"></form>',
  );
  assert.equal(
    await renderToString(html`<form method="post" action="${'/submit'}"></form>`, { ssr: true }),
    '<form method="post" action="/submit"></form>',
  );
  assert.equal(
    await renderToString(html`<form action="/x?a=${1}"></form>`, { ssr: true }),
    '<form action="/x?a=1"></form>',
  );
});

// The STREAMING renderer is a second, independent state machine. It was missed
// by the first pass of this fix and kept emitting the action's whole body while
// the buffered renderer already refused it, so it gets its own coverage rather
// than being assumed to inherit the guard.
test('the streaming renderer refuses the same function (ssr:false path)', async () => {
  await assert.rejects(
    () => drain(renderToStream(html`<form action=${leaky}></form>`, { ssr: false })),
    /function was interpolated into action=/,
  );
});

test('the streaming renderer never emits the source', async () => {
  let out = '';
  try {
    out = await drain(renderToStream(html`<form action=${leaky}></form>`, { ssr: false }));
  } catch { /* expected */ }
  assert.ok(!out.includes('SECRET'), 'streamed output must not carry the function source');
});

test('streaming keeps string-valued actions working', async () => {
  const out = await drain(renderToStream(html`<form action=${'/submit'}></form>`, { ssr: false }));
  assert.match(out, /action="\/submit"/);
});

test('functions in OTHER attributes keep the existing stringify behaviour', async () => {
  // Narrow claim: only action/formaction throw. Anything else is unchanged
  // (arguably also a bug, but out of #1154's scope by design).
  const out = await renderToString(html`<div title=${leaky}></div>`, { ssr: true });
  assert.ok(out.startsWith('<div title="'));
});
