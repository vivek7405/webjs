import { html } from 'webjs';

export const metadata = { title: 'Client Router — webjs' };

export default function ClientRouter() {
  return html`
    <h1>Client Router</h1>
    <p>webjs includes a Turbo Drive-style client router that intercepts same-origin link clicks, fetches the target page via <code>fetch()</code>, and swaps the DOM — no full page reload. The result feels like a SPA while keeping the full SSR model.</p>

    <h2>When to use</h2>
    <p>It's enabled automatically when you import <code>webjs/client-router</code> in your layout (the scaffold does this for you). You don't need to do anything — every <code>&lt;a&gt;</code> link in your app becomes a client-side navigation.</p>

    <h2>When NOT to use</h2>
    <ul>
      <li>For links to external sites — they're ignored automatically (different origin).</li>
      <li>For file downloads — links with <code>download</code> attribute are ignored.</li>
      <li>For links that should force a full reload — add <code>data-no-router</code> to the <code>&lt;a&gt;</code> tag.</li>
    </ul>

    <h2>How it works</h2>
    <ol>
      <li>Intercepts clicks on <code>&lt;a&gt;</code> tags (same origin, no modifier keys, no <code>target</code>, no <code>download</code>). Works across shadow DOM boundaries via <code>composedPath()</code>.</li>
      <li>Fetches the target URL's HTML.</li>
      <li>Parses the response with <code>Document.parseHTMLUnsafe()</code> (preserves Declarative Shadow DOM).</li>
      <li>If both pages share the same layout shell (e.g. <code>&lt;blog-shell&gt;</code>), swaps only the slot content — the layout stays fully mounted (no flicker, no style recalc).</li>
      <li>If the layout is different, replaces the entire <code>&lt;body&gt;</code> and merges <code>&lt;head&gt;</code>.</li>
      <li>Re-runs any new <code>&lt;script&gt;</code> tags.</li>
      <li>Upgrades custom elements that were parsed in the detached document.</li>
      <li>Updates the URL via <code>pushState</code>, scrolls to top (or to <code>#hash</code>).</li>
      <li>Dispatches a <code>webjs:navigate</code> event on <code>document</code>.</li>
    </ol>

    <h2>Programmatic navigation</h2>
    <p>Use <code>navigate()</code> instead of <code>location.href = ...</code>:</p>

    <pre>import { navigate } from 'webjs/client-router';

// Normal navigation (adds to history)
await navigate('/about');

// Replace current history entry
await navigate('/login', { replace: true });</pre>

    <h2>Opting out</h2>
    <p>Add <code>data-no-router</code> to any link to force a full page navigation:</p>

    <pre>&lt;a href="/legacy-page" data-no-router&gt;Full reload&lt;/a&gt;</pre>

    <p>To disable the router entirely:</p>
    <pre>import { disableClientRouter } from 'webjs/client-router';
disableClientRouter();</pre>

    <h2>Listening for navigations</h2>
    <p>React to client-side navigations with the <code>webjs:navigate</code> event:</p>

    <pre>document.addEventListener('webjs:navigate', (e) => {
  console.log('Navigated to:', e.detail.url);
  // Track page view, update active nav link, etc.
});</pre>

    <h2>Layout shell optimization</h2>
    <p>When both the current and target pages use the same layout shell (identified by the first custom element in <code>&lt;body&gt;</code>), the router swaps only the slot content inside that shell. The header, sidebar, footer, and any component state in the layout are preserved across navigations.</p>
    <p>This means your <code>&lt;theme-toggle&gt;</code>, navigation highlight, and sidebar scroll position survive page transitions — only the page content changes.</p>

    <h2>Loading indicator</h2>
    <p>During navigation, the <code>&lt;html&gt;</code> element gets a <code>data-navigating</code> attribute. Use it for a subtle loading indicator:</p>

    <pre>html[data-navigating] {
  cursor: progress;
}
html[data-navigating]::after {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--accent);
  animation: progress 1s ease-in-out infinite;
}</pre>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/routing">Routing</a> — file-based route conventions</li>
      <li><a href="/docs/components">Components</a> — how components hydrate after navigation</li>
      <li><a href="/docs/ssr">Server-Side Rendering</a> — the SSR pipeline that produces the HTML</li>
    </ul>
  `;
}
