/**
 * Example browser test — runs in real Chromium via WTR + Playwright.
 *
 * Run:  webjs test --browser
 *       npx wtr
 *
 * Tests here have full access to real browser APIs: Shadow DOM,
 * adoptedStyleSheets, IntersectionObserver, events, etc.
 */

const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`); },
};

suite('Example browser tests', () => {
  test('DOM is real (not jsdom/linkedom)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    assert.ok(el.isConnected, 'Element should be connected to real DOM');
    el.remove();
  });

  test('Shadow DOM works', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>inside shadow</p>';
    assert.ok(shadow.querySelector('p'));
    assert.ok(!host.querySelector('p'), 'Shadow content not in light DOM');
  });

  // Replace with your component tests:
  // test('my-widget renders correctly', () => {
  //   import('../../components/my-widget.ts');
  //   const el = document.createElement('my-widget');
  //   document.body.appendChild(el);
  //   assert.ok(el.shadowRoot);
  //   el.remove();
  // });
});
