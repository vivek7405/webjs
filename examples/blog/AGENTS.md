# AGENTS.md for the webjs blog example

This is the reference app for the webjs framework. It exercises every
feature the framework ships. Read this before editing any file.

## Framework source is in `node_modules/`

You can and should read framework code directly when debugging. No
build step, no minification: the JavaScript in `node_modules/@webjsdev/*`
is what runs. Quick map:

- `node_modules/@webjsdev/core/`: renderer, `WebComponent`, directives,
  client router, `Task`, context, testing helpers. See
  `node_modules/@webjsdev/core/src/component.js` for lifecycle
  behaviour, `render-client.js` for DOM patching, `router-client.js`
  for navigation / View Transitions.
- `node_modules/@webjsdev/server/`: dev server, SSR, file router,
  server actions, WebSocket upgrade, `auth.js`, `session.js`,
  `cache.js`, `rate-limit.js`, `csrf.js`. `ssr.js` shows exactly how
  the metadata object becomes `<head>` tags.
- `node_modules/@webjsdev/cli/`: CLI commands + scaffold templates.
- `node_modules/@webjsdev/intellisense/`: tsserver plugin (go-to-definition
  on tag names, `<webjs-tag>` "Unknown tag/attribute" diagnostic
  suppression, attribute auto-complete sourced from the reactive props
  declared in `WebComponent({ ... })`, gated on the current file's import
  graph). Inside `` html`` `` templates.

When in doubt, `grep -rn '<symbol>' node_modules/@webjsdev/`. The
framework is plain JS with JSDoc types, small, and readable end-to-end.

## App layout

```
app/                         thin route adapters
  layout.ts                  root layout (light-DOM shell with <header>/<main>/<footer>,
                              theme toggle, Tailwind tokens, open-graph metadata)
  page.ts                    / (home, post feed, counter, chat)
  error.ts                   error boundary
  not-found.ts               404
  login/page.ts              /login (auth-forms component)
  search/page.ts             /search (progressive no-JS GET search form)
  blog/[slug]/page.ts        /blog/:slug (post + live comments)
  dashboard/
    middleware.ts             auth gate (302 → /login if no session)
    page.ts                  /dashboard
    posts/new/page.ts        /dashboard/posts/new
  (marketing)/about/page.ts  /about (route group, parens not in URL)
  ui-demo/page.ts            /ui-demo (showcases the @webjsdev/ui kit)
  seeded/page.ts             /seeded (SSR action seeding demo, #472)
  script-swap/
    layout.ts                a layout emitting inline scripts as SIBLINGS of its
                             children, so both are TOP-LEVEL nodes of the
                             swapped range (client-router fixture, #1102)
    page.ts                  /script-swap
  api/
    hello/route.ts           GET /api/hello
    posts/route.ts           GET/POST /api/posts
    posts/[slug]/route.ts    GET/DELETE /api/posts/:slug
    comments/[postId]/route.ts  GET/POST + WS /api/comments/:postId
    chat/route.ts            GET + WS /api/chat
    auth/
      middleware.ts           rate limit (5 req / 10s / IP)
      login/route.ts          POST /api/auth/login
      signup/route.ts         POST /api/auth/signup
      logout/route.ts         POST /api/auth/logout
middleware.ts                root middleware (request logging)
lib/                         cross-cutting infra
  password.ts                scrypt hash/verify
  session.ts                 session cookie helpers
db/                          Drizzle: schema.server.ts, columns.server.ts, connection.server.ts
modules/
  auth/
    actions/signup.server.ts, login.server.ts, logout.server.ts
    queries/current-user.server.ts
    components/auth-forms.ts
    utils/validate.ts
    types.ts                 PublicUser, ActionResult<T>
  posts/
    actions/create-post.server.ts, delete-post.server.ts
    queries/list-posts.server.ts, get-post.server.ts
    components/new-post.ts
    utils/slugify.ts         slugify() + formatPost()
    types.ts                 PostFormatted, CreatePostInput
  comments/
    actions/create-comment.server.ts
    queries/list-comments.server.ts
    components/comments-thread.ts
    utils/format.ts          formatComment()
    utils/bus.ts             in-process pub/sub for live comments
    types.ts                 CommentFormatted
  chat/
    components/chat-box.ts
    utils/clients.ts         shared WebSocket client Set + broadcast()
    types.ts                 ChatMessage
components/                  shared UI primitives
  counter.ts, error-card.ts, theme-toggle.ts, blog-shell.ts, muted-text.ts
  ui/                        @webjsdev/ui standard kit (button, card, input, dialog, …)
                              installed via `webjs ui add …` from https://webjs.dev/ui
db/schema.server.ts          User, Session, Post, Comment (Drizzle)
```

