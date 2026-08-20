// #1154: a function interpolated into a form-action attribute must never
// stringify. At SSR a `'use server'` import is the REAL function, so
// `String(fn)` would serialize the action's source (secrets included) into
// the served HTML. Covers every hole shape that used to leak (quoted, mixed,
// and `formaction` on a submit button), plus the byte-identical passthrough
// for string-valued action attributes.
//
// #1155 later made ONE of those shapes meaningful rather than merely refused:
// an unquoted `action=${fn}` on a `<form>` binds the action. It still cannot
// stringify anything, so the security claim is unchanged, but the refusal it
// hits is now the identity one ("is not a server action") for a function the
// server never registered, which is every function in this file. The binding
// itself has its own suite in `form-action-binding.test.js`; here the point is
// that the source never escapes on any path.
const NOT_AN_ACTION = /is not a server action/;
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
 * Issues a large SYNCHRONOUS burst of reads, and fails loudly if the burst was
 * not big enough. Four wrong answers preceded this, so the mechanism is worth
 * stating exactly rather than by analogy.
 *
 * Chunks written while the `new ReadableStream` constructor is still running
 * land in the queue that `controller.error()` later clears, and that is the
 * path that matters here: for the template below, and for the patched machine
 * the ladder was measured on, every chunk is written during the constructor.
 * (A second path exists, since `streamTemplate` awaits at text holes and a
 * chunk written after the constructor returns goes straight to a pending read.
 * A three-hole template splits 2 in the constructor and 4 after. No template in
 * this file has a text hole, so it plays no part in any of the numbers below,
 * and it is mentioned only because two earlier versions of this note explained
 * the behaviour with whichever path they happened to be wrong about.)
 *
 * Either way the recovery is per read: N reads issued in one synchronous run
 * recover N chunks. So consumers form a ladder with no top, measured against a
 * machine patched to flush its buffer, enqueue pad chunks, enqueue the source,
 * then refuse:
 *
 *   for await                    the prefix alone
 *   sequential getReader() loop  the prefix and one more chunk
 *   burst of N                   N chunks in total
 *
 * Any FIXED burst is therefore guessable: a batch of 16 silently passed a leak
 * sitting behind 20 pad chunks. The bound cannot be removed, since the burst is
 * sized before anything is awaited, so instead running out of it is made a hard
 * failure rather than a clean-looking drain.
 *
 * Worth being blunt about what this buys on the SHIPPED path: nothing. The
 * template the caller below uses has a single attribute hole and no text hole,
 * so the guard refuses before anything is enqueued at all, and instrumenting
 * the controller records exactly one event, the error. `sink.text` is therefore
 * always empty there, and both assertions hold trivially. All of this machinery
 * exists for the counterfactual, where a regression that writes before refusing
 * DOES enqueue, and where the difference between draining well and draining
 * badly is the difference between catching that and waving it through.
 *
 * @param {any} stream
 * @param {{ text: string }} sink written to as chunks arrive
 */
const DRAIN_BURST = 4096;

