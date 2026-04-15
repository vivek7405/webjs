# webjs

A no-build, web-components-first, Next.js-inspired full-stack framework.
SSR + CSR, file-based routing, API routes, server actions — plain JavaScript
(JSDoc) or TypeScript, zero bundler, ships ES modules straight to the browser.

## Why

- **No build.** `.js` or `.ts` files are served to the browser directly.
  Edit, refresh, done. Node 23.6+ strips TS types at runtime on the server;
  the dev server strips types via esbuild for files served to the browser.
- **Full-stack type safety.** Import a server action from a client component
  and TypeScript sees the real function signature. The RPC wire uses
  superjson so `Date` / `Map` / `Set` / `BigInt` round-trip as their real
  types — what the type says is what you get at runtime.
- **Web components first.** Components define their own custom element +
  shadow-DOM styles. SSR emits Declarative Shadow DOM; the browser upgrades
  on connection — no hydration runtime in the critical path.
- **Next.js-style routing.** `app/page.js`, `app/[slug]/page.js`,
  `app/api/foo/route.js`, `app/error.js`, `app/not-found.js`, `(group)`,
  `_private`, layouts, async pages, `metadata`, `notFound()`, `redirect()`.
- **Server actions, both ways.** Import a `.server.js` function from a
  client component → it auto-rewrites into a CSRF-protected RPC stub.
  Wrap the same function in `expose('POST /api/posts', fn, { validate })` →
  it's also a first-class REST endpoint for external consumers. **One
  function, two callers, no `route.js` wrapper.**
- **Fine-grained client renderer.** Re-renders touch only the parts that
  changed; element identity, focus, cursor, scroll, and form state survive
  state updates. `repeat(items, key, tpl)` does keyed list reconciliation.
- **Production batteries.** CSRF on action RPC, error sanitisation in prod,
  graceful shutdown, Cache-Control + ETag on static assets, gzip/brotli
  negotiation, health endpoint, pluggable JSON logger, programmatic
  `createRequestHandler` for embedding.
- **Prisma + SQLite by default.** Schema-first via `webjs db migrate` /
  `webjs db generate` (Prisma CLI under the hood).

## Quickstart

```sh
git clone <this-repo> webjs && cd webjs
npm install                         # links workspaces

cd examples/blog
npx prisma migrate dev --name init  # create dev.db
npx webjs dev                       # http://localhost:3000
```

Open the home page, create a post via the form, watch the counter
component, then try:

```sh
curl http://localhost:3000/api/posts                  # GET — exposed action
curl -X POST http://localhost:3000/api/posts \        # POST — same function
  -H "content-type: application/json" \
  -d '{"title":"Hello","body":"World"}'
curl http://localhost:3000/__webjs/health             # health probe
```

## Repo layout

```
packages/
  core/     # webjs — html, css, WebComponent, isomorphic renderers, repeat,
            #         expose, notFound, redirect
  server/   # @webjs/server — dev/prod server, router, SSR, actions, csrf,
            #                 logger, compression, createRequestHandler
  cli/      # @webjs/cli — `webjs` binary
examples/
  blog/     # reference app exercising every feature
AGENTS.md   # the contract for AI agents and humans editing webjs apps
```

## Tiny example

```js
// app/page.js
import { html, repeat } from 'webjs';
import '../components/counter.js';
import { listPosts } from '../actions/posts.server.js';

export const metadata = { title: 'home' };

export default async function Home() {
  const posts = await listPosts();
  return html`
    <h1>posts</h1>
    <ul>
      ${repeat(posts, p => p.id, p => html`<li>${p.title}</li>`)}
    </ul>
    <my-counter count="3"></my-counter>
  `;
}
```

```js
// components/counter.js
import { WebComponent, html, css } from 'webjs';

export class Counter extends WebComponent {
  static tag = 'my-counter';
  static properties = { count: { type: Number } };
  static styles = css`button { font: inherit; }`;
  constructor() { super(); this.count = 0; }
  bump(d) { this.count += d; this.requestUpdate(); }
  render() {
    return html`
      <button @click=${() => this.bump(-1)}>−</button>
      <output>${this.count}</output>
      <button @click=${() => this.bump(1)}>+</button>
    `;
  }
}
// Pass import.meta.url so the SSR shell can emit <link rel=modulepreload>
// — breaks the ES-module waterfall without a bundler.
Counter.register(import.meta.url);
```

```js
// actions/posts.server.js
'use server';
import { expose } from 'webjs';
import { db } from './_db.js';

export const listPosts = expose('GET /api/posts', async () =>
  db.post.findMany({ orderBy: { createdAt: 'desc' } })
);

export const createPost = expose(
  'POST /api/posts',
  async ({ title, body }) => db.post.create({ data: { title, body, slug: slugify(title) } }),
  { validate(input) {
      if (!input?.title || !input?.body) throw new Error('title and body required');
      return input;
    }
  }
);
```

That's the whole stack: page renders posts, component handles client
interactivity, action serves both internal RPC and external REST.

## Production

```sh
cd examples/blog
npx prisma migrate deploy
npx webjs build                     # bundles components+pages to .webjs/bundle.js
npx webjs start --port 8080         # JSON logs, gzip/brotli, ETag, streaming, …
```

Health endpoint: `GET /__webjs/health`. Graceful shutdown on `SIGTERM`.

To embed inside an existing Node server:

```js
import { createRequestHandler } from '@webjs/server';
const app = await createRequestHandler({ appDir: process.cwd() });
// Express:
expressApp.use(async (req, res) => {
  const webReq = new Request(`http://${req.headers.host}${req.url}`, { … });
  const resp = await app.handle(webReq);
  // pipe resp into res
});
```

## Status

Pre-1.0 but production-shape. Hardening highlights:

- Security: CSRF on RPC, prod error sanitisation, `expose()` validate hook.
- Rendering: fine-grained client diffing (focus/cursor survive setState),
  keyed list reconciliation (`repeat`), **streaming SSR with Suspense**
  (fallback flushes immediately; deferred content streams as it resolves).
- Backend parity: `route.js` anywhere, `cookies()`/`headers()`, CORS,
  per-segment middleware, **built-in rate limiter**, `createRequestHandler`
  for embedding.
- Performance (no-build default): automatic `<link rel="modulepreload">`
  for every component on the page, 103 Early Hints before SSR starts,
  HTTP/2 via `--http2 --cert … --key …`, gzip/brotli, ETag + long cache
  headers, streaming response bodies. Optional `webjs build` bundles
  everything via esbuild when request count still matters.
- Ops: health probe, graceful shutdown (SIGTERM/SIGINT), JSON logger,
  process-level error handlers, SSE keepalive against proxy timeouts.
- Tokens: HTML comments and `<script>`/`<style>` raw-text correctly parsed.
- Edge-portable CSRF uses Web Crypto — `createRequestHandler.handle(req)`
  runs anywhere Request/Response work.

Deliberately deferred (see `AGENTS.md`): per-route code splitting,
Vite-grade HMR with state preservation, RSC Flight protocol, full edge
runtime portability (file-system loader on Workers), i18n, image opt.

## Tests

```sh
npm test              # 60 unit tests across renderer (server + client),
                      # router, actions, csrf, expose, repeat, Suspense,
                      # context, fine-grained diffing, rate-limit,
                      # comment + rawtext parsing, segment middleware
```
