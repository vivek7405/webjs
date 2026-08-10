# WebJs

**The web framework for AI agents.**

## What is WebJs?

**WebJs is an AI-first full-stack JavaScript web framework built on web
components.** It server-renders every page and component to real HTML,
needs no build step or bundler, and runs on Node 24+ or Bun.

Nothing is hidden from your agent. The framework ships in `node_modules` as
plain JavaScript it can read end to end, and your app code is served to the
browser exactly as written. Any model reasons about the whole stack and debugs it,
with no training data required and no single blessed model, on the web
components and standard HTML every model already knows.

**AI-first is a design constraint here, not a marketing tag.** File
conventions are predictable, each server function lives in its own file, and
the `.server.ts` extension marks the server boundary explicitly, so a coding
agent can change one route without loading the whole codebase into context.
Every app ships an `AGENTS.md` contract plus a cross-agent skill that Claude
Code, Cursor, Copilot, Gemini, and opencode all read from one source.

It gives you file-based routing, server actions with real end-to-end types,
sessions, authentication, caching, rate limiting, WebSockets, and a database
layer in the box. `cache()` for queries, HTTP Cache-Control for pages and for
cached GET server actions, a Session class with SessionStorage, NextAuth-style
auth with providers, and WebSocket broadcast all share one pluggable store, so
a single `setStore()` call moves them onto Redis with no config files in
between.

```sh
npm create webjs@latest my-app
```

