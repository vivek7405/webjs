import { html } from 'webjs';

export const metadata = { title: 'About — webjs blog' };

export default function About() {
  return html`
    <style>
      .lead {
        font-size: 1.1rem;
        color: var(--fg-muted);
        margin: 0 0 var(--sp-6);
        max-width: 56ch;
      }
      .features {
        display: grid;
        gap: var(--sp-3);
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        margin: var(--sp-5) 0;
      }
      .feature {
        padding: var(--sp-4);
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--rad);
        /* Let the grid track (minmax 220px 1fr) win over intrinsic
           child width, and break unbreakable tokens (file paths,
           URLs) so they don't push the tile wider than its column. */
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .feature strong { display: block; margin-bottom: 4px; color: var(--fg); }
      .feature span   { font-size: 13px; color: var(--fg-muted); }
      .feature code   {
        /* code with no natural break points wraps on any character. */
        word-break: break-word;
      }
    </style>

    <h1>About this demo</h1>
    <p class="lead">
      A tiny blog built on <strong>webjs</strong> — a no-build, web-components-first,
      Next.js-inspired framework. The blog exercises every feature the framework ships.
    </p>

    <h2>Features on display</h2>
    <div class="features">
      <div class="feature"><strong>SSR + DSD</strong><span>Real server HTML, shadow DOM upgrades on connect.</span></div>
      <div class="feature"><strong>Streaming Suspense</strong><span>Fallback flushes immediately; deferred content streams in.</span></div>
      <div class="feature"><strong>Server actions</strong><span>Import a <code>.server.js</code> function from a component — it auto-RPCs.</span></div>
      <div class="feature"><strong>WebSockets</strong><span>Live chat + live comments via the <code>WS</code> export on <code>route.js</code>.</span></div>
      <div class="feature"><strong>Session auth</strong><span>scrypt + cookie session, CSRF on RPC, rate-limited auth endpoints.</span></div>
      <div class="feature"><strong>Fine-grained renderer</strong><span>Focus and selection survive state updates.</span></div>
      <div class="feature"><strong>Keyed lists</strong><span><code>repeat()</code> preserves element identity on reorder.</span></div>
      <div class="feature"><strong>Route groups</strong><span>This page lives at <code>app/(marketing)/about/page.js</code>.</span></div>
    </div>

    <h2>Modules architecture</h2>
    <p>
      Organised like a production Next.js app: thin adapters in <code>app/</code>,
      feature modules in <code>modules/</code> (<code>actions/</code>, <code>queries/</code>,
      <code>components/</code>, <code>utils/</code>, <code>types.js</code>),
      cross-cutting infrastructure in <code>lib/</code>.
    </p>

    <p><a href="/">← Back to posts</a></p>
  `;
}
