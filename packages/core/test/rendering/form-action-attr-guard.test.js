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

/**
 * Drain a stream into a CALLER-OWNED buffer, so what the consumer RECEIVED
 * survives a throw.
 *
 * `drain()` accumulates into a local and loses it when the iteration throws, so
 * a test that drains a refused render and then inspects the result is always
 * inspecting an empty string, whatever the consumer actually got. "It threw" is
 * not the same claim as "the client received nothing".
 *
 * What this captures is precisely the security-relevant quantity, and it is
 * narrower than "everything the renderer enqueued". `renderToStream` fails via
 * `controller.error()`, which per spec clears the stream's QUEUE. Whether a
 * chunk enqueued shortly before that reaches the consumer depends on where it
 * landed, and both cases were checked rather than assumed:
 *
 *   enqueued into the queue, then `error()` with no yield in between
 *     -> destroyed. A consumer patched to flush the buffer and enqueue the
 *        source as a second chunk receives `<p>hello</p><form action="` and
 *        never the source.
 *   enqueued while a read is pending, or with ANY await before the refusal
 *     -> delivered. The same patch plus a 5ms yield before the guard hands the
 *        consumer the whole function body.
 *
 * The second is a real leak and this test reds on it. The first is not a leak,
 * because nothing reached the client, and this test stays green. So the
 * coverage lines up with the thing worth caring about: `sink.text` is what a
 * client could actually have seen, and every shape that puts the source in
 * front of a consumer fails here.
 *
 * @param {any} stream
 * @param {{ text: string }} sink written to as chunks arrive
 */
async function drainInto(stream, sink) {
  for await (const c of stream) sink.text += typeof c === 'string' ? c : new TextDecoder().decode(c);
  return sink.text;
}

// The secret sentinel must never appear in any output, thrown or not.
// The marker is INLINE in the body on purpose. `String(fn)` reproduces source,
// so a body that reads the marker from an outer `const` stringifies to the
// IDENTIFIER and never to the value. These assertions happened to survive that
// only because the identifier was itself called SECRET; renaming it would have
// silently turned every `/SECRET/` check into a tautology. The same shape was a
// live defect in `test/bun/form-action-guard.mjs`, where the marker and the
// identifier did not share a name and nothing matched.
async function leaky(input) {
  const conn = 'postgres://user:SECRET_MARKER@host/db';
  return { success: true, conn, input };
}

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

// The STREAMING renderer is a second, independent state machine, missed by the
// first pass of this fix. It is reached only through
// `renderToStream(v, { ssr: false })`, which no page render uses (the server
// renders every page, Suspense included, via `renderToString`), so this was a
// public-API hole and not a live page leak. It gets its own coverage rather
// than being assumed to inherit the buffered renderer's guard.
test('the streaming renderer refuses the same function (ssr:false path)', async () => {
  await assert.rejects(
    () => drain(renderToStream(html`<form action=${leaky}></form>`, { ssr: false })),
    /function was interpolated into action=/,
  );
});

test('the streaming renderer never emits the source, not even before it refuses', async () => {
  // Uses `drainInto` on purpose. Draining into a local and reading it after the
  // catch always sees an empty string, because the throw discards it, so the
  // assertion passes no matter what the consumer got. Verified: making the
  // streaming machine enqueue the source and THEN refuse left the whole file
  // green.
  //
  // The claim being pinned is about what a client could have RECEIVED, not
  // about the exception. See `drainInto` for why that is narrower than what the
  // renderer enqueued, and why the difference is in our favour.
  const sink = { text: '' };
  await assert.rejects(
    () => drainInto(renderToStream(html`<form action=${leaky}></form>`, { ssr: false }), sink),
    /function was interpolated into action=/,
  );
  assert.ok(!sink.text.includes('SECRET'), `received bytes must not carry the source, got: ${sink.text}`);
  assert.ok(!sink.text.includes('async function'), 'no function source of any kind reached the client');
});

// The unquoted shape lands in the streaming machine's `after-eq` branch; the
// quoted and mixed shapes land in its SEPARATE `attr-quoted`/`attr-unquoted`
// branch. Without these two, that second branch could be deleted outright and
// the suite would stay green, which is the same guard-asymmetry this whole
// change exists to prevent, just moved into the test layer.
test('the streaming renderer refuses a quoted hole', async () => {
  await assert.rejects(
    () => drain(renderToStream(html`<form action="${leaky}"></form>`, { ssr: false })),
    /function was interpolated into action=/,
  );
});

