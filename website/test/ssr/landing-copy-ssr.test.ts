/**
 * The landing page used to carry an intro video, first as a YouTube iframe and
 * then (#1440) as a native player pointed at videos.webjs.dev. It is gone.
 *
 * The bytes are still in the R2 bucket `webjs-videos`, so restoring the section
 * is an editorial call rather than a re-upload. What these assertions pin is
 * that it does not come back by accident: an embed added to any of the shared
 * section helpers would land on this page without anyone editing it here.
 *
 * The copy assertions cover the one-line definition of WebJs, which is
 * duplicated across the visible lede, the meta description, and the OG-image
 * generator. Pinning the rendered wording is what catches a partial edit that
 * leaves the search snippet contradicting the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@webjsdev/core/server';
import LandingPage from '#app/page.ts';

const render = () => renderToString(LandingPage());

test('the landing page embeds no video of any kind', async () => {
  const out = await render();
  assert.doesNotMatch(out, /<video/, 'no native player');
  assert.doesNotMatch(out, /<iframe/, 'no embed of any kind');
  assert.doesNotMatch(out, /videos\.webjs\.dev/, 'no reference to the video host');
  assert.doesNotMatch(out, /youtube-nocookie|youtube\.com\/embed/i, 'no embed url');
  assert.doesNotMatch(out, /intro-video/, 'no leftover section or styling hook');
});

test('the hero lede leads with what WebJs is, without the AI-first label', async () => {
  const out = await render();
  assert.match(
    out,
    /WebJs is a full-stack JavaScript web components framework with no build step\./,
  );
  assert.doesNotMatch(out, /AI-first full-stack/, 'the adjective is out of the definition');
});

test('the web-components section pays its DX claim in checkable nouns', async () => {
  const out = await render();
  // The heading promises "better DX", which is the one kind of claim this
  // section's own rules forbid leaving unpaid: it needs a baseline the page
  // never states. The lede has to cash it in things the stage below visibly
  // does, so pin those rather than the adjective.
  assert.match(out, /Native web components the browser already understands/);
  for (const paid of ['custom element', 'signals', 'decorator', 'build step']) {
    assert.ok(out.includes(paid), `the lede pays the DX claim with ${paid}`);
  }
});

test('the progressive-enhancement and elision claims survive the heading change', async () => {
  const out = await render();
  // The section stopped LEADING with these when it was renamed. They are still
  // the only place the page states either, and the P.S. dare below invites the
  // reader to check the first one, so a chip going missing is a real loss and
  // not a copy tidy.
  assert.ok(out.includes('Reads and submits before JS'), 'the no-JS claim is still on the page');
  assert.ok(out.includes('Display components ship 0 KB'), 'the elision claim is still on the page');
  assert.ok(out.includes('No whole-page hydration'), 'the precise hydration wording, not a shorter one');
  assert.doesNotMatch(out, /No hydration (runtime|overhead)/, 'those read as zero cost and are false');
  assert.ok(out.includes('P.S. Turn JavaScript off'), 'the dare that lets a reader verify it');
});
