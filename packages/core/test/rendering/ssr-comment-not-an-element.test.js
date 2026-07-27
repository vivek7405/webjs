// A registered tag name written inside an HTML comment is comment TEXT, not an
// element (#1128).
//
// The custom-element walk matches tags with a flat regex over assembled markup,
// which knew nothing about HTML contexts, so `<!-- see <my-tag> -->` used to
// construct and render the component. The damage went past a wasted render: the
// replacement consumed the rest of the comment INCLUDING its closing `-->`, so
// everything after it was swallowed by an unterminated comment. Whether it
// happened depended on whether the name in the comment was a registered
// component, which is what made it look random.
//
// Found by writing an ordinary explanatory comment in the website's root layout
// that mentioned `<copy-cmd>`, which grew a real copy button.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { html, renderToString, WebComponent } from '../../index.js';

class CommentProbe extends WebComponent {
  render() { return html`<b>RENDERED</b>`; }
}
CommentProbe.register('comment-probe');

// Name deliberately starts with "script": a raw-text check that is not
// anchored on a tag boundary treats this as a <script> and stops scanning.
class ScriptProbe extends WebComponent {
  render() { return html`<b>SCRIPTPROBE</b>`; }
}
ScriptProbe.register('script-probe');

// A template that documents its own slot in a comment, which is exactly how a
// developer would annotate one.
class SlotInComment extends WebComponent {
  render() {
    return html`<div><!-- <slot name="head"> is the header --><slot></slot><p>tail</p></div>`;
  }
}
SlotInComment.register('slot-in-comment');

test('a component tag inside a comment is not instantiated', async () => {
  const out = await renderToString(html`<div><!-- <comment-probe></comment-probe> --></div>`);
  assert.equal(out, '<div><!-- <comment-probe></comment-probe> --></div>');
});

test('markup after a comment mentioning a component survives', async () => {
  // The regression that actually loses content: the old behaviour ate the
  // closing `-->` and the trailing markup with it.
  const out = await renderToString(
    html`<div><!-- see <comment-probe> for the button --><span>after</span></div>`
  );
  assert.ok(out.includes('-->'), 'the comment is still closed');
  assert.ok(out.includes('<span>after</span>'), 'markup following the comment is not swallowed');
  assert.ok(!out.includes('RENDERED'), 'the component did not render');
});

test('an unterminated comment does not instantiate what follows', async () => {
  // A browser treats everything after an unclosed `<!--` as comment data, so
  // the scanner has to as well, or the two disagree about the same bytes.
  const out = await renderToString(html`<div><!-- <comment-probe> </div>`);
  assert.ok(!out.includes('RENDERED'), 'nothing after an unterminated comment is instantiated');
});

test('a real component still renders next to a comment', async () => {
  // The other half of the fix: skipping comments must not skip anything else.
  const out = await renderToString(
    html`<div><!-- a note --><comment-probe></comment-probe></div>`
  );
  assert.ok(out.includes('RENDERED'), 'a genuine element after a comment still renders');
  assert.ok(out.includes('<!-- a note -->'), 'the comment is preserved verbatim');
});

test('a comment marker inside a script does not suppress later components', async () => {
  // Raw-text elements have no comment syntax: `<!--` inside a script is
  // ordinary text. If the scanner treated it as opening a comment, every
  // component after that script would silently stop rendering, which would be
  // a worse bug than the one being fixed.
  const out = await renderToString(
    html`<div><script>var a = "<!--";</script><comment-probe></comment-probe></div>`
  );
  assert.ok(out.includes('RENDERED'), 'a component after a script containing "<!--" still renders');
});

// The cases below are the ones a naive `indexOf('<!--')` scanner gets wrong.
// Every one of them was a real regression in the first version of this fix:
// the component silently stopped rendering, which is a worse failure than the
// bug being fixed, because the page loses content with no error anywhere.

test('a comment marker inside an attribute value is inert', async () => {
  const out = await renderToString(
    html`<div><a title="use <!-- here"></a><comment-probe></comment-probe></div>`
  );
  assert.ok(out.includes('RENDERED'), 'an attribute containing "<!--" does not open a comment');
});

test('the spec short comment forms close where a browser closes them', async () => {
  // `--!>` is the "abrupt closing" form and `<!-->` is a comment with empty
  // data. A scanner that only knows `-->` runs past both and swallows the page.
  const abrupt = await renderToString(html`<div><!-- note --!><comment-probe></comment-probe></div>`);
  assert.ok(abrupt.includes('RENDERED'), '--!> closes the comment');
  const empty = await renderToString(html`<div><!--><comment-probe></comment-probe></div>`);
  assert.ok(empty.includes('RENDERED'), '<!--> is a complete empty comment');
});

test('RCDATA content does not open a comment region', async () => {
  // textarea and title hold text, so `<!--` inside them is not comment syntax.
  const ta = await renderToString(html`<div><textarea><!-- hi</textarea><comment-probe></comment-probe></div>`);
  assert.ok(ta.includes('RENDERED'), 'a textarea containing "<!--" does not suppress later components');
  const ti = await renderToString(html`<div><title><!--</title><comment-probe></comment-probe></div>`);
  assert.ok(ti.includes('RENDERED'), 'a title containing "<!--" does not suppress later components');
});

test('a component whose name starts with a raw-text tag name is not mistaken for one', async () => {
  // `script-probe` starts with "script". Treating it as a <script> would skip
  // to a `</script>` that never comes, so the rest of the document goes
  // unscanned and the comment bug stays live after it.
  const out = await renderToString(
    html`<div><script-probe></script-probe><!-- <comment-probe> --><span>after</span></div>`
  );
  assert.ok(out.includes('SCRIPTPROBE'), 'the hyphenated component itself renders');
  assert.ok(!out.includes('RENDERED'), 'the commented component after it is still inert');
  assert.ok(out.includes('<span>after</span>'), 'markup after it survives');
});

