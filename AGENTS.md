# AGENTS.md — webjs

This file is the contract for **AI agents** (and humans) editing a webjs app.
It describes file conventions, the public API, invariants to preserve, and
recipes for common tasks. Keep it in sync whenever behaviour changes.

---

## What webjs is

A **no-build, web-components-first** framework modeled after Next.js App Router.

- **No build step.** Source files are served to the browser as native ES modules.
- **JSDoc, not TypeScript.** Authoring in plain `.js`; types live in doc comments.
- **SSR + CSR by default.** Pages are server-rendered (real HTML, no hydration fallback). Interactive web components ship Declarative Shadow DOM and upgrade on the client.
- **Server actions.** Any file ending `.server.js` (or starting with `'use server'`) exports functions the client imports and calls directly — the import is rewritten into an RPC stub.

---

## App layout (cannot be renamed)

```
app/                        thin route adapters — import from modules/
  layout.js                 root layout, wraps every page
  page.js                   /
  error.js                  nested error boundary (catches render errors)
  not-found.js              404 page (only at app/ root)
  <segment>/page.js         /<segment>
  [param]/page.js           dynamic route; `params.param` in handler
  [...rest]/page.js         catch-all
  (group)/…                 route group — folder NOT in URL; still scopes layout/error
  _private/…                private folder — fully ignored by the router
  <path>/route.js           HTTP handler at /<path> — may live anywhere under app/
  <segment>/middleware.js   per-segment middleware (auth gate, rate limit, …)
middleware.js               root-level middleware (runs on every request)
lib/                        cross-cutting infra (prisma.js, session.js, password.js, …)
modules/                    feature-scoped business logic
  <feature>/
    actions/                mutations — one file per action, `'use server'`
    queries/                reads — one file per query, `'use server'`
    utils/                  internal helpers (formatters, pure fns)
    types.js                JSDoc typedefs shared across the module
components/*.js             presentational web components (shared UI)
public/*                    static assets, served at /<name>
prisma/schema.prisma        data models
```

Every file is a plain ES module. No config required.

---

## Public API — `webjs`

Import from the bare specifier `'webjs'` (resolved via the injected import map).

```js
import { html, css, WebComponent, render, renderToString } from 'webjs';
```

| Export            | Purpose |
| ----------------- | ------- |
| `html`            | Tagged template literal producing a `TemplateResult`. Use in pages, layouts, and component `render()`. |
| `css`             | Tagged template literal producing a `CSSResult`. Assign to `static styles` on components. |
| `WebComponent`    | Base class for interactive components. |
| `register(tag,C)` | Register a tag → class. Called automatically by `Class.register()`. |
| `render(v, el)`   | Client-side: render a value into a DOM element. |
| `renderToString`  | Server-side: **async** — render a value to an HTML string with DSD injection. Awaits Promise-valued holes and async component `render()` methods. |
| `notFound()`      | Throw inside a page/layout/server action to return a 404 rendered via `not-found.js`. |
| `redirect(url)`   | Throw inside a page/layout/server action to return a 307 (default) or 308 redirect. |
| `expose(p, fn)`   | Tag a server action to ALSO be reachable at a REST path, e.g. `expose('POST /api/posts', fn)`. Optional `{ validate }` runs before the handler over HTTP. |
| `repeat(items, k, t)` | Keyed list directive — `${repeat(items, it => it.id, it => html\`...\`)}`. Preserves element identity / focus when items reorder. |
| `Suspense({fallback, children})` | Streaming boundary — server flushes `fallback` immediately, streams `children` (a Promise<TemplateResult>) when it resolves. |
| `connectWS(url, handlers)` | Client-side WebSocket with auto-reconnect, JSON parse/stringify, queued sends. |

### `html` — expression prefixes

Inside an `html` template:

| Syntax            | Meaning |
| ----------------- | ------- |
| `<div>${x}</div>` | Text child. Values may be primitives, arrays, or other `TemplateResult`s. |
| `class=${x}`      | Plain attribute — value is stringified and HTML-escaped. |
| `@click=${fn}`    | Event listener. Only rendered on the client. |
| `.value=${v}`     | Direct **property** set on the DOM element (not an attribute). |
| `?disabled=${b}`  | Boolean attribute — attribute is present iff the value is truthy. |

