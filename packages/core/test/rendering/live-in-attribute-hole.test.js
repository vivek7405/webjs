// #1443: SSR must resolve `live()` in an ATTRIBUTE hole, not just a child hole.
//
// `live()` exists to dirty-check a commit against the LIVE DOM value, which is
// a client-only concern, so on the server the directive is transparent and every
// position must see the inner value. It was resolved only in child position
// (`render()` / `streamRender()`), so the wrapper object reached the attribute
// emit sites raw and each kind failed its own way:
//
//   ?bool  the wrapper is truthy, so `?open=${live(false)}` emitted `open=""`
//   attr   `String(val ?? '')` stringified the wrapper to `[object Object]`
//   .prop  the wrapper itself was serialized into `data-webjs-prop-*`
//
// The falsy-bool case is the one that shipped: webjs.dev's `<details>` nav menu
// bound `?open=${live(this.open)}`, so mobile painted the menu OPEN and
// hydration then closed it.
//
// The client (render-client/parts.js `applyPart`) has always unwrapped `live()`
// once, before its attr/bool/prop dispatch, and render-client/reconciler.js
// `effectiveFormAttr` simulates SSR by calling `resolveHoleValue` (which
// unwraps) while its docstring claims to "mirror render-server.js exactly". So
// this was a direct contradiction between the two renderers, and the fix is to
// unwrap at the same single point on the server.
//
// Both server machines are asserted on every case: the buffered renderer
// (`renderToString`) and the streaming one (`renderToStream(v, {ssr:false})`)
// are separate hole-dispatch sites that must not drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html } from '../../src/html.js';
import { renderToString, renderToStream } from '../../src/render-server.js';
import { live } from '../../src/directives.js';

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

/**
 * Run a template factory through BOTH server machines and hand each output to
 * `assertOn` with the machine's name. Flat rather than one subtest per machine:
 * Bun's `node:test` shim refuses a nested subtest outside `bun test`, and this
 * suite is in the Bun parity matrix. Every assertion below carries `who` in its
 * failure message, so nothing is lost by not nesting.
 */
async function bothRenderers(mk, assertOn) {
  for (const [who, run] of [['buffered', buffered], ['streamed', streamed]]) {
    assertOn(await run(mk()), who);
  }
}

test('a falsy ?bool hole omits its attribute through live() (#1443)', async () => {
  // THE counterfactual case: reverting the server unwrap reds exactly this,
  // because the wrapper object is truthy whatever it wraps.
  await bothRenderers(() => html`<details ?open=${live(false)}></details>`, (out, who) => {
    assert.ok(!/\bopen\b/.test(out), `${who}: ?open=\${live(false)} must omit the attribute, got ${out}`);
  });
});

test('a truthy ?bool hole still emits its attribute through live() (#1443)', async () => {
  await bothRenderers(() => html`<details ?open=${live(true)}></details>`, (out, who) => {
    assert.match(out, /\bopen=""/, `${who}: ?open=\${live(true)} must emit the attribute, got ${out}`);
  });
});

test('a ?bool hole renders identically with and without live() (#1443)', async () => {
  // The property that matters: live() is TRANSPARENT at SSR. Asserting parity
  // rather than a literal keeps this honest if the emit spelling ever changes.
  for (const v of [false, true]) {
    for (const [who, run] of [['buffered', buffered], ['streamed', streamed]]) {
      const bare = await run(html`<details ?open=${v}></details>`);
      const wrapped = await run(html`<details ?open=${live(v)}></details>`);
      assert.equal(wrapped, bare, `${who}: live(${v}) must render exactly as ${v}`);
    }
  }
});

test('an unquoted attribute hole resolves live() (#1443)', async () => {
  await bothRenderers(() => html`<div title=${live('hi')}></div>`, (out, who) => {
    assert.match(out, /title="hi"/, `${who}: title=\${live('hi')} must emit the inner value, got ${out}`);
    assert.ok(!/object Object/.test(out), `${who}: the live() wrapper must not be stringified, got ${out}`);
  });
});

test('a quoted attribute hole resolves live() (#1443)', async () => {
  await bothRenderers(() => html`<div title="${live('hi')}"></div>`, (out, who) => {
    assert.match(out, /title="hi"/, `${who}: quoted live() must emit the inner value, got ${out}`);
  });
});

test('a mixed attribute hole resolves live() in every position (#1443)', async () => {
  // A multi-hole attribute concatenates statics and EVERY hole, so each one has
  // to be unwrapped, not just the anchor.
  await bothRenderers(() => html`<div class="a ${live('b')} c ${live('d')}"></div>`, (out, who) => {
    assert.match(out, /class="a b c d"/, `${who}: every hole in a mixed attribute must unwrap, got ${out}`);
  });
});

