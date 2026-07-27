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

test('the framework own hydration marker does not hide a sibling component', async () => {
  // injectDSD recurses over output that already contains `<!--webjs-hydrate-->`
  // and the client router's `<!--wj:children:...-->` boundary pairs. Those are
  // well-formed comments, so they must not start a region that swallows the
  // components rendered after them.
  const out = await renderToString(
    html`<div><comment-probe></comment-probe><comment-probe></comment-probe></div>`
  );
  assert.equal(out.match(/RENDERED/g)?.length, 2, 'both siblings render past the first hydrate marker');
});
