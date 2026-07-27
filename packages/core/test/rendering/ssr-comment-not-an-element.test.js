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
import { unsafeHTML } from '../../src/directives.js';

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

// A named slot with a distinguishable fallback, so a child routed into the
// WRONG slot is visible in the output rather than merely missing.
class SlotShell extends WebComponent {
  render() {
    return html`<div><slot name="head">NO-HEAD</slot><slot></slot></div>`;
  }
}
SlotShell.register('slot-shell');

test('a component tag inside a comment is not instantiated', async () => {
  const out = await renderToString(html`<div><!-- <comment-probe></comment-probe> --></div>`);
  assert.equal(out, '<div><!-- <comment-probe></comment-probe> --></div>');
});

test('a comment containing a > still runs to its real end', async () => {
  // This is what actually pins the comment branch. Without it, `<!--` falls
  // through to the markup-declaration path, which stops at the FIRST `>`, and
  // every fixture whose tag sits before that `>` stays inert for the wrong
  // reason. A `>` INSIDE the comment, ahead of the tag, is the discriminator.
  const out = await renderToString(
    html`<div><!-- a > b <comment-probe> --><span>after</span></div>`
  );
  assert.ok(!out.includes('RENDERED'), 'the component after the > is still inert');
  assert.ok(out.includes('<span>after</span>'), 'markup after the comment survives');
});

test('every component in a multi-tag comment stays inert', async () => {
  const out = await renderToString(
    html`<div><!-- <comment-probe> and <comment-probe> --><span>after</span></div>`
  );
  assert.ok(!out.includes('RENDERED'), 'neither component renders');
  assert.ok(out.includes('<span>after</span>'), 'markup after the comment survives');
});

