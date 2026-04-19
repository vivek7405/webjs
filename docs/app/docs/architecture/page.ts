import { html } from '@webjs/core';

export const metadata = { title: 'Architecture — webjs' };

export default function Architecture() {
  return html`
    <h1>Architecture</h1>
    <p>webjs is a monorepo with three packages that together form the framework. Understanding the split helps when you need to import something specific or embed webjs into another runtime.</p>

    <h2>Package Overview</h2>
    <pre>webjs/
├── packages/
│   ├── core/     # webjs       — browser + server runtime
│   ├── server/   # @webjs/server — dev/prod server, router, SSR, actions
│   └── cli/      # @webjs/cli   — webjs dev/start/build/db commands
├── examples/
│   └── blog/     # reference app exercising every feature
└── docs/         # this documentation site (built on webjs)</pre>

    <h3>webjs (core)</h3>
    <p>Isomorphic — safe to import on both server and client. Contains:</p>
    <ul>
      <li><code>html</code> / <code>css</code> — tagged template literals for templates and styles</li>
      <li><code>WebComponent</code> — base class for custom elements</li>
      <li><code>render</code> — client-side fine-grained DOM renderer</li>
      <li><code>renderToString</code> — server-side async HTML renderer with DSD injection</li>
      <li><code>repeat()</code> — keyed list directive</li>
      <li><code>Suspense()</code> — streaming SSR boundary</li>
      <li><code>expose()</code> — tag an action for REST exposure</li>
      <li><code>notFound()</code> / <code>redirect()</code> — navigation sentinels</li>
      <li><code>connectWS()</code> — auto-reconnecting WebSocket client</li>
      <li><code>richFetch()</code> — superjson-aware fetch wrapper</li>
    </ul>

    <h3>@webjs/server</h3>
    <p>Server-only. Contains:</p>
    <ul>
      <li><code>startServer()</code> — creates an HTTP(S) server with all features wired</li>
      <li><code>createRequestHandler()</code> — returns a <code>(Request) → Response</code> handler for embedding</li>
      <li>File-based router, SSR pipeline, server actions, WebSocket handler</li>
      <li><code>cookies()</code> / <code>headers()</code> — request context via AsyncLocalStorage</li>
      <li><code>json()</code> / <code>readBody()</code> — content-negotiated JSON helpers</li>
      <li><code>rateLimit()</code> — in-memory fixed-window rate limiter</li>
      <li><code>buildBundle()</code> — optional esbuild production bundle</li>
      <li>CSRF, compression, graceful shutdown, health probes, logger</li>
    </ul>

    <h3>@webjs/cli</h3>
    <p>The <code>webjs</code> command-line tool:</p>
    <ul>
      <li><code>webjs dev</code> — dev server with file watching + live reload via SSE</li>
      <li><code>webjs start</code> — production server (optional <code>--http2 --cert --key</code>)</li>
      <li><code>webjs build</code> — optional esbuild bundle for production</li>
      <li><code>webjs db generate/migrate/studio</code> — Prisma CLI wrappers</li>
    </ul>

    <h2>Modules Architecture (Recommended)</h2>
    <p>For non-trivial apps, webjs recommends a feature-scoped modules pattern (inspired by the pilot-platform convention):</p>
    <pre>my-app/
├── app/                    # thin route adapters
│   ├── layout.ts
│   ├── page.ts
│   └── api/posts/route.ts  # delegates to modules/posts
├── lib/                    # cross-cutting infra
│   ├── prisma.ts
│   └── session.ts
├── modules/                # feature-scoped business logic
│   ├── auth/
│   │   ├── actions/        # mutations (one file per action)
│   │   ├── queries/        # reads (one file per query)
│   │   ├── components/     # feature-owned UI
│   │   ├── utils/          # pure helpers
│   │   └── types.ts        # shared type definitions
│   └── posts/
│       ├── actions/
│       ├── queries/
│       ├── components/
│       ├── utils/
│       └── types.ts
├── components/             # shared UI primitives
├── middleware.ts            # root middleware
└── prisma/schema.prisma</pre>

    <h3>Rules</h3>
    <ul>
      <li><strong>Routes stay thin.</strong> If a route.ts has more than ~20 lines of business logic, extract it into a module action.</li>
      <li><strong>One module per feature.</strong> auth, posts, comments, etc. each get their own folder.</li>
      <li><strong>Actions return <code>ActionResult&lt;T&gt;</code></strong> — a <code>{ success, data } | { success: false, error, status }</code> envelope that routes translate to HTTP responses mechanically.</li>
      <li><strong>Server-only imports</strong> (<code>@prisma/client</code>, <code>node:*</code>) stay in <code>.server.ts</code> files. Components import them and get auto-generated RPC stubs.</li>
    </ul>

    <h2>Request Lifecycle</h2>
    <ol>
      <li><strong>HTTP request arrives</strong> at the Node HTTP server (or HTTP/2 if TLS configured).</li>
      <li><strong>Root middleware</strong> (<code>middleware.ts</code>) runs first if present.</li>
      <li><strong>103 Early Hints</strong> sent (prod only) with modulepreload URLs for the matched page.</li>
      <li><strong>Route matching</strong>: the router tries (in order) internal endpoints, expose()d actions, static files, user source modules, API routes, then page routes.</li>
      <li><strong>Segment middleware</strong> chain runs (outermost → innermost) for the matched route.</li>
      <li>For <strong>pages</strong>: SSR pipeline runs (load page + layouts, render to HTML, inject DSD, collect metadata, stream response with Suspense).</li>
      <li>For <strong>API routes</strong>: the matched handler function runs, returns a Response.</li>
      <li>For <strong>WebSocket upgrades</strong>: the WS handler is invoked with the ws object + Request.</li>
      <li><strong>Response</strong> is sent (with compression in prod, CSRF cookie if needed, cache headers).</li>
    </ol>

    <h2>Embedding</h2>
    <p>webjs can be embedded in any Node-compatible runtime via <code>createRequestHandler</code>:</p>
    <pre>import { createRequestHandler } from '@webjs/server';

const app = await createRequestHandler({
  appDir: process.cwd(),
  dev: false,
});

// Use with any HTTP server:
const resp = await app.handle(new Request('http://x/api/hello'));
console.log(await resp.json());</pre>

    <p>This returns standard <code>Request → Response</code> — usable in Express, Fastify, Bun, Deno, Cloudflare Workers (with the file-system caveat documented in the deployment guide).</p>
  `;
}
