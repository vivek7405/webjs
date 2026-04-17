import { html } from 'webjs';

export const metadata = {
  title: 'webjs — AI-first, no-build, web-components-first framework inspired by NextJs and Lit',
  description: 'Designed for AI agents to read and write. Server-rendered web components, file-based routing, server actions, TypeScript with zero bundler.',
};

const FEATURES = [
  { icon: '🤖', title: 'AI-First Development', desc: 'Designed from the ground up for AI agents. AGENTS.md contract, cross-agent guardrails (.cursorrules, .windsurfrules, copilot-instructions.md), auto-generated tests and docs, opinionated conventions — LLMs produce production-quality code without guesswork.' },
  { icon: '⚡', title: 'No Build Step', desc: 'Source files are served to the browser as native ES modules. Edit a .ts file, refresh, see it. No webpack, no Vite, no compile step. Auto-vendor bundling for npm packages via import maps.' },
  { icon: '🧱', title: 'Web Components First', desc: 'Full lifecycle (shouldUpdate, willUpdate, firstUpdated, updated), reactive controllers, context protocol, client-side error boundaries. Shadow DOM + Declarative Shadow DOM for real SSR. Selective hydration for below-the-fold components.' },
  { icon: '📁', title: 'NextJs-Style Routing', desc: 'File-based routing at parity with NextJs App Router. page.ts, layout.ts, route.ts, error.ts, loading.ts (auto-Suspense), not-found.ts (nested), middleware.ts, [param], [...slug], [[...optional]], (groups), metadata routes (sitemap.ts, robots.ts).' },
  { icon: '🔄', title: 'Server Actions + superjson', desc: 'Import a .server.ts function from a client component — it auto-rewrites into a type-safe RPC stub. Date, Map, Set, BigInt round-trip as their real types.' },
  { icon: '🌊', title: 'Streaming SSR + Suspense', desc: 'Fallback content flushes immediately. Deferred data streams in as it resolves. TTFB measured in milliseconds, not seconds.' },
  { icon: '🔌', title: 'WebSocket Built In', desc: 'Export a WS function from any route.ts and it becomes a WebSocket endpoint. connectWS() on the client auto-reconnects with exponential backoff.' },
  { icon: '🛡️', title: 'Production Batteries', desc: 'CSRF on RPC, gzip/brotli, HTTP/2, 103 Early Hints, modulepreload with transitive deps, lazy component loading, rate limiting, health probes, graceful shutdown.' },
  { icon: '📝', title: 'TypeScript or JSDoc', desc: 'Full-stack type safety with .ts files (Node strips types natively) or JSDoc annotations. Zero compile step either way.' },
  { icon: '🧪', title: 'Testing Built In', desc: 'webjs test runs server + browser tests (WTR + Playwright). webjs check validates conventions. webjs create scaffolds test directories and example tests. AI agents auto-generate tests with every feature.' },
  { icon: '🔀', title: 'Git Workflow Guardrails', desc: 'Branch checking before edits, merge approval with delete/keep prompt, no AI attribution in commits, auto-rebase before work. Enforced via hooks for Claude Code, config files for Cursor/Windsurf/Copilot.' },
  { icon: '📐', title: 'Opinionated Conventions', desc: 'Modules architecture, one-function-per-file actions, CONVENTIONS.md with overridable rules, webjs check validator. AI agents produce consistent code across teams.' },
];

