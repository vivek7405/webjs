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
 * does with `String(fn)` and with the async render path around it. Assertions
 * therefore check for the SECRET marker rather than for a stringification
 * shape, and the reason is worth stating precisely, because the obvious one is
 * wrong. `Function.prototype.toString` is spec'd to return the exact source
 * text, so JSC and V8 do NOT format it differently. What differs is that Bun
 * TRANSPILES the module before the engine ever sees it, so the source a
 * function reports is the rewritten source:
 *
 *   node 26.1.0 : async function leaky(input) { const conn = '…'; return { ok: true, conn, input }; }
 *   bun  1.3.14 : async function leaky(input) { return { ok: !0, conn: "…", input }; }
 *
 * Constant folded, `true` minified to `!0`, reindented. A string LITERAL
 * survives that intact, which is exactly why the marker is the right thing to
 * assert on and a formatting pattern is not.
 */
import assert from 'node:assert/strict';

import { html } from '../../packages/core/src/html.js';
import { renderToString, renderToStream } from '../../packages/core/src/render-server.js';
import { setFormActionResolver, FORM_ACTION_FIELD } from '../../packages/core/src/form-action.js';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

// The marker is written INLINE, not read from a module-scope `const`.
//
// On Node that is load-bearing: `String(fn)` reproduces source, so a body
// saying `const conn = SECRET` stringifies to the identifier and never contains
// the marker, which would make every `!includes(BUN_PARITY_SECRET)` assertion
// below trivially true and this whole file proof of nothing.
//
// On Bun the same construction MIGHT instead expose the marker, because Bun can
// fold a module-scope `const` string into the body. Whether it does here is not
// worth deriving: four attempts to state the folding rule were measured while
// this guard was reviewed, and each was falsified by the next.
//
// That unpredictability IS the argument for inlining. A test whose marker is
// visible only under some transpiler heuristic is a test that can go quietly
// tautological when the heuristic shifts, which is exactly what it must never
// do. Inlining removes the dependency instead of reasoning about it.
async function leaky(input) {
  const conn = 'postgres://user:BUN_PARITY_SECRET@host/db';
  return { ok: true, conn, input };
}

async function drain(stream) {
  let out = '';
  for await (const c of stream) out += typeof c === 'string' ? c : new TextDecoder().decode(c);
  return out;
}

/**
 * Every shape that must be refused, in both SSR machines.
 *
 * The UNQUOTED sigil forms are load-bearing here, not padding: the two machines
 * route bindings through separate branches, and they have already drifted apart
 * on exactly those (one refused `.action=${fn}` while the other dropped it, and
 * a later fix over-corrected into refusing `@action=${fn}` on one side only).
 * A parity file that enumerates only the quoted shapes cannot see either.
 */
const refused = {
  'action="${fn}"': () => html`<form action="${leaky}"></form>`,
  'mixed action="/x/${fn}"': () => html`<form action="/x/${leaky}"></form>`,
  'quoted prop .action="${fn}"': () => html`<form .action="${leaky}"></form>`,
  'quoted bool ?action="${fn}"': () => html`<form ?action="${leaky}"></form>`,
  'quoted event @action="${fn}"': () => html`<form @action="${leaky}"></form>`,
  'native prop .action=${fn}': () => html`<form .action=${leaky}></form>`,
  'unquoted bool ?action=${fn}': () => html`<form ?action=${leaky}></form>`,
  'array-wrapped action=${[fn]}': () => html`<form action=${[leaky]}></form>`,
  'quoted formaction="${fn}"': () => html`<form action=${'/x'}><button formaction="${leaky}"></button></form>`,
  'reflecting prop .formAction=${fn} on a button': () => html`<button .formAction=${leaky}></button>`,
};


/**
 * The two shapes #1155 turned into a BINDING rather than a stringify:
 * `action=${fn}` and its case-folded spelling, on a `<form>`. They still refuse
 * a function the server cannot identify, so nothing leaks either way, but the
 * refusal is the identity one and they belong in their own table.
 */
