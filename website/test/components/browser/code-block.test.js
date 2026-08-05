/**
 * Browser tests for <code-block>, the one code sample on the site.
 *
 * These exist because the behaviour they cover only appears after upgrade.
 * The element replaced a site-wide static script whose MutationObserver on
 * document.body was the only thing that made a soft navigation into or
 * between docs pages highlight anything, so the test that matters most is the
 * one that inserts blocks AFTER load and asserts they colour themselves with
 * no observer anywhere: that is the whole reason for being an element.
 *
 * The "exactly once" assertions are the other half. A re-run over an
 * already-highlighted block used to be prevented by a data-hl attribute, and
 * dropping that guard along with the observer is only safe if a second pass
 * cannot double the content.
 */
import '#components/code-block.ts';
import { ssrMarkup, authoredMarkup, BROWSER_SAMPLES } from '#test/fixtures/code-block-markup.js';

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// Shared with the SSR drift guard, which asserts the fixture matches real
// server output for these exact strings. Defining them here instead would let
// the two drift apart, which is the whole failure the guard exists to catch.
const SAMPLE = BROWSER_SAMPLES.multiline;

async function mount(markup) {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  document.body.appendChild(holder);
  const host = holder.querySelector('code-block');
  await customElements.whenDefined('code-block');
  await host.updateComplete;
  await tick();
  return { holder, host };
}

const preOf = (host) => host.querySelector('pre');
const tokens = (host) => [...host.querySelectorAll('span[class^="t-"]')];

suite('code-block', () => {
  let mounted = [];
  const track = async (markup) => { const m = await mount(markup); mounted.push(m.holder); return m; };
  teardown(() => { mounted.forEach((h) => h.remove()); mounted = []; });

  test('renders a keyboard-reachable pre and colours the code', async () => {
    const { host } = await track(ssrMarkup(SAMPLE));
    const pre = preOf(host);
    assert.ok(pre, 'the element renders a pre');
    assert.equal(pre.getAttribute('tabindex'), '0', 'the scroll container is a focus stop');
    assert.equal(pre.textContent, SAMPLE, `the code survives tokenizing unchanged, got ${JSON.stringify(pre.textContent)}`);
    assert.ok(tokens(host).length > 3, `expected token spans, found ${tokens(host).length}`);
    assert.ok(host.querySelector('span.t-kw'), 'keywords are coloured');
    assert.ok(host.querySelector('span.t-str'), 'strings are coloured');
    assert.ok(host.querySelector('span.t-com'), 'comments are coloured');
  });

  test('reaches the same result from the authored shape as from the served one', async () => {
    const { host: fromServer } = await track(ssrMarkup(SAMPLE));
    const { host: fromTemplate } = await track(authoredMarkup(SAMPLE));
    assert.equal(preOf(fromTemplate).textContent, preOf(fromServer).textContent, 'same text either way');
    assert.equal(tokens(fromTemplate).length, tokens(fromServer).length, 'same token count either way');
  });

  test('an unnamed block carries no name at all, since ARIA prohibits one on a pre', async () => {
    const { host } = await track(ssrMarkup(SAMPLE));
    const pre = preOf(host);
    assert.equal(pre.hasAttribute('aria-label'), false, 'no name');
    assert.equal(pre.hasAttribute('role'), false, 'and so no region role either');
  });

  test('a named block takes the role that permits the name', async () => {
    const { host } = await track(ssrMarkup(SAMPLE, ' label="root layout"'));
    const pre = preOf(host);
    assert.equal(pre.getAttribute('aria-label'), 'root layout');
    assert.equal(pre.getAttribute('role'), 'region');
  });

  test('extra classes land on the pre, which is the element that scrolls', async () => {
    const { host } = await track(ssrMarkup(SAMPLE, ' pre-class="max-h-120 overflow-y-auto"'));
    assert.ok(preOf(host).classList.contains('overflow-y-auto'), 'the scroll container carries the class');
  });

  test('highlights blocks inserted after load, with no observer anywhere', async () => {
    // The soft-navigation case: the client router swaps new content in, and
    // the elements in it upgrade on insertion. This is what the deleted
    // script needed a document.body MutationObserver to achieve.
    const region = document.createElement('div');
    document.body.appendChild(region);
    mounted.push(region);

    region.innerHTML = `${ssrMarkup(SAMPLE)}${ssrMarkup(SAMPLE)}`;
    const blocks = [...region.querySelectorAll('code-block')];
    assert.equal(blocks.length, 2, 'two blocks arrived');
    await Promise.all(blocks.map((b) => b.updateComplete));
    await tick();
    for (const block of blocks) {
      assert.equal(preOf(block).textContent, SAMPLE, 'a late-arriving block keeps its code');
      assert.ok(block.querySelector('span.t-kw'), 'a late-arriving block is coloured');
    }

    // And again, the way navigating BETWEEN two docs pages replaces content
    // inside a container that itself stays put.
    region.innerHTML = ssrMarkup(SAMPLE);
    const second = region.querySelector('code-block');
    await second.updateComplete;
    await tick();
    assert.equal(preOf(second).textContent, SAMPLE);
    assert.ok(second.querySelector('span.t-kw'), 'the replacement block is coloured');
  });

  test('re-connecting does not double the content', async () => {
    // Without the old data-hl attribute, nothing outside the element stops a
    // second pass. What stops it is that the second read sees the text it
    // already rendered, so the result is identical rather than doubled.
    const { holder, host } = await track(ssrMarkup(SAMPLE));
    const before = tokens(host).length;
    const parent = host.parentElement;
    host.remove();
    parent.appendChild(host);
    host.requestUpdate();
    await host.updateComplete;
    await tick();
    assert.equal(preOf(host).textContent, SAMPLE, 'the code is not repeated');
    assert.equal(tokens(host).length, before, 'the token count is unchanged');
    assert.equal(holder.querySelectorAll('pre').length, 1, 'still one pre');
  });

  test('escapes rather than parses angle brackets in a sample', async () => {
    const code = BROWSER_SAMPLES.angleBrackets;
    const { host } = await track(ssrMarkup(code));
    assert.equal(preOf(host).textContent, code, 'the sample reads back verbatim');
    assert.equal(host.querySelector('my-tag'), null, 'no element was created from the sample text');
  });
});
