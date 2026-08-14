/**
 * Light DOM hydration tests: runs in a REAL browser via WTR + Playwright.
 * Verifies that the client renderer correctly handles server-rendered
 * light DOM content (marked by <!--webjs-hydrate-->).
 *
 * Strategy: SSR content is replaced with identical client-rendered content.
 * No visible flash because the output is the same. Events are bound by
 * the normal render path.
 */
import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';

import { assert } from '../../../../../test/browser-assert.js';

suite('Light DOM hydration', () => {
  test('hydration marker is removed and content renders correctly', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    // Simulate SSR output
    el.innerHTML = '<!--webjs-hydrate--><p>hello world</p>';
    assert.ok(el.querySelector('p'), 'SSR content should exist');

    // Client render: removes marker, renders normally
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

/**
 * MutationObserver safety net: the router keeps a global observer that upgrades
 * custom elements it sees inserted.
 *
 * Read what this asserts narrowly (#1406). It pins the END STATE, that an
 * element inserted after the router is imported ends up constructed and
 * connected. It does NOT isolate the observer, because the platform already
 * upgrades this exact case on its own: measured in Chromium, Firefox, and
 * WebKit, inserting an element whose definition is registered upgrades it
 * synchronously, whether it arrives by `innerHTML`, by `replaceChildren`, or
 * by importing a node out of a detached parse, and a later
 * `customElements.define` upgrades matching elements already in the document.
 * So this test would still pass with the observer removed.
 *
 * That is left as-is rather than rewritten around a case the platform does not
 * cover, because no such case has been measured here, and a test built on a
 * guessed one would be worse than a narrow one that is honest about its reach.
 */
suite('Custom element upgrade safety net', () => {
  test('importing router-client upgrades custom elements inserted later', async () => {
    // Import router-client (auto-enables on import: sets up MutationObserver).
    await import('../../../src/router-client.js');

    // Define a custom element AFTER the router is enabled.
    const tagName = 'safety-net-test-el';
    let constructed = 0;
    let connected = 0;
    if (!customElements.get(tagName)) {
      customElements.define(tagName, class extends HTMLElement {
        constructor() { super(); constructed++; }
        connectedCallback() { connected++; this.textContent = 'upgraded'; }
      });
    }

    // Insert through `innerHTML` rather than `document.createElement`, which
    // constructs the element itself and so would not exercise insertion at
    // all. Note this still upgrades synchronously on its own (see the suite
    // comment); the assertions below are about the end state, not about which
    // mechanism delivered it.
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = `<${tagName}></${tagName}>`;

    // Give the MutationObserver a tick to fire.
    await new Promise((r) => setTimeout(r, 50));

    const el = host.querySelector(tagName);
    assert.ok(el, 'custom element exists in DOM');
    assert.ok(constructed >= 1, 'constructor ran at least once');
    assert.ok(connected >= 1, 'connectedCallback ran at least once');
    assert.equal(el.textContent, 'upgraded');

    host.remove();
  });
});