const refusedAsUnidentified = {
  'action=${fn}': () => html`<form action=${leaky}></form>`,
  'upper-case ACTION=${fn}': () => html`<form ACTION=${leaky}></form>`,
  'formaction=${fn} inside bound form': () => html`<form action=${leaky}><button formaction=${leaky}></button></form>`,
  // #1307: a bound submitter no longer asks anything of its enclosing form, so
  // these two moved here from their own table. They still refuse, because
  // `leaky` has no identity to bind, which is the leak guard this file exists
  // for. The enclosing form has nothing to do with it either way.
  'formaction=${fn} with no bound form': () => html`<button type="submit" formaction=${leaky}></button>`,
  'camelCase formAction=${fn} with no bound form': () => html`<button type="submit" formAction=${leaky}></button>`,
};

for (const [name, mk] of Object.entries(refused)) {
  // Buffered renderer.
  let threw = null;
  try { await renderToString(mk(), { ssr: true }); } catch (e) { threw = e; }
  assert.ok(threw, `[${runtime}] buffered SSR must refuse ${name}`);
  assert.match(threw.message, /function was interpolated into/, `[${runtime}] ${name} message`);
  assert.ok(!threw.message.includes('BUN_PARITY_SECRET'),
    `[${runtime}] the refusal message must not carry the source it withholds (${name})`);

  // Streaming renderer, the second, independent state machine. Matches the
  // message too: asserting only that SOMETHING threw would be satisfied by any
  // unrelated error, which is how a machine that refuses for the wrong reason
  // slips through a parity check.
  let streamThrew = null;
  try { await drain(renderToStream(mk(), { ssr: false })); } catch (e) { streamThrew = e; }
  assert.ok(streamThrew, `[${runtime}] streaming SSR must refuse ${name}`);
  assert.match(streamThrew.message, /function was interpolated into/,
    `[${runtime}] streaming must refuse ${name} for the RIGHT reason`);
  assert.ok(!streamThrew.message.includes('BUN_PARITY_SECRET'),
    `[${runtime}] streaming refusal must not carry the source (${name})`);
}

for (const [name, mk] of Object.entries(refusedAsUnidentified)) {
  for (const [machine, run] of [
    ['buffered', () => renderToString(mk(), { ssr: true })],
    ['streaming', () => drain(renderToStream(mk(), { ssr: false }))],
  ]) {
    let threw = null;
    try { await run(); } catch (e) { threw = e; }
    assert.ok(threw, `[${runtime}] ${machine} SSR must refuse ${name}`);
    assert.match(threw.message, /is not a server action/, `[${runtime}] ${machine} ${name} message`);
    assert.ok(!threw.message.includes('BUN_PARITY_SECRET'),
      `[${runtime}] the refusal message must not carry the source it withholds (${machine} ${name})`);
  }
}

/**
 * A bound action, the one supported shape (#1155). Both machines must emit the
 * same form: no `action` attribute, a forced `method="post"`, and the hidden
 * identity field INSIDE the form. This is runtime-sensitive for the same reason
 * the guard is: it runs inside the SSR state machines, and the two engines see
 * a transpiled vs an untranspiled module.
 */
setFormActionResolver((fn) => (fn === leaky ? 'a1b2c3d4e5/leaky' : null));
for (const [machine, run] of [
  ['buffered', () => renderToString(html`<form action=${leaky}><input name="a"></form>`, { ssr: true })],
  ['streaming', () => drain(renderToStream(html`<form action=${leaky}><input name="a"></form>`, { ssr: false }))],
]) {
  const out = await run();
  assert.ok(!out.includes('BUN_PARITY_SECRET'), `[${runtime}] a bound action must not leak (${machine})`);
  assert.match(out, new RegExp(`<input type="hidden" name="${FORM_ACTION_FIELD}" value="a1b2c3d4e5/leaky">`),
    `[${runtime}] the identity field is emitted (${machine})`);
  assert.doesNotMatch(out, /<form[^>]*\saction=/, `[${runtime}] the form posts to its own url (${machine})`);
  assert.match(out, /method="post"/, `[${runtime}] method is forced (${machine})`);
  assert.ok(out.indexOf(FORM_ACTION_FIELD) < out.indexOf('</form>'),
    `[${runtime}] the identity field must be inside the form (${machine}), or it is never submitted`);
}
setFormActionResolver(() => null);

