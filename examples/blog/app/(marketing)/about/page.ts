import { html } from 'webjs';

export const metadata = { title: 'About — webjs blog' };

const FEATURES = [
  { label: 'SSR + DSD',            note: 'Real server HTML; shadow DOM upgrades on connect.' },
  { label: 'Streaming Suspense',   note: 'Fallback flushes immediately; deferred content streams in.' },
  { label: 'Server actions',       note: 'Import a .server.js fn from a component — auto-RPCs.' },
  { label: 'WebSockets',           note: 'Live chat and live comments via WS on route.js.' },
  { label: 'Session auth',         note: 'scrypt + cookie session, CSRF on RPC, rate-limited endpoints.' },
  { label: 'Fine-grained render',  note: 'Focus and selection survive state updates.' },
  { label: 'Keyed lists',          note: 'repeat() preserves element identity on reorder.' },
  { label: 'Route groups',         note: 'This page lives in app/(marketing)/about.' },
];

export default function About() {
  return html`
    <style>
      .rubric {
        display: block;
        font: 600 11px/1 var(--font-mono);
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: var(--sp-4);
      }
      h1 {
        font-family: var(--font-serif);
        font-size: var(--fs-display);
        line-height: 1.02;
        letter-spacing: -0.035em;
        font-weight: 700;
        margin: 0 0 var(--sp-5);
        text-wrap: balance;
      }
      .lead {
        font: 1.15rem/1.5 var(--font-sans);
        color: var(--fg-muted);
        max-width: 56ch;
        margin: 0 0 var(--sp-8);
      }

      h2 {
        font-family: var(--font-serif);
        font-size: 1.6rem;
        letter-spacing: -0.02em;
        margin: var(--sp-8) 0 var(--sp-4);
      }

      .features {
        display: grid;
        gap: 0;
        border-top: 1px solid var(--border);
      }
      .feat {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(0, 2fr);
        gap: var(--sp-5);
        padding: var(--sp-4) 0;
        border-bottom: 1px solid var(--border);
        min-width: 0;
      }
      .feat .label {
        font: 600 11px/1.4 var(--font-mono);
        letter-spacing: 0.1em;
        color: var(--accent);
        text-transform: uppercase;
      }
      .feat .note {
        font-family: var(--font-serif);
        font-size: 1rem;
        line-height: 1.6;
        color: var(--fg);
        margin: 0;
      }

      .card {
        margin-top: var(--sp-7);
        padding: var(--sp-5) var(--sp-6);
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--rad-lg);
      }
      .card p { margin: 0; font-size: 15px; color: var(--fg-muted); }
      .card strong { color: var(--fg); }
      .card code {
        font-family: var(--font-mono);
        font-size: 0.88em;
        padding: 2px 6px;
        border-radius: var(--rad-sm);
        background: var(--bg-subtle);
        border: 1px solid var(--border);
        word-break: break-word;
        overflow-wrap: anywhere;
      }
    </style>

    <span class="rubric">● about</span>
    <h1>A full-stack demo, at framework scale.</h1>
    <p class="lead">
      A tiny blog built on <strong>webjs</strong> — a no-build, web-components-first,
      Next.js-inspired framework. Every feature the framework ships with is exercised
      here in under a thousand lines.
    </p>

    <h2>What's on display</h2>
    <div class="features">
      ${FEATURES.map((f) => html`
        <div class="feat">
          <div class="label">${f.label}</div>
          <p class="note">${f.note}</p>
        </div>
      `)}
    </div>

    <div class="card">
      <p>
        <strong>Modules architecture.</strong> Feature modules live under <code>modules/</code> with
        their own <code>actions/</code>, <code>queries/</code>, <code>components/</code>, and
        <code>types.js</code>. Routes in <code>app/</code> are thin adapters.
      </p>
    </div>

    <p style="margin-top:var(--sp-7)"><a href="/">← Back to posts</a></p>
  `;
}
