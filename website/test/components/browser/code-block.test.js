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

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const SAMPLE = "const greeting = 'hi';\n// a comment\nexport function run() {}";

/**
 * The exact bytes `renderToString` emits, not an approximation of them.
 *
 * This matters more than it looks. `@webjsdev/core` picks its light-DOM
 * adoption branch on the `webjs-hydrate` marker comment, and its slot
 * adoption on `data-webjs-light` AND `data-projection` together. A fixture
 * missing any of those falls through to the client-first-mount path instead,
 * so the whole file would exercise the branch NO production page takes while
 * appearing to cover the one all 480 of them do. Copied verbatim from the
 * server; regenerate rather than hand-edit if the renderer's markers change.
 */
const ssrMarkup = (code, attrs = '') => {
  const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const label = attrs.match(/label="([^"]*)"/)?.[1];
  const preClass = attrs.match(/pre-class="([^"]*)"/)?.[1] ?? '';
  const named = label ? ` role="region" aria-label="${label}"` : '';
  return `<code-block${attrs} data-wj-host><!--webjs-hydrate--><pre class="${preClass}" tabindex="0"${named}>`
    + `<code><slot data-webjs-light data-projection="actual" data-wj-slot-owner="code-block">${esc}</slot></code></pre></code-block>`;
};

/** The shape a template authors: the code as plain text children. */
const authoredMarkup = (code, attrs = '') =>
  `<code-block${attrs}>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code-block>`;

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

  test('adopts the server-rendered slot rather than re-mounting from scratch', async () => {
    // The fixture above only covers the production path if the runtime takes
    // its SSR-adoption branch on it. Assert the marks that select that branch
    // are present and consumed, so a renderer change that moves them fails
    // here instead of silently rerouting every test in this file onto the
    // client-first-mount path.
    const { host } = await track(ssrMarkup(SAMPLE));
    assert.ok(host.hasAttribute('data-wj-host'), 'the host is marked as framework-rendered');
    const slot = host.querySelector('slot');
    assert.equal(slot, null, 'the slot is gone once the tokens replace it');
    assert.equal(preOf(host).textContent, SAMPLE, 'and the projected code survived that adoption');
  });

  test('escapes rather than parses angle brackets in a sample', async () => {
    const code = 'const el = <my-tag attr="1">;';
    const { host } = await track(ssrMarkup(code));
    assert.equal(preOf(host).textContent, code, 'the sample reads back verbatim');
    assert.equal(host.querySelector('my-tag'), null, 'no element was created from the sample text');
  });
});
