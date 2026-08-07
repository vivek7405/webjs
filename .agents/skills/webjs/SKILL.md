---
name: webjs
description: Build and review WebJs applications. Use when working on WebJs app structure, pages, layouts, routes, server actions, components, signals, data and validation, auth, sessions, styling, the client router, streaming, or tests. WebJs is AI-first, web-components-first, and has no build step.
---

# Build a WebJs App

Use this skill for end-to-end WebJs app work. It helps you choose the right layer first, reach for the right export, and avoid the WebJs-specific mistakes that Next.js or Lit muscle memory causes. WebJs is its own framework: the component API matches Lit and the routing feels like Next, but the execution model is neither.

## Full Documentation

This skill is the quick guide. When you need the full API reference for a surface, load the matching file in `references/` (listed below). For even deeper framework detail, WebJs ships buildless, so the source you run IS the source you read: look in `node_modules/@webjsdev/{core,server,cli}/` (each package ships its own `AGENTS.md`). The complete hosted docs live at https://webjs.dev/docs.

## What WebJs Is

WebJs is an AI-first, web-components-first framework with **no build step**: source files are served as native ES modules, and TypeScript is stripped in place (Node 24+ or Bun). It runs SSR + progressive enhancement by default.

**There is no server/client component split.** No RSC render tree, no Flight protocol, no `"use client"` boundary. Instead:

- **Pages and layouts** (`app/**/page.ts`, `app/**/layout.ts`) run **only on the server** to produce HTML. They do NOT hydrate, so their own markup cannot be interactive (an `@click` in a page template is dropped at SSR). They still LOAD in the browser so imported components register.
- **Components** (`WebComponent` custom elements) hydrate per element, islands-style. **All interactivity lives here**: `@event`, reactive property assignment, signal mutation.
- **`*.server.ts`** is the one server boundary. With `'use server'` its exports are RPC-callable from the client (the import is rewritten to a stub); without it the file is a server-only utility whose browser import throws at load. This, not a component annotation, is how a dependency (the DB driver, secrets, `node:*`) is kept off the client.
- **`route.ts`** is a server-only HTTP handler (named `GET`/`POST` exports), the one routing file that is NOT isomorphic.

**Progressive enhancement is the default architecture.** With JS off, content reads, `<a>` navigates, and a `<form action=${importedAction}>` submits to its server action. JS is opt-in per interactive behaviour. Never write a first paint that depends on hydration.

## When To Use This Skill

- New features or refactors touching pages, routes, actions, components, data, auth, sessions, styling, or tests
- Reviewing WebJs code for correctness or framework usage
- Answering "how should this be structured in WebJs?"
- Finding the right export, reference doc, or default pattern for a task

## Load Only The References You Need

Classify the task first, then load the smallest useful reference set. Each reference starts with a "What This Covers" section; read that to confirm relevance before reading the rest. Loading more than two or three at once usually means the task is not narrowed yet.

| Task involves...                                                            | Start with                                    |
| --------------------------------------------------------------------------- | --------------------------------------------- |
| Pages, layouts, dynamic routes, route handlers, metadata, redirects, 404s   | `references/routing-and-pages.md`             |
| Writing components: reactive props, signals, lifecycle, light vs shadow DOM  | `references/components.md`                     |
| Why a component's JS was or was not downloaded, `webjs elision`, `static interactive = true` | `references/components.md`                     |
| Server actions, mutations, queries, validation, the `ActionResult` envelope | `references/data-and-actions.md`              |
| Sessions, login flows, route protection, `forbidden()` / `unauthorized()`   | `references/auth-and-sessions.md`             |
| Tailwind, light-DOM tag-prefix rule, tokens, fixed headers, no-reflow layout | `references/styling.md`                        |
| Client router, prefetch, frames, view transitions, Suspense streaming        | `references/client-router-and-streaming.md`   |
| Optimistic UI for a user-facing mutation                                     | `references/optimistic-ui.md`                 |
| The `@webjsdev/ui` component kit (a `components.json` is present): class helpers, tokens, `add` / `view`, the MCP `ui` tool | `references/ui-kit.md`                         |
| TypeScript at runtime, erasable syntax, full-stack types, the derive-the-type rule (never `unknown` / `any`) | `references/typescript.md`                     |
| Unit, browser, e2e tests, the `handle()` harness, Bun parity                 | `references/testing.md`                        |
| Auth, caching, env vars, rate limit, file storage, the `webjs` config block  | `references/built-ins.md`                      |
| Node vs Bun, running the app, deploying, runtime-specific differences        | `references/runtime.md`                        |
| Offline support, an asset cache, the opt-in service worker                   | `references/service-worker.md`                 |
| A pattern that feels like Next.js or Lit but might not transfer              | `references/muscle-memory-gotchas.md`         |

