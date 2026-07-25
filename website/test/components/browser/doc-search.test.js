/**
 * Browser tests for the <doc-search> element in the docs sidebar.
 *
 * It moved apps with the docs (#1098), and the endpoint behind it was
 * rewritten to index off the same extraction the llms.txt routes use rather
 * than its own filesystem walk. Neither change is visible from an SSR
 * assertion: the component only does anything once it hydrates, debounces,
 * and renders a dropdown, so this is the layer that proves it still works.
 *
 * `fetch` is stubbed so the test asserts the component's behaviour (debounce,
 * dropdown states, navigation) rather than the search ranking, which is a
 * server concern covered separately. It also keeps the test deterministic
 * with no server running.
 */
import '#components/doc-search.ts';

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** The component debounces by 200ms before fetching. */
const DEBOUNCE = 200;
const afterSearch = () => tick(DEBOUNCE + 80);

suite('doc-search', () => {
  let el;
  let realFetch;
  let calls;
  let results;

  setup(async () => {
    calls = [];
    results = [
      { path: '/docs/routing', title: 'Routing', score: 10, snippet: 'file-based routing…' },
      { path: '/docs/components', title: 'Components', score: 5, snippet: 'custom elements…' },
    ];
    realFetch = window.fetch;
    window.fetch = async (url) => {
      calls.push(String(url));
      return { json: async () => results };
    };

    el = document.createElement('doc-search');
    document.body.appendChild(el);
    await el.updateComplete;
  });

  teardown(() => {
    window.fetch = realFetch;
    el?.remove();
  });

  const input = () => el.querySelector('input[type="search"]');

  async function type(value) {
    const field = input();
    field.value = value;
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await el.updateComplete;
  }

  test('renders a search input', () => {
    assert.ok(input(), 'the search field is in the light DOM');
    assert.equal(input().getAttribute('placeholder'), 'Search docs…');
  });

  test('a query under two characters never hits the endpoint', async () => {
    await type('r');
    await afterSearch();
    assert.equal(calls.length, 0, 'one character is not worth a request');
  });

  test('a real query hits the search endpoint with the term encoded', async () => {
    await type('client router');
    await afterSearch();
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('/api/search?q=client%20router'), `unexpected URL: ${calls[0]}`);
  });

  test('results render as links to their doc pages', async () => {
    await type('routing');
    await afterSearch();
    await el.updateComplete;

    const links = [...el.querySelectorAll('a')];
    assert.equal(links.length, 2);
    assert.equal(links[0].getAttribute('href'), '/docs/routing');
    assert.ok(links[0].textContent.includes('Routing'));
    assert.ok(links[0].textContent.includes('file-based routing'), 'the snippet is shown');
  });

  test('an empty result set says so instead of rendering nothing', async () => {
    results = [];
    await type('zzzzzz');
    await afterSearch();
    await el.updateComplete;
    assert.ok(el.textContent.includes('No results'), 'the empty state is explicit');
  });

  test('typing again supersedes the previous query', async () => {
    // The component keys the response against the CURRENT query, so a slow
    // first response must not repaint the dropdown after the user moved on.
    await type('ro');
    await type('routing');
    await afterSearch();
    await el.updateComplete;
    assert.equal(calls.length, 1, 'the superseded query was debounced away');
    assert.ok(calls[0].includes('q=routing'));
  });
});