test('a bogus comment opened by </ does not expose what follows', async () => {
  // `</` followed by a non-letter is the third bogus-comment form and also runs
  // to the next `>`. Without that branch the bytes after it are scanned as
  // markup and the tag inside is instantiated.
  const out = await renderToString(
    html`<div>a </< b <comment-probe> c</div><span>after</span>`
  );
  assert.ok(!out.includes('RENDERED'), 'the tag inside the bogus comment does not render');
  assert.ok(out.includes('<span>after</span>'), 'markup after it survives');
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
  // The END of the skip needs its own assertion. An inert range never deletes
  // text, so the span above is true wherever the range stops; only a real
  // component after the element proves scanning RESUMED. If it did not, a
  // single <style> in a root layout would silently kill every component on
  // every page, which is worse than the bug this all started from.
  const after = await renderToString(
    html`<div><style>.a{color:red}</style><comment-probe></comment-probe></div>`
  );
  assert.ok(after.includes('RENDERED'), 'scanning resumes after the style closes');
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

test('iframe fallback content is text, not markup', async () => {
  // Raw text is not just script and style. An <iframe> with fallback markup is
  // the realistic one, and it hit the identical document-destroying path.
  const out = await renderToString(
    html`<div><iframe>see <comment-probe> here</iframe><span>after</span></div>`
  );
  assert.ok(!out.includes('RENDERED'), 'a component tag inside an iframe does not render');
  assert.ok(out.includes('<span>after</span>'), 'markup after the iframe survives');
  const after = await renderToString(
    html`<div><iframe>fallback</iframe><comment-probe></comment-probe></div>`
  );
  assert.ok(after.includes('RENDERED'), 'scanning resumes after the iframe closes');
});

test('a component inside noscript still renders', async () => {
  // The exclusion that matters most, and the one a future widening of the
  // text-only list would silently break. A browser with scripting disabled
  // parses noscript content as markup, and that reader is exactly who
  // server-rendered output exists for, so components inside it must render.
  const out = await renderToString(
    html`<div><noscript><comment-probe></comment-probe></noscript></div>`
  );
  assert.ok(out.includes('RENDERED'), 'noscript content is markup, not text');
});

test('a component inside a template still renders', async () => {
  // The other exclusion: template content is parsed, and Declarative Shadow DOM
  // and the streamed swap templates both depend on components inside it.
  const out = await renderToString(
    html`<div><template><comment-probe></comment-probe></template></div>`
  );
  assert.ok(out.includes('RENDERED'), 'template content is parsed as markup');
});

test('the other text-only elements are text too', async () => {
  // iframe is covered separately as the realistic case; these pin the rest of
  // the set so a future trim of the predicate reds a test instead of silently
  // reintroducing the document-destroying path.
  for (const tag of ['xmp', 'noembed', 'noframes']) {
    const out = await renderToString(
      html`<div>${unsafeHTML(`<${tag}>see <comment-probe> here</${tag}>`)}<span>after</span></div>`
    );
    assert.ok(!out.includes('RENDERED'), `a component tag inside <${tag}> does not render`);
    assert.ok(out.includes('<span>after</span>'), `markup after <${tag}> survives`);
    const after = await renderToString(
      html`<div>${unsafeHTML(`<${tag}>text</${tag}>`)}<comment-probe></comment-probe></div>`
    );
    assert.ok(after.includes('RENDERED'), `scanning resumes after <${tag}> closes`);
  }
});

test('plaintext runs to the end of the document', async () => {
  // plaintext has no end tag at all: everything after it is text, so nothing
  // following can be a component.
  const out = await renderToString(
    html`<div><plaintext>see <comment-probe> here</div>`
  );
  assert.ok(!out.includes('RENDERED'), 'nothing after plaintext is instantiated');
});

test('the <!---> short form closes like a browser closes it', async () => {
  // comment-start-dash + `>`. Distinct from `<!-->` and separately unpinned:
  // without its branch the comment never ends and the component vanishes.
  const out = await renderToString(html`<div><!---><comment-probe></comment-probe></div>`);
  assert.ok(out.includes('RENDERED'), '<!---> is a complete empty comment');
});

test('a doubled = does not open a quoted value', async () => {
  // Per spec the character after `=` is reconsumed in attribute-value-unquoted
  // state, so in `title==">` the quote is an ordinary value character and the
  // tag ends at the first `>`. Treating it as a delimiter leaves an odd quote
  // count, runs the scan to EOF, and silently disables the fix for the rest of
  // the page. Reachable through unsafeHTML or third-party markup.
  const out = await renderToString(
    html`<div>${unsafeHTML('<a title==">go</a>')}<comment-probe></comment-probe></div>`
  );
  assert.ok(out.includes('RENDERED'), 'the component after the doubled = still renders');
});

test('a missing attribute value does not swallow the tag end', async () => {
  // `<a href=>` is a missing-value parse error and the `>` still ends the tag.
  // Consuming it as a value character runs the scan to the NEXT `>`, which eats
  // the real tag end: the component after it stops rendering, and a following
  // <style> never arms its skip, so a tag inside the style is instantiated.
  const live = await renderToString(
    html`<div>${unsafeHTML('<a href=></a>')}<comment-probe></comment-probe></div>`
  );
  assert.ok(live.includes('RENDERED'), 'the component after a valueless attribute renders');

  const styled = await renderToString(
    html`<div>${unsafeHTML('<a href=></a><style>/* <comment-probe> */</style><span>after</span>')}</div>`
  );
  assert.ok(!styled.includes('RENDERED'), 'the following style still skips its content');
  assert.ok(styled.includes('<span>after</span>'), 'markup after the style survives');
});

test('a slash ending an unquoted value is not a self-closing solidus', async () => {
  // Per spec `/` is an ordinary character inside an unquoted value, so
  // `<iframe src=/embed/x/>` is NOT self-closing. Reading it as one suppresses
  // the text-only skip and instantiates whatever is inside, which is the
  // destructive direction. `src=https://host/embed/` is a realistic literal.
  const out = await renderToString(
    html`<div>${unsafeHTML('<iframe src=/embed/x/>see <comment-probe> here</iframe><span>after</span>')}</div>`
  );
  assert.ok(!out.includes('RENDERED'), 'the iframe still holds text, not markup');
  assert.ok(out.includes('<span>after</span>'), 'markup after the iframe survives');
});

test('whitespace between = and a quoted value still opens the value', async () => {
  // `title= "..."` is ordinary. If the space is not skipped while waiting for
  // the value, the quote never opens, the tag ends at the first `>` INSIDE the
  // value, and scanning resumes in the middle of an attribute.
  const out = await renderToString(
    html`<div>${unsafeHTML('<div title= "a > b <comment-probe> c"></div>')}<span>after</span></div>`
  );
  assert.ok(!out.includes('RENDERED'), 'the component named inside the value stays inert');
  assert.ok(out.includes('<span>after</span>'), 'markup after it survives');
});

test('a self-closed text-only tag does not swallow the document', async () => {
  // In SVG and MathML foreign content a self-closing tag genuinely closes, so
  // `<svg><title/></svg>` has no `</title` to find. Running the range to EOF
  // there makes every component in the rest of the document inert.
  const out = await renderToString(
    html`<div>${unsafeHTML('<svg><title/></svg>')}<comment-probe></comment-probe></div>`
  );
  assert.ok(out.includes('RENDERED'), 'a component after a self-closed title still renders');
});

test('a close tag is matched on a tag boundary, not a prefix', async () => {
  // `</styleguide>` is not `</style>`. Without the lookahead the style content
  // ends early and the component inside it is instantiated.
  const out = await renderToString(
    html`<div>${unsafeHTML('<style>/* see </styleguide> */ <comment-probe></comment-probe></style>')}<span>after</span></div>`
  );
  assert.ok(!out.includes('RENDERED'), 'a prefix close tag does not end the style');
  assert.ok(out.includes('<span>after</span>'), 'markup after the style survives');
});

test('a literal </plaintext> does not resume scanning', async () => {
  // plaintext has no end tag: a browser reads `</plaintext>` as more text.
  const out = await renderToString(
    html`<div>${unsafeHTML('<plaintext>x</plaintext><comment-probe></comment-probe>')}</div>`
  );
  assert.ok(!out.includes('RENDERED'), 'nothing after plaintext is instantiated, close tag or not');
});

test('a markup declaration does not expose the markup after it', async () => {
  // `<![CDATA[ ... ]]>` and `<!x ...>` are bogus comments that run to the next
  // `>`. Without that branch the bytes inside are scanned as markup.
  const cdata = await renderToString(
    html`<div><![CDATA[ <comment-probe> ]]><span>after</span></div>`
  );
  assert.ok(!cdata.includes('RENDERED'), 'a tag inside CDATA does not render');
  assert.ok(cdata.includes('<span>after</span>'), 'markup after it survives');
});

test('a comment AFTER a real suspense boundary is still mapped correctly', async () => {
  // Pins the `consumed` offset arithmetic. The suspense scanner computes its
  // ranges against the full input but walks a shrinking string, so a boundary
  // consumed earlier has to advance the offset or every later comment is
  // mis-mapped and its contents run. A commented boundary with no real one
  // before it only exercises the offset-zero path.
  const out = await renderToString(html`<div><webjs-suspense>a</webjs-suspense><!-- <webjs-suspense><comment-probe></comment-probe></webjs-suspense> --><span>after</span></div>`);
  assert.ok(!out.includes('RENDERED'), 'the commented boundary after a real one stays inert');
  assert.ok(out.includes('<span>after</span>'), 'markup after it survives');
});

test('a commented-out boundary consumes nothing from the streaming context', async () => {
  // The blocking path is what plain renderToString exercises, so the serious
  // half went untested: under streaming a commented boundary would consume an
  // id, queue a pending chunk, and emit a swap script targeting an element that
  // exists only inside a comment, so it could never resolve and the fallback
  // would sit there forever. Assert the context is untouched.
  const ctx = { pending: [], nextId: 1, usedComponents: new Set() };
  const out = await renderToString(
    html`<div><!-- <webjs-suspense data-webjs-fallback="x"><comment-probe></comment-probe></webjs-suspense> --><span>after</span></div>`,
    { ssr: true, suspenseCtx: ctx },
  );
  assert.equal(ctx.nextId, 1, 'no boundary id was consumed');
  assert.equal(ctx.pending.length, 0, 'nothing was queued to stream');
  assert.equal(ctx.usedComponents.size, 0, 'no component module was marked used');
  assert.ok(!out.includes('data-webjs-resolve'), 'no swap template was emitted');
  assert.ok(out.includes('<span>after</span>'), 'markup after the comment survives');
});

test('a short-form comment does not swallow the slotted children after it', async () => {
  // Pins the partition scanner sharing endOfComment. With a bare indexOf('-->')
  // it runs past a `<!-->` or `--!>` and eats the children, so a slot="head"
  // child is silently routed into the default slot.
  const out = await renderToString(
    // `--!>` is the discriminating form: `<!-->` happens to contain `-->`, so a
    // bare indexOf finds the same end and the test could not fail.
    html`<slot-shell><!-- note --!><b slot="head">HEAD</b><i>BODY</i></slot-shell>`
  );
  assert.ok(out.includes('HEAD'), 'the named-slot child is still projected');
  assert.ok(!out.includes('NO-HEAD'), 'the named slot did not fall back');
});

// #1133: element boundaries. The depth ledger in findClosingTagInString must
// not count a tag inside a comment for EITHER side, or the element's end is
// mis-detected and the surrounding markup shuffles.

test('a commented close tag is not the element end', async () => {
  const out = await renderToString(html`<slot-shell>kid<!-- </slot-shell> --></slot-shell><span>ok</span>`);
  // The whole comment stays inside the projected children, the real close tag
  // still closes, and the trailing span stays OUTSIDE the component.
  assert.ok(out.includes('kid<!-- </slot-shell> -->'), 'the comment rides the children intact');
  assert.ok(/<\/slot-shell><span>ok<\/span>/.test(out), 'the span lands after the real close');
});

test('a commented open tag does not inflate the nesting depth', async () => {
  const out = await renderToString(html`<slot-shell>kid<!-- <slot-shell> --></slot-shell><span>ok</span>`);
  assert.ok(/<\/slot-shell><span>ok<\/span>/.test(out), 'depth returns to zero at the real close');
});

test('a commented slot close tag does not truncate the fallback', async () => {
  const out = await renderToString(html`<slot-in-comment><b>kid</b></slot-in-comment>`);
  assert.ok(out.includes('<b>kid</b>'), 'children still project');
  // And a fallback that documents its own close tag in a comment:
  const out2 = await renderToString(html`<slot-shell></slot-shell>`);
  assert.ok(out2.includes('NO-HEAD'), 'the named fallback renders when nothing is slotted');
});

// #1134: script data is not plain raw text. `<!--` + `<script` enters the
// double-escaped state, where `</script>` is TEXT and the element ends at the
// NEXT one. The legacy comment-wrapped inline script produces exactly this.

test('a double-escaped script body stays text to its real end', async () => {
  const out = await renderToString(html`<div><script type="text/plain"><!-- <script> </script> <comment-probe></comment-probe> --></script><span>after</span></div>`);
  assert.ok(!out.includes('RENDERED'), 'the tag inside the double-escaped body is text');
  assert.ok(out.includes('<span>after</span>'), 'markup after the script survives');
});

test('an ordinary script still ends at its first close tag', async () => {
  const out = await renderToString(
    html`<div><script>var a = 1;</script><comment-probe></comment-probe></div>`
  );
  assert.ok(out.includes('RENDERED'), 'scanning resumes at the first </script> when not escaped');
  // And an escaped-but-not-double-escaped body (just a <!--, no inner <script)
  // also ends at its first close tag, which is what a browser does.
  const esc = await renderToString(
    html`<div><script>var a = "<!--";</script><comment-probe></comment-probe></div>`
  );
  assert.ok(esc.includes('RENDERED'), 'a lone <!-- in a script does not defer the close');
});

test('a comment naming a boundary and a text-only tag does not derail a real boundary after it', async () => {
  // The suspense scanner skips a commented boundary and re-slices its input
  // just past the match, which can land MID-comment. The close-tag search for
  // the next REAL boundary must therefore use ranges computed on the full
  // input, not a re-tokenization of the suffix: restarted mid-comment, a
  // text-only opener named later in that comment (here <textarea>) read as a
  // real unclosed element, everything to EOF went inert, and the boundary
  // swallowed its own close tag plus the trailing markup.
  const out = await renderToString(html`<div><!-- a <webjs-suspense> demo uses <textarea> input --><webjs-suspense><comment-probe></comment-probe></webjs-suspense><span>after</span></div>`);
  assert.ok(out.includes('RENDERED'), 'the real boundary renders its children');
  // The discriminators, chosen so a swallowed close tag cannot fake a pass:
  // the failure emits inner + a SYNTHESIZED close, so the tag count doubles
  // and the document ends with the synthesized `</webjs-suspense>` instead of
  // the real `</div>`.
  assert.equal((out.match(/<\/webjs-suspense>/g) || []).length, 1,
    'exactly one boundary close tag (no synthesized duplicate)');
  assert.ok(out.endsWith('</div>'), 'the trailing markup stays outside the boundary');
});

test('the <!--> short form inside a script cancels the escape', async () => {
  // The dash-dash state entered by <!-- exits straight back to plain script
  // data on >, so a lone "<!-->" in a script does NOT arm the double-escape:
  // even with a "<script>" string later in the body, the element ends at its
  // first </script>, which is where a browser ends it.
  const out = await renderToString(
    html`<div>${unsafeHTML('<script>var x = "<!-->"; var y = "<script>";</script>')}<comment-probe></comment-probe></div>`
  );
  assert.ok(out.includes('RENDERED'), 'the component after the script still renders');
});

test('a <!--> exit inside an already-escaped script clears both escape flags', async () => {
  // The token's trailing dashes reach the dash-dash state from EVERY script
  // state, and dash-dash exits to plain data on `>`. Missing the exit when
  // already escaped meant a later "<script" string armed the double-escape
  // and the element end moved past its real close, silently unrendering every
  // component after the script. A browser renders this probe.
  const out = await renderToString(
    html`<div>${unsafeHTML('<script>a<!--b<!--><script></script>')}<comment-probe></comment-probe></div>`
  );
  assert.ok(out.includes('RENDERED'), 'the component after the script still renders');
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