Common bundles:

- **Form or CRUD feature** then data-and-actions, routing-and-pages, testing; add auth if user-specific
- **Interactive widget** then components, styling; add client-router-and-streaming only if it streams
- **Protected area** then auth-and-sessions, routing-and-pages, testing
- **Instant-feeling mutation** then data-and-actions, optimistic-ui

## Default Workflow

1. **Classify the change.** Route contract, data model, server mutation, auth, or only UI?
2. **Start from the server.** Add the page/route and its server action or query before wiring interactive UI. A page render or a `<form>` POST should already return correct HTML before any component hydrates.
3. **Put code in the narrowest owner.** Route-local first (`modules/<feature>/`), promote to `lib/` or `components/` only when reuse is real.
4. **Keep server-only code behind `.server.ts`.** The DB driver, secrets, and `node:*` never belong in a page, layout, or component.
5. **Add interactivity per behaviour.** Reach for a component (and a signal or `@event`) only where the UI is genuinely interactive. A display-only component is elided from the browser.
6. **Validate input at the boundary.** Declare `export const validate` on an action; the RPC and `route()` boundaries run it.
7. **Default mutations to optimistic UI** where the client can predict the result (`optimistic()` from `@webjsdev/core`).
8. **Type every boundary from its source, never `unknown` or `any`.** The row type comes from the schema (`typeof todos.$inferSelect`), the action's input from a named `interface` and its result from `ActionResult<T>`, the routing files from `PageProps` / `LayoutProps` / `RouteHandlerContext`. `unknown` belongs on a payload nothing has vouched for yet that the next line narrows, and on a parameter of your own helper that forwards into an `html` template hole. Everywhere else, including a layout's `children`, it is a missing type. See `references/typescript.md`.
9. **Test the narrowest meaningful layer**, and render the app in a real browser for any UI change (static checks do not catch a collapsed layout).

## Project Layout

```
app/                  ROUTING ONLY (thin adapters importing from modules/)
  layout.ts           root layout (the ONLY file that may write <html>/<head>/<body>)
  page.ts             /
  <segment>/page.ts   /<segment>
  [param]/page.ts     dynamic route (params.param)
  <path>/route.ts     HTTP handler at /<path>
  error.ts loading.ts not-found.ts forbidden.ts unauthorized.ts   boundaries (nearest wins)
middleware.ts         root middleware
modules/<feature>/    actions/ (mutations, *.server.ts), queries/ (reads, *.server.ts),
                      components/, utils/ (pure), types.ts
lib/                  lib/*.server.ts server-only infra, lib/utils/ browser-safe helpers
components/*.ts        shared presentational custom elements (one per file)
db/*.server.ts        Drizzle: schema, connection
public/*              static assets, served at /public/<name>
```

App-internal imports use the `#` root alias (`import { db } from '#db/connection.server.ts'`), Node's native `package.json` imports field, not deep `../../../` relatives. A same-directory import stays relative.

## Core WebJs Rules (invariants)

