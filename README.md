# webjs

**AI-first. Web components first.**

Full-stack web framework built on top of Web Components. `cache()` for
queries, HTTP Cache-Control for pages, Session class with SessionStorage,
NextAuth-style auth with providers, WebSocket broadcast, rate limiting.
Swap the in-memory cache store for Redis with a single `setStore()` call
(no config files, no build step in between). Web components first,
TypeScript with zero build step, real SSR with Declarative Shadow DOM.

## Why webjs

- **AI-first.** Predictable file conventions, one function per file, explicit `.server.ts` boundary, `AGENTS.md` contract — designed so LLMs modify code without loading the entire codebase into context.
- **No build step you run.** `.ts` files served directly. The dev server transforms TypeScript via esbuild for both server-side imports (SSR) and browser-bound modules (hydration) — same transformer for both, ~1ms/file, cached by mtime. Full TS feature support (enums, decorators, parameter properties — anything esbuild handles). Edit, refresh, done.
- **Web components, light DOM by default.** Pages and components render as light DOM so global CSS and Tailwind utilities apply directly — no `::part`, no `:host`, no CSS-var plumbing. Shadow DOM is opt-in (`static shadow = true`) when you need scoped styles or real `<slot>` projection. Both modes SSR fully, no hydration runtime.
- **Tailwind CSS by default.** The scaffold ships with the Tailwind browser runtime + `@theme` design tokens. Prefer hand-written CSS? Opt out entirely — the framework works just as well with vanilla CSS when you follow the wrapper-scoping convention (`.page-<route>`, `.layout-<name>`, component-tag scoped). Full recipe in the [Styling docs](./docs/app/docs/styling/page.ts).
- **Full-stack type safety.** Import a `.server.ts` function from a component — TypeScript sees the real signature. webjs's built-in ESM serializer on the wire preserves `Date`, `Map`, `Set`, `BigInt`, `TypedArray`, `Blob`, `File`, `FormData`, and reference cycles.
- **Server-file source is unreachable from the browser.** Framework invariant: any file ending `.server.{js,ts}` or starting with `'use server'` is always served as an RPC stub, never its real source. Enforced in the HTTP layer with regression tests.
- **NextJs-style routing.** `page.ts`, `layout.ts`, `route.ts`, `error.ts`, `middleware.ts`, `[params]`, `(groups)`, `_private`. Layouts persist across navigations.
- **Client router.** Turbo-Drive-style link interception. Shadow-DOM-aware via `composedPath()`. Layouts stay mounted, only page content swaps. No white flash.
- **WebSockets built in.** Export `WS` from `route.ts` → WebSocket endpoint. `connectWS()` on the client auto-reconnects.
- **Backend-only mode.** Skip pages entirely — use webjs as a lightweight API framework with file routing, middleware, rate limiting, and TypeScript.
- **Built-in essentials.** Auth, sessions, caching, WebSocket broadcast, rate limiting — all built in, sharing one pluggable cache store. In-memory by default; call `setStore(redisStore({ url: process.env.REDIS_URL }))` once at startup to put all four on Redis for horizontal scaling.
- **Lazy loading.** `static lazy = true` defers module download until the component scrolls into the viewport. SSR content stays visible — only the JS is lazy.
- **Error boundaries & loading states.** `error.ts` catches render failures at any route level. `loading.ts` auto-wraps pages in Suspense boundaries.
- **Metadata routes.** `sitemap.ts`, `robots.ts`, `manifest.ts`, `icon.ts`, `opengraph-image.ts` — dynamic SEO/PWA metadata from functions, not static files.
- **`expose()` for REST.** Tag a server action with `expose('POST /api/posts', fn)` to make it reachable over HTTP and via RPC. Optional input validation.
- **Production ready.** CSRF, gzip/brotli, HTTP/2, 103 Early Hints, CSP nonces, modulepreload, rate limiting, health probes, graceful shutdown, streaming Suspense.

## Quickstart