/**
 * The carve-outs, which matter as much as the refusals: a guard that refused
 * everything would satisfy every assertion above. Both machines must AGREE that
 * these stay legal.
 */
const allowed = {
  'unquoted event @action=${fn}': () => html`<form @action=${leaky}></form>`,
  'custom-element event @action=${fn}': () => html`<my-el @action=${leaky}></my-el>`,
  'custom-element prop .action=${fn}': () => html`<my-el .action=${leaky}></my-el>`,
  // The `.prop` guard keys on REFLECTION, not on "is a native element", so
  // these must stay legal on both runtimes: a plain expando writes no markup.
  'native prop .action=${fn} on a div': () => html`<div .action=${leaky}></div>`,
  'native prop .action=${fn} on a button': () => html`<button .action=${leaky}></button>`,
};

for (const [name, mk] of Object.entries(allowed)) {
  const buffered = await renderToString(mk(), { ssr: true });
  assert.ok(!buffered.includes('BUN_PARITY_SECRET'), `[${runtime}] ${name} must not leak (buffered)`);

  const streamed = await drain(renderToStream(mk(), { ssr: false }));
  assert.ok(!streamed.includes('BUN_PARITY_SECRET'), `[${runtime}] ${name} must not leak (streaming)`);
}

// A self-referential array stringifies to '' because `Array.prototype.join` has
// a cycle guard. The function check has to match that rather than recurse, on
// both engines.
const cyclic = [];
cyclic.push(cyclic);
const cyclicOut = await renderToString(html`<form action=${cyclic}></form>`, { ssr: true });
assert.match(cyclicOut, /action=""/, `[${runtime}] a cyclic array must render, not overflow the stack`);

// The SCOPE boundary, on both machines. Every other passthrough above is
// `action`-valued, so none of them would notice a change that widened the claim
// to drop function values in every attribute. This is the one that would.
// Asserts on the SECRET marker rather than a stringification shape, for the
// reason given at the top of the file: Bun transpiles the module, so the source
// a function reports is rewritten, and a string literal is what survives that.
const otherBuffered = await renderToString(html`<div title=${leaky}></div>`, { ssr: true });
assert.ok(otherBuffered.includes('BUN_PARITY_SECRET'),
  `[${runtime}] an unclaimed attribute must still stringify (buffered)`);

const otherStreamed = await drain(renderToStream(html`<div title=${leaky}></div>`, { ssr: false }));
assert.ok(otherStreamed.includes('BUN_PARITY_SECRET'),
  `[${runtime}] an unclaimed attribute must still stringify (streaming)`);

// The passthrough must stay byte-identical across runtimes: refusing everything
// would also pass the assertions above, so pin what still works.
const okBuffered = await renderToString(html`<form method="post" action=${'/submit'}></form>`, { ssr: true });
assert.match(okBuffered, /action="\/submit"/, `[${runtime}] a string action must still render`);

const okStream = await drain(renderToStream(html`<form action=${'/submit'}></form>`, { ssr: false }));
assert.match(okStream, /action="\/submit"/, `[${runtime}] a string action must still stream`);

const okArray = await renderToString(html`<form action=${['/a', '/b']}></form>`, { ssr: true });
assert.match(okArray, /action="\/a,\/b"/, `[${runtime}] an array of strings is not a function`);

console.log(`[${runtime}] form-action parity OK: ${Object.keys(refused).length} refused shapes, ${Object.keys(refusedAsUnidentified).length} unidentified-action refusals, 1 bound action, ${Object.keys(allowed).length} carve-outs, 5 passthroughs`);
