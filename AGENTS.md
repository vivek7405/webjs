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
app/
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
  api/<path>/route.js       HTTP handler at /api/<path> (api/ is convention, not required)
middleware.js               optional top-level middleware, runs on every request
actions/*.server.js         server actions (RPC); individual exports may `expose()` a REST endpoint
components/*.js             custom-element definitions
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

- Each file should define **one** custom element and call `Class.register()` at module top level.
- Imported by pages (for SSR) and/or other components (for composition).
- **Styling convention: shadow-DOM CSS via `static styles = css\`…\``, not inline `style="…"` attributes.** Any repeated visual chunk in pages (layout chrome, cards, muted labels, etc.) should become a component whose styles live in its shadow root. The example app's `<blog-shell>` and `<muted-text>` demonstrate this — pages emit semantic HTML with zero inline styles.

---

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

### Add a server action

```js
// actions/users.server.js
'use server';
import { db } from './_db.js';
export async function getUser(id) { return db.user.findUnique({ where: { id } }); }
```

Then in any client component:

```js
import { getUser } from '../actions/users.server.js';
const u = await getUser(42); // actually a POST to /__webjs/action/…
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

## Out of scope for v1

Documented here so agents don't attempt them:

- Streaming SSR / Suspense.
- Bundling, minification, code-splitting.
- Fine-grained HMR (we do full-page reload on file change).
- Edge/worker runtime targets.
- React Server Component tree serialisation (our server actions are plain RPC).
- i18n, image optimisation.
- HTML template parser does not handle `<script>`/`<style>` raw-text or HTML
  comments inside templates — write components for interactive bits.