```sh
# install once
npm i -g @webjskit/cli

# scaffold a new app
webjs create my-app                  # full-stack (pages + API + components + Prisma/SQLite)
cd my-app && npm install && npm run dev
# → http://localhost:3000

# or backend-only API
webjs create my-api --template api

# or SaaS starter (auth + dashboard + Prisma)
webjs create my-app --template saas

# or run everything in the monorepo (website + docs + blog together)
git clone https://github.com/vivek7405/webjs
cd webjs && npm install
cd examples/blog && npx prisma migrate dev --name init && cd ..
npm run dev
# → Website → http://localhost:5000
# → Docs    → http://localhost:4000
# → Blog    → http://localhost:3456
#
# Or run any one individually:
cd examples/blog && npm run dev      # just the blog
cd docs           && npm run dev     # just the docs
cd website        && npm run dev     # just the website
```

## Repo layout

```
packages/
  core/       # webjs — html, css, WebComponent, renderers, client router
  server/     # @webjskit/server — dev/prod server, router, SSR, actions, WS
  cli/        # @webjskit/cli — webjs dev/start/build/db
examples/
  blog/       # full-featured reference app (auth, posts, comments, chat)
docs/         # documentation site (built on webjs itself)
AGENTS.md     # AI-agent contract for the framework
CLAUDE.md     # Claude Code quick-reference
```

## Example

```ts
// app/page.ts — server-rendered, async data fetching
import { html, repeat } from '@webjskit/core';
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
// components/counter.ts — interactive web component, light DOM + Tailwind
import { WebComponent, html } from '@webjskit/core';

export class Counter extends WebComponent {
  // Light DOM is the default; Tailwind utility classes apply directly.
  static properties = { count: { type: Number } };
  count = 0;

  render() {
    return html`
      <div class="inline-flex items-center gap-2 font-mono">
        <button class="px-3 py-1 rounded border border-border hover:bg-bg-elev" @click=${() => { this.count--; this.requestUpdate(); }}>−</button>
        <output class="min-w-[2ch] text-center">${this.count}</output>
        <button class="px-3 py-1 rounded border border-border hover:bg-bg-elev" @click=${() => { this.count++; this.requestUpdate(); }}>+</button>
      </div>
    `;
  }
}
Counter.register('my-counter');
```

Need scoped styles, `<slot>` projection, or embed-ready isolation? Opt
in to shadow DOM with `static shadow = true` and author styles via
`static styles = css\`…\``.

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
webjs build                     # optional: bundle for fewer HTTP requests
webjs start --port 8080         # JSON logs, gzip/brotli, ETag, streaming
```

Health: `GET /__webjs/health`. Graceful shutdown on `SIGTERM`.

Embed in Express/Fastify/Bun/Deno:

```ts
import { createRequestHandler } from '@webjskit/server';
const app = await createRequestHandler({ appDir: process.cwd() });
const resp = await app.handle(new Request('http://x/api/hello'));
```

## Documentation

The docs site is built on webjs itself:

```sh
cd docs && webjs dev --port 4000
```

37 pages covering: getting started, AI-first development, routing,
components, SSR, styling, Suspense, loading states, error handling,
client router, server actions, expose() REST endpoints, API routes,
WebSockets, database, authentication, TypeScript, middleware,
rate limiting, lazy loading, metadata routes, caching, sessions,
controllers, context protocol, task, deployment, backend-only mode,
testing, conventions, configuration, editor setup.

## Status

Pre-1.0. 632 unit tests (96.6% line coverage, 87.5% branch, 93.6% function),
36 puppeteer e2e tests, 27 WTR browser tests. Key features:

- **Core:** SSR with DSD (opt-in) + light-DOM hydration (default), fine-grained client renderer, `repeat()`, `Suspense()`, client router with `composedPath()` for shadow DOM, mixed-attribute interpolation, MutationObserver upgrade safety net
- **Data:** server actions with webjs's built-in serializer (Date/Map/Set/BigInt/TypedArray/Blob/File/FormData/cycles survive the wire), `expose()` for REST, `json()` + `richFetch()` for content-negotiated APIs, `cache()` for server-side query caching with TTL + `invalidate()`
- **Server:** file router, per-segment middleware, `rateLimit()`, WebSockets + `broadcast()`, CSRF, compression, HTTP/2, 103 Early Hints, health probes, graceful shutdown, `Session` class with `SessionStorage` (cookie or store-backed), NextAuth-style `createAuth()` (Credentials, Google, GitHub)
- **DX:** TypeScript with zero build, `AGENTS.md` contract, `CLAUDE.md`, live reload in dev, optional esbuild bundle for prod, `@webjskit/ts-plugin` for tsserver — tag-name and CSS-class-name go-to-definition inside `html\`\`` templates.

## License

MIT
