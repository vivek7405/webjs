# webjs

**AI-first. Batteries included. Web components first.**

Full-stack web framework inspired by NextJs, Lit, and Rails. `cache()` for
queries, HTTP Cache-Control for pages, Session class with SessionStorage,
NextAuth-style auth with providers, WebSocket broadcast, rate limiting — set
`REDIS_URL` and everything scales horizontally. Web components first,
TypeScript with zero build step, real SSR with Declarative Shadow DOM.

## Why webjs

- **AI-first.** Predictable file conventions, one function per file, explicit `.server.ts` boundary, `AGENTS.md` contract — designed so LLMs modify code without loading the entire codebase into context.
- **No build.** `.ts` files served directly. Node 23.6+ strips types at runtime; the dev server strips types via esbuild for the browser (~1ms/file, cached). Edit, refresh, done.
- **Web components.** Shadow DOM + Declarative Shadow DOM for real SSR. Components paint before JS loads. No hydration runtime.
- **Full-stack type safety.** Import a `.server.ts` function from a component — TypeScript sees the real signature. superjson on the wire preserves `Date`, `Map`, `Set`, `BigInt`.
- **NextJs-style routing.** `page.ts`, `layout.ts`, `route.ts`, `error.ts`, `middleware.ts`, `[params]`, `(groups)`, `_private`. Layouts persist across navigations.
- **Client router.** Turbo-Drive-style link interception. Shadow-DOM-aware via `composedPath()`. Layouts stay mounted, only page content swaps. No white flash.
- **WebSockets built in.** Export `WS` from `route.ts` → WebSocket endpoint. `connectWS()` on the client auto-reconnects.
- **Backend-only mode.** Skip pages entirely — use webjs as a lightweight API framework with file routing, middleware, rate limiting, and TypeScript.
- **Batteries included.** `cache()` for server-side query caching, HTTP `Cache-Control` for pages, `Session` class with `SessionStorage` interface, NextAuth-style `createAuth()` with OAuth + credentials + JWT, WebSocket `broadcast()`, `rateLimit()` — all built in. Set `REDIS_URL` → everything scales across instances.
- **Production ready.** CSRF, gzip/brotli, HTTP/2, 103 Early Hints, CSP nonces, modulepreload, rate limiting, health probes, graceful shutdown, streaming Suspense.

## Quickstart

```sh
git clone https://github.com/vivek7405/webjs
cd webjs && npm install

cd examples/blog
npx prisma migrate dev --name init
npx webjs dev
# → http://localhost:3000
```

## Repo layout

```
packages/
  core/       # webjs — html, css, WebComponent, renderers, client router
  server/     # @webjs/server — dev/prod server, router, SSR, actions, WS
  cli/        # @webjs/cli — webjs dev/start/build/db
examples/
  blog/       # full-featured reference app (auth, posts, comments, chat)
docs/         # documentation site (built on webjs itself)
AGENTS.md     # AI-agent contract for the framework
CLAUDE.md     # Claude Code quick-reference
```

## Example

```ts
// app/page.ts — server-rendered, async data fetching
import { html, repeat } from 'webjs';
import '../components/counter.ts';
import { listPosts } from '../modules/posts/queries/list-posts.server.ts';

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

```ts
// components/counter.ts — interactive web component with shadow DOM
import { WebComponent, html, css } from 'webjs';

export class Counter extends WebComponent {
  static tag = 'my-counter';
  static properties = { count: { type: Number } };
  static styles = css`
    :host { display: inline-flex; gap: 8px; }
    button { font: inherit; padding: 4px 12px; }
  `;
  count = 0;

  render() {
    return html`
      <button @click=${() => { this.count--; this.requestUpdate(); }}>−</button>
      <output>${this.count}</output>
      <button @click=${() => { this.count++; this.requestUpdate(); }}>+</button>
    `;
  }
}
Counter.register(import.meta.url);
```

```ts
// modules/posts/queries/list-posts.server.ts — one function per file
'use server';
import { prisma } from '../../../lib/prisma.ts';

export async function listPosts() {
  return prisma.post.findMany({ orderBy: { createdAt: 'desc' } });
}
```

## Production

```sh
npx webjs build                     # optional: bundle for fewer HTTP requests
npx webjs start --port 8080         # JSON logs, gzip/brotli, ETag, streaming
```

Health: `GET /__webjs/health`. Graceful shutdown on `SIGTERM`.

Embed in Express/Fastify/Bun/Deno:

```ts
import { createRequestHandler } from '@webjs/server';
const app = await createRequestHandler({ appDir: process.cwd() });
const resp = await app.handle(new Request('http://x/api/hello'));
```

## Documentation

The docs site is built on webjs itself:

```sh
cd docs && npx webjs dev --port 4000
```

18 pages covering: getting started, AI-first development, routing,
components, SSR, styling, Suspense, server actions, API routes,
WebSockets, database, authentication, TypeScript, middleware,
deployment, backend-only mode, testing, configuration.

## Status

Pre-1.0. 70 unit tests. Key features:

- **Core:** SSR with DSD, fine-grained client renderer, `repeat()`, `Suspense()`, client router with `composedPath()` for shadow DOM
- **Data:** server actions + superjson (Date/Map/Set/BigInt survive the wire), `expose()` for REST, `json()` + `richFetch()` for content-negotiated APIs, `cache()` for server-side query caching with TTL + `invalidate()`
- **Server:** file router, per-segment middleware, `rateLimit()`, WebSockets + `broadcast()`, CSRF, compression, HTTP/2, 103 Early Hints, health probes, graceful shutdown, `Session` class with `SessionStorage` (cookie or store-backed), NextAuth-style `createAuth()` (Credentials, Google, GitHub)
- **DX:** TypeScript with zero build, `AGENTS.md` contract, `CLAUDE.md`, live reload in dev, optional esbuild bundle for prod

## License

MIT
