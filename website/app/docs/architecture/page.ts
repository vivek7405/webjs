import { html } from '@webjsdev/core';

export const metadata = { title: 'Architecture | WebJs' };

export default function Architecture() {
  return html`
    <h1>Architecture</h1>
    <p>WebJs is a monorepo with three packages that together form the framework. Understanding the split helps when you need to import something specific or embed WebJs into another runtime.</p>

    <p><strong>Mental model, especially if you come from React Server Components:</strong> WebJs has no server/client component split. Pages, layouts, and components are <em>isomorphic</em> modules, the same source runs on the server to produce SSR'd HTML and then loads in the browser to add interactivity. There is no Flight protocol and no "server component" identity. The one server boundary is the <code>.server.{js,ts}</code> file, which is an RPC + source-protection mechanism (server actions and server-only utilities), not a server-rendered component. <code>route.{js,ts}</code> is a server-only HTTP handler. And elision (skipping the JS download of a module that does no client work) is a build-free optimization on those isomorphic modules, not a boundary, it never changes behaviour because progressive enhancement is the no-JS baseline.</p>

    <h2>Package Overview</h2>
    <pre>webjs/
├── packages/
│   ├── core/     # webjs       : browser + server runtime
│   ├── server/   # @webjsdev/server : dev/prod server, router, SSR, actions
│   └── cli/      # @webjsdev/cli   : webjs dev/start/build/db commands
├── examples/
│   └── blog/     # reference app exercising every feature
└── docs/         # this documentation site (built on webjs)</pre>

    <h3>WebJs (core)</h3>
    <p>Isomorphic: safe to import on both server and client. Contains:</p>
    <ul>
      <li><code>html</code> / <code>css</code>: tagged template literals for templates and styles</li>
      <li><code>WebComponent</code>: base class for custom elements</li>
      <li><code>render</code>: client-side fine-grained DOM renderer</li>
      <li><code>renderToString</code>: server-side async HTML renderer with DSD injection</li>
      <li><code>repeat()</code> is the keyed list directive</li>
      <li><code>Suspense()</code> is the streaming SSR boundary</li>
      <li><code>notFound()</code> / <code>redirect()</code> are navigation sentinels</li>
      <li><code>connectWS()</code> is the auto-reconnecting WebSocket client</li>
      <li><code>richFetch()</code> is the rich-type-aware fetch wrapper</li>
      <li><code>stringify()</code> / <code>parse()</code> are webjs's built-in serializer (Date, Map, Set, BigInt, TypedArray, Blob, File, FormData, cycles)</li>
    </ul>

    <h3>@webjsdev/server</h3>
    <p>Server-only. Contains:</p>
    <ul>
      <li><code>startServer()</code> creates an HTTP(S) server with all features wired</li>
      <li><code>createRequestHandler()</code> returns a <code>(Request) → Response</code> handler for embedding</li>
      <li>File-based router, SSR pipeline, server actions, WebSocket handler</li>
      <li><code>cookies()</code> / <code>headers()</code> provide request context via AsyncLocalStorage</li>
      <li><code>json()</code> / <code>readBody()</code> are content-negotiated JSON helpers</li>
      <li><code>rateLimit()</code> is the in-memory fixed-window rate limiter</li>
      <li>CSRF, compression, graceful shutdown, health probes, logger</li>
    </ul>

    <h3>@webjsdev/cli</h3>
    <p>The <code>webjs</code> command-line tool:</p>
    <ul>
      <li><code>webjs dev</code>: dev server with file watching + live reload via SSE</li>
      <li><code>webjs start</code>: production server, speaks plain HTTP/1.1 (front a reverse proxy for TLS + HTTP/2). No build step: serves source directly.</li>
      <li><code>webjs db generate/migrate/studio</code>: Drizzle Kit wrappers (drizzle-kit)</li>
    </ul>

    <h2>Modules Architecture (Recommended)</h2>
    <p>For non-trivial apps, WebJs recommends a feature-scoped modules pattern:</p>
    <pre>my-app/
├── app/                    # thin route adapters
│   ├── layout.ts
│   ├── page.ts
│   └── api/posts/route.ts  # delegates to modules/posts
├── db/                     # data layer (Drizzle)
│   ├── connection.server.ts
│   └── schema.server.ts
├── lib/                    # cross-cutting infra
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
└── middleware.ts            # root middleware</pre>

    <h3>Rules</h3>
    <ul>
      <li><strong>Routes stay thin.</strong> If a route.ts has more than ~20 lines of business logic, extract it into a module action.</li>
      <li><strong>One module per feature.</strong> auth, posts, comments, etc. each get their own folder.</li>
      <li><strong>Actions return <code>ActionResult&lt;T&gt;</code></strong>: a <code>{ success, data } | { success: false, error, status }</code> envelope that routes translate to HTTP responses mechanically.</li>
      <li><strong>Server-only imports</strong> (the DB driver <code>pg</code>, <code>node:*</code>, anything needing Node APIs) stay in <code>.server.{js,ts}</code> files, <code>route.ts</code> handlers, or <code>middleware.ts</code>. Never in pages, layouts, or components, because page modules also load in the browser to register transitively imported components. Pages and components import functions from a <code>.server.{js,ts}</code> file; the framework rewrites that import into an RPC stub for the browser.</li>
    </ul>

    <h2>Imports: the <code>#</code> root alias</h2>
    <p>App-internal imports use the <code>#</code> path alias instead of deep <code>../../../</code> relatives:</p>
    <pre>import { db } from '#db/connection.server.ts';
import { Button } from '#components/ui/button.ts';
import { listPosts } from '#modules/posts/queries/list-posts.server.ts';</pre>
    <p>This is Node's native <code>package.json</code> <code>"imports"</code> field. The scaffold ships a single catch-all key, so every top-level folder is aliased and a new one needs no config change:</p>
    <pre>"imports": { "#*": "./*" }</pre>
    <p>It resolves at runtime on Node 24+ AND Bun with no build step and no <code>tsconfig</code> <code>paths</code>. The sigil is <code>#</code> (not <code>@</code>) and there is no slash after it (<code>#lib/...</code>, not <code>#/lib/...</code>): a <code>#/</code>-prefixed key does not resolve on Bun. WebJs expands the same map for its import graph, so a <code>#</code>-aliased <code>.server.ts</code> still trips the server-only boundary, and the browser importmap gets a matching scope per top-level folder automatically. A same-directory import stays a plain relative (<code>./sibling.ts</code>); opt out anywhere by writing a relative path.</p>

    <h2>Request Lifecycle</h2>
    <ol>
      <li><strong>HTTP request arrives</strong> at the Node HTTP server (or HTTP/2 if TLS configured).</li>
      <li><strong>Root middleware</strong> (<code>middleware.ts</code>) runs first if present.</li>
      <li><strong>103 Early Hints</strong> sent (prod only) with modulepreload URLs for the matched page.</li>
      <li><strong>Route matching</strong>: the router tries (in order) internal endpoints, static files, user source modules, API routes (<code>route.ts</code>), then page routes.</li>
      <li><strong>Segment middleware</strong> chain runs (outermost → innermost) for the matched route.</li>
      <li>For <strong>pages</strong>: SSR pipeline runs (load page + layouts, render to HTML, inject DSD, collect metadata, stream response with Suspense).</li>
      <li>For <strong>API routes</strong>: the matched handler function runs, returns a Response.</li>
      <li>For <strong>WebSocket upgrades</strong>: the WS handler is invoked with the ws object + Request.</li>
      <li><strong>Response</strong> is sent (with compression in prod and cache headers).</li>
    </ol>

    <h2>Progressive Enhancement</h2>
    <p>
      Step 6 above produces real HTML. The SSR pipeline runs every web component's <code>render()</code> on the server, so the component's initial markup is in the response before any script loads. The browser paints content, processes <code>&lt;a&gt;</code> links, and handles <code>&lt;form&gt;</code> submissions before any JavaScript runs. The client router, custom-element upgrades, and Suspense streaming are <em>layered</em> on top of that HTML. They enhance an already-working page, they do not constitute it.
    </p>
    <ul>
      <li><strong>Read-paths:</strong> the SSR'd HTML is the user's first interaction. With JS disabled, content reads, <code>&lt;a&gt;</code> links navigate, and display-only custom elements render correctly.</li>
      <li><strong>Write-paths:</strong> server actions are reachable as plain HTML form POSTs. A <code>&lt;form action=${"/actions/foo"}&gt;</code> works without JavaScript, and the framework upgrades it to a partial-swap submission once the client router is active.</li>
      <li><strong>Interactivity:</strong> JavaScript is only required for behaviors that <em>respond</em> to user input: <code>@click</code>, a signal mutation, drag handlers, focus management. The component's <em>initial</em> render is HTML either way. A counter shows "0" without JS, and only the +/- click handling needs scripts.</li>
    </ul>
    <p>See <a href="/docs/progressive-enhancement">Progressive Enhancement</a> for the full design rationale and patterns.</p>

    <h2>Embedding</h2>
    <p>WebJs can be embedded in any Node-compatible runtime via <code>createRequestHandler</code>:</p>
    <pre>import { createRequestHandler } from '@webjsdev/server';

const app = await createRequestHandler({
  appDir: process.cwd(),
  dev: false,
});

// Use with any HTTP server:
const resp = await app.handle(new Request('http://x/api/hello'));
console.log(await resp.json());</pre>

    <p>This returns standard <code>Request → Response</code>, usable in Express, Fastify, Bun, Deno, Cloudflare Workers (with the file-system caveat documented in the deployment guide).</p>

    <p>Coming from Next.js? The execution model above (isomorphic modules, no Server/Client Component split, the <code>.server</code> boundary as the one server boundary) is the biggest difference. The <a href="/docs/migrating-from-nextjs">Migrating from Next.js</a> guide maps each Next idiom to its WebJs equivalent.</p>
  `;
}