## Feature usage in this app

### Rate limiting
`app/api/auth/middleware.ts` applies `rateLimit({ window: '10s', max: 5 })` to all auth endpoints, capping requests at 5 per 10 seconds per IP. Exceeding returns 429 with `retry-after` header. Uses the global cache store (memory by default. Call `setStore(redisStore({ url: process.env.REDIS_URL }))` at app startup to switch to Redis for cross-instance sharing).

### Error boundaries
`app/error.ts` catches any unhandled error during page rendering. Receives `{ error }` and renders a user-friendly error card. Nested error boundaries are supported. Place `error.ts` deeper in the route tree to isolate failures.

### Client router
The client router auto-enables when `@webjsdev/core` loads (any page with a component, e.g. the layout's `theme-toggle`), so the layout needs no client-router import. All `<a>` links navigate via fetch + DOM swap. Same-layout navigations keep the `<header>` and `<footer>` elements mounted (theme state, scroll context preserved). Only `<main>` content swaps.

### Metadata
Root `app/layout.ts` exports `generateMetadata(ctx)` that derives an absolute `og:image` URL from `ctx.url.origin`. Sets `openGraph` + `twitter: { card: 'summary_large_image' }` so social shares render the 1200×630 `public/og.png` card.

### Middleware
- `middleware.ts` (root): request logging on every route.
- `app/dashboard/middleware.ts`: auth gate. Redirects to `/login` if no session.
- `app/api/auth/middleware.ts`: rate limiting on auth endpoints.

### WebSockets
- `app/api/chat/route.ts` exports `WS` for the live chat.
- `app/api/comments/[postId]/route.ts` exports `WS` for live comment threads.
- Client components use `connectWS()` for auto-reconnecting WebSocket connections.

### Elision fixtures (e2e-pinned)
The app carries display-only and inert-route fixtures so the network
probes in `test/e2e/e2e.test.mjs` can assert that no dead JS ships.

- `components/build-stamp.ts` (rendered on `/` AND on `/observed`): a
  display-only component whose module is stripped from the served page
  source, so the browser never downloads it. It is the NEGATIVE CONTROL on
  both routes: a probe asserting some other module IS downloaded needs a
  module that is still elided on the same run, or the probe would also pass
  if elision had stopped working altogether.
- `components/vendor-badge.ts` (rendered on `/`): a display-only
  component whose only non-core dependency is `dayjs` (a binding import,
  not an interactivity signal). Because the component is elided, the
  bare-import scan skips it, so `dayjs` never enters the importmap and is
  never fetched. The dayjs-formatted date is still SSR'd.
- `app/static-info/page.ts`: a fully-static route whose inert page module
  is dropped from the boot script. The import-only root layout is dropped
  too (#620); the only module the boot emits is the layout's re-emitted
  theme-toggle, which loads core and auto-enables the router.
- `components/observed-badge.ts` + `components/observe-badge.ts` (rendered
  on `/observed`): a display-only component that WOULD elide, paired with a
  module that observes it via `customElements.whenDefined('observed-badge')`.
  The observation forces the badge to ship, so the probe asserts its module
  IS downloaded (the cross-module-registration fix, #169). The unobserved
  `build-stamp` is the negative control.
- `components/forced-badge.ts` (rendered on `/observed`): display-only in
  every respect (static markup, no events, no reactive props, no lifecycle
  hook, light DOM) EXCEPT `static interactive = true`, the explicit author
  override. It pins that override end to end (#1308): before it, the only
  coverage stopped at the analyser returning a boolean, and nothing proved
  the boot script actually keeps the module. The probe asserts its module is
  downloaded on a run where `build-stamp` on the same page still is not.

Two of these fixtures carry doc comments that deliberately AVOID writing a
literal tag in angle brackets or a `whenDefined` call shape, because the
elision analyser scans raw source including comments, so such prose would
register as a real rendered tag or observation and the fixture would ship
for the wrong reason (making its test pass vacuously). Keep that discipline
when editing them.

### Client-router script reactivation (#1102)
`app/script-swap/` exists ONLY as an e2e fixture. Its layout emits two inline
scripts as SIBLINGS of `${children}`, one on each side, so both are TOP-LEVEL
nodes of the range the router replaces on a navigation into the route from
outside. That is the shape a `querySelectorAll('script')` walk skips, since it
never matches the element it is called on. Each script bumps a window counter
and writes it into a readout the layout renders, so the e2e can assert from
either side. Two scripts rather than one because the fix has two halves: the
before-script witnesses that a top-level script re-executes at all, the
after-script that replacing it did not truncate the range walk (reactivating a
script detaches it, which would cut a live `nextSibling` walk). Do not "tidy"
either script into the children or delete one: each is load-bearing.

### SSR action seeding (#472)
`/seeded` renders `<seeded-user>` (`components/seeded-user.ts`), a SHIPPING
async component whose `async render()` awaits `getSeedUser`
(`modules/seed/queries/get-user.server.ts`, a `'use server'` action). The SSR
result is seeded into the page, so the e2e network probe asserts NO
`/__webjs/action/` RPC fires on hydration (initial load and soft nav), while a
prop bump to an unseeded id DOES fetch. The `@click` bump is what makes the
component ship (otherwise a bare async leaf would be elided like `/async-leaf`).

### Webjs UI kit
`components/ui/` holds the kit, split into two tiers:

- **Tier 1: class helpers.** `buttonClass`, `cardClass`,
  `cardHeaderClass`, `inputClass`, `labelClass`, `alertClass`,
  `badgeClass`, `separatorClass`. Pure functions returning Tailwind
  class strings, applied to raw native elements (`<button>`,
  `<input>`, `<div>`).
- **Tier 2: custom elements.** `<ui-dialog>` (and subparts). Real
  custom elements for state the browser doesn't give you natively.
  Register via side-effect import in the consumer file.

`/ui-demo` showcases both tiers side-by-side. Open it during
development to see the patterns without hopping to the registry website.
Real surfaces in this app:

- `modules/auth/components/auth-forms.ts`: login/signup form uses
  `cardClass`, `inputClass`, `labelClass`, `buttonClass`, `alertClass`.
- `modules/posts/components/new-post.ts`: post composer uses
  `cardClass`, `inputClass`, `labelClass`, `buttonClass`, `alertClass`
  on native elements, with a raw `<textarea>` for the body field.
- `app/dashboard/page.ts`: dashboard uses `cardClass` for the post
  list and `buttonClass({ size: 'lg' })` for actions.

Add more components via `webjs ui add <name>` (registry at
https://webjs.dev/ui). Tier-1 additions auto-export class helpers
from their `components/ui/<name>.ts` file; Tier-2 additions register
their custom element on import.

## Running the app

```sh
cp .env.example .env          # AUTH_SECRET, SESSION_SECRET, DATABASE_URL
npm run db:migrate            # creates db/dev.db + applies migrations
npm run db:seed               # demo author + posts (optional)
npm run dev                   # http://localhost:5004
```

`npm run dev` / `npm start` and `webjs dev` / `webjs start` behave
identically (#550). The orchestration (applying migrations, compiling
Tailwind) lives in the `webjs` block of `package.json` and runs INSIDE
`webjs dev` / `webjs start`:

```jsonc
"webjs": {
  "dev": {
    "before": ["webjs db migrate", "npm run css:build"],
    "regenerate": [{ "output": "public/tailwind.css", "command": "tailwindcss -i ./public/input.css -o ./public/tailwind.css --minify", "inputs": ["app", "components", "lib", "modules", "public/input.css"] }]
  },
  "start": { "before": ["webjs db migrate", "npm run css:build"] }
}
```

A bare `webjs dev` applies migrations and compiles the static Tailwind
stylesheet, then serves; in dev `dev.regenerate` (#967) recompiles
`public/tailwind.css` on request when a source changes, so it never goes
stale without a live `--watch`. `npm run dev` (a thin alias) does the same. In
Docker / Railway, `CMD ["npm", "start"]` and `CMD ["webjs", "start"]` are
equivalent: `webjs start` runs `webjs db migrate` (start `before`) in-process
before serving.

## Tests

The blog's own tests live under `test/` (`auth`, `posts`, `comments`, `chat`)
and run via `npm test` (the `webjs test --server` script; the blog has no
browser tests). They touch the SQLite DB, so run `npm run db:migrate` (and the
seed) first, exactly like running the app. These tests are NOT discovered by the
framework's root `npm test`; CI runs them in the dedicated **In-repo app tests
(website + blog)** job (issue #342), which prepares the DB the same way the
e2e job does. The separate root-level `test/e2e/e2e.test.mjs` exercises the blog
in a real browser (the framework's `e2e` CI job), and `test/examples/blog/`
holds its smoke + browser probes.

## Conventions

- **One exported function per action/query file.** Name the file after the function.
- **ActionResult<T> envelope** for all actions: `{ success: true, data } | { success: false, error, status }`.
- **Routes are thin adapters.** Business logic lives in modules. A route imports a module function, calls it, translates the result to a Response.
- **Server-only imports** (the DB driver, node:crypto, etc.) only in `.server.ts` files, `db/`, or `lib/`.
- **No barrel files.** Import from the specific file.
- **Types per module** in `types.ts`. Shared types (ActionResult) live in `modules/auth/types.ts`.
- **globalThis for dev singletons** (the Drizzle `db`, WS clients, comment bus): survives module cache-busting.

## Invariants

1. Never import a DB driver (`node:sqlite`) or `node:*` from components or pages.
2. Custom element tags must contain a hyphen. Pass the tag to `ClassName.register('tag-name')` at the bottom of the file. The tag is not a static field.
3. Event/property/boolean holes in `html` must be unquoted: `@click=${fn}`, not `@click="${fn}"`.
4. Component state lives in signals from `@webjsdev/core`. Read with
   `signal.get()` inside `render()`, write with `signal.set(value)`.
   Module-scope signals share state across components; instance
   signals (created in the constructor) carry component-local state.
5. Pages/layouts are server-only functions returning TemplateResult.

## Recipes

### Add a page
Create `app/<path>/page.ts`. Export default async function returning `html\`...\``.

### Add an API endpoint
Create `app/api/<path>/route.ts`. Export named functions: `GET`, `POST`, etc.

### Add a server action
Create `modules/<feature>/actions/<name>.server.ts`. Export one async function.
Import from auth/types.ts for ActionResult<T>.

### Add a component
Create `modules/<feature>/components/<name>.ts` or `components/<name>.ts`.
Extend the `WebComponent({ ... })` factory to declare reactive properties (e.g. `extends WebComponent({ count: Number })`; per-prop options via `prop(Number, { reflect: true })`), add `static styles` for shadow-DOM components, implement `render()`, then call `ClassName.register('tag-name')` at the bottom. Tag must contain a hyphen. A hand-written `static properties` throws at construction (`no-static-properties`); set defaults in the constructor, never a class-field initializer. **Never extend raw HTMLElement directly for app components.** Always subclass `WebComponent` (or the factory form `WebComponent({...})`) to hook into SSR, lifecycle, elision, and the reactive property system. Extend raw HTMLElement only for rare native-API edge cases (like form-associated `ElementInternals` or customized built-in elements), and add a `webjs-allow-htmlelement: <reason>` comment to acknowledge the exception.

### Add a database model
Edit `db/schema.server.ts`. Run `webjs db generate` then `webjs db migrate`.
