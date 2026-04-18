import { test } from 'node:test';
import assert from 'node:assert/strict';

import { html, renderToString, WebComponent, css } from '../packages/core/index.js';

test('light DOM component SSR renders content as direct children', async () => {
  class LightComp extends WebComponent {
    static tag = 'test-light-comp';
    static shadow = false;
    render() { return html`<p>light content</p>`; }
  }
  LightComp.register();

  const out = await renderToString(html`<test-light-comp></test-light-comp>`);
  assert.match(out, /<p>light content<\/p>/);
  assert.doesNotMatch(out, /<template shadowrootmode="open">/);
  assert.doesNotMatch(out, /<\/template>/);
});

test('light DOM SSR includes hydration marker', async () => {
  class LightMarker extends WebComponent {
    static tag = 'test-light-marker';
    static shadow = false;
    render() { return html`<span>marked</span>`; }
  }
  LightMarker.register();

  const out = await renderToString(html`<test-light-marker></test-light-marker>`);
  assert.match(out, /<!--webjs-hydrate-->/);
  assert.match(out, /<test-light-marker><!--webjs-hydrate--><span>marked<\/span><\/test-light-marker>/);
});

test('shadow DOM component SSR still uses DSD', async () => {
  class ShadowComp extends WebComponent {
    static tag = 'test-shadow-comp';
    static shadow = true;
    render() { return html`<p>shadow content</p>`; }
  }
  ShadowComp.register();

  const out = await renderToString(html`<test-shadow-comp></test-shadow-comp>`);
  assert.match(out, /<template shadowrootmode="open">/);
  assert.match(out, /<p>shadow content<\/p>/);
  assert.match(out, /<\/template>/);
  assert.doesNotMatch(out, /<!--webjs-hydrate-->/);
});

test('mixed page with both shadow and light DOM', async () => {
  class MixLight extends WebComponent {
    static tag = 'test-mix-light';
    static shadow = false;
    render() { return html`<em>light part</em>`; }
  }
  MixLight.register();

  class MixShadow extends WebComponent {
    static tag = 'test-mix-shadow';
    static shadow = true;
    static styles = css`p { color: blue; }`;
    render() { return html`<p>shadow part</p>`; }
  }
  MixShadow.register();

  const out = await renderToString(
    html`<div><test-mix-light></test-mix-light><test-mix-shadow></test-mix-shadow></div>`
  );

  // Light DOM: direct children with hydration marker, no DSD
  assert.match(out, /<test-mix-light><!--webjs-hydrate--><em>light part<\/em><\/test-mix-light>/);

  // Shadow DOM: wrapped in DSD template
  assert.match(out, /<test-mix-shadow><template shadowrootmode="open">/);
  assert.match(out, /<p>shadow part<\/p>/);
  assert.match(out, /<style>p \{ color: blue; \}<\/style>/);

  // Confirm hydration marker only appears in light DOM section
  const hydrationCount = (out.match(/<!--webjs-hydrate-->/g) || []).length;
  assert.equal(hydrationCount, 1, 'hydration marker should appear exactly once (for the light DOM component)');
});

test('light DOM async render works', async () => {
  class AsyncLight extends WebComponent {
    static tag = 'test-async-light';
    static shadow = false;
    async render() {
      const data = await Promise.resolve('async result');
      return html`<div>${data}</div>`;
    }
  }
  AsyncLight.register();

  const out = await renderToString(html`<test-async-light></test-async-light>`);
  assert.match(out, /<!--webjs-hydrate-->/);
  assert.match(out, /<div>async result<\/div>/);
  assert.doesNotMatch(out, /<template shadowrootmode="open">/);
});

test('WebComponent.shadow defaults to false (light DOM is the default)', () => {
  assert.equal(WebComponent.shadow, false);
});

test('component without explicit static shadow uses light DOM (inherits default)', async () => {
  class DefaultShadow extends WebComponent {
    static tag = 'test-default-shadow';
    // No `static shadow =` declaration — should inherit WebComponent.shadow (false).
    render() { return html`<p>default</p>`; }
  }
  DefaultShadow.register();
  assert.equal(DefaultShadow.shadow, false, 'inherited default should be false');

  const out = await renderToString(html`<test-default-shadow></test-default-shadow>`);
  // Default is light DOM: content rendered as direct children with hydration marker.
  assert.match(out, /<!--webjs-hydrate-->/);
  assert.doesNotMatch(out, /<template shadowrootmode="open">/);
});

test('component with shadow = "open" (truthy but not === true) stays light DOM', async () => {
  // The DSD injection check is `shadow === true` — any other truthy value means light.
  class NotTrueShadow extends WebComponent {
    static tag = 'test-not-true-shadow';
    static shadow = /** @type any */ ('open');
    render() { return html`<p>still light</p>`; }
  }
  NotTrueShadow.register();
  const out = await renderToString(html`<test-not-true-shadow></test-not-true-shadow>`);
  // shadow is not strictly === true, so no DSD injection.
  assert.doesNotMatch(out, /<template shadowrootmode="open">/);
});
