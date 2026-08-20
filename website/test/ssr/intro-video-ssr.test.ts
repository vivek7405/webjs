/**
 * The landing page's intro video is self-hosted, not embedded.
 *
 * It replaced a YouTube iframe whose every property was a workaround for
 * being cross-origin: a frame hidden until load (an iframe paints its own
 * canvas, opaque white on some engines, before the embedded stylesheet
 * lands), a plain onload attribute to reveal it (this page never hydrates, so
 * an event hole would be dropped at SSR), and a noscript rule that deleted
 * the whole section for a JS-off reader (their player needs JS inside the
 * frame, so revealing it would have shown their own error).
 *
 * A native player needs none of that, and the assertions below pin the pieces
 * that silently break it if they go missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@webjsdev/core/server';
import LandingPage from '#app/page.ts';

const render = () => renderToString(LandingPage());

test('the intro video is a native player pointed at our own host', async () => {
  const out = await render();
  assert.match(out, /<video[^>]*\ssrc="https:\/\/videos\.webjs\.dev\/intro\.mp4"/);
  assert.match(out, /<video[^>]*\scontrols/, 'the controls are the whole no-JS story');
});

test('the first paint shows a poster rather than a black box', async () => {
  const out = await render();
  // Without this the box is empty until someone presses play, which is worse
  // than the embed it replaced.
  assert.match(out, /<video[^>]*\sposter="https:\/\/videos\.webjs\.dev\/intro-poster\.webp"/);
});

test('the bytes stay off the wire until someone plays it', async () => {
  const out = await render();
  // The file is 85 MB. Without preload=metadata a page view fetches it.
  assert.match(out, /<video[^>]*\spreload="metadata"/);
  // iOS Safari otherwise takes the video fullscreen the moment it plays.
  assert.match(out, /<video[^>]*\splaysinline/);
});

test('none of the cross-origin workarounds survive', async () => {
  const out = await render();
  assert.doesNotMatch(out, /<iframe/, 'no embed of any kind');
  assert.doesNotMatch(out, /youtube/i);
  assert.doesNotMatch(out, /intro-video-frame/);
  assert.doesNotMatch(out, /onload="this\.classList\.remove/);
});

test('a JS-off reader gets the video, not a deleted section', async () => {
  const out = await render();
  // The old markup hid the section outright. A native player works with
  // scripting disabled, so the rule that removed it has to be gone.
  assert.doesNotMatch(out, /\.intro-video \{ display: none \}/);
  assert.match(out, /<section class="intro-video /, 'the section still renders');
});
