# Muscle-Memory Gotchas

## What This Covers

- The Next.js patterns that LOOK right in WebJs but break, because WebJs borrows Next's file-based routing shape but not its execution model (no RSC, no `'use client'` split): `redirect()` in a route handler, `fetch()` in a page, `<Link>`, `NEXT_PUBLIC_`, `await params`.
- The Lit patterns that break WebJs SSR or reactivity, because WebJs is HTML-first (real HTML first paint, JS opt-in per behaviour) not JS-first: `static properties` / the `@property()` decorator, class-field initializers, browser globals in `render()`, fetching in `connectedCallback`, interpolation into `<style>`, reading `assignedNodes()` in `firstUpdated` of a light-DOM component.
- The WebJs-shaped fix for each, with short code.

Read this when a pattern feels familiar from Next.js or Lit but you are not sure it transfers. For the component runtime see `components.md`; for the routing surface see `routing-and-pages.md`. The one difference underneath everything: pages and layouts render server-only and never hydrate, and the one client boundary is a `WebComponent` custom element.

---

## Coming from Next.js

### `'use client'` does nothing; `'use server'` is a file boundary, not a component annotation

There is no RSC render tree and no server/client component split. Interactivity lives in a `WebComponent` island that hydrates per element. A page or layout cannot be interactive in its own markup (an `@click` in a page template is dropped at SSR). `'use server'` is real, but it is the RPC plus source-protection directive at the top of a `*.server.ts` file, not a component annotation. Apply it to an action file, never to a component or page.

### `redirect()` throws, and it is illegal in a route handler

In Next, `redirect()` works in Server Components, Actions, and Route Handlers alike. In WebJs, `redirect()` and `notFound()` throw a control-flow sentinel that the SSR page pipeline and the action pipeline catch. They are valid in page functions, layouts, and server actions. They are NOT valid in a `route.ts` handler, where the throw goes uncaught and returns a 500 (the `no-redirect-in-api-route` check flags this).

```ts
// route.ts WRONG: redirect() is uncaught here.
export async function GET() { redirect('/login'); }
// route.ts RIGHT: return a real redirect Response.
export async function GET(req: Request) { return Response.redirect(new URL('/login', req.url), 303); }
```

Do NOT throw `redirect()` from a page `action` to bounce a form POST either. The method-preserving 307 default re-POSTs the body and re-runs the mutation. Return an `ActionResult` with a `redirect` field instead (a 303 PRG), or throw only for a real external redirect.

### Reads are server actions, not `fetch()` in a Server Component

Next fetches by calling `fetch()` or an ORM directly inside an async Server Component. WebJs has no Server Components, so fetch server data in the page function (server-only) and pass it down, or fetch in a component via an async `render()` (the resolved data is in the first paint), or a `'use server'` GET action.

```ts
// WRONG: hand-written fetch to your own endpoint.
const res = await fetch('/api/users');
// RIGHT: importing a 'use server' action IS the API (the import becomes an RPC stub).
import { getUsers } from '#modules/users/queries/get-users.server.ts';
const users = await getUsers();
```

There is no React `cache()`, `use()`, or `unstable_cache`. Caching is the `cache()` query helper, `export const revalidate` on a page, or `export const cache` on a GET action.

### `params` and `searchParams` are awaitable AND synchronously readable

Next 15/16 made `params` / `searchParams` Promises. WebJs supports BOTH, so either muscle memory is correct.

```ts
export default async function User({ params, searchParams }: PageProps<'/users/[id]'>) {
  const id = params.id;              // sync read, works
  const { id: id2 } = await params;  // Next 15/16 await, also works
  const tab = (await searchParams).tab;
}
```

The runtime hands a plain object with a non-enumerable `then`, so a spread, `JSON.stringify`, and `Object.keys` see only the data keys. This holds for pages, layouts, and `route.ts` handler context alike.

### The page default export returns a template and runs server-only

A Next page returns JSX and may embed client interactivity directly. A WebJs page default export returns a `TemplateResult` from `html` and runs only on the server. It is never re-invoked in the browser, so a signal read or `@click` in a page body does nothing after load. Put interactivity in a `WebComponent` and render its tag from the page.

### Route handlers: named method exports, value returns auto-JSON