Event/property/boolean-prefixed attributes **must be unquoted**.

### `WebComponent`

```js
class MyThing extends WebComponent {
  static tag = 'my-thing';           // required
  static shadow = true;              // false = render into light DOM
  static properties = {              // attribute → property coercion
    count: { type: Number }
  };
  static styles = css`…`;            // CSSResult or array of them
  state = { /* any */ };             // internal state

  connectedCallback() {              // call super! then seed state from props
    super.connectedCallback();
  }

  render() {                         // returns TemplateResult
    return html`…`;
  }
}
MyThing.register();
```

Mutate state with `this.setState({...})` — it batches a re-render via microtask.
Attribute changes auto-trigger re-render when the attribute is declared in
`static properties`.

---

## File conventions — detail

### Pages (`app/**/page.js`)

- **Default export is a (possibly async) function.** Receives `{ params, searchParams, url }`. Returns a `TemplateResult`.
- Runs **only on the server**. Data fetching is just `await` — same mental model as React Server Components.
- May `throw notFound()` or `throw redirect('/somewhere')` — the SSR pipeline converts these to 404 / 3xx responses.
- Named exports read by the framework:
  - `metadata` — static object (`{ title, description, viewport, themeColor, openGraph: {…} }`) merged into `<head>`.
  - `generateMetadata(ctx)` — async function returning the same shape. Takes precedence over `metadata`.
- Page modules are also loaded on the client (as a side effect) so transitively imported components register their custom elements. Keep top-level imports safe to execute in the browser (do **not** import `@prisma/client`, `node:fs`, etc. directly — go through a server action).

### Error boundaries (`app/**/error.js`)

- Default export receives `{ error, ...ctx }` and returns a `TemplateResult`.
- Catches errors thrown during render of the sibling page or any deeper segment (not 404/redirect sentinels — those are handled separately).
- Nearest boundary wins: innermost `error.js` on the route's folder chain is tried first.

### Custom components (`components/*.js`)

- `render()` can be `async` on the server — the SSR pipeline awaits it before emitting Declarative Shadow DOM. Mirrors async React Server Components.
- On the client, `render()` is expected to be synchronous (runs in the browser event loop).

### Layouts (`app/**/layout.js`)

- Default export receives `{ children, params, searchParams, url }`.
- Must embed `children` somewhere in its returned template.
- Nest by folder: `app/layout.js` wraps everything; `app/blog/layout.js` wraps only `/blog/**`.

### Route handlers (`app/**/route.js`)

- Export named async functions per method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- Each receives `(Request, { params })` and returns either a `Response` or any value (auto-JSON).
- Can live anywhere under `app/` — the file path becomes the URL path.
  `app/webhook/route.js` → `/webhook`, `app/api/users/[id]/route.js` → `/api/users/:id`.
  The `app/api/…` convention is idiomatic, not required.
