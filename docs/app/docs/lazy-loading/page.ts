import { html } from '@webjs/core';

export const metadata = { title: 'Lazy Loading — webjs' };

export default function LazyLoading() {
  return html`
    <h1>Lazy Loading</h1>
    <p>Components marked with <code>static lazy = true</code> are loaded only when they enter the viewport. The SSR-rendered HTML is visible immediately — the JavaScript module is fetched in the background when the user scrolls near the component.</p>

    <h2>When to use</h2>
    <ul>
      <li>Below-the-fold components that don't need interactivity on initial load (charts, comment threads, image galleries).</li>
      <li>Heavy components with large dependencies that would slow down the initial page load.</li>
      <li>Components that most users never scroll to (footer widgets, "load more" sections).</li>
    </ul>

    <h2>When NOT to use</h2>
    <ul>
      <li>For above-the-fold components — they need to be interactive immediately.</li>
      <li>For critical UI like navigation, auth forms, or CTAs — these must hydrate eagerly.</li>
      <li>For tiny components with negligible JS cost — the overhead of lazy loading isn't worth it.</li>
    </ul>

    <h2>Basic usage</h2>
    <p>Add <code>static lazy = true</code> to your component class:</p>

    <pre>import { WebComponent, html, css } from '@webjs/core';

class HeavyChart extends WebComponent {
  static lazy = true;  // ← module loaded on scroll, not on page load
  static styles = css${'`'}:host { display: block; min-height: 400px; }${'`'};

  render() {
    return html${'`'}&lt;canvas&gt;&lt;/canvas&gt;${'`'};
  }
}
HeavyChart.register('heavy-chart');</pre>

    <h2>How it works</h2>
    <ol>
      <li>During SSR, the component is rendered normally — full HTML with Declarative Shadow DOM. The user sees the content immediately.</li>
      <li>The SSR pipeline skips the <code>&lt;link rel="modulepreload"&gt;</code> for lazy components (no eager download).</li>
      <li>Instead, a small inline script registers the component tag with the lazy loader.</li>
      <li>An <code>IntersectionObserver</code> (with 200px root margin) watches for the element.</li>
      <li>When the element enters the viewport, the module is fetched via <code>import()</code>.</li>
      <li>The custom element class registers itself, upgrading the element — event listeners bind, state initializes.</li>
    </ol>

    <h2>Selective hydration</h2>
    <p>For even more control, use <code>static hydrate = 'visible'</code> — this defers the component's <code>connectedCallback</code> activation (not just the module load) until the element is visible:</p>

    <pre>class LazyComments extends WebComponent {
  static hydrate = 'visible';  // ← activation deferred until visible
  // ...
}</pre>

    <p>The difference: <code>lazy</code> defers the module download. <code>hydrate = 'visible'</code> defers the component's activation even if the module is already loaded. Use both together for maximum deferral.</p>

    <h2>MutationObserver</h2>
    <p>The lazy loader automatically watches for dynamically added elements via <code>MutationObserver</code>. If a lazy component is added to the DOM after page load (e.g. via client-side navigation), it will still be observed and loaded when visible.</p>

    <h2>Fallback</h2>
    <p>In environments without <code>IntersectionObserver</code> (SSR-only, older browsers), all lazy components are loaded immediately — graceful degradation.</p>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/components">Components</a> — component lifecycle and properties</li>
      <li><a href="/docs/ssr">Server-Side Rendering</a> — how DSD preserves visual content before hydration</li>
      <li><a href="/docs/lifecycle">Lifecycle Hooks</a> — <code>connectedCallback</code>, <code>firstUpdated</code>, etc.</li>
    </ul>
  `;
}
