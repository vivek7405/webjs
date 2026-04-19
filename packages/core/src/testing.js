/**
 * Testing utilities for webjs components.
 *
 * **When to use (AI hint):** Import from `'@webjskit/core/testing'` in test files
 * to create, render, and interact with web components in a Node.js test
 * environment using linkedom (a lightweight DOM implementation).
 *
 * ```js
 * import { fixture, waitForUpdate } from '@webjskit/core/testing';
 * import { html } from '@webjskit/core';
 *
 * const el = await fixture(html`<my-counter count="5"></my-counter>`);
 * assert.equal(el.shadowRoot.textContent.trim(), '5');
 *
 * el.setAttribute('count', '10');
 * await waitForUpdate(el);
 * assert.equal(el.shadowRoot.textContent.trim(), '10');
 * ```
 *
 * @module testing
 */

/**
 * Create a component from a TemplateResult, connect it to a DOM,
 * and wait for its first render to complete.
 *
 * Uses linkedom (if available) to create a minimal DOM environment
 * in Node.js. Falls back to the global `document` in a browser.
 *
 * **When to use (AI hint):** Use `fixture()` in unit tests to quickly
 * mount a component and assert against its rendered shadow DOM.
 * This is the primary test helper — start every component test with it.
 *
 * @param {import('./html.js').TemplateResult | string} template
 *   Either a `html\`…\`` result or a raw HTML string.
 * @returns {Promise<Element>} The first child element of the rendered container.
 */
export async function fixture(template) {
  const container = getContainer();
  if (typeof template === 'string') {
    container.innerHTML = template;
  } else if (template && typeof template === 'object' && template._$webjs === 'template') {
    // Render using the server renderer to produce HTML with DSD,
    // then parse it into the container.
    const { renderToString } = await import('./render-server.js');
    const html = await renderToString(template, { ssr: true });
    container.innerHTML = html;
  } else {
    throw new Error('fixture() expects an html`…` template or an HTML string');
  }

  // Wait a microtask for component connectedCallback + first render
  await new Promise((r) => setTimeout(r, 0));

  const el = container.firstElementChild;
  if (!el) throw new Error('fixture() produced no element');
  return el;
}

/**
 * Wait for a component's next render cycle to complete.
 *
 * **When to use (AI hint):** Call after `setAttribute()`, `setState()`,
 * or any change that triggers a re-render. The re-render is async
 * (microtask-batched), so you need to await before asserting.
 *
 * @param {Element} el  The component element.
 * @returns {Promise<void>}
 */
export async function waitForUpdate(el) {
  // WebComponent batches via queueMicrotask, so two microtask yields
  // is sufficient: one for the setState queueMicrotask, one for any
  // cascading updates.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * Simulate a click event on an element.
 *
 * **When to use (AI hint):** Use to test click handlers in components
 * without a real browser. Works with elements inside shadow DOM.
 *
 * @param {Element} el  The element to click.
 */
export function click(el) {
  el.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
}

/**
 * Query an element inside a component's shadow root.
 *
 * **When to use (AI hint):** Shorthand for `el.shadowRoot.querySelector(sel)`.
 * Returns null if no shadow root or no match.
 *
 * @param {Element} el  The component host element.
 * @param {string} selector  CSS selector.
 * @returns {Element | null}
 */
export function shadowQuery(el, selector) {
  return el.shadowRoot?.querySelector(selector) ?? null;
}

/**
 * Get all matching elements inside a component's shadow root.
 *
 * @param {Element} el  The component host element.
 * @param {string} selector  CSS selector.
 * @returns {NodeList}
 */
export function shadowQueryAll(el, selector) {
  return el.shadowRoot?.querySelectorAll(selector) ?? [];
}

/* ------------------------------------------------------------------ */
/* Internal: DOM container management                                  */
/* ------------------------------------------------------------------ */

let _doc = null;
let _container = null;

function getContainer() {
  if (_container) {
    _container.innerHTML = '';
    return _container;
  }

  // Browser environment
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    _container = document.createElement('div');
    document.body?.appendChild(_container);
    return _container;
  }

  // Node.js environment — use linkedom
  try {
    const { parseHTML } = /** @type {any} */ (
      // Dynamic import syntax can't be used in a sync function,
      // but linkedom is a CJS package that works with createRequire.
      (() => {
        const { createRequire } = /** @type {any} */ (globalThis).__webjs_require ||
          (() => { throw new Error('no require'); })();
        return createRequire(import.meta.url)('linkedom');
      })()
    );
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    _doc = doc;
    _container = doc.createElement('div');
    doc.body.appendChild(_container);
    return _container;
  } catch {
    throw new Error(
      'fixture() requires a DOM environment. In Node.js, install linkedom: npm i -D linkedom'
    );
  }
}