export default function LandingPage() {
  return html`
    <style>
      .hero {
        max-width: 900px;
        margin: 0 auto;
        padding: var(--sp-8) var(--sp-5) var(--sp-7);
        text-align: center;
      }
      .hero .rubric {
        font: 600 13px/1 var(--font-mono);
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--fg-muted);
        margin-bottom: var(--sp-5);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .hero .rubric .name {
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.08em;
        color: var(--accent);
      }
      .hero .rubric .sep {
        color: var(--fg-subtle);
      }
      .hero h1 {
        font: 700 var(--fs-display)/1.05 var(--font-serif);
        letter-spacing: -0.03em;
        margin: 0 0 var(--sp-5);
        text-wrap: balance;
      }
      .hero p {
        font-size: var(--fs-lede);
        line-height: 1.55;
        color: var(--fg-muted);
        max-width: 60ch;
        margin: 0 auto var(--sp-6);
      }
      .hero-actions {
        display: flex;
        gap: var(--sp-3);
        justify-content: center;
        flex-wrap: wrap;
      }
      .hero-actions a {
        display: inline-block;
        padding: var(--sp-3) var(--sp-5);
        border-radius: 999px;
        font: 600 14px/1 var(--font-sans);
        text-decoration: none;
        transition: background var(--t-fast), border-color var(--t-fast);
      }
      .hero-actions .primary {
        background: var(--accent);
        color: var(--accent-fg);
      }
      .hero-actions .primary:hover { background: var(--accent-hover); }
      .hero-actions .secondary {
        background: transparent;
        color: var(--fg-muted);
        border: 1px solid var(--border-strong);
      }
      .hero-actions .secondary:hover { color: var(--fg); border-color: var(--fg-muted); }

      .install {
        max-width: 520px;
        margin: 0 auto var(--sp-8);
        padding: var(--sp-4);
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        border-radius: var(--rad);
        font: 14px/1.6 var(--font-mono);
        color: var(--fg-muted);
        text-align: left;
        overflow-x: auto;
      }
      .install .comment { color: var(--fg-subtle); }
      .install .cmd { color: var(--fg); }

      .features {
        max-width: 900px;
        margin: 0 auto;
        padding: 0 var(--sp-5) var(--sp-8);
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: var(--sp-4);
      }
      .feature {
        padding: var(--sp-5);
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--rad-lg);
        transition: border-color var(--t), box-shadow var(--t);
      }
      .feature:hover { border-color: var(--border-strong); box-shadow: var(--shadow); }
      .feature .icon { font-size: 24px; margin-bottom: var(--sp-2); }
      .feature h3 {
        font-size: 1rem;
        font-weight: 700;
        margin: 0 0 var(--sp-2);
        color: var(--fg);
      }
      .feature p {
        font-size: 14px;
        line-height: 1.55;
        color: var(--fg-muted);
        margin: 0;
      }

      .modes {
        max-width: 900px;
        margin: 0 auto;
        padding: 0 var(--sp-5) var(--sp-8);
      }
      .modes h2 {
        font: 700 var(--fs-h2)/1.2 var(--font-serif);
        letter-spacing: -0.02em;
        text-align: center;
        margin: 0 0 var(--sp-5);
      }
      .mode-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--sp-4);
      }
      @media (max-width: 600px) { .mode-grid { grid-template-columns: 1fr; } }
      .mode-card {
        padding: var(--sp-5) var(--sp-6);
        background: var(--bg-elev);
        border: 1px solid var(--border);
        border-radius: var(--rad-lg);
      }
      .mode-card .rubric {
        font: 600 10px/1 var(--font-mono);
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: var(--sp-2);
      }
      .mode-card h3 {
        font: 700 1.2rem/1.25 var(--font-serif);
        margin: 0 0 var(--sp-3);
      }
      .mode-card p {
        font-size: 14px;
        line-height: 1.6;
        color: var(--fg-muted);
        margin: 0 0 var(--sp-3);
      }
      .mode-card pre {
        margin: 0;
        padding: var(--sp-3);
        border-radius: var(--rad-sm);
        background: var(--bg-sunken);
        border: 1px solid var(--border);
        font: 13px/1.5 var(--font-mono);
        overflow-x: auto;
      }

      footer {
        max-width: 900px;
        margin: 0 auto;
        padding: var(--sp-7) var(--sp-5);
        border-top: 1px solid var(--border);
        text-align: center;
        font-size: 13px;
        color: var(--fg-subtle);
      }
      footer a { color: var(--accent); text-decoration: none; }
      footer a:hover { text-decoration: underline; }
    </style>

    <section class="hero">
      <div class="rubric"><span class="name">webjs</span> <span class="sep">—</span> ai-first web framework</div>
      <h1>The web framework where AI agents write production code.</h1>
      <p>
        webjs is an AI-first, no-build, web-components-first framework inspired by Lit and NextJs.
        Cross-agent guardrails enforce tests, docs, branch hygiene, and conventions automatically —
        AI agents deliver production-quality code without being asked.
        Works with Claude Code, Cursor, Windsurf, Copilot, and any AI coding assistant.
      </p>
      <div class="hero-actions">
        <a class="primary" href="http://localhost:4000/docs/getting-started" target="_blank">Get Started</a>
        <a class="secondary" href="https://github.com/vivek7405/webjs" target="_blank">GitHub</a>
        <a class="secondary" href="http://localhost:3456" target="_blank">Example Blog</a>
      </div>
    </section>

    <div class="install">
      <span class="comment"># quickstart</span><br>
      <span class="cmd">git clone https://github.com/vivek7405/webjs</span><br>
      <span class="cmd">cd webjs && npm install</span><br>
      <span class="cmd">cd examples/blog</span><br>
      <span class="cmd">npx prisma migrate dev --name init</span><br>
      <span class="cmd">npx webjs dev</span><br>
      <span class="comment"># → http://localhost:3000</span>
    </div>

    <div class="features">
      ${FEATURES.map(f => html`
        <div class="feature">
          <div class="icon">${f.icon}</div>
          <h3>${f.title}</h3>
          <p>${f.desc}</p>
        </div>
      `)}
    </div>

    <section class="modes">
      <h2>One framework, two modes</h2>
      <div class="mode-grid">
        <div class="mode-card">
          <div class="rubric">Full-Stack</div>
          <h3>Pages + API + Components</h3>
          <p>
            SSR pages with web components, server actions, Prisma, auth,
            WebSockets, streaming. Everything you need for a complete app.
          </p>
          <pre>app/page.ts          → SSR page
app/api/posts/route.ts → REST endpoint
components/counter.ts  → interactive UI
actions/posts.server.ts → server action</pre>
        </div>
        <div class="mode-card">
          <div class="rubric">Backend-Only</div>
          <h3>Just API Routes</h3>
          <p>
            Skip pages entirely. Use webjs as a lightweight API framework
            with file-based routing, middleware, rate limiting, WebSockets,
            and TypeScript — zero frontend required.
          </p>
          <pre>app/api/users/route.ts     → CRUD
app/api/auth/middleware.ts → rate limit
app/api/chat/route.ts      → WebSocket
middleware.ts              → global auth</pre>
        </div>
      </div>
    </section>

    <section class="modes">
      <h2>Built for AI agents</h2>
      <div class="mode-grid">
        <div class="mode-card">
          <div class="rubric">Cross-agent guardrails</div>
          <h3>Every AI agent, same standards</h3>
          <p>
            <code>webjs create</code> scaffolds config files for Claude Code
            (<code>.claude/settings.json</code> + hooks), Cursor (<code>.cursorrules</code>),
            Windsurf (<code>.windsurfrules</code>), and GitHub Copilot
            (<code>.github/copilot-instructions.md</code>). Every agent gets the same
            rules: auto-generate tests, auto-update docs, check branch before coding,
            ask before merging, no AI attribution in commits.
          </p>
        </div>
        <div class="mode-card">
          <div class="rubric">AGENTS.md</div>
          <h3>The machine-readable contract</h3>
          <p>
            Every webjs app ships <code>AGENTS.md</code> with the full API surface,
            directive decision guide, lifecycle hooks, controller patterns, and
            step-by-step recipes. <code>CONVENTIONS.md</code> adds overridable
            project rules. AI agents read both before making any change.
          </p>
        </div>
        <div class="mode-card">
          <div class="rubric">Autonomous mode</div>
          <h3>Sandbox-safe defaults</h3>
          <p>
            In bypass-permissions mode, agents auto-decide: create feature branches,
            rebase before starting, generate meaningful commits, fix failing tests,
            delete feature branches after merge. Same quality bar — no blocking on questions.
          </p>
        </div>
        <div class="mode-card">
          <div class="rubric">Testing &amp; conventions</div>
          <h3>Quality enforced, not requested</h3>
          <p>
            <code>webjs test</code> runs server + browser tests (WTR + Playwright). <code>webjs check</code>
            validates conventions (actions in modules, components registered, tests exist).
            AI agents run both automatically — the user never has to ask for tests or docs.
          </p>
        </div>
      </div>
    </section>

    <footer>
      <p><a href="https://github.com/vivek7405/webjs" target="_blank">GitHub</a> · <a href="http://localhost:4000/docs/getting-started" target="_blank">Docs</a> · <a href="http://localhost:4000/docs/ai-first" target="_blank">AI-First</a> · <a href="http://localhost:3456" target="_blank">Example Blog</a></p>
    </footer>
  `;
}
