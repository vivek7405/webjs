// Co-located browser test for the <counter-card> component. This is the webjs
// component-test SHAPE, so copy it for your own components:
//   - It runs in REAL Chromium (webjs test --browser, or npx wtr), not jsdom. If
//     the browser binary is missing, install it once: npx playwright install chromium.
//   - The runner's mocha UI is `tdd`, so use suite() / test(), NOT describe / it().
//   - There is NO assertion library in the importmap (no chai, no expect). Throw
//     to fail. A tiny inline `assert` is plenty.
//   - `ssrFixture` server-renders AND hydrates the component, so you exercise the
//     REAL SSR output and the client interactivity, not a jsdom approximation.
// It lives NEXT TO the component (a `browser/` dir inside the module), the
// co-located default; the runner discovers browser tests under any browser dir.
import { html, render } from '@webjsdev/core';
import { ssrFixture } from '@webjsdev/core/testing';
import '../counter-card.ts';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

suite('<counter-card>', () => {
  test('SSRs its initial state and the default label', async () => {
    const el = await ssrFixture(html`<counter-card></counter-card>`);
    assert(el.textContent.includes('0'), 'the count starts at 0');
    assert(el.textContent.includes('Clicks'), 'the default label renders');
  });

  test('render() mounts a template imperatively into a container', async () => {
    // render(value, container) is the client-side imperative render: mount a
    // WebJs template into any DOM node (a portal, a plain page). Components
    // render themselves, so reach for this only when you need to drive the
    // mount point yourself. The container must be CONNECTED to the document, or
    // the custom element never upgrades (connectedCallback, and so its first
    // render, only fire on connection).
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      render(html`<counter-card label="Imperative"></counter-card>`, container);
      const el = container.querySelector('counter-card');
      assert(el, 'the element mounts into the container');
      await el.updateComplete; // wait for the component's first client render
      assert(container.textContent.includes('Imperative'), 'the label renders');
    } finally {
      container.remove();
    }
  });

  test('reads the label reactive prop', async () => {
    const el = await ssrFixture(html`<counter-card label="Taps"></counter-card>`);
    assert(el.textContent.includes('Taps'), 'the provided label renders');
  });

  test('increments on click (hydrated interactivity)', async () => {
    const el = await ssrFixture(html`<counter-card></counter-card>`);
    el.querySelector('button').click();
    await el.updateComplete;
    assert(el.textContent.includes('1'), 'the count becomes 1 after one click');
  });
});