Export `GET` / `POST` / etc. as named async functions `(request, { params }) => Response | value` (a non-Response value is auto-JSON'd). A folder cannot have both `page` and `route`. There is no `NextRequest` / `NextResponse`; use the platform `Request` / `Response`. A WebSocket endpoint is a `WS(ws, req, { params })` export from the same file.

### `middleware.ts` is per-segment and chainable, not one matcher config

The file stays `middleware.ts`, NOT Next 16's renamed `proxy.ts`. WebJs middleware is in-process, chainable, and per-segment (the Remix / Koa model). There is no `export const config = { matcher }` and no single-file restriction. The default export is `async (req, next) => Response`: return a Response to short-circuit, or call `next()` and post-process. Colocate `app/admin/middleware.ts` next to the admin routes and it runs for that subtree only. An optional root `middleware.ts` runs on every request, outermost to innermost.

### No `<Link>`, no `next/navigation`, no `next/*` libraries

Navigation is automatic. The client router auto-enables when `@webjsdev/core` loads (any page with a component), so a plain `<a href>` gets soft navigation for free. There is no `<Link>` to import and no `useRouter`. For programmatic navigation import `navigate()` / `revalidate()` from `@webjsdev/core`. There is no `next/image`, `next/font`, `next/script`, or `next/dynamic`. WebJs is no-build: use a plain `<img>`, a `<link>` / `@font-face`, a component's `static lazy = true` for viewport lazy-loading, and a dynamic `import()` where code should load lazily.

### Server-only code: the `.server.ts` boundary, not a `server-only` package

Next poisons a client-imported module with the `server-only` package. WebJs uses the file extension: `*.server.ts` is the path-level boundary (the file router refuses to serve the source). A `'use server'` file's exports are RPC-callable; a `.server.ts` file WITHOUT `'use server'` is a server-only utility whose browser import throws at load. Reach a no-`'use server'` utility through a `'use server'` action, `route.ts`, or `middleware`, never by direct import into a shipping page or component.

### Public env vars use `WEBJS_PUBLIC_`, not `NEXT_PUBLIC_`

`process.env.X` is server-only. To expose a value to the browser, prefix it `WEBJS_PUBLIC_` (inlined via an inline `<script>`, no build step). `NODE_ENV` is defined both sides. Reading a non-public server env var in a component is flagged by `no-server-env-in-components` (it would leak into SSR'd HTML or read as undefined after hydration).

---

## Coming from Lit

The disagreement underneath: Lit is JS-first (hydration is the API), WebJs is HTML-first (first paint is real HTML, JS is opt-in per interactive behaviour). JS is requested by the specific interactive holes you write: a `@click`, a `signal.set(...)`, a `.data=${richObject}` property binding, a `Task`. A plain `<a href>`, a `<form action>`, and a display-only component request no JS. The SSR contract: the pipeline runs the constructor, applies attributes, runs `willUpdate` and controllers' `hostUpdate`, reflects `reflect: true` props, then calls `render()`. Nothing past render fires server-side (not `connectedCallback`, `firstUpdated`, `updated`).

### Fetching in `connectedCallback` or `firstUpdated`

Neither hook runs server-side, so the first paint is empty and content pops in after hydration with a layout shift. Fetch in the page function and pass the data down as props or attributes.

```ts
// app/users/[id]/page.ts (correct)
export default async function User({ params }) {
  const user = await fetchUser(params.id); // via a *.server.ts query
  return html`<user-card .user=${user}></user-card>`;
}
```

### `Task` for initial-paint data

`Task` deliberately does not auto-run at SSR: it keeps its `INITIAL` state and runs only on hydration, so the client renders the resolved state after a flash. `Task` stays right for client-time async (interaction-triggered mutations, polling, websocket reactions). For initial-paint data, fetch in the page function, or use an async `render()` (which Lit does not have): write `const u = await getUser(this.id)` directly in the component and SSR bakes the resolved data into the first paint. A bare async `render()` blocks SSR and renders real data with no fallback. To STREAM slow data wrap the region in `<webjs-suspense .fallback=${html`...`}>`. `renderFallback()` is the OPTIONAL client re-fetch UI, never a first-paint concern.

### Browser globals in the constructor or `render()`

`window.matchMedia`, `localStorage`, `navigator`, `document.querySelector`, and layout reads crash SSR (the instance has no DOM). The constructor is for pure-JS init. Browser APIs belong in `connectedCallback` or later (client-only by construction). Flagged by `no-browser-globals-in-render`.

```ts
// wrong
constructor() { super(); this.dark = window.matchMedia('(prefers-color-scheme: dark)').matches; }
// right
constructor() { super(); this.dark = false; }
connectedCallback() {
  super.connectedCallback();
  this.dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
}
```

The attribute methods (`getAttribute` / `setAttribute` / `hasAttribute`), the event methods, and `attachInternals()` ARE backed by a server shim, so reading an attribute in `render()` is safe. Only the genuinely DOM-backed members (`classList`, `querySelector`, `attachShadow`, `getBoundingClientRect`, `focus`) throw.

### Top-level imports of browser-only libraries

`import Chart from 'chart.js'` or any library that touches `window` at import time crashes SSR, because the page module loads on the server. Use a dynamic `import()` inside `connectedCallback` for client-only behaviour, or wrap server work in a `.server.ts` file.

```ts
connectedCallback() {
  super.connectedCallback();
  import('chart.js').then(({ Chart }) => { this.chart = new Chart(this.canvas, this.config); });
}
```

### Class-field initializers for reactive properties

A class-field initializer (`student: Student = { ... }`) compiles to an assignment after `super()` that uses `[[Define]]` and overwrites the reactive accessor the base class installed, silently breaking reactivity. Declare the prop in the factory and set its default in the constructor after `super()`. Flagged by `reactive-props-no-class-field`.

```ts
class StudentCard extends WebComponent({ student: prop<Student>(Object) }) {
  constructor() { super(); this.student = { name: '', email: '' }; }
}
```

### The `@property()` decorator and a `static properties` block

The `@property()` decorator is banned by the erasable-TS invariant (decorators are non-erasable, they would force a build step). A `static properties = { ... }` block THROWS at runtime (`no-static-properties`). The single replacement for both is the declare-free base-class factory `WebComponent({ ... })`, with the `prop()` helper carrying options.

### Expecting shadow DOM and reaching for scoped CSS

Lit defaults to shadow DOM, so `static styles = css` scopes automatically. WebJs defaults to light DOM. A `static styles` block without `static shadow = true` does nothing useful and any inline `<style>` with bare class names leaks globally. The webjs-shaped fix is Tailwind utilities, which apply directly in light DOM. Reach for `static shadow = true` plus `static styles` only when scoped CSS genuinely belongs in a shadow root, or prefix every selector with the tag name if authoring vanilla light-DOM CSS.

### Reading `assignedNodes()` in `firstUpdated` of a light-DOM component

In shadow DOM the browser projects slotted content natively before `firstUpdated`, so Lit muscle memory says `this.shadowRoot.querySelector('slot').assignedNodes()` is populated there. In light DOM the first projection lands one microtask AFTER the first render, so `firstUpdated` sees the `<slot>` element with an EMPTY `assignedNodes()`. The webjs-shaped fix: read assigned content from a `slotchange` listener (fires once projection lands, and on every later change), or wait a microtask. Every later read and every mutation-driven update behaves identically in both modes; only the first-render read differs.

### `:host { display: block }` on a light-DOM component

A custom element is `display: inline` by default, so a block container collapses. In Lit you fix this with `:host { display: block }`, which works because Lit is shadow-DOM-first. A light-DOM WebJs component has no shadow root, so there is no `:host` to write. There is nothing to do: the framework already defaults every light-DOM host to `display: block` via a low-priority `@layer webjs-host` rule, overridable by any Tailwind utility (`class="flex"` wins). A shadow-DOM component (`static shadow = true`) still sets `:host { display: block }` in `static styles` itself, exactly like Lit.

### Interpolating into a `<style>` or `<script>` inside a component

In Lit a binding inside `<style>` works. In a WebJs component it fails silently after hydration: the server emits the interpolated content (first paint looks right), but the client drops the raw-text hole and rebuilds the element EMPTY, so the styles vanish. Use `static styles` (shadow) or Tailwind (light DOM). A fully static `<style>` with no `${}` is fine. Flagged by `no-interpolation-in-raw-text-element`. Note the exception: pages and layouts never hydrate, so a page's `<style>${STYLES}</style>` is a legitimate pattern.

### Reordering a `.map()` list needs a keyed `repeat()`

A plain `.map()` list reconciles in place and preserves node identity on item-level updates (drag-and-drop, focus, caret, and input state all survive), so it is fine for append-only or update-in-place lists. What it does NOT do is keyed reordering: reconciliation is positional, so on a middle insert or a reorder the nodes stay put and their contents are rewritten. When a list reorders or splices in the middle and each item owns DOM state that must move with it, use `repeat(items, (i) => i.id, template)` from `@webjsdev/core/directives`, exactly as in Lit.

### `ContextProvider` for server-known data

Context providers publish on connect via `hostConnected`, which does not run at SSR, so descendants read the default (or undefined) during SSR and re-render on hydration with a content shift. For server-known data (session, user, theme, locale, feature flags), pass it through props from the page function. Reserve `ContextProvider` for client-time concerns (interaction state, focus management, transient UI).

### Vanilla DOM instead of Lit idioms

WebJs components are Lit-shaped on purpose: the value is the declarative DX. Prefer a factory-declared reactive prop over `this.getAttribute`, a `signal` over a `state: true` prop for internal state, a `class=${...}` binding over `this.classList`, a `@click=${...}` binding over `this.addEventListener`, and `C.register('x')` over `customElements.define`. Vanilla DOM stays right only where the platform offers nothing declarative: `this.closest('ui-tabs')` for compound-component ancestor lookup (resolves at SSR too), slotted-content queries, global `document` / `window` listeners, and imperative `el.focus()`. This is a convention, not a lint rule.