- A folder cannot have both `page.js` and `route.js` (they'd conflict on the same URL).
- **WebSocket support**: exporting a `WS` function from the same `route.js`
  turns the URL into a WebSocket endpoint. The server handles the HTTP
  `Upgrade` handshake; your function receives the `ws` object, the upgrade
  `Request` (for cookies / headers / auth), and `{ params }`:
  ```js
  export function WS(ws, req, { params }) {
    ws.on('message', (data) => ws.send('echo:' + data));
    ws.on('close', () => { /* cleanup */ });
  }
  ```
  In **dev mode**, the module is re-imported on each connection to pick up
  edits — store shared state (e.g. connected clients Set) on `globalThis`
  so it survives the reload:
  ```js
  const clients = globalThis.__my_clients ?? (globalThis.__my_clients = new Set());
  ```
  Client helper: `connectWS(url, { onOpen, onMessage, onClose, onError, reconnect })`
  from `webjs` — auto-reconnect with exponential backoff, JSON parse/stringify,
  queues sends while disconnected.

### Middleware (`middleware.js` at the app root)

- Optional top-level file. Default export is `async (req, next) => Response`.
- `req` is the standard `Request`; `next()` returns the normal pipeline's `Response`.
- Return a `Response` to short-circuit (redirect, 401, etc.); call `next()` then post-process to add headers, log, etc.
- Only one file, only at the app root (no per-segment middleware in v1).

### Server actions (`**/*.server.js` or `'use server'`)

- Export named async functions. Arguments and return values must be JSON-serialisable.
- **Importing these modules from a client component** (e.g. a file under `components/`) is the entire API: the dev server rewrites the import into an RPC stub that POSTs to `/__webjs/action/<hash>/<fn>` and returns the JSON result.
- On the server these modules are imported normally; you can freely use Prisma, `fs`, environment variables, etc.
- **Expose as REST**: wrap any action with `expose('METHOD /path', fn)` to ALSO make it reachable at a stable REST URL. The same function body powers both callers:
  ```js
  import { expose } from 'webjs';
  export const createPost = expose('POST /api/posts', async ({ title, body }) => { … });
  ```
  When called over HTTP, the adapter merges `{ ...query, ...urlParams, ...jsonBody }` into a single object argument. This is the recommended way to surface a server action to external consumers — no `route.js` wrapper needed.
- **Validate input**: pass a third arg `{ validate }`. The function runs before your handler over HTTP; throw to fail (→ 400 JSON with the message and any `issues`). Plays nicely with zod / valibot / hand-written validators:
  ```js
  expose('POST /api/posts', handler, { validate: Schema.parse });
  ```
  Validate runs only on the HTTP path. Direct client-component RPC calls bypass it (the function trusts its argument because the call is same-origin and CSRF-protected).

### Internal RPC — security model

- Every action call from a client component is a `POST /__webjs/action/<hash>/<fn>` with `x-webjs-csrf` and a matching `webjs_csrf` cookie issued on the first SSR response. Cross-origin attackers cannot read the cookie, so they cannot forge the header. CSRF mismatch → 403.
- Errors thrown from action handlers are sanitised in production: only the thrown `message` is returned, never the stack. Internal errors (no message) collapse to "Internal server error". The full error is logged server-side.
- `expose()`d REST endpoints are NOT CSRF-protected (they target external consumers). Apply auth via `middleware.js` or per-route checks.

### Security checklist for `expose()`

When you mark an action as `expose('METHOD /path', fn)`, you are declaring it part of your public API surface. Treat it like one:

1. **Authenticate every mutating endpoint.** Cookie auth alone is not enough — without CSRF a malicious site can POST to your endpoint with the user's cookies. Either:
   - Require a bearer token / API key (read via `headers().get('authorization')`).
   - Add an explicit CSRF check in your `validate` or `middleware.js`.
   - Reject browser POSTs by checking `headers().get('origin')` against an allow-list.
2. **Use `validate`** — never trust the merged `{ ...query, ...params, ...body }` shape. A handler that does `db.user.update({ where: input.filter, data: input.data })` is a foot-gun.
3. **Log responsibly.** The default `actionErrorResponse` returns the thrown `message` only in prod; never include user input in error messages, never include secrets.
4. **Configure CORS narrowly.** `cors: true` is fine for genuinely public reads. For anything authenticated, prefer an explicit origin or list.
5. **Rate-limit at the edge.** webjs ships no built-in rate limiter. Use a reverse proxy (nginx, fly, cloudflare) or write a small middleware over `headers()`/in-process counters.

### Components (`components/*.js`)

- Each file should define **one** custom element and call `Class.register(import.meta.url)` at module top level.
  Passing `import.meta.url` lets the SSR shell emit a `<link rel="modulepreload">` so the browser can fetch the module without waiting for its parent to parse. Zero build step; big first-paint win.
- Imported by pages (for SSR) and/or other components (for composition).
- **Styling convention: shadow-DOM CSS via `static styles = css\`…\``, not inline `style="…"` attributes.** Any repeated visual chunk in pages (layout chrome, cards, muted labels, etc.) should become a component whose styles live in its shadow root. The example app's `<blog-shell>` and `<muted-text>` demonstrate this — pages emit semantic HTML with zero inline styles.

---

## Modules architecture (preferred for non-trivial apps)

Feature-scoped modules keep business logic out of routes and off
components. Conventions enforced across the example blog:

### Layout

- **`modules/<feature>/actions/*.server.js`** — mutations, one file per
  function. Each exports a single named async function (e.g.
  `create-post.server.js` exports `createPost`). Always start with the
  `'use server'` pragma or the `.server.js` extension (the `.server.js`
  extension is the recommended default — unambiguous in file listings).
- **`modules/<feature>/queries/*.server.js`** — reads. Same shape as
  actions; the split is so grep quickly shows what mutates vs. what
  doesn't.
- **`modules/<feature>/utils/*.js`** — pure helpers and formatters.
  Importable from anywhere, no `'use server'`, no DB access.
- **`modules/<feature>/types.js`** — JSDoc `@typedef` blocks for shapes
  returned from actions/queries. File is effectively empty at runtime —
  `export {};` keeps it a valid ES module.
- **`lib/*.js`** — cross-cutting infra: `prisma.js` (singleton), auth
  primitives (`password.js`, `session.js`), external-service clients.
  Not feature-specific.

### Return shape

Actions that can fail with a user-facing error return the
pilot-platform `ActionResult<T>` envelope so route adapters translate
them mechanically:

```js
/**
 * @template T
 * @typedef {{ success: true, data: T }
 *          | { success: false, error: string, status: number }} ActionResult
 */
```

Route handler pattern:

```js
import { createPost } from '../../modules/posts/actions/create-post.server.js';

export async function POST(req) {
  const r = await createPost(await req.json());
  if (!r.success) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r.data);
}
```

### Rules

- **Routes must stay thin.** If a `route.js` has more than ~20 lines of
  business logic, extract it into a module action.
- **Client components import server modules via the normal import path.**
  webjs rewrites the import into an RPC stub automatically — don't hand-
  write `fetch()`.
- **Server-only imports (`@prisma/client`, `node:*`, `lib/password.js`)
  stay out of components/ and pages' top-level graphs** except through
  `.server.js` files.
- **One module, one feature.** If code naturally splits (e.g. `auth`,
  `posts`, `comments`), give each its own module folder.
- **Modules can depend on `lib/*` and on other modules' public exports.**
  Prefer importing through a module's action/query files rather than
  reaching into its `utils/`.

## Invariants (for both humans and agents)

1. **Never import `@prisma/client`, `node:*`, or any server-only dependency from a file under `components/` or from a page's top-level module graph that isn't a server action.** The browser will try to load it and fail. Use a server action instead.
2. **Every `*.server.js` export must be an `async` JSON-safe function.** Arguments/results are serialised over the wire.
3. **Custom element tag names must contain a hyphen** (HTML spec). Set `static tag`, call `.register()`.
4. **Event (`@`), property (`.`), and boolean (`?`) holes in `html` must be unquoted** — e.g. `@click=${fn}`, never `@click="${fn}"`.
5. **Do not mutate `this.state` directly** — use `setState`. State reads are fine.
6. **Page and layout default exports must be functions.** They return a value (usually a `TemplateResult`); they do not call `render()` themselves.

---

## Recipes

### Add a new page at `/about`

```js
// app/about/page.js
import { html } from 'webjs';
export default function About() {
  return html`<h1>About</h1><p>…</p>`;
}
```

### Add a dynamic route

```js
// app/users/[id]/page.js
import { html } from 'webjs';
export default async function User({ params }) {
  // use a server action to fetch; never import a DB client directly in a page
  const user = await fetchUser(params.id);
  return html`<h1>${user.name}</h1>`;
}
```

### Add an API route

```js
// app/api/ping/route.js
export async function GET() { return { pong: Date.now() }; }
```

### Add a server action (modules architecture)

```js
// modules/users/actions/update-profile.server.js
'use server';
import { prisma } from '../../../lib/prisma.js';
import { currentUser } from '../queries/current-user.server.js';

/**
 * @param {{ name: string }} input
 * @returns {Promise<import('../types.js').ActionResult<import('../types.js').PublicUser>>}
 */
export async function updateProfile(input) {
  const me = await currentUser();
  if (!me) return { success: false, error: 'Not signed in', status: 401 };
  const name = String(input?.name || '').trim();
  if (!name) return { success: false, error: 'name required', status: 400 };
  const row = await prisma.user.update({ where: { id: me.id }, data: { name } });
  return { success: true, data: { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt } };
}
```

Expose it via a thin route:

```js
// app/api/users/me/route.js
import { updateProfile } from '../../../../modules/users/actions/update-profile.server.js';
export async function PATCH(req) {
  const r = await updateProfile(await req.json());
  if (!r.success) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r.data);
}
```

Or call it directly from a client component — the dev server rewrites
the import into an RPC stub:

```js
import { updateProfile } from '../../../modules/users/actions/update-profile.server.js';
const r = await updateProfile({ name: 'New name' });
if (!r.success) this.setState({ error: r.error });
```

### Add a new component

```js
// components/hello-world.js
import { WebComponent, html } from 'webjs';
export class HelloWorld extends WebComponent {
  static tag = 'hello-world';
  render() { return html`<p>Hello!</p>`; }
}
HelloWorld.register();
```

Then use it as `<hello-world></hello-world>` in any page or component.

### Add a database model

Edit `prisma/schema.prisma`, then run:

```sh
webjs db migrate add_posts
webjs db generate
```

Reference it via JSDoc:

```js
/** @param {import('@prisma/client').Post} post */
```

---

## Production deployment

- `webjs start` runs the production server: prod logger (one JSON object per
  line on stdout), graceful shutdown on SIGTERM/SIGINT, ETag + cache headers
  on static assets, gzip/brotli compression negotiated via `Accept-Encoding`.
- Long-lived caching: `/__webjs/core/*` ships `Cache-Control: public, max-age=
  31536000, immutable`. Other static files get `max-age=3600` + ETag.
- Health probe: `GET /__webjs/health` and `/__webjs/ready` return `{status:"ok"}`
  with `Cache-Control: no-store`. Wire these into your orchestrator.
- Embed in another runtime: import `createRequestHandler({ appDir, dev })`
  from `@webjs/server`. It returns `{ handle(req: Request) → Promise<Response> }`
  — usable in Express (`app.use((req, res) => …)`), Fastify, Deno, Bun, Workers.
- Plug your own logger via `createRequestHandler({ logger })`. Any `{ info,
  warn, error }` shape works (pino, winston, etc.).

## Advanced features

### Streaming SSR / Suspense

```js
import { html, Suspense } from 'webjs';

export default function Page() {
  return html`
    <h1>Catalogue</h1>
    ${Suspense({ fallback: html`<p>Loading…</p>`, children: fetchExpensive() })}
  `;
}
```

TTFB = time to render everything *outside* the Suspense boundary. The
fallback flushes immediately; the resolved content streams in as a
`<template>` + inline `__webjsResolve('id')` script when the promise lands.
Nested Suspense is supported.

### First-paint performance without a build step

webjs stacks three zero-build optimizations that together replace what a
traditional bundler buys you for the initial page load:

1. **`<link rel="modulepreload">` per used component.** The SSR pass knows
   every custom element in the final HTML; it emits a preload hint in the
   `<head>` for each component module. The browser starts all fetches the
   moment it parses the head — no ES-module waterfall.
2. **HTTP/2 (ALPN over TLS).** `webjs start --http2 --cert … --key …` serves
   everything over one multiplexed connection. N small module files no
   longer mean N TCP handshakes.
3. **103 Early Hints.** Before SSR even starts computing the response,
   the server sends `103 Interim Response` with the page's module URLs as
   `rel=modulepreload`. Chrome/Edge and edge proxies (Cloudflare, fly-proxy,
   Fastly) forward these to the client, which begins fetching modules
   *while the server is still rendering*.

For most apps these three together produce first-paint performance
comparable to a tree-shaken bundle — without running a bundler. For larger
apps (many components) where request count still matters, `webjs build`
is available as an opt-in.

### Bundling — `webjs build` (optional)

Runs esbuild over every client-facing module (components, pages, layouts,
error, not-found) and writes a single `.webjs/bundle.js`. Prod serves the
bundle with `Cache-Control: immutable, max-age=1y`; the SSR shell imports
only the bundle, collapsing N HTTP requests into one on first paint.

  webjs build                        # default: minified + sourcemap
  webjs build --no-minify            # for debugging
  webjs build --no-sourcemap         # smaller deploy

One bundle for the whole app — no per-route code splitting in v1.

### Rate limiting — `rateLimit()`

In-memory fixed-window limiter, shaped as middleware:

```js
import { rateLimit } from '@webjs/server';
export default rateLimit({ window: '1m', max: 60 });    // 60 req/min
export default rateLimit({
  window: '10s', max: 10,
  key: req => `login:${req.headers.get('x-forwarded-for') || 'anon'}`,
});
```

Single-process only — use Redis or edge rate-limiting for multi-instance.

### Per-segment middleware

`middleware.js` can live at any level under `app/` and only applies to its
subtree. Chain runs outermost → innermost, root sibling → app root first,
then segment-scoped files.

### Raw-text templates

`<script>` and `<style>` are now parsed as raw-text — `<` and `>` inside
them aren't tag starts. Holes interpolate verbatim (no HTML escaping).

## Runtime targets

### Node (default)

`startServer({ appDir })` — opens an `http.Server`, installs SIGTERM/SIGINT
handlers, enables chokidar file watching in dev.

### Embedded / other runtimes

Import `createRequestHandler` and adapt the platform's Request/Response:

```js
// Express
import express from 'express';
import { createRequestHandler } from '@webjs/server';
const webjs = await createRequestHandler({ appDir });
app.use(async (req, res) => {
  const webReq = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method, headers: req.headers, body: req.method === 'GET' ? null : req,
  });
  const r = await webjs.handle(webReq);
  res.status(r.status);
  r.headers.forEach((v, k) => res.setHeader(k, v));
  r.body?.pipeTo(new WritableStream({ write: c => res.write(c), close: () => res.end() }));
});
```

### Edge runtimes (Cloudflare Workers, Deno Deploy, Bun)

**Partially supported.** The pieces that port today:
- `createRequestHandler(...).handle(Request)` — fully runtime-agnostic.
- CSRF uses Web Crypto (`crypto.getRandomValues`) — works on all edge runtimes.
- Server actions, `expose()`, `cookies()`/`headers()`, middleware, CORS, Suspense.

**What doesn't port yet:**
- File-system module loading. Edge runtimes don't have `node:fs`; app code
  must be bundled ahead-of-time. Needs: a build step that inlines
  `app/**/*.js` into the handler. **Not shipped in v1.**
- Compression: uses `node:zlib`. On edge use `CompressionStream` (web-std).
  We'd need to detect the runtime and swap. **Not shipped in v1.**
- Chokidar file watching: dev-only, Node-only. Edge is prod-deploy only anyway.

Realistic path to edge today: deploy a Node server to a compute platform
that runs Node (Fly, Render, Cloud Run). True edge (Workers) requires the
missing build step above.

## Deliberately deferred

These features are *explicitly not* in v1 and agents should not try to
implement them as part of other tasks without a separate design pass:

- **Per-route code splitting.** `webjs build` produces one bundle for the
  whole app. Splitting per route would need a dependency graph analysis
  pass and router-coordinated preload hints.
- **Vite-grade HMR with state preservation.** Web components can only be
  registered once (`customElements.define` throws on redefinition), so true
  component HMR requires either scoped registries (not widely supported) or
  tag-name versioning (invasive). We do full-page reload instead. Data
  reloads are near-instant via chokidar → SSE.
- **React Server Components Flight protocol.** Our server actions already
  cover "call a server function from the client"; Flight is React's specific
  wire format for serializing server-rendered component trees. Re-implementing
  it would fight our web-components model and duplicate years of React work.
  Use `Suspense` + streaming for progressive rendering instead.
- **Edge-runtime bundling / full portability.** See above.
- **i18n, image optimisation.** Outside the scope of the core framework;
  layer libraries on top.
