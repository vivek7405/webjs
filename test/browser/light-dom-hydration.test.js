/**
 * Light DOM hydration tests — runs in a REAL browser via WTR + Playwright.
 * Verifies that the client renderer correctly handles server-rendered
 * light DOM content (marked by <!--webjs-hydrate-->).
 *
 * Strategy: SSR content is replaced with identical client-rendered content.
 * No visible flash because the output is the same. Events are bound by
 * the normal render path.
 */
import { html } from '../../packages/core/src/html.js';
import { render } from '../../packages/core/src/render-client.js';

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`); },
};

suite('Light DOM hydration', () => {
  test('hydration marker is removed and content renders correctly', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    // Simulate SSR output
    el.innerHTML = '<!--webjs-hydrate--><p>hello world</p>';
    assert.ok(el.querySelector('p'), 'SSR content should exist');

    // Client render — removes marker, renders normally
    render(html`<p>hello ${'world'}</p>`, el);

    assert.ok(el.querySelector('p'), '<p> should exist after render');
    assert.equal(el.querySelector('p').textContent, 'hello world');
    // Hydration marker should be gone
    assert.ok(!el.innerHTML.includes('webjs-hydrate'), 'marker should be removed');

    el.remove();
  });

  test('event handlers work after hydration', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    // Simulate SSR output
    el.innerHTML = '<!--webjs-hydrate--><button>click me</button>';

    let clicked = false;
    render(html`<button @click=${() => { clicked = true; }}>click me</button>`, el);

    el.querySelector('button').click();
    assert.ok(clicked, 'click handler should fire after hydration');

    el.remove();
  });

  test('subsequent renders diff normally', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    // Simulate SSR output
    el.innerHTML = '<!--webjs-hydrate--><p>count: 1</p>';

    // First render: hydrate
    const tpl = (n) => html`<p>count: ${n}</p>`;
    render(tpl(1), el);

    const hydratedP = el.querySelector('p');
    assert.equal(hydratedP.textContent, 'count: 1');

    // Second render: diff update (same template, new value)
    render(tpl(42), el);

    const updatedP = el.querySelector('p');
    // Same element reused by the diffing algorithm
    assert.equal(updatedP, hydratedP, '<p> should be reused across diff');
    assert.equal(updatedP.textContent, 'count: 42');

    el.remove();
  });
});
