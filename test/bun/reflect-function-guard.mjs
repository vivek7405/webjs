/**
 * Cross-runtime proof that a `reflect: true` property holding a function never
 * writes that function into its attribute, under WHICHEVER runtime executes
 * this file (#1169). Run under both:
 *
 *   node test/bun/reflect-function-guard.mjs
 *   bun  test/bun/reflect-function-guard.mjs
 *
 * The reflect path is plain DOM-shim use rather than a serializer / listener /
 * stream surface, so a divergence in the GUARD itself is not what this is
 * watching for. What makes it worth proving on both runtimes is the thing the
 * guard removes: the severity of the leak was runtime-dependent.
 *
 * `String(fn)` is `Function.prototype.toString`, and what that returns is not
 * the same on both. On Node it is the source text as written, so a module-scope
 * `const` the body reads appears only as its identifier. Bun transpiles a
 * module before the engine sees it and can fold a module-scope string literal
 * straight into the body, so the same function can report the SECRET ITSELF
 * where Node reports the name it was read through. That is a transpiler's
 * internal choice rather than a documented boundary, so it is not a rule to
 * build a habit on, which is exactly why refusing to stringify is the fix
 * rather than sanitizing whatever came back.
 *
 * So this asserts the strong claim on both runtimes: neither the identifier
 * nor the folded value reaches the output, because nothing is stringified at
 * all. A plain assert script (not `*.test.mjs`, so the runner does not
 * double-run it), exiting non-zero on failure. Run from the repo root so the
 * bare `@webjsdev/core` specifier resolves to the workspace package.
 */
import assert from 'node:assert/strict';
import { html, WebComponent, prop } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

// A module-scope literal the action closes over. This is the binding Bun may
// fold into the function body and Node will not, so both spellings are checked
// below and neither may appear.
const VENDOR_API_KEY = 'sk_live_REFLECT_FOLDED_MARKER';

async function leakyAction() {
  const header = `Bearer ${VENDOR_API_KEY}`;
  const inline = 'REFLECT_INLINE_MARKER';
  return header + inline;
}

class ReflectProbe extends WebComponent({
  // The String branch, which is where the leak lived.
  label: prop(String, { reflect: true }),
  // Untyped, so the same fall-through is reached without a declared type.
  payload: prop({ reflect: true }),
  // JSON.stringify(fn) is `undefined`, which setAttribute wrote as that
  // literal four-character string. No source leak, same defect.
  config: prop(Object, { reflect: true }),
  // An ordinary value, to prove the guard did not break reflection.
  ok: prop(String, { reflect: true }),
  // An author-supplied converter runs first and is deliberately untouched.
  conv: prop(String, { reflect: true, converter: { toAttribute: (v) => `custom:${typeof v}` } }),
}) {
  constructor() {
    super();
    this.label = leakyAction;
    this.payload = leakyAction;
    this.config = leakyAction;
    this.ok = 'plain-string';
    this.conv = leakyAction;
  }
  render() { return html`<span>x</span>`; }
}
ReflectProbe.register('bun-reflect-probe');

// The guard warns on every drop, and a passing run should not print a wall of
// warnings that read as failures. Capture them and assert on the count instead.
//
// This capture is what caught the warning being dead code in the SHIPPED
// bundle. The check used to be gated on `process.env.NODE_ENV`, which
// `scripts/build-framework-dist.js` folds to a constant (esbuild substitutes
// it under `platform: 'browser'` + `minify`), so the SSR half never warned in
// any published build. Running this through the bare `@webjsdev/core`
// specifier, which resolves to `dist/`, is the only layer that sees it.
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));
let out;
try {
  out = await renderToString(html`<bun-reflect-probe></bun-reflect-probe>`);
} finally {
  console.warn = originalWarn;
}

// The claim the whole guard exists for, in both spellings the two runtimes
// produce. The inline marker covers a literal written inside the body (which
// both runtimes emit), the folded marker covers the module-scope binding Bun
// may inline, and the identifier covers what Node emits in its place.
for (const marker of ['REFLECT_INLINE_MARKER', 'REFLECT_FOLDED_MARKER', 'VENDOR_API_KEY']) {
  assert.ok(!out.includes(marker), `[${runtime}] the function source reached the output via ${marker}: ${out}`);
}

// The attributes are absent, not merely emptied. An empty attribute would be a
// different observable than the removal the guard promises.
for (const attr of ['label=', 'payload=', 'config=']) {
  assert.ok(!out.includes(attr), `[${runtime}] ${attr} should be removed, not written: ${out}`);
}
assert.ok(!out.includes('undefined'), `[${runtime}] wrote a literal "undefined": ${out}`);

// Ordinary reflection is unchanged, and the author override still wins.
assert.ok(out.includes('ok="plain-string"'), `[${runtime}] a normal value must still reflect: ${out}`);
assert.ok(out.includes('conv="custom:function"'), `[${runtime}] converter.toAttribute must still win: ${out}`);

// One warning per dropped property, and none of them prints the value: the
// warning path is the other place the source could escape, and a server log is
// not always a private place.
assert.equal(warnings.length, 3, `[${runtime}] expected one warning per dropped prop, got ${warnings.length}`);
for (const message of warnings) {
  for (const marker of ['REFLECT_INLINE_MARKER', 'REFLECT_FOLDED_MARKER']) {
    assert.ok(!message.includes(marker), `[${runtime}] the warning leaked the source it refused to write: ${message}`);
  }
}

console.log(`[${runtime}] reflect-function-guard: function props dropped, no source in output or warnings, string + converter intact ✓`);