Full overview at [webjs.dev/what-is-webjs](https://webjs.dev/what-is-webjs).
Not the project you were looking for? [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
(often shortened to wwebjs) is an unrelated WhatsApp client library, and an
older, unrelated Java framework also used the name WebJS.

## Why WebJs

- **WebJs is AI-first.** Predictable file conventions, one function per file, an explicit `.server.ts` boundary, and an `AGENTS.md` contract keep every change local, so an LLM can modify code without loading the entire codebase into context.
- **There is no build step you run.** `.ts` files are served directly, and Node 24+ or Bun is the runtime (run a Bun app with `bun --bun run dev` / `start`). The dev server strips types via Node's built-in `module.stripTypeScriptTypes` (or `amaro` on Bun, byte-identical), which is position-preserving with no sourcemap and near-zero overhead. TypeScript must be erasable, so non-erasable constructs (enums, value-carrying namespaces, constructor parameter properties, legacy decorators with `emitDecoratorMetadata`) fail at strip time with a 500 pointing at the `no-non-erasable-typescript` lint rule, since WebJs is buildless end-to-end with no bundler fallback. You edit, you refresh, and you are done.
- **Components are web components, light DOM by default.** Pages and components render as light DOM so global CSS and Tailwind utilities apply directly, with no `::part`, no `:host`, and no CSS-var plumbing. Shadow DOM is opt-in (`static shadow = true`) when you need scoped styles or third-party-embed isolation. `<slot>` projection (named slots, fallback content, `assignedNodes` / `slotchange`) works identically in both modes, and both modes SSR fully with no hydration runtime.
- **Progressive enhancement is built in.** Pages *and* components are SSR'd to real HTML, and every web component's `render()` runs on the server, so its initial markup is in the response before any script loads. Content reads, links navigate, forms submit (server actions are plain HTML POSTs), and display-only custom elements look right, all without JavaScript. JS is opt-in *per interactive behavior* rather than per component, so a counter renders as "0" without JS and only the +/- click handling needs scripts. The HTML is the floor, and the client router and `@click` / signal interactivity are layered on top.
- **Tailwind CSS is the default styling.** The scaffold compiles a static Tailwind stylesheet (`css:build`, run automatically by dev / start) with shadcn-style `@theme` design tokens, so the app is fully styled with JavaScript disabled. If you prefer hand-written CSS you can opt out entirely, and the framework works just as well with vanilla CSS when you follow the wrapper-scoping convention (`.page-<route>`, `.layout-<name>`, component-tag scoped). The full recipe is in the [Styling docs](./website/app/docs/styling/page.ts).
- **Type safety runs the full stack.** Import a `.server.ts` function from a component and TypeScript sees the real signature. WebJs's built-in ESM serializer on the wire preserves `Date`, `Map`, `Set`, `BigInt`, `TypedArray`, `Blob`, `File`, `FormData`, and reference cycles.
- **Server-file source is unreachable from the browser.** This is a framework invariant: any file ending `.server.{js,ts}` is source-protected. With `'use server'` it serves an RPC stub (a server action), and without it a throw-at-load stub (a server-only utility). Either way the real source never reaches the browser, and the HTTP layer enforces it with regression tests.
- **Routing follows NextJs conventions.** `page.ts`, `layout.ts`, `route.ts`, `error.ts`, `middleware.ts`, `[params]`, `(groups)`, and `_private` all map onto the folder structure, and layouts persist across navigations.
- **The client router ships with the framework.** It intercepts links Turbo-Drive style and stays shadow-DOM-aware via `composedPath()`. Layouts stay mounted while only the page content swaps, so there is no white flash.
- **WebSockets are built in.** Export `WS` from a `route.ts` to define a WebSocket endpoint, and `connectWS()` on the client reconnects automatically.
- **WebJs also runs backend-only.** Skip pages entirely and use it as a lightweight API framework with file routing, middleware, rate limiting, and TypeScript.
- **The essentials ship in the box.** Auth, sessions, caching, WebSocket broadcast, and rate limiting are all built in, sharing one pluggable cache store that is in-memory by default. Call `setStore(redisStore({ url: process.env.REDIS_URL }))` once at startup to move all four onto Redis for horizontal scaling.
- **Components can lazy-load themselves.** Setting `static lazy = true` defers the module download until the component scrolls into the viewport. The SSR content stays visible throughout, so only the JavaScript is lazy.
- **Error boundaries and loading states are file conventions.** `error.ts` catches render failures at any route level, and `loading.ts` automatically wraps pages in Suspense boundaries.
- **Metadata routes are functions rather than static files.** `sitemap.ts`, `robots.ts`, `manifest.ts`, `icon.ts`, and `opengraph-image.ts` generate SEO and PWA metadata dynamically.
- **REST endpoints come from `route.ts`.** Expose a server action over HTTP by importing it into a `route.ts` handler, or reach for the one-line `route(action)` adapter from `@webjsdev/server`. Input validation is optional.
- **WebJs is production ready.** CSRF protection, gzip and brotli, HTTP/2, 103 Early Hints, CSP nonces, modulepreload, rate limiting, health probes, graceful shutdown, and streaming Suspense all ship with the framework.
- **WebJs UI is the matching AI-first component library.** Its 32 primitives at [webjs.dev/ui](https://webjs.dev/ui) are written for AI agents, in two tiers: pure class-helper functions (`buttonClass`, `cardClass`, `inputClass`) for visual primitives, plus a small set of stateful custom elements (`<ui-dialog>`, `<ui-tabs>`, `<ui-popover>`) for the cases where state matters. Running `webjs ui add button card dialog` copies the source into your project, so you own it and can edit it. It ships as a hard dependency of `@webjsdev/cli`, so a WebJs app that installed the CLI needs no separate install, and a WebJs app that skipped the global install runs `npm install -D @webjsdev/ui` and `npm install @webjsdev/core` first, then `npx webjsui init` and `npx webjsui add button card dialog`.

## Quickstart

> **AI agents, read this before scaffolding.** Only two templates exist
> (`full-stack` default, `--template api`), and the CLI rejects anything
> else. Always start from one of them. Never hand-roll the directory
> structure. Default to **full-stack with Drizzle + SQLite**. Never store
> app data in JSON files, in-memory arrays, or localStorage as a
> substitute for the database. The scaffold is **reference only**.
> Replace the example layout, page, components, and `User` model with
> the app the user actually asked for. Picker:
>
> - Any product UI (todo, blog, notes, dashboard, marketplace, social, e-commerce, a SaaS with accounts…) → **default** (`webjs create <name>`)
> - Backend-only HTTP/JSON API, no UI → **`--template api`**
>
> Auth is one of the full-stack gallery cards (login, a signed session, and a real protected route), so a default app already carries a promotable auth baseline.
>
> **The scaffold is a starting point, grown in place.** It ships a gallery index home, a neutral-palette root layout, database wiring, and a densely-commented feature gallery (single-concept demos under `app/features/` plus the `app/examples/todo` app, with logic in `modules/`). The framework context ships as one cross-agent skill, `.agents/skills/webjs/SKILL.md` (a routing skill), alongside `AGENTS.md` and `.agents/rules/workflow.md`. Read the skill and browse the gallery, then build the app the user asked for on top of the scaffold, pruning the demos it does not use.
>
> Full rules: [`AGENTS.md` → How AI agents must scaffold](./AGENTS.md#how-ai-agents-must-scaffold).
> Full framework docs (every API, every recipe): **https://webjs.dev/docs**.

```sh
# Get started in one command (no global install required)
npm create webjs@latest my-app   # full-stack (pages + API + components + Drizzle/SQLite)
cd my-app && npm run dev
# → http://localhost:8080

# Backend-only API (routes + modules + Drizzle, no UI)
npm create webjs@latest my-api  -- --template api

# Auth (login/signup, session, a protected route) ships as a gallery card
# in the default full-stack app. No separate template needed.

# Prefer Bun? webjs runs on Node 24+ or Bun. Add --runtime bun to any
# template (it is orthogonal to --template), or scaffold through Bun and
# it is auto-detected. Both forms below produce the same Bun-flavored app.
bun create webjs my-app                          # auto-detected; runs it with bun --bun run dev
npm create webjs@latest my-app -- --runtime bun  # the explicit flag on any package manager

# Or with the CLI installed globally for repeated use.
# `webjsdev` is the unscoped npm name for @webjsdev/cli; both install the `webjs` command.
npm i -g webjsdev && webjs create my-app
cd my-app && npm run dev

# or run everything in the monorepo (website + docs + blog + UI registry together)
git clone https://github.com/webjsdev/webjs
cd webjs && npm install
cd examples/blog && npm run db:migrate && cd ..
npm run dev
# → Website     → http://localhost:5001
# → Docs        → http://localhost:5002
# → UI registry → http://localhost:5003
# → Blog        → http://localhost:5004
```

See [Local development](#local-development) for running one app at a time and overriding ports.

## Repo layout

```
packages/
  # Framework (the things webjs ships at runtime)
  core/             # @webjsdev/core: html, css, WebComponent, renderers, client router
  server/           # @webjsdev/server: dev/prod server, router, SSR, actions, WS
  cli/              # @webjsdev/cli: webjs dev/start/create/db/test/check/ui
  intellisense/       # @webjsdev/intellisense: standalone editor intelligence (own template parser, no Lit dep)
  ui/               # @webjsdev/ui: AI-first component library + CLI

  # Scaffold entry points (peer wrappers around @webjsdev/cli)
  create-webjs/ # `npx create-webjs@latest my-app` (mirrors create-next-app)
  webjsdev/         # unscoped npm name for @webjsdev/cli (so `npm i -g webjsdev` works without a scope)
examples/
  blog/             # full-featured reference app (auth, posts, comments, chat)
gallery/            # the feature gallery every scaffolded app ships, as a live app
website/            # landing site AND the documentation at /docs and gallery at /ui
AGENTS.md           # AI-agent contract for the framework
CLAUDE.md           # Claude Code quick-reference
```

## Local development

Contributing to the framework itself? Run the monorepo's apps from their
own dir with `npm run dev`; as of #550 a bare `webjs dev` is equivalent
(each app's Tailwind compile and prep steps, `webjs db migrate`,
the registry copy, moved into its `webjs.dev` / `webjs.start` tasks config,
which `webjs dev`/`start` run, so the npm scripts are thin aliases). In dev
the Tailwind stylesheet is recompiled on request when a source changes
(`webjs.dev.regenerate`, #967), so it never goes stale without a live watcher.

```sh
npm install                          # once, from the repo root (installs every workspace)
npm run dev                          # both apps at once
```

Default ports (port 5000 is skipped because macOS reserves it for the
AirPlay Receiver / Control Center):

| App | Dir | Port | Env override |
|---|---|---|---|
| Landing site, docs, UI gallery | `website/` | 5001 | `WEBSITE_PORT` |
| Example blog | `examples/blog/` | 5004 | `BLOG_PORT` |
| Feature gallery | `gallery/` | 5005 | `PORT` |

**Run a single app** (from its directory). Each honors a `PORT` env var:

```sh
cd website && npm run dev            # landing site + docs on 5001
PORT=8080 npm run dev                # ...or on 8080
```

**Override ports when running both** via the per-app env vars:

```sh
WEBSITE_PORT=8001 BLOG_PORT=8004 npm run dev
```

> Use the `PORT` / `*_PORT` env vars, **not** a `--port` flag. `npm run dev
> --port 5678` does not work: npm parses `--port` as its own (deprecated)
> config, and the `dev` script runs each app through `concurrently`, which
> would intercept any passthrough args before they reached `webjs dev`. The
> env var is the supported interface (and the conventional one: Railway,
> Heroku, Fly, etc. all drive port via `PORT`).

The landing site cross-links to the demo by URL, defaulting to the localhost
port above and overridable via `EXAMPLE_BLOG_URL` (this is also how a deploy
points it at the real domain). Nothing else needs a URL: the docs and the UI
gallery are served by the landing site itself at `/docs` and `/ui`, so they are
plain paths.

## Example

```ts
// app/page.ts: server-rendered, async data fetching
import { html, repeat } from '@webjsdev/core';
import '#components/counter.ts';
import { listPosts } from '#modules/posts/queries/list-posts.server.ts';

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
// components/counter.ts: interactive web component, light DOM + Tailwind
import { WebComponent, html } from '@webjsdev/core';

export class Counter extends WebComponent({ count: Number }) {
  // `count` is a reactive property, declared in the base-class factory with
  // no `declare` line, so the count="3" attribute on the SSR'd tag seeds it
  // and every assignment re-renders. Light DOM is the default, so Tailwind
  // utility classes apply directly.
  constructor() {
    super();
    this.count = 0;
  }

  render() {
    return html`
      <div class="inline-flex items-center gap-2 font-mono">
        <button class="px-3 py-1 rounded border border-border hover:bg-bg-elev" @click=${() => this.count--}>−</button>
        <output class="min-w-[2ch] text-center">${this.count}</output>
        <button class="px-3 py-1 rounded border border-border hover:bg-bg-elev" @click=${() => this.count++}>+</button>
      </div>
    `;
  }
}
Counter.register('my-counter');
```

Need scoped styles or embed-ready isolation? Opt in to shadow DOM with
`static shadow = true` and author styles via `static styles = css\`…\``.
`<slot>` projection works in both modes (light DOM uses framework
projection, same API).

```ts
// modules/posts/queries/list-posts.server.ts: one function per file
'use server';
import { db } from '#db/connection.server.ts';

export async function listPosts() {
  return db.query.posts.findMany({ orderBy: { createdAt: 'desc' } });
}
```

## Production

No build step. The same source files that ran in `webjs dev` also run in
production, served as native ES modules via importmap, with
`<link rel="modulepreload">` hints emitted at SSR time so the browser
fetches the page's modules in parallel over a single HTTP/2 connection.
Same model as Rails 7+ with `importmap-rails`.

```sh
PORT=8080 npm run start                            # JSON logs, gzip/brotli, ETag, streaming
```

The production server speaks plain HTTP/1.1. The expected production topology
is a reverse proxy in front that terminates TLS and speaks HTTP/2 to
the browser. **PaaS edges already do this for free.** Railway, Fly,
Render, Vercel, Cloudflare Pages, and Heroku all serve HTTP/2
to clients while proxying HTTP/1.1 to your container. For bare-VM or
self-hosted deploys, put nginx, Caddy, or Traefik in front. HTTP/2 at
the edge matters because webjs's per-file ESM model benefits from
HTTP/2 multiplex. HTTP/1.1-only deployments still work, just slower
on cold cache.

Health: `GET /__webjs/health`. Graceful shutdown on `SIGTERM`.

Embed in Express/Fastify/Bun/Deno:

```ts
import { createRequestHandler } from '@webjsdev/server';
const app = await createRequestHandler({ appDir: process.cwd() });
const resp = await app.handle(new Request('http://x/api/hello'));
```

## Documentation

The docs are part of the landing site, served at `/docs` and built on WebJs
itself. They live in `website/app/docs/`, so running the site runs them:

```sh
cd website && npm run dev    # webjs dev; compiles Tailwind, then recompiles on request (see AGENTS.md)
```

`docs.webjs.dev` still resolves, as a Cloudflare redirect rule rather than an
app in this repo. It sends every request to `webjs.dev/docs`, the hub page,
rather than to the matching page.

The pages cover: getting started, AI-first development, routing,
components, SSR, styling, Suspense, loading states, error handling,
client router, server actions, REST endpoints, API routes,
WebSockets, database, authentication, TypeScript, middleware,
rate limiting, lazy loading, metadata routes, caching, sessions,
controllers, context protocol, task, deployment, backend-only mode,
testing, conventions, configuration, editor setup.

## Status

Pre-1.0, released continuously. Current versions of every package
(`@webjsdev/core`, `@webjsdev/server`, `@webjsdev/cli`, `@webjsdev/ui`) are on
the [changelog](https://webjs.dev/changelog). Behaviour is covered by unit,
browser (web-test-runner), and puppeteer e2e suites, plus example-app smoke
tests. Key features:

- **Core:** Signals (`signal`, `computed`, `effect`, `batch`, TC39 Stage 1 shape) as the default state primitive, with WebComponent's built-in SignalWatcher auto-tracking `.get()` reads inside `render()`. Reactive properties via the declare-free base-class factory `extends WebComponent({ count: Number })` (the `prop()` helper carries options like `reflect` / `state` / `attribute` / `default`), reserved for HTML attribute round-trip (a direct `static properties` block throws at runtime, flagged by the `no-static-properties` rule, and a class-field initializer on a factory prop is caught by `reactive-props-no-class-field`). Full lit-API parity: ReactiveController hooks (`hostConnected`, `hostDisconnected`, `hostUpdate`, `hostUpdated`) and lifecycle (`shouldUpdate`, `willUpdate`, `update`, `updated`, `firstUpdated`, `updateComplete`), 12 directives (`repeat`, `unsafeHTML`, `live`, `keyed`, `guard`, `templateContent`, `ref` + `createRef`, `cache`, `until`, `asyncAppend`, `asyncReplace`, `watch`). SSR with DSD (opt-in) + light-DOM hydration (default), light-DOM `<slot>` projection (framework-driven, same API as shadow DOM), fine-grained client renderer, `Suspense()`, client router with `composedPath()` for shadow DOM, mixed-attribute interpolation, MutationObserver upgrade safety net.
- **Data:** Server actions with webjs's built-in serializer (`Date`, `Map`, `Set`, `BigInt`, `TypedArray`, `Blob`, `File`, `FormData`, reference cycles all survive the wire). Two-marker server-file convention: `.server.{js,ts}` for path-level source-protection (browser imports get a throw-at-load stub), `'use server'` for RPC registration (file is also browser-callable). REST over HTTP via a `route.ts` (or the `route()` adapter) with an optional `validate` config export. `json()` + `richFetch()` for content-negotiated APIs. `cache()` for server-side query caching with TTL + `invalidate()`. `WEBJS_PUBLIC_*` env vars injected into `window.process.env` at SSR (no build step, no transform).
- **Server:** File router with `page.ts`, `layout.ts`, `route.ts`, `error.ts`, `loading.ts`, `not-found.ts`, `middleware.ts`, metadata routes (`sitemap`, `robots`, `manifest`, `icon`, `opengraph-image`), per-segment middleware, `rateLimit()`, WebSockets (`WS` export + `connectWS()` + `broadcast()`), CSRF, gzip / brotli compression, HTTP/2, 103 Early Hints, modulepreload hints, health probes, graceful shutdown on `SIGTERM`, `Session` class with `SessionStorage` (cookie or store-backed), NextAuth-style `createAuth()` (Credentials, Google, GitHub), single pluggable cache store (in-memory by default, swap to Redis with one `setStore()` call shared by auth, sessions, caching, and rate limiting).
- **DX:** Node 24+ or Bun runtime (run a Bun app with `bun --bun run dev` / `start`, and the CLI hot-reloads via `node --watch` on Node and `bun --hot` on Bun), with the dev server stripping TypeScript via Node's built-in `module.stripTypeScriptTypes` (or `amaro` on Bun, byte-identical), zero build, position-preserving, no sourcemap. Non-erasable TS (enums, value-carrying namespaces, constructor parameter properties, legacy decorators) fails with a 500 pointing at the `no-non-erasable-typescript` lint rule. WebJs is buildless end-to-end and has no bundler fallback. Vendor (`node_modules`) packages resolve through importmap to jspm.io URLs at runtime; the WebJs server doesn't bundle them. `webjs vendor pin` writes resolved URLs to `.webjs/vendor/importmap.json` for deterministic deploys; `webjs vendor pin --download` additionally vendors bundle bytes for offline-capable production. `webjs check` lint covers `use-server-needs-extension`, `no-server-env-in-components`, `no-static-properties`, `reactive-props-no-class-field`, `erasable-typescript-only`, `no-non-erasable-typescript`, `shell-in-non-root-layout`, and more (run `webjs check --rules` to enumerate). Single cross-agent source: `AGENTS.md` (read natively by Cursor, opencode, Antigravity, and the Copilot coding agent) plus the shipped skill `.agents/skills/webjs/SKILL.md` and the workflow rules in `.agents/rules/workflow.md`. Tools that do not read `AGENTS.md` natively get a thin bridge pointing at it (`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`), and Claude Code adds a `.claude/settings.json` PreToolUse hook guarding edits on `main`. Live reload in dev (`fs.watch` + SSE). `@webjsdev/intellisense` is the standalone editor-only piece (no Lit dependency): its own `` html`…` `` template parser drives go-to-definition on tags / attributes / CSS classes, binding-aware completions, value/binding diagnostics, and hover, all gated by the file's import graph. The `webjs` VS Code / Cursor / Windsurf extension bundles it. Not required for the framework to run.
- **Release:** Per-package per-version changelog under `changelog/<pkg>/<version>.md`, auto-generated on the same commit that bumps a `package.json` `version` field (universal pre-commit hook). The `.github/workflows/release.yml` workflow watches for new changelog files on `main` and dual-publishes to npm (`npm publish --workspace=@webjsdev/<pkg>`) and GitHub Releases (`gh release create <pkg>@<version>`), both idempotent so re-runs pick up where they left off. Free for public repos via `NPM_TOKEN` + the auto-provisioned `GITHUB_TOKEN`.

## License

MIT
