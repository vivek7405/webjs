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

Do NOT throw `redirect()` from a form-bound action to bounce a form POST either. The method-preserving 307 default re-POSTs the body and re-runs the mutation. Return an `ActionResult` with a `redirect` field instead (a 303 PRG), or throw only for a real external redirect.

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

### `<form action=${fn}>` binds, in exactly one shape

Next binds a Server Action with `<form action={createTodo}>`, and WebJs reads the same shape, so this muscle memory transfers. The mechanism underneath differs, and the difference is what the rest of this section is about: React serializes the binding (bound arguments included) into hidden fields, while WebJs emits ONE hidden field carrying the action's `<hash>/<fn>` identity and no arguments. A per-row action therefore takes its row id from a hidden input in the form, never from `action.bind(null, id)`.

```ts
import { submitFeedback } from '#modules/feedback/actions/submit-feedback.server.ts';
html`<form action=${submitFeedback}><input name="email"></form>`;
```

That is the whole wiring. The renderer omits the `action` attribute (so the form posts to the page's own url), supplies `method="post"` and an enctype, and emits the identity field. Writing `method="get"` on a bound form throws, because a GET form sends no body and the action could never run.

**A form whose buttons run different actions binds each one on its submitter**, with the same unquoted spelling one level down:

```js
html`<form action=${saveDraft}>
  <input name="title">
  <button>Save</button>
  <button formaction=${publishPost}>Publish</button>
</form>`;
```

The identity rides the pressed button's own `name`/`value` pair, which a browser submits for that button alone, so this works with JS off exactly as it does with JS on. Both entries reach the server and the LAST wins, which is always the submitter's when one was pressed.

**A bound submitter is self-sufficient, so the enclosing form does not have to be bound** (#1307). The renderer puts `formmethod="post"` and `formenctype="multipart/form-data"` on the button itself, alongside the identity, exactly as React emits `formMethod` and `formEncType` on a button carrying a function `formAction`. So a per-button action works inside a bound form, an unbound form, a `method="get"` form, or a form with no method at all:

```js
// Every button below submits a POST its action can read, with JS on or off.
html`<form>
  <button formaction=${saveDraft}>Save</button>
  <button formaction=${publishPost}>Publish</button>
</form>`;
```

One consequence worth knowing rather than discovering: no `formaction` url is emitted (an empty one is an HTML conformance error), so the submission targets whatever the FORM targets. A form declaring its own `action="/x"` sends its buttons to `/x`, which is native precedence. The action still runs if `/x` is a PAGE route, because the identity travels in the body, but against a `route.ts` or another origin the identity is ignored and nothing runs. In dev the client logs a warning at submit time naming the url. Leaving the form's `action` off, the ordinary shape, keeps the submission on the current page.

The submitter must be a `<button>` and cannot carry its own `name`, `value`, or `form` attribute, because the identity already occupies that pair. `<input type="submit">` is refused for the binding: the identity has to occupy its `value`, which on that control is also the visible caption, so the button would render captioned with the action id and could never be labelled. A `<button>` has no such conflict, since its label is its children.

**Only the bare, unquoted `action=${fn}` on a `<form>` binds.** Every near-miss is a hard render error rather than a silently-inert form, and the reason is a source leak. During SSR a `.server.ts` import is the ACTUAL function (the RPC stub exists only in the browser), and `action=` is an ordinary attribute hole, so stringifying it would write the function's body into the HTML every visitor downloads, including any literal inside it. The renderer throws instead, on the server and on the client, for `action=` and `formaction=` alike.

What escapes is the SOURCE the runtime reports, and how much that includes depends on the runtime. The body always goes: your query shapes, your table and column names, your internal paths, and any credential written inline.

Whether an OUTER value goes with it is not something to rely on either way. `Function.prototype.toString` returns source text, so on Node a module-scope `const` the body reads appears as its identifier. Bun transpiles the module before the engine sees it and can fold that literal into the body, so the same action reports the VALUE:

```
// const VENDOR_API_KEY = 'sk_live_…';  then used as `Bearer ${VENDOR_API_KEY}`
node 26  Authorization: `Bearer ${VENDOR_API_KEY}`      identifier only
bun 1.3  Authorization: "Bearer sk_live_…"              the key itself
```

Do not go looking for the rule that decides when it folds. Export status, read count, declaration position, and whether the module has an import have each been measured as the deciding factor and each produced a counterexample on the same bun version, so whatever the optimizer keys on is finer than any of them. The two rows above are one measurement on two specific versions, not a per-runtime guarantee: read them as proof that the boundary moves, never as a promise that Node keeps an outer binding private.

So treat everything reachable from the action as exposed. That is the assumption the refusal is built on, it is the only one that holds across runtimes, and it is the only one that stays true when the transpiler changes.

The refusal covers the shape, not one spelling of it. A quoted `action="${fn}"` and the mixed `action="/x/${fn}"` are refused, because quoting turns a binding hole back into a plain attribute; so is a function wrapped in an array (`action=${[fn]}`), since an array stringifies each element through `String()` and leaks identically. Unsupported `formaction=` shapes are refused, including non-submit controls, duplicate holes, and submitters carrying `name`, `value`, `form`, or static `formaction` attributes. Attribute names fold case, so `ACTION=${fn}` on a `<form>` BINDS like the lowercase spelling, while quoted or otherwise unsupported `formAction=${fn}` shapes are refused.

**Commenting the form out does not disable the hole.** A comment is HTML, the interpolation is JavaScript, and the renderer emits a comment's holes raw, so a hole inside `<!-- ... -->` never reaches the binding branch and is stringified instead: `<!-- <form action=${createTodo}> -->` ships the whole action body with no throw and no log. Commenting out a WORKING binding is therefore not a way to disable it, it is a way to turn it into a leak. Delete the form or move it out of the template. This is the one shape in this section that leaks silently, which is exactly why it is worth knowing.

It is not special to comments. `String(fn)` returns source text wherever it runs, so a bare function in a text child (`<div>${fn}</div>`) or any unclaimed attribute (`title=${fn}`) writes the same body out. Only the two form-action attribute names are claimed today; treat a function anywhere else in a template as a mistake that ships, and reach for `@event=${fn}` or a custom element's `.prop=${fn}`, neither of which stringifies.

The bound, refused, and allowed shapes in full. Every "no" row is a binding that stringifies nothing, so refusing it would break working code rather than close a leak:

| Written as | Refused? | Why |
|---|---|---|
| `action=${fn}` unquoted, on a `<form>` | **no, it BINDS** | the one supported shape: the identity is resolved and emitted as a hidden field, nothing is stringified |
| `action=${fn}` on any other tag | yes | `action` submits nothing off a `<form>`, so it is an ordinary attribute and the function would be stringified |
| `action="${fn}"`, or a mixed `action="/x/${fn}"` | yes | quoting turns a binding hole back into a plain attribute |
| `formaction=${fn}` unquoted, on a submitter, ANYWHERE | **no, it BINDS** | the second supported shape (#1207, #1307). A bound submitter carries its WHOLE submission: the identity rides the button's own `name`/`value` pair, the one channel a browser submits for the pressed button alone, and the renderer adds `formmethod="post"` and `formenctype="multipart/form-data"` to the button itself. So it works inside a bound form, an unbound form, a `method="get"` form, or a form with no method at all, and it asks NOTHING of the element around it. No `formaction` url is emitted, and the server takes the LAST `__webjs_action` entry |

| `formaction=${fn}` on a submitter carrying its own `name` or `value` | yes | the identity IS that name/value pair, so both halves are already spoken for. Bind one action on the form and dispatch on `name="intent"` if you need the button's own value |
| `formaction=${fn}` on a non-submit control, or `<input type="image">` | yes | `formaction` is inert on anything that does not submit, and an image submitter sends `name.x` / `name.y` coordinates instead of `name=value`, so the identity would never arrive |
| `formaction=${fn}` on a submitter with `form="other"` | yes | it re-points the submitter at a different form owner, which may not be where the identity field it needs lives |
| `formmethod` / `formenctype` the BOUND submitter cannot submit with (`get`, `PATCH`, `text/plain`, `dialog`, a padded `" post "`) | yes | a same-element contradiction: you attached an action to THIS button and told THIS button to submit in a way that action could never read. The renderer supplies `formmethod="post"` and the enctype only where you supplied neither, so your own parseable value always wins |
| `formmethod="get"` / `formenctype="text/plain"` on a PLAIN submitter inside a bound form | **no** | #1307 reversed this. Native HTML says the submitter's override wins, you typed it deliberately, and the form's action simply does not run, exactly as the same markup behaves anywhere else. In dev the client logs a console error at submit time if the submission is carrying an identity it cannot deliver |
| `formmethod="dialog"` on a submitter that binds nothing | **no** | a native `<dialog>` dismissal, never a submission, so there is no body for the action to miss. It IS refused on a button that also binds an action, which is a straight contradiction |
| a plain `formaction="/url"` on a submitter inside a bound form | **no** | it retargets the submission away from the page's bound action entirely, so where it goes and how is your business |
| `.action=` on a native form | yes | the supported binding is the plain attribute, and a `.prop` on a native element drops at SSR, so accepting it would mean a form that submits under JS and does nothing without it |
| `export const method = 'GET'` on a form-bound action file | yes | form-bound actions strictly enforce `POST`. Binding a GET action to a form produces a 405 runtime refusal and `webjs check` error (`form-action-not-a-get-action`) |
| `method="get"` on a bound `<form action=${fn}>` | yes | WebJs supplies `method="post"` and `formenctype` automatically, and a bound form declaring `method="get"` is REFUSED at render (a thrown error, not a warning), because a GET sends no body for the action to read |
| `.method=` / `.enctype=` / `.encoding=` on a BOUND form | yes | the same reason one level over. All three are reflected IDL attributes, so SSR drops the binding and emits `method="post"` while a browser ends at what you assigned. Write them as plain attributes |
| a second `action=${fn}` on one form | yes | SSR emits the second as a plain url next to the identity field, the client takes the last. Bind exactly one, in either position |
| a plain `action="/url"` beside the bound hole | yes | the hole drops only its OWN attribute, so SSR keeps the static one while the client removes it: without JS the browser posts to `/url`, with JS to the page |
| `method=" post "` / `enctype=" multipart/form-data "` | yes | `method` and `enctype` are enumerated attributes matched against exact keywords with no whitespace stripping, so a padded value falls to the invalid-value default and the form submits as a GET with no body. Trimming it for you would emit the padded value anyway |
| `encoding="..."` as an ATTRIBUTE on a bound form | **no** | inert in HTML (`form.encoding` reads back `enctype`), so both renderers ignore it and still supply `enctype`. Only the `.encoding` PROPERTY aliases enctype, and that spelling IS refused, one row up |
| `.formAction=` / `.formMethod=` / `.formEnctype=` on a BOUND submitter | yes | same reason, that is where they reflect: SSR drops the property and the browser applies it, so the button would submit one way with JS and another way without. On a PLAIN button they are ordinary native properties and are left alone |
| `.action=` on any other native tag | **no** | a plain expando (`<div .action=${fn}>`, `<button .action=${fn}>`), reflecting nothing, so nothing reaches the markup |
| `.action=` on a custom element | **no** | an author-defined property, not a reflected IDL attribute, so a function is a legitimate value. One declared `reflect: true` reflects on a path outside these commit sites, which used to write `String(value)` and emit the source. It now removes the attribute and warns instead, for a bare function and for an array carrying one, unless the prop supplies its own `converter.toAttribute`, which runs first and stays the author's call |
| `?action=` | yes | a function never leaked through a boolean hole, but the binding is meaningless, so it is refused rather than emitting the bare `action=""` that ANY truthy value produces there. Two separate facts worth carrying: `action=""` is a conformance error (the spec wants a valid non-empty URL whenever the attribute is present), and deleting the attribute is still not the WebJs fix, since a page has no `action` export and an unbound `method="post"` form is a 405 (a bare GET form just re-renders). Bind it: `<form action=${fn}>` |
| `@action=` unquoted | **no** | an event listener, and a function is exactly what one takes |
| `@action="${fn}"` quoted | yes | quoting makes it an ordinary attribute again, so it leaks |

That last row is the one to remember: quoting a binding hole turns it back into a plain attribute, which is why invariant 4 requires `@`, `.` and `?` holes to be unquoted.

`.action=${fn}` on a native form is refused during SSR too, even though the property is dropped there and nothing could leak, so a page cannot render clean on the server and then throw on hydration.

**A bound submitter is self-sufficient and asks nothing of the form around it.** This is the shape people expect to have to wire up, and do not:

```ts
// components/publish-button.ts   <- the submitter lives here
class PublishButton extends WebComponent({}) {
  render() { return html`<button formaction=${publishDraft}>Publish</button>`; }
}
PublishButton.register('publish-button');

// app/triage/page.ts             <- the form lives here
// BOTH work. The button carries its own submission attributes.
html`<form><publish-button></publish-button></form>`;
html`<form action=${saveAll}><publish-button></publish-button></form>`;
```

The renderer supplies the submission attributes at the level where the action is BOUND (#1307), so a bound `<button>` gains `formmethod="post"` and `formenctype` ON THE BUTTON, alongside the reserved `__webjs_action` identity riding the button's own `name`/`value` pair. A submitter's `formmethod` overrides the form's `method` per HTML, so the submission is a POST whatever the enclosing form declares, including no `method` at all or `method="get"`, and the identity travels in the body where the dispatcher reads it.

That is also why the renderer refuses only a SAME-ELEMENT contradiction (a bound submitter's own `formmethod` other than post, an `formenctype` the server cannot parse, `formmethod="dialog"`) and never a cross-element one. A component renders its template in a separate pass with no view of the host page, so the cross-element question is unanswerable at render time, and self-sufficiency leaves nothing for it to answer. One consequence: no `formaction` url is emitted, so the submission targets whatever the FORM targets, and a form declaring `action="/x"` sends its buttons there. The action still runs when `/x` is a PAGE route, since the identity travels in the body; against a `route.ts` or another origin nothing runs, which the dev-time client guard reports at submit time.

**Two runtime signals cover what is left.** In dev, submitting a form that carries an action identity it cannot deliver logs one `console.error` naming the fix, once per shape; it never throws, so the submission behaves exactly as it does in production. In production, both server-visible fingerprints reach the `onError` hook (the programmatic `createRequestHandler({ onError })` option and any sink an `instrumentation.{js,ts}` installed) with a code to group on: `WEBJS_FORM_SUBMITTED_AS_GET` for a page GET carrying the reserved field in its query string, and `WEBJS_FORM_ACTION_MISSING` for a form body carrying no identity at all. A BOUND submitter carries its own `formmethod="post"`, and a bound form is refused a `method="get"` outright, so what reaches the first one is a PLAIN submitter's `formmethod="get"`, which native precedence lets win and the renderer deliberately honours, or a hand-authored form carrying the reserved field. Both are detect-only, so no status changes, and both carry the submitted field NAMES and never the values.

**Inside a component you may never see the error.** Per-component SSR error isolation contains the throw, so development shows an error box in place of the component and production renders it empty with the page still returning 200. A form that has silently vanished in production is this bug wearing a disguise; the message is in the server log. Nothing leaks either way.

Two things that "renders it empty" understates, both worth knowing before you go looking:

- **Anything slotted into the failing component goes with it.** The isolation replaces the element from its opening tag through its matching close, so a shell or layout component whose template holds the bad form takes the page's whole authored body with it. Put `action=${fn}` in a shared header and every page renders a 200 with an empty body, not one missing header.
- **On a route with a `loading.{js,ts}`, there is no log line either.** That wraps the page in a `Suspense` boundary, so the page body renders AFTER the 200 and the shell have been flushed, and a boundary that throws there is currently swallowed with no server log, no `onError`, and no error boundary. The visitor gets chrome and an empty body; with JS off the skeleton simply stays. That silence is a known framework gap rather than intended behaviour, so do not read the missing log line as evidence the render succeeded.

```ts
import { submitFeedback } from '#modules/feedback/actions/submit-feedback.server.ts';
// RIGHT: bind the imported action. method and enctype are supplied.
html`<form action=${submitFeedback}><input name="email"></form>`;
// WRONG: a bare form binds nothing, so the submission is a 405. There is no
// page `action` export to catch it.
html`<form method="post"><input name="email"></form>`;
```

A hole that resolves to `null` is NOT the same as omitting the attribute. `method=${null}` renders `method=""`, which cannot submit and is refused; `?method=${false}` emits nothing at all, so WebJs supplies `method="post"` and the form works. Both leave no attribute in the DOM, which is exactly why the check reads your template rather than the rendered element.

A string stays a string: `action="/search"` and `action=${'/search'}` are unchanged, which is what a search form (`<form method="get" action="/search">`) and a `route.ts` endpoint both want. Other attributes keep their existing stringify behaviour; only a FUNCTION under `action` / `formaction` is claimed.

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

The file stays `middleware.ts`, NOT Next 16's renamed `proxy.ts`. WebJs middleware is in-process, chainable, and per-segment (the Remix / Koa model). There is no `export const config = { matcher }` and no single-file restriction. The default export is `async (req, next) => Response`: return a Response to short-circuit, or call `next()` and post-process. Colocate `app/admin/middleware.ts` next to the admin routes and it runs for that subtree only. An optional root `middleware.ts` runs on every app request, outermost to innermost. Two things are served ahead of it: the framework's own `/__webjs/*` assets and probes, in both modes, and in DEV only, `/public/*` plus the `/sw.js` / `/offline.html` root remaps and `/favicon.ico`, so a stylesheet is never queued behind the dev startup analysis. In production those static files go through root middleware normally, so a middleware that guards an asset still guards it where it counts.

### No `<Link>`, no `next/navigation`, no `next/*` libraries

Navigation is automatic. The client router auto-enables when `@webjsdev/core` loads (any page with a component), so a plain `<a href>` gets soft navigation for free. There is no `<Link>` to import and no `useRouter`. For programmatic navigation import `navigate()` / `revalidate()` from `@webjsdev/core`. There is no `next/image`, `next/font`, `next/script`, or `next/dynamic`. WebJs is no-build: use a plain `<img>`, a `<link>` / `@font-face`, a component's `static lazy = true` for viewport lazy-loading, and a dynamic `import()` where code should load lazily.

### No `<ScrollRestoration>`, and no scroll restore of your own

Remix ships a `<ScrollRestoration />` component, Next has a `scrollRestoration` flag and a pile of community `useEffect` + `scrollTo` recipes, and every one of them is a thing to NOT port. WebJs restores scroll on Back/Forward automatically: the router sets `history.scrollRestoration = 'manual'` on boot and is the sole authority on scroll for the whole navigation. There is no component to render and no option to enable. An app-level `popstate` listener that calls `scrollTo`, a remembered offset in `sessionStorage`, or a `scrollIntoView` on a saved element all race the router and win sometimes, which is worse than losing consistently.

This includes the case that most tempts a hand-rolled fix: Back landing BELOW where the reader left, on a page whose components size themselves after they render. The router already handles it, by suppressing the browser's scroll anchoring across the restore so late growth above the viewport is not added to the offset it just replayed (see `client-router-and-streaming.md`). If a restore still lands wrong, report it rather than patching around it in app code.

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

WebJs components are Lit-shaped on purpose: the value is the declarative DX. Prefer a factory-declared reactive prop over `this.getAttribute`, a `signal` over a `state: true` prop for internal state, a `class=${...}` binding over `this.classList`, a `@click=${...}` binding over `this.addEventListener`, and `C.register('x')` over `customElements.define`. Vanilla DOM stays right only where the platform offers nothing declarative: `this.closest('ui-tabs')` for compound-component ancestor lookup (resolves at SSR too), slotted-content queries, global `document` / `window` listeners, and imperative `el.focus()`. This is a convention, not a lint rule. A global `document` / `window` LISTENER is one of those legitimate cases, because the event happens outside the element. A document QUERY is not: reaching for markup that another component rendered is the jQuery habit to drop, and for your OWN rendered node a `ref` replaces the selector entirely. The ownership rules at the top of `components.md` state the full test.