async function drainInto(stream, sink) {
  const reader = stream.getReader();
  const decode = (v) => (typeof v === 'string' ? v : new TextDecoder().decode(v));
  for (;;) {
    const burst = Array.from({ length: DRAIN_BURST }, () => reader.read());
    let done = false;
    let failure = null;
    let chunks = 0;
    for (const pending of burst) {
      try {
        const { done: d, value } = await pending;
        if (d) done = true;
        else if (value !== undefined) { sink.text += decode(value); chunks++; }
      } catch (e) {
        failure = failure || e;
      }
    }
    if (failure) throw failure;
    if (done) break;
    if (chunks === DRAIN_BURST) {
      // Every read came back with a chunk, so the burst may have stopped short
      // of the end. May, not did: a stream holding EXACTLY this many chunks and
      // then closing looks identical here, and throwing on that would be a
      // false alarm. One more read settles it, and it is safe to await now
      // because a stream still producing has nothing left to protect.
      const { done: ended } = await reader.read();
      if (ended) break;
      throw new Error(
        `drainInto ran out of its ${DRAIN_BURST}-read burst with the stream still producing. `
        + 'Chunks beyond the burst were never dequeued, so this drain is no longer reading the '
        + 'worst case and a leak could hide behind them. Raise DRAIN_BURST.',
      );
    }
  }
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
    NOT_AN_ACTION,
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

test('formaction=${fn} on a submit button inside an unbound form throws', async () => {
  // The enclosing form no longer decides anything (#1307). What still refuses is
  // the LEAK guard: `leaky` is not a registered action, so it has no identity to
  // bind and stringifying it would write the function's source into the HTML.
  await assert.rejects(
    () => renderToString(html`<form method="post"><button formaction=${leaky}>Go</button></form>`, { ssr: true }),
    NOT_AN_ACTION,
  );
});

test('camelCase formAction=${fn} throws on an unbound form (React spells it this way)', async () => {
  await assert.rejects(
    () => renderToString(html`<form method="post"><button formAction=${leaky}>Go</button></form>`, { ssr: true }),
    NOT_AN_ACTION,
  );
  await assert.rejects(
    () => renderToString(html`<form action=${'/x'}><button formAction="${leaky}">Go</button></form>`, { ssr: true }),
    /function was interpolated into formaction=/,
  );
});

test('upper-case ACTION=${fn} throws', async () => {
  // Attribute names are case-insensitive in HTML, so this is the binding shape
  // spelled loudly and it hits the identity refusal, not the stringify one.
  await assert.rejects(
    () => renderToString(html`<form method="post" ACTION=${leaky}></form>`, { ssr: true }),
    NOT_AN_ACTION,
  );
});

test('a quoted mixed-case Action="${fn}" throws (sigil strip and case-fold compose)', async () => {
  await assert.rejects(
    () => renderToString(html`<form method="post" Action="${leaky}"></form>`, { ssr: true }),
    /function was interpolated into action=/,
  );
});

test('the streaming renderer folds case too', async () => {
  await assert.rejects(
    () => drain(renderToStream(html`<button formAction=${leaky}></button>`, { ssr: false })),
    NOT_AN_ACTION,
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
    NOT_AN_ACTION,
  );
});

test('the streaming renderer never emits the source, not even before it refuses', async () => {
  // Two things this has to get right, both learned the hard way.
  //
  // It reads into a caller-owned sink, because a helper that accumulates into a
  // local loses everything when the iteration throws, and a test inspecting
  // that local is inspecting an empty string no matter what the consumer got.
  //
  // And it reads in one large synchronous burst, because what a consumer keeps
  // is exactly what its synchronously-issued reads dequeued before the clearing
  // microtask: N reads recover N chunks. A `for await` drain, and even a
  // sequential reader loop, both call a real leak clean, and any fixed burst is
  // guessable, so `drainInto` treats exhausting its burst as a hard failure
  // rather than a clean drain.
  const sink = { text: '' };
  await assert.rejects(
    () => drainInto(renderToStream(html`<form action=${leaky}></form>`, { ssr: false }), sink),
    NOT_AN_ACTION,
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

test('the streaming renderer refuses a formaction that is not an action', async () => {
  await assert.rejects(
    () => drain(renderToStream(html`<button formaction=${leaky}></button>`, { ssr: false })),
    NOT_AN_ACTION,
  );
  await assert.rejects(
    () => drain(renderToStream(html`<form action=${'/x'}><button formaction="${leaky}"></button></form>`, { ssr: false })),
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

// The `.prop` guard fires on REFLECTION, not on "is a native element". Those
// are different sets, and gating on the second refused four shapes that never
// leaked. Both sides are pinned here, because the suite passed either way:
// nothing covered a `.prop` binding on a native element that is not a form.
//
//   reflects (must throw)      .action on <form>, .formAction on <button>/<input>
//   plain expando (must not)   .action anywhere else, .formAction anywhere else
test('.formAction=${fn} throws on a button and an input, where it reflects', async () => {
  await assert.rejects(
    () => renderToString(html`<button .formAction=${leaky}></button>`, { ssr: true }),
    /function was interpolated into formaction=/,
  );
  await assert.rejects(
    () => renderToString(html`<input .formAction=${leaky} />`, { ssr: true }),
    /function was interpolated into formaction=/,
  );
});

test('.action=${fn} on a native element that does NOT reflect it still renders', async () => {
  // A plain expando: nothing is stringified and nothing reaches the markup, so
  // refusing it would break a supported binding (the delegated-command shape
  // `<button .action=${() => save(row)}>`) to prevent a leak that cannot occur.
  for (const tpl of [
    html`<div .action=${leaky}>hi</div>`,
    html`<button .action=${leaky}>hi</button>`,
    html`<li .action=${leaky}>hi</li>`,
    html`<div .formAction=${leaky}>hi</div>`,
  ]) {
    const out = await renderToString(tpl, { ssr: true });
    assert.doesNotMatch(out, /SECRET/, 'a dropped prop must not carry the source');
    assert.match(out, /hi/, 'and the element must still render');
  }
});

test('the streaming renderer draws the same reflection boundary', async () => {
  await assert.rejects(
    () => drain(renderToStream(html`<button .formAction=${leaky}></button>`, { ssr: false })),
    /function was interpolated into formaction=/,
  );
  const out = await drain(renderToStream(html`<div .action=${leaky}>hi</div>`, { ssr: false }));
  assert.doesNotMatch(out, /SECRET/);
  assert.match(out, /hi/);
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
  const cyclicProbe = [];
  cyclicProbe.push(cyclicProbe);
  // SKIPPED where the engine's own cycle guard is broken. Bun 1.4.0 regressed
  // `Array.prototype.join`'s, so `String(a)` throws RangeError for
  // `const a = []; a.push(a)` with no framework involved (node and Bun 1.3.14
  // both return ''). Keyed to the BEHAVIOUR, not a version, so this returns
  // automatically once the engine is fixed. See test/bun/form-action-guard.mjs
  // for the full note on why this is scoped rather than worked around.
  let engineJoinsCycles = true;
  try { String(cyclicProbe); } catch { engineJoinsCycles = false; }
  if (!engineJoinsCycles) return;
  const cyclic = cyclicProbe;
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