test('raw-text content is text, so a component inside a style is inert', async () => {
  // Same markup-destroying path as the comment case: without this the replaced
  // tag ate the `*/</style>` and everything after it.
  const out = await renderToString(
    html`<div><style>/* <comment-probe> */</style><span>ok</span></div>`
  );
  assert.ok(!out.includes('RENDERED'), 'a component tag inside a style does not render');
  assert.ok(out.includes('<span>ok</span>'), 'markup after the style survives');
});

test('an unbalanced quote in a tag does not disable the scan for the rest of the page', async () => {
  // escapeAttr does not escape `'`, so an interpolated apostrophe inside a
  // single-quoted attribute emits three unbalanced quotes. A scanner that
  // treats every quote as a delimiter gets stuck inside the value to EOF and
  // returns a truncated range list, which silently re-enables this entire bug
  // for everything after that tag. A browser recovers at the `>`.
  const apos = "don't";
  // The discriminating assertion is a REAL component after the bad tag. If the
  // scan runs to EOF it produces one giant inert range, which keeps a commented
  // probe inert for the wrong reason and would pass either way; only a genuine
  // element reveals that everything after the tag stopped being scanned.
  const live = await renderToString(
    html`<div title='${apos}'></div><comment-probe></comment-probe>`
  );
  assert.ok(live.includes('RENDERED'), 'a real component after the unbalanced quote still renders');

  const out = await renderToString(
    html`<div title='${apos}'></div><!-- <comment-probe> --><span>after</span></div>`
  );
  assert.ok(!out.includes('RENDERED'), 'the commented component after the tag is still inert');
  assert.ok(out.includes('<span>after</span>'), 'markup after it survives');
});

test('a component tag inside an attribute value is not instantiated', async () => {
  // The same destroy-the-document path as the comment case, in a context the
  // scanner already knows the boundaries of. Naming a component in a title or
  // placeholder is the same authoring act that produced the original bug.
  const out = await renderToString(
    html`<button title="renders a <comment-probe> element">go</button><span>after</span>`
  );
  assert.ok(!out.includes('RENDERED'), 'the tag in the attribute value does not render');
  assert.ok(out.includes('<span>after</span>'), 'markup after the tag survives');
  assert.ok(out.includes('</button>'), 'the carrying element is still closed');
});

test('an attribute value containing > does not end the tag early', async () => {
  // A `>` inside a quoted value must not close the tag, or the interior range
  // stops short and a component tag written LATER in that same value escapes
  // the skip and is instantiated, destroying the rest of the document. The
  // tag-with-a-component-in-it is what discriminates: a value containing only
  // `>` passes whether or not quotes are tracked at all.
  const out = await renderToString(
    html`<div title="a > b <comment-probe> c"></div><span>after</span>`
  );
  assert.ok(!out.includes('RENDERED'), 'a component named later in the value is still inert');
  assert.ok(out.includes('</div>'), 'the carrying element is still closed');
  assert.ok(out.includes('<span>after</span>'), 'markup after it survives');

  const live = await renderToString(html`<div title="a > b"></div><comment-probe></comment-probe>`);
  assert.ok(live.includes('RENDERED'), 'a real component after such a tag still renders');
});

test('a commented-out suspense boundary does not run its children', async () => {
  // processSuspenseElements runs BEFORE the element walk and hands the
  // boundary's children to a fresh injectDSD as a standalone string, so the
  // comment fix has to reach it too. Under streaming this also consumed an id
  // and emitted a swap script targeting an element that only exists inside a
  // comment, so it could never resolve.
  const out = await renderToString(
    html`<div><!-- <webjs-suspense data-webjs-fallback="x"><comment-probe></comment-probe></webjs-suspense> --><span>after</span></div>`
  );
  assert.ok(!out.includes('RENDERED'), 'children of a commented boundary do not render');
  assert.ok(out.includes('<span>after</span>'), 'markup after the comment survives');
});

test('a slot mentioned in a comment does not consume the authored children', async () => {
  // The worst of the family: a commented `<slot>` has no `</slot>`, so the
  // fallback scan swallowed the rest of the template, the real slot was never
  // substituted, and the authored children vanished from the page.
  const out = await renderToString(html`<slot-in-comment><b>kid</b></slot-in-comment>`);
  assert.ok(out.includes('<b>kid</b>'), 'the authored children are still projected');
  assert.ok(out.includes('<p>tail</p>'), 'the rest of the template survives');
});

test('the client router boundary comments do not hide the components between them', async () => {
  // The load-bearing case (#1015, #1114). SSR wraps each layout's children in
  // KEYED boundary comment PAIRS, and the router's scan is strict: a mispaired
  // or duplicated boundary degrades navigation to a full page load. Those
  // comments must be skipped as comments WITHOUT swallowing the real markup
  // between them, so assert a component inside a pair still renders and both
  // markers survive verbatim.
  const out = await renderToString(html`<div>
    <!--wj:children:root:/-->
    <comment-probe></comment-probe>
    <!--/wj:children:root-->
    <comment-probe></comment-probe>
  </div>`);
  assert.equal(out.match(/RENDERED/g)?.length, 2, 'components inside and after the boundary pair both render');
  assert.ok(out.includes('<!--wj:children:root:/-->'), 'the opening boundary survives verbatim');
  assert.ok(out.includes('<!--/wj:children:root-->'), 'the closing boundary survives verbatim');
});
