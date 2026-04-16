import { html } from 'webjs';

export const metadata = { title: 'Streaming & Suspense — webjs' };

export default function SuspensePage() {
  return html`
    <h1>Streaming & Suspense</h1>
    <p>webjs supports <strong>streaming SSR with Suspense boundaries</strong>. The server flushes the page shell (header, layout, fast content) immediately, then streams deferred content as it resolves. The browser paints above-the-fold content in milliseconds while slow data trickles in.</p>

    <h2>How It Works</h2>
    <ol>
      <li>The page returns a template containing <code>Suspense({ fallback, children })</code> markers.</li>
      <li><code>renderToString</code> encounters a Suspense boundary → emits the fallback HTML wrapped in a <code>&lt;webjs-boundary id="sN"&gt;</code> placeholder.</li>
      <li>The SSR pipeline flushes the document head + body (with fallbacks) immediately — this is the first byte the browser sees.</li>
      <li>The response stream stays open. As each Suspense promise resolves, the server emits a <code>&lt;template data-webjs-resolve="sN"&gt;...real content...&lt;/template&gt;</code> followed by a tiny inline script that swaps the fallback for the real content.</li>
      <li>The browser progressively replaces fallbacks as data arrives. No framework runtime needed — just a one-line <code>replaceWith</code> call per boundary.</li>
    </ol>

    <h2>Usage</h2>
    <pre>import { html, Suspense } from 'webjs';

async function SlowStats() {
  const data = await fetchExpensiveAnalytics();
  return html\`&lt;div&gt;\${data.summary}&lt;/div&gt;\`;
}

export default function Dashboard() {
  return html\`
    &lt;h1&gt;Dashboard&lt;/h1&gt;
    &lt;p&gt;Welcome back!&lt;/p&gt;

    \${Suspense({
      fallback: html\`&lt;p&gt;Loading stats…&lt;/p&gt;\`,
      children: SlowStats(),
    })}
  \`;
}</pre>

    <p>The user sees "Loading stats…" immediately. When <code>SlowStats()</code> resolves (maybe 500ms later), the real content streams in and replaces the fallback — without a full page reload or client-side JS re-render.</p>

    <h2>TTFB Impact</h2>
    <p>Without Suspense, the server waits for ALL data before sending the first byte. With Suspense, TTFB equals the time to render everything OUTSIDE the boundaries — typically milliseconds:</p>
    <pre>Without Suspense:  TTFB = slowest await = 500ms
With Suspense:     TTFB = shell render = ~40ms
                   Total = still 500ms (stream completes)
                   But the user sees content 460ms earlier.</pre>

    <h2>Nested Suspense</h2>
    <p>Boundaries can nest. A resolved boundary can itself contain Suspense — the server keeps streaming until all promises drain:</p>
    <pre>\${Suspense({
  fallback: html\`&lt;p&gt;Loading section…&lt;/p&gt;\`,
  children: (async () =&gt; {
    const section = await loadSection();
    return html\`
      &lt;h2&gt;\${section.title}&lt;/h2&gt;
      \${Suspense({
        fallback: html\`&lt;p&gt;Loading details…&lt;/p&gt;\`,
        children: loadDetails(section.id),
      })}
    \`;
  })(),
})}</pre>

    <h2>Without a Suspense Context</h2>
    <p>If <code>renderToString</code> is called without a <code>suspenseCtx</code> (e.g., in a static pre-render), Suspense boundaries render the fallback only — the promise is dropped. This is the safe default for contexts where streaming isn't available.</p>

    <h2>Client-Side Resolver</h2>
    <p>The tiny client-side script (auto-injected when any Suspense boundary is present) is a single function:</p>
    <pre>window.__webjsResolve = function(id) {
  const tpl = document.querySelector('template[data-webjs-resolve="' + id + '"]');
  const boundary = document.getElementById(id);
  if (tpl && boundary) {
    boundary.replaceWith(tpl.content.cloneNode(true));
    tpl.remove();
  }
};</pre>
    <p>No framework runtime. No hydration. Just a DOM swap.</p>

    <h2>When to Use Suspense</h2>
    <ul>
      <li><strong>Slow database queries</strong> — wrap the section that depends on slow data.</li>
      <li><strong>External API calls</strong> — third-party services with unpredictable latency.</li>
      <li><strong>Personalised content</strong> — user-specific data that can't be cached, below fast-to-render public content.</li>
    </ul>
    <p>Don't wrap everything in Suspense — only the parts whose data is genuinely slow. Fast queries should remain in the synchronous render path for simpler code.</p>
  `;
}