test('the streaming renderer refuses a mixed hole', async () => {
  await assert.rejects(
    () => drain(renderToStream(html`<form action="/x/${leaky}"></form>`, { ssr: false })),
    /function was interpolated into action=/,
  );
});

test('the streaming renderer refuses formaction', async () => {
  await assert.rejects(
    () => drain(renderToStream(html`<button formaction=${leaky}></button>`, { ssr: false })),
    /function was interpolated into formaction=/,
  );
});

test('streaming keeps string-valued actions working', async () => {
  const out = await drain(renderToStream(html`<form action=${'/submit'}></form>`, { ssr: false }));
  assert.match(out, /action="\/submit"/);
});

test('functions in OTHER attributes keep the existing stringify behaviour', async () => {
  // Narrow claim: only action/formaction throw. Anything else is unchanged
  // (arguably also a bug, but out of #1154's scope by design).
  //
  // This pins the SCOPE BOUNDARY, so it has to assert the source really is
  // still written out. `out.startsWith('<div title="')` was not enough: an
  // empty `title=""` satisfies it just as well, so a change that dropped
  // function values everywhere would have left this green while silently
  // widening the claim this PR deliberately kept narrow.
  const out = await renderToString(html`<div title=${leaky}></div>`, { ssr: true });
  assert.match(out, /^<div title="/);
  assert.match(out, /SECRET/, 'an unclaimed attribute still stringifies the function, source and all');
  assert.match(out, /async function leaky/, 'specifically, the function source');
});

test('the streaming renderer keeps the same scope boundary', async () => {
  // The boundary has to be pinned on EVERY renderer, not just the buffered one.
  // Pinning it on `renderToString` alone left the widening this guards against
  // invisible on the other two: dropping function values in every attribute in
  // the streaming machine kept the whole suite green.
  const out = await drain(renderToStream(html`<div title=${leaky}></div>`, { ssr: false }));
  assert.match(out, /SECRET/, 'an unclaimed attribute still stringifies on the streaming path');
  assert.match(out, /async function leaky/, 'specifically, the function source');
});

// --- Bypasses found reviewing the first cut of the guard -------------------
//
// The guard originally compared the RAW attribute name. The SSR state machines
// accumulate the name as authored and only the unquoted `after-eq` branch
// splits the binding sigil off, so a QUOTED binding hole arrived at the guard
// still carrying its `.` / `?` / `@` and slipped past the comparison. The
// renderer then treated it as an ordinary attribute and stringified it, which
// is the same leak this file exists to close.

test('quoted property hole .action="${fn}" throws (sigil is stripped before matching)', async () => {
  const out = await renderToString(html`<form .action="${leaky}"></form>`, { ssr: true })
    .then((html) => html, (e) => e);
  assert.ok(out instanceof Error, 'must throw, not render');
  assert.match(out.message, /function was interpolated into \.action=/);
  assert.doesNotMatch(out.message, /SECRET/, 'the message must not carry what it withholds');
});

test('quoted boolean hole ?action="${fn}" throws', async () => {
  await assert.rejects(
    () => renderToString(html`<form ?action="${leaky}"></form>`, { ssr: true }),
    /function was interpolated into \?action=/,
  );
});

test('quoted event hole @action="${fn}" throws', async () => {
  await assert.rejects(
    () => renderToString(html`<form @action="${leaky}"></form>`, { ssr: true }),
    /function was interpolated into @action=/,
  );
});

test('quoted .formaction="${fn}" on a submit button throws', async () => {
  await assert.rejects(
    () => renderToString(html`<button type="submit" .formaction="${leaky}"></button>`, { ssr: true }),
    /function was interpolated into \.formaction=/,
  );
});

// `String(val)` is what every commit site does, and Array.prototype.toString
// runs each element through String() too, so wrapping the action in an array
// leaked exactly as passing it bare did.

test('an array-wrapped function action=${[fn]} throws', async () => {
  await assert.rejects(
    () => renderToString(html`<form action=${[leaky]}></form>`, { ssr: true }),
    /function was interpolated into action=/,
  );
});

test('a nested array action=${[[fn]]} throws (Array toString joins recursively)', async () => {
  await assert.rejects(
    () => renderToString(html`<form action=${[[leaky]]}></form>`, { ssr: true }),
    /function was interpolated into action=/,
  );
});

test('an array of plain strings still renders, the array check is not a blanket refusal', async () => {
  const out = await renderToString(html`<form action=${['/a', '/b']}></form>`, { ssr: true });
  assert.match(out, /action="\/a,\/b"/);
});

// `.action` on a NATIVE element is dropped at SSR, so it never leaked there.
// It still refuses, so a page cannot render clean on the server and then throw
// on hydration, where `action` reflects and the leak is real.

test('.action=${fn} on a native form throws at SSR even though the prop would be dropped', async () => {
  await assert.rejects(
    () => renderToString(html`<form .action=${leaky}></form>`, { ssr: true }),
    /function was interpolated into action=/,
  );
});

test('a custom element keeps accepting a function on an unclaimed prop', async () => {
  const out = await renderToString(html`<my-widget .onSelect=${leaky}></my-widget>`, { ssr: true });
  assert.doesNotMatch(out, /SECRET/, 'an unserializable prop is dropped, not serialized');
});

test('a URL object action still renders, only functions are refused', async () => {
  const out = await renderToString(html`<form action=${new URL('https://example.com/p')}></form>`, { ssr: true });
  assert.match(out, /action="https:\/\/example\.com\/p"/);
});

// A component's render errors are isolated per component (#469), so a throw
// from inside one does NOT propagate: dev swaps in an error box, prod renders
// the component empty and the page still returns 200. That makes the refusal
// invisible on this path, so what has to be pinned is the security property
// rather than the throw. The leak must not reappear just because the error
// was swallowed.
test('a function action inside a component leaks nothing, even though the throw is isolated', async () => {
  const { WebComponent } = await import('../../src/component.js');
  class Guarded extends WebComponent({}) {
    render() { return html`<form action=${leaky}></form>`; }
  }
  Guarded.register('guarded-leak-form');

  const out = await renderToString(html`<div><guarded-leak-form></guarded-leak-form></div>`, { ssr: true });
  assert.doesNotMatch(out, /SECRET/, 'the isolated error path must not emit the source');
  assert.doesNotMatch(out, /async function/, 'no function source of any kind');
});

// --- Carve-outs, and the machines agreeing on them ------------------------
//
// A guard that refused everything would satisfy every assertion above, so what
// stays LEGAL has to be pinned just as hard. Both bindings below never
// stringify their value, so neither can leak, and refusing them would break
// ordinary code.

test('an unquoted @action=${fn} event binding stays legal on both machines', async () => {
  const buffered = await renderToString(html`<form @action=${leaky}></form>`, { ssr: true });
  assert.doesNotMatch(buffered, /SECRET/);
  const streamed = await drain(renderToStream(html`<form @action=${leaky}></form>`, { ssr: false }));
  assert.doesNotMatch(streamed, /SECRET/);
});

test('a custom element keeps a function on its own .action property', async () => {
  const buffered = await renderToString(html`<my-el .action=${leaky}></my-el>`, { ssr: true });
  assert.doesNotMatch(buffered, /SECRET/, 'an unserializable prop is dropped, never serialized');
  const streamed = await drain(renderToStream(html`<my-el .action=${leaky}></my-el>`, { ssr: false }));
  assert.doesNotMatch(streamed, /SECRET/);
});

test('an unquoted ?action=${fn} is refused rather than emitting a bare action=""', async () => {
  // Never leaked, but a truthy function silently produced `action=""`, which is
  // never what anyone meant. Refusing keeps the documented rule true for `?`.
  await assert.rejects(
    () => renderToString(html`<form ?action=${leaky}></form>`, { ssr: true }),
    /function was interpolated into action=/,
  );
  await assert.rejects(
    () => drain(renderToStream(html`<form ?action=${leaky}></form>`, { ssr: false })),
    /function was interpolated into action=/,
  );
});

test('a self-referential array renders instead of overflowing the stack', async () => {
  // `Array.prototype.join` has a cycle guard, so `String(cyclic)` is ''. The
  // function walk has to match that; a naive recursion turned a render that
  // used to succeed into a RangeError.
  const cyclic = [];
  cyclic.push(cyclic);
  const out = await renderToString(html`<form action=${cyclic}></form>`, { ssr: true });
  assert.match(out, /action=""/);
});

test('the streaming renderer refuses .action=${fn} on a native form', async () => {
  // The streaming machine's native-prop clause. Mapping every guard call site
  // to a test that fails when it is reverted showed this one pinned ONLY by
  // `test/bun/form-action-guard.mjs`, so the whole rendering suite stayed green
  // with it deleted. Covered here too, since a clause guarded by a single
  // cross-runtime script is one file away from being unguarded.
  await assert.rejects(
    () => drain(renderToStream(html`<form .action=${leaky}></form>`, { ssr: false })),
    /function was interpolated into action=/,
  );
});