1. Server-only code lives in `.server.ts`, `route.ts`, or `middleware.ts`. Never in a page, layout, or component (it crashes the browser at module load).
2. `'use server'` exports are `async` functions returning serializer-safe values. Files without `'use server'` are server-only utilities.
3. Custom element tag names contain a hyphen. Pass the tag to `Class.register('tag-name')`.
4. Event (`@`), property (`.`), and boolean (`?`) holes in `html` are UNQUOTED: `@click=${fn}`, never `@click="${fn}"`.
5. Signals are the default state primitive. Import `signal` / `computed` from `@webjsdev/core`, read via `signal.get()` inside `render()`. The base-class factory `WebComponent({ ... })` is only for values riding an HTML attribute or arriving via SSR hydration.
6. Page and layout default exports are functions returning a value; they never call `render()` themselves.
7. Light-DOM components with custom CSS prefix every class selector with their tag name. Prefer Tailwind (unique by construction).
8. Only the root layout may write `<!doctype>` / `<html>` / `<head>` / `<body>`.
9. No backtick characters inside an `html\`...\`` body, even in comments (it closes the literal and 500s).
10. TypeScript must be erasable (`erasableSyntaxOnly: true`): no `enum`, no value `namespace`, no constructor parameter properties, no legacy decorators.
11. Reactive properties are declared ONLY through the base-class factory `extends WebComponent({ count: Number })`. Never a `static properties` block, never a class-field initializer (it clobbers the reactive accessor).
12. A form that writes binds its action: `<form action=${importedAction}>`, or a per-button `<button formaction=${importedAction}>`. A bound submitter is SELF-SUFFICIENT (#1307): the renderer puts `formmethod="post"` and `formenctype` on the button itself, so it needs no bound form around it and works inside any form or none. Quoted bindings, non-submit controls, `<input type="submit">` (the identity needs its `value`, which is also its label, so use a `<button>`), submitter `name` / `value` / `form` / static `formaction` attributes, a `.prop` spelling of any of those, `action=${fn}` off a `<form>`, a bound form with `method="get"`, a BOUND submitter's own non-post `formmethod` or unparseable `formenctype`, and a non-action function all throw. A PLAIN button's own `formmethod` / `formenctype` is a legal native override and is left alone. A page has no `action` export, so a bare `<form method="post">` is a 405.

## Export Map

Find the right export fast. Load the linked reference for full examples.

### `@webjsdev/core` (browser + isomorphic)

- `html` / `css` tagged templates. `WebComponent({ ... })` base-class factory; `prop(type?, opts?)` declares one reactive property. `register(tag, C)` / `Class.register('tag')`.
- `signal` / `computed` reactive state, `effect(fn)` client-only reaction (returns a disposer), `batch(fn)` coalesced writes; `render(v, el)` client render.
- `notFound()` / `redirect(url[, status])` control-flow throws (page/layout/action only, NOT `route.ts`). `forbidden()` / `unauthorized()` render the nearest boundary.
- `Suspense({fallback, children})` page-level streaming; `<webjs-suspense>` component-level streaming.
- `optimistic()` optimistic UI; `navigate(url)` / `revalidate(url?)` client-router control; `connectWS` / `richFetch`.
- `asset(path)` content-hashes a `public/` url so a deploy cannot serve stale bytes (`href=${asset('/public/app.css')}`), served `immutable` for a year. Page / layout / metadata route only, inside the render function. See `references/built-ins.md`.
- Types: `Metadata`, `PageProps<R>`, `LayoutProps<R>`, `RouteHandlerContext<R>`, `WebjsConfig`.
- `@webjsdev/core/server`: `renderToString` / `renderToStream` (Node side).
- `@webjsdev/core/directives`: `repeat`, `unsafeHTML` (trusted only), `live`, `keyed`, `guard`, `cache`, `until`, `watch(signal)`, `ref` / `createRef`, `asyncAppend` / `asyncReplace`, `templateContent`. `Task` / `TaskStatus` live at `@webjsdev/core/task`, context (`createContext` / `ContextProvider` / `ContextConsumer`) at `/context`. See `references/components.md` for the directive table + Task + context.

### `@webjsdev/server` (server side)

- `createRequestHandler`, `cors()`, `route(action, opts?)` REST adapter, `sitemap()` / `sitemapIndex()`, `actionContext()`, `actionSignal()`, `requestId()`, `cache()` / `revalidateTag`.
- Route-handler toolkit: `json(v)` rich responder, `readBody(req)`, `clientIp(req)`, no-arg `headers()` / `cookies()` / `cspNonce()` (client counterpart `richFetch` is in `@webjsdev/core`). See `references/routing-and-pages.md`.
- Auth + sessions: `createAuth` (+ `Credentials` / `Google` / `GitHub`), `auth()` / `auth(req)`, `session()` + `cookieSession` / `storeSession`, `getSession(req)` (`.get` / `.set` / `.flash` / `.destroy`). File storage: `getFileStore` / `diskStore` / `signedUrl`. See `references/auth-and-sessions.md` + `references/built-ins.md`.
- Data layer is Drizzle in `db/*.server.ts`. Auth, sessions, caching, rate limit, file storage are built in and pluggable (`references/built-ins.md`).

### File conventions

`page.ts` (server-only fn), `layout.ts` (embeds `children`), `route.ts` (HTTP handler), `middleware.ts`, `*.server.ts` (server boundary), `error.ts` / `loading.ts` / `not-found.ts` / `forbidden.ts` / `unauthorized.ts` (boundaries), metadata routes (`sitemap.ts`, `robots.ts`, `manifest.ts`, `icon.ts`, `opengraph-image.ts`).

## Canonical Patterns

### A page

```ts
// app/about/page.ts
import { html } from '@webjsdev/core';
export default function About() {
  return html`<h1>About</h1>`;
}
```

### A dynamic route reading data through an action

```ts
// app/users/[id]/page.ts
import { html } from '@webjsdev/core';
import { getUser } from '#modules/users/queries/get-user.server.ts';
export default async function User({ params }: { params: { id: string } }) {
  const user = await getUser(params.id); // never import the DB directly into a page
  return html`<h1>${user.name}</h1>`;
}
```

### A server action

```ts
// modules/users/actions/update-profile.server.ts
'use server';
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';
export async function updateProfile(input: { id: string; name: string }) {
  const name = String(input?.name || '').trim();
  if (!name) return { success: false, error: 'name required', status: 400 };
  const [row] = await db.update(users).set({ name }).where(eq(users.id, input.id)).returning();
  return { success: true, data: row };
}
```

Call it from a component via a normal import (rewritten to a typed RPC stub). Never hand-write `fetch()`.

### An interactive component

```ts
// components/counter.ts
import { WebComponent, prop, html } from '@webjsdev/core';
class Counter extends WebComponent({ count: prop(Number) }) {
  constructor() { super(); this.count = 0; }
  render() {
    return html`<button @click=${() => this.count++}>${this.count}</button>`;
  }
}
Counter.register('my-counter');
```

### The no-JS write path (a form-bound action)

```ts
// modules/contact/actions/send-message.server.ts
'use server';
export async function sendMessage(formData: FormData) {
  const email = String(formData.get('email') || '');
  if (!email) return { success: false, fieldErrors: { email: 'required' } };
  return { success: true, redirect: '/thanks' };
}

// app/contact/page.ts
import { sendMessage } from '#modules/contact/actions/send-message.server.ts';
export default function Contact({ actionData }) {
  return html`<form action=${sendMessage}><input name="email"></form>`;
}
```

Binding the action is the whole wiring: the renderer omits `action` (so the form posts to the page's own url), supplies `method="post"` and an enctype, and emits a hidden `__webjs_action` identity field. A form-bound action always receives the `FormData`.

Success is a 303 (PRG); failure re-renders the page at 422 with the result on `actionData`. With JS the client router applies the response in place. A submission that binds nothing is a 405, and the submission is Origin-verified like an RPC call.

## Security And Session Defaults

- Never ship demo secrets. Require session and provider secrets from the environment and fail fast if missing.
- CSRF is an Origin / `Sec-Fetch-Site` check on both the action RPC and the form-submit path, not a token cookie. A safe GET action is CSRF-exempt. A `route.ts` REST endpoint is NOT covered: authenticate every mutating endpoint, validate, rate-limit.
- Prod action errors are sanitized to a generic message plus a digest. Put a user-facing message on the `ActionResult` `{ success: false, error }` envelope, never on a raw throw.
- Use `forbidden()` for an authenticated user lacking permission, `unauthorized()` for an unauthenticated request. Inside a `'use server'` RPC action, return an `ActionResult` for an auth failure instead of throwing.
- For CORS use `cors()` from `@webjsdev/server`; `credentials: true` REQUIRES an explicit origin allowlist, never `'*'`.

## Testing Defaults

- Prefer server/handler tests first: drive the app with `handle()` from `@webjsdev/server/testing` and assert on the `Response`.
- Add a browser test (`npm run test:browser`) for anything touching hydration, the client router, slots, or custom-element upgrade. A unit test is necessary but NOT sufficient for a browser-facing change.
- Render the app and LOOK for any UI change: `npm run check` and `npm run typecheck` pass even when a layout collapses. Static tools give no signal for a visual defect.
- WebJs runs on Node 24+ AND Bun. Prove a runtime-sensitive change (serializer, listener, streams, `node:crypto`, the TS stripper) on both.

## Common Mistakes To Avoid

- Treating a page or layout like a React component and expecting its markup to hydrate. It runs server-only; put interactivity in a component.
- Importing a `.server.ts` utility (no `'use server'`) directly into a shipping component. Its browser stub throws at load; reach it through a `'use server'` action.
- Using a `static properties` block or a class-field initializer for reactive props instead of the `WebComponent({ ... })` factory.
- Quoting an event / property / boolean hole (`@click="${fn}"`).
- Writing `fetch()` to call your own server instead of importing the action.
- Writing a bare `<form method="post">` and expecting a page `action` export to catch it. There is no such export; bind the action with `action=${fn}` or the submission is a 405.
- Putting a submitter's `formaction=${fn}` on anything that is not a submit control, or on a button carrying its own `name` / `value`. The identity IS the button's name/value pair, so both halves are spoken for.
- Writing `formmethod="get"` or `formenctype="text/plain"` on a button that BINDS an action. Neither can carry that action's body, so the pair contradicts itself and throws. On a button that binds nothing it is a legal native override and is honoured.
- Binding an action whose file declares `export const method = 'GET'`. That is a 405 at runtime and a `webjs check` error.
- Throwing `redirect()` / `notFound()` inside a `route.ts` handler (uncaught 500). Return a `Response` there.
- A placeholder first paint that fetches in `connectedCallback`. SSR does not call `connectedCallback`; put first-paint data in the constructor (server-known inputs) or use `async render()`.
- A browser global (`window`, `document`, `localStorage`) in the constructor or `render()`. It throws at SSR; do browser-only work in `connectedCallback`.
- Interpolating into a component's `<style>` / `<script>` body. Use `static styles` or Tailwind.
