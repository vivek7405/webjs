/**
 * Browser tests for the <video-embed> element.
 *
 * The element exists to keep a cross-origin YouTube frame off the page until
 * the reader asks for it, because such a frame paints its own canvas and that
 * canvas came up white on a dark phone before the embedded stylesheet applied.
 * So the load-bearing assertion is the NEGATIVE one: before the click there is
 * no player frame in the tree. A test that only checked the post-click swap
 * would still pass if the poster shipped a live frame behind it, which is the
 * exact defect this element was written to remove.
 *
 * The poster's own <img> is never awaited. It points at i.ytimg.com, and a
 * test that waits on the network is a test that fails on a plane. What matters
 * here is which element is in the tree, not whether the bytes arrived.
 */
import '#components/video-embed.ts';

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const mount = async (attrs = 'videoid="abc123" label="Intro video"') => {
  const host = document.createElement('div');
  host.innerHTML = `<video-embed ${attrs}></video-embed>`;
  document.body.append(host);
  const el = host.firstElementChild;
  await customElements.whenDefined('video-embed');
  await el.updateComplete;
  return { host, el, cleanup: () => host.remove() };
};

suite('video-embed', () => {
  test('renders a poster button and no live player before the click', async () => {
    const { el, cleanup } = await mount();

    const btn = el.querySelector('button');
    assert.ok(btn, 'expected a poster button');
    assert.equal(btn.getAttribute('aria-label'), 'Play Intro video');

    const img = el.querySelector('img');
    assert.ok(img, 'expected a poster image');
    assert.equal(img.getAttribute('src'), 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg');

    // The <noscript> body is inert markup while scripting is enabled, so the
    // only frame querySelector can reach must be inside it. Anything outside
    // would be a frame the browser is really loading.
    const frames = [...el.querySelectorAll('iframe')];
    const live = frames.filter((f) => !f.closest('noscript'));
    assert.equal(live.length, 0, 'no player frame may exist before the click');

    cleanup();
  });

  test('client render emits no noscript and no style element', async () => {
    const { el, cleanup } = await mount();

    // The regression this guards: the fallback used to be rendered on BOTH
    // sides. In a template, scripting is disabled, so the noscript body
    // becomes real elements, and a style element applies wherever it sits in
    // the DOM. Its rule hid the poster button on every JS-enabled visit, so
    // the embed looked like it had vanished. The server half of the fallback
    // is covered in test/ssr/video-embed-ssr.test.ts.
    assert.equal(el.querySelectorAll('noscript').length, 0, 'client render must emit no noscript');
    assert.equal(el.querySelectorAll('style').length, 0, 'client render must emit no style element');

    const btn = el.querySelector('button');
    assert.ok(btn, 'the poster button must survive the client render');
    assert.ok(
      getComputedStyle(btn).display !== 'none',
      'the poster button must not be hidden by the component\'s own markup',
    );

    cleanup();
  });

  test('swaps in the autoplaying player on click', async () => {
    const { el, cleanup } = await mount();

    el.querySelector('button').click();
    await el.updateComplete;
    await tick();

    const frame = [...el.querySelectorAll('iframe')].find((f) => !f.closest('noscript'));
    assert.ok(frame, 'expected the player frame after the click');
    assert.equal(
      frame.getAttribute('src'),
      'https://www.youtube-nocookie.com/embed/abc123?rel=0&autoplay=1',
    );
    assert.equal(frame.getAttribute('title'), 'Intro video');
    assert.ok(!el.querySelector('button'), 'the poster should be gone once playing');

    cleanup();
  });
});