test('a null attribute hole keeps the documented empty-string emit through live() (#1443)', async () => {
  // AGENTS.md: the server STRINGIFIES a nullish plain-attribute hole to
  // `attr=""` (only the client removes it). Unwrapping must not quietly change
  // that documented asymmetry into an omission.
  await bothRenderers(() => html`<div title=${live(null)}></div>`, (out, who) => {
    assert.match(out, /title=""/, `${who}: live(null) must emit title="" like a bare null, got ${out}`);
  });
});

test('a .prop hole on a custom element serializes the inner value, not the wrapper (#1443)', async () => {
  // Buffered only: `renderToStream(v, {ssr:false})` drops EVERY .prop by design
  // (there is no injectDSD pre-pass on that path to consume the attribute), so
  // there is no prop emit there to assert against.
  const out = await renderToString(html`<my-el .foo=${live(1)}></my-el>`);
  assert.match(out, /data-webjs-prop-foo="1"/, `the inner value must be serialized, got ${out}`);
  assert.ok(!/_\$webjs/.test(out), `the live() wrapper must not reach the hydration payload, got ${out}`);
});

test('a child hole nested in an array still resolves live() on the SERVER (#1443)', async () => {
  // The hole-level unwrap never sees this one; render()/streamRender() keep
  // their own isLive branch for it. Guards against removing those as dead code.
  //
  // SERVER ONLY, as the name says. The matching CLIENT assertions live in
  // live-in-client-child.test.js, which covers all four consumers of a child
  // value (fresh array build, in-place array reconcile, streamed renderer, and
  // a directive wrapping a live()). Keeping the halves in separate files is
  // why this one names its side explicitly: a test called "resolves live()"
  // that checks one renderer reads as if both were covered.
  await bothRenderers(() => html`<p>${[live('x'), live('y')]}</p>`, (out, who) => {
    assert.match(out, /<p>xy<\/p>/, `${who}: live() inside an array child must resolve, got ${out}`);
  });
});

test('the action-leak guards fire through live() (#1443)', async () => {
  // Unwrapping is what MAKES these fire: the wrapper is not a function, so
  // before the fix `action="${live(serverAction)}"` slipped past the guard and
  // emitted `action="[object Object]"`, a form posting to a garbage url.
  const fn = async function myAction() {};
  const shapes = [
    ['action="${live(fn)}" on <form>', () => html`<form action="${live(fn)}"></form>`],
    ['?action=${live(fn)} on <form>', () => html`<form ?action=${live(fn)}></form>`],
    ['.action=${live(fn)} on <form>', () => html`<form .action=${live(fn)}></form>`],
  ];
  for (const [label, mk] of shapes) {
    for (const [who, run] of [['buffered', buffered], ['streamed', streamed]]) {
      await assert.rejects(
        () => run(mk()),
        /function was interpolated into/,
        `${who}: ${label} must be refused, not emitted`,
      );
    }
  }
});

test('an unquoted action hole behaves identically bare and through live() (#1443)', async () => {
  // The one shape the unwrap changes MOST: `action=${fn}` on a <form> is the
  // #1155 bound-form binding, so unwrapping routes `action=${live(fn)}` into
  // that dispatch instead of stringifying the wrapper into the attribute
  // (which is what shipped before the fix: `action="[object Object]"`, a form
  // posting to a garbage url, with the guard silent because a wrapper is not
  // a function). The pin is PARITY rather than a hardcoded message: whatever
  // the bound-form path does with the inner function, bare and wrapped must do
  // the same thing, on both machines. Here the inner function is not a
  // 'use server' export, so both are refused by the bound-form dispatch; a
  // real action would bind identically, which the client already models
  // (reconciler.js resolveHoleValue unwraps before isBoundFormAction).
  const fn = async function myAction() {};
  for (const [who, run] of [['buffered', buffered], ['streamed', streamed]]) {
    /** @type {{ threw: boolean, message?: string, out?: string }[]} */
    const outcomes = [];
    for (const mk of [
      () => html`<form action=${fn}><button>go</button></form>`,
      () => html`<form action=${live(fn)}><button>go</button></form>`,
    ]) {
      try {
        outcomes.push({ threw: false, out: await run(mk()) });
      } catch (e) {
        outcomes.push({ threw: true, message: /** @type Error */ (e).message });
      }
    }
    const [bare, wrapped] = outcomes;
    assert.equal(wrapped.threw, bare.threw, `${who}: wrapped must throw iff bare throws`);
    if (bare.threw) {
      assert.equal(wrapped.message, bare.message, `${who}: identical refusal for bare and wrapped`);
      // And it is the bound-form refusal, not the stringify guard: the unwrap
      // routed the function into the #1155 dispatch.
      assert.match(String(bare.message), /not a server action/, `${who}: the bound-form path judged it`);
    } else {
      assert.equal(wrapped.out, bare.out, `${who}: identical emit for bare and wrapped`);
    }
  }
});
