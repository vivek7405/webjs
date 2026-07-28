/**
 * Cross-runtime proof that the form-action leak guard (#1154) refuses
 * identically on Node and Bun. Run from the repo root:
 *
 *   node test/bun/form-action-guard.mjs
 *   bun  test/bun/form-action-guard.mjs
 *
 * WebJs runs on Node 24+ OR Bun, and the guard sits in the SSR template state
 * machines, so a divergence here is a divergence in whether a server action's
 * source reaches the served HTML. That is the one failure mode where "it works
 * on Node" is not good enough: an app deployed on Bun would leak silently while
 * the Node test suite stayed green.
 *
 * The runtime-sensitive part is not the string building, it is what each engine
 * does with `String(fn)` and with the async render path around it. JSC and V8
 * format function source differently, so the assertions check for the SECRET
 * marker itself rather than an exact stringification.
 */
import assert from 'node:assert/strict';

import { html } from '../../packages/core/src/html.js';
import { renderToString, renderToStream } from '../../packages/core/src/render-server.js';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

const SECRET = 'postgres://user:BUN_PARITY_SECRET@host/db';
async function leaky(input) { const conn = SECRET; return { ok: true, conn, input }; }

async function drain(stream) {
  let out = '';
  for await (const c of stream) out += typeof c === 'string' ? c : new TextDecoder().decode(c);
  return out;
}

/** Every shape that must be refused, in both SSR machines. */
const refused = {
  'action=${fn}': () => html`<form action=${leaky}></form>`,
  'action="${fn}"': () => html`<form action="${leaky}"></form>`,
  'mixed action="/x/${fn}"': () => html`<form action="/x/${leaky}"></form>`,
  'formaction=${fn}': () => html`<button type="submit" formaction=${leaky}></button>`,
  'quoted prop .action="${fn}"': () => html`<form .action="${leaky}"></form>`,
  'quoted bool ?action="${fn}"': () => html`<form ?action="${leaky}"></form>`,
  'quoted event @action="${fn}"': () => html`<form @action="${leaky}"></form>`,
  'native prop .action=${fn}': () => html`<form .action=${leaky}></form>`,
  'array-wrapped action=${[fn]}': () => html`<form action=${[leaky]}></form>`,
};

for (const [name, mk] of Object.entries(refused)) {
  // Buffered renderer.
  let threw = null;
  try { await renderToString(mk(), { ssr: true }); } catch (e) { threw = e; }
  assert.ok(threw, `[${runtime}] buffered SSR must refuse ${name}`);
  assert.match(threw.message, /function was interpolated into/, `[${runtime}] ${name} message`);
  assert.ok(!threw.message.includes('BUN_PARITY_SECRET'),
    `[${runtime}] the refusal message must not carry the source it withholds (${name})`);

  // Streaming renderer, the second, independent state machine.
  let streamThrew = null;
  try { await drain(renderToStream(mk(), { ssr: false })); } catch (e) { streamThrew = e; }
  assert.ok(streamThrew, `[${runtime}] streaming SSR must refuse ${name}`);
  assert.ok(!streamThrew.message.includes('BUN_PARITY_SECRET'),
    `[${runtime}] streaming refusal must not carry the source (${name})`);
}

// The passthrough must stay byte-identical across runtimes: refusing everything
// would also pass the assertions above, so pin what still works.
const okBuffered = await renderToString(html`<form method="post" action=${'/submit'}></form>`, { ssr: true });
assert.match(okBuffered, /action="\/submit"/, `[${runtime}] a string action must still render`);

const okStream = await drain(renderToStream(html`<form action=${'/submit'}></form>`, { ssr: false }));
assert.match(okStream, /action="\/submit"/, `[${runtime}] a string action must still stream`);

const okArray = await renderToString(html`<form action=${['/a', '/b']}></form>`, { ssr: true });
assert.match(okArray, /action="\/a,\/b"/, `[${runtime}] an array of strings is not a function`);

console.log(`[${runtime}] form-action guard parity OK: ${Object.keys(refused).length} refused shapes, 3 passthroughs`);
