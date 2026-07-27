/**
 * Cross-runtime proof that SSR treats HTML contexts identically under
 * WHICHEVER runtime executes this file (#1128). Run it under both:
 *
 *   node test/bun/comment-not-an-element.mjs
 *   bun  test/bun/comment-not-an-element.mjs
 *
 * A registered tag name inside a comment used to be constructed and rendered as
 * a real element, and the replacement ate the comment's closing `-->` along
 * with the markup after it. The fix decides that by tokenizing the assembled
 * HTML: comments (including the `--!>` and `<!-->` short forms), markup
 * declarations, tags with their quoted attribute values, raw text, and RCDATA.
 *
 * This is runtime-sensitive for a specific reason, not by category. The scanner
 * leans on `String.prototype.indexOf` / `startsWith` offsets, a `RegExp` with a
 * lookahead built per call, and `matchAll` index arithmetic that has to line up
 * exactly with those offsets. Any divergence in regex semantics or index
 * handling between V8 and JSC would not throw, it would silently shift a range
 * boundary, and the symptom is a component that renders on one runtime and
 * silently vanishes on the other. So both the positive and negative cases are
 * asserted here rather than just "it does not crash".
 *
 * A plain assert script (not `*.test.mjs`, so the node:test runner does not
 * double-run it); it exits non-zero on failure. Run from the repo root so the
 * bare `@webjsdev/core` specifier resolves to the workspace package.
 */
import assert from 'node:assert/strict';
import { html, WebComponent } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

class BunProbe extends WebComponent {
  render() { return html`<b>PROBE</b>`; }
}
BunProbe.register('bun-probe');

// Starts with "script": a raw-text check not anchored on the tag boundary
// misreads this as a <script> and stops scanning for the rest of the document.
class ScriptShaped extends WebComponent {
  render() { return html`<b>SCRIPTSHAPED</b>`; }
}
ScriptShaped.register('script-shaped');

const rendered = async (tpl) => (await renderToString(tpl)).includes('<b>PROBE</b>');

// Inert: the tag is text, not markup.
assert.equal(await rendered(html`<div><!-- <bun-probe> --></div>`), false,
  'a component inside a comment must not render');
assert.equal(await rendered(html`<div><!-- <bun-probe> </div>`), false,
  'an unterminated comment runs to EOF');
assert.equal(await rendered(html`<div><style>/* <bun-probe> */</style></div>`), false,
  'raw-text content is text');
assert.equal(await rendered(html`<div><script>var a = "<bun-probe>";</script></div>`), false,
  'script content is text');

// Live: everything else still renders. These are the cases where a subtly
// wrong range boundary makes a component disappear.
assert.equal(await rendered(html`<div><bun-probe></bun-probe></div>`), true,
  'a plain component still renders');
assert.equal(await rendered(html`<div><!-- note --><bun-probe></bun-probe></div>`), true,
  'a component after a closed comment still renders');
assert.equal(await rendered(html`<div><a title="use <!-- here"></a><bun-probe></bun-probe></div>`), true,
  'an attribute value containing "<!--" does not open a comment');
assert.equal(await rendered(html`<div><!-- x --!><bun-probe></bun-probe></div>`), true,
  'the abrupt-closing form --!> closes the comment');
assert.equal(await rendered(html`<div><!--><bun-probe></bun-probe></div>`), true,
  '<!--> is a complete empty comment');
assert.equal(await rendered(html`<div><textarea><!-- hi</textarea><bun-probe></bun-probe></div>`), true,
  'RCDATA content does not open a comment');
assert.equal(await rendered(html`<div><script-shaped></script-shaped><bun-probe></bun-probe></div>`), true,
  'a component whose name starts with a raw-text tag name is not treated as one');
// The END of each text-only skip, which is the boundary a range-arithmetic
// divergence would move. An inert range never deletes text, so only a real
// component AFTER the element proves scanning resumed on this runtime.
assert.equal(await rendered(html`<div><style>.a{color:red}</style><bun-probe></bun-probe></div>`), true,
  'scanning resumes after a style closes');
assert.equal(await rendered(html`<div><script>var a=1;</script><bun-probe></bun-probe></div>`), true,
  'scanning resumes after a script closes');
assert.equal(await rendered(html`<div><iframe>fallback</iframe><bun-probe></bun-probe></div>`), true,
  'scanning resumes after an iframe closes');
assert.equal(await rendered(html`<div><noscript><bun-probe></bun-probe></noscript></div>`), true,
  'noscript content is markup, not text');

// Element boundaries (#1133): a commented tag counts for neither side of the
// nesting ledger, so the element still ends at its REAL close tag.
{
  const out = await renderToString(html`<div><!-- </div> --><bun-probe></bun-probe></div>`);
  assert.ok(out.includes('<b>PROBE</b>'), 'a commented close tag does not end the element early');
}
// Script data double-escape (#1134): <!-- + <script defers the close to the
// NEXT </script>, so the tag between them is text on both runtimes.
assert.equal(await rendered(html`<div><script type="text/plain"><!-- <script> </script> <bun-probe></bun-probe> --></script></div>`), false,
  'a double-escaped script body is text to its real end');

// Content preservation: the damage mode that made this worth fixing.
const out = await renderToString(
  html`<div><!-- see <bun-probe> here --><span>after</span></div>`
);
assert.ok(out.includes('-->'), 'the comment is still closed');
assert.ok(out.includes('<span>after</span>'), 'markup after the comment survives');

console.log(`[bun-parity] comment-not-an-element OK on ${runtime}`);
