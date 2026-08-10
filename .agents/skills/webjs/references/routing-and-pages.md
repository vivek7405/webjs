# Routing and Pages

## What This Covers

- Pages, layouts, and where the HTML shell comes from
- Dynamic (`[param]`), catch-all (`[...rest]`), and optional catch-all (`[[...rest]]`) segments, route groups, private folders
- `route.ts` HTTP handlers and `middleware.ts`, the route-handler toolkit (`json` / `readBody` / `clientIp` / the no-arg accessors), and calling one from the client with `richFetch`
- `metadata` and `generateMetadata` (folded in here), including image metadata routes that return a `Response`
- Control-flow throws: `notFound()`, `redirect()`, `forbidden()`, `unauthorized()`
- The no-JS write path: a `<form>` bound to a `'use server'` action
- Boundaries: `error.ts`, `loading.ts`, `not-found.ts`, `forbidden.ts`, `unauthorized.ts`, and the two root-only ones

Read this when a task touches the route contract, a URL, a `<head>` tag, a redirect, a 404, or a form POST that a page owns. Sibling refs: `components.md` (anything interactive), `data-and-actions.md` (server actions, queries, validation, the `ActionResult` envelope), `auth-and-sessions.md` (`forbidden()` / `unauthorized()` flows).

## The Execution Model (read this first)

Pages and layouts run **only on the server** to produce HTML. They do NOT hydrate, so their own markup cannot be interactive (an `@click` in a page template is dropped at SSR, a signal read in a page body never re-renders). They still LOAD in the browser so imported components register. Put every interactive behaviour in a component.

`route.ts` is the one routing file that is NOT isomorphic: a server-only HTTP handler, never shipped to the client.

## Pages (`app/**/page.ts`)

The default export is a possibly-async function receiving `{ params, searchParams, url, actionData }`. It returns a `TemplateResult`; it never calls `render()` itself.

```ts
// app/about/page.ts
import { html } from '@webjsdev/core';
export default function About() {
  return html`<h1>About</h1>`;
}
```

`params` and `searchParams` are awaitable AND synchronously readable (`params.id` and `await params` both work, Next.js 15/16 parity). Throw `notFound()` or `redirect(url)` to short-circuit. Reach data through a `.server.ts` query; never import the DB driver into a page.

Optional named exports: `metadata` / `generateMetadata` (below) and `export const revalidate` (seconds, opts into the HTML response cache, only for a page identical for every visitor). There is no `action` export; the write path is a form bound to a `'use server'` action (below).

## Layouts (`app/**/layout.ts`)

The default export receives `{ children, params, searchParams, url }` and must embed `children`. Layouts nest by folder; `metadata` merges with the deepest winning.

```ts
// app/layout.ts (root)
import { html } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
export default function RootLayout({ children }: LayoutProps) {
  return html`<html lang="en"><head></head><body>${children}</body></html>`;
}
```

Only the **root layout** (`app/layout.ts` exactly) MAY write `<!doctype>` / `<html>` / `<head>` / `<body>`; the framework splices in the importmap, modulepreload, title, and meta. Non-root layouts and pages MUST NOT write the shell (the `shell-in-non-root-layout` rule). If the root layout omits the shell, the framework auto-emits `<!doctype><html lang="en"><head></head><body>`.

## Dynamic and catch-all routes

```ts
// app/users/[id]/page.ts
import { html } from '@webjsdev/core';
import { getUser } from '#modules/users/queries/get-user.server.ts';
export default async function User({ params }: { params: { id: string } }) {
  const user = await getUser(params.id); // via a server query, never the DB directly
  return html`<h1>${user.name}</h1>`;
}
```

- `[param]/page.ts` dynamic segment, read via `params.param`.
- `[...rest]/page.ts` catch-all, `[[...rest]]/page.ts` optional catch-all.
- `(group)/...` route group: the folder is NOT in the URL but still scopes layout / error.
- `_private/...` private folder: ignored by the router.

## Route handlers (`app/**/route.ts`)

Named async exports per HTTP method, each `(Request, { params }) => Response | value` (a non-Response value auto-JSONs). A folder cannot have both `page.ts` and `route.ts`.

```ts
// app/api/health/route.ts
export async function GET() {
  return { ok: true };
}
```

**NEVER throw `redirect()` / `notFound()` / `forbidden()` inside a `route.ts` handler** (an uncaught throw is a generic 500). Return a real response instead: `return Response.redirect(url, 303)` for a redirect, `return new Response('Not Found', { status: 404 })` for a 404. A `route.ts` is also NOT covered by the action CSRF check, so authenticate every mutating endpoint, validate, and rate-limit. Export `WS(ws, req, { params })` from the same file for a WebSocket endpoint.

**The route-handler toolkit** (from `@webjsdev/server`). Two accessors take the request explicitly: `readBody(req)` decodes a rich request body (the inverse of `json()`, round-tripping `Date` / `Map` / `Set` / `BigInt` / `Blob`), and `clientIp(req)` reads the caller IP. To respond with rich types, `json(value)` serializes with the same wire (so a `Date` survives), versus a plain object return that auto-JSONs. The context accessors take NO argument because they read the in-flight request from context: `headers()`, `cookies()`, `requestId()`, `cspNonce()`.

```ts
import { json, readBody, clientIp } from '@webjsdev/server';
export async function POST(req: Request) {
  const body = await readBody(req);            // rich types decoded
  return json({ at: new Date(), ip: clientIp(req) });  // Date survives the wire
}
```

**Calling your own `route.ts` from the client:** use `richFetch<T>(url, opts?)` from `@webjsdev/core`, a drop-in `fetch` that sends `Accept: application/vnd.webjs+json`, encodes a plain-object `body` with the rich wire, and decodes the `json()` response (so `data.at` is a real `Date`). This is the ONE legitimate hand-fetch (importing a `'use server'` action is the way to call the server otherwise, never a hand-written `fetch` to an action).

## Middleware (`middleware.ts`)

Optional root-level plus per-segment. The default export is `async (req, next) => Response`. Return a Response to short-circuit, or call `next()` and post-process. Per-segment middleware applies to its subtree, outermost to innermost.

The root file sits beside `app/`, not inside it, and may be `middleware.ts` / `.js` / `.mts` / `.mjs` (`.ts` wins if more than one exists). A per-segment `app/<segment>/middleware.*` takes any of the same extensions.

## Metadata and `generateMetadata`

A page exports `metadata` (static) or `generateMetadata(ctx)` (request-scoped, takes precedence). Values flow into `<head>` at SSR and merge across nested layouts (deeper wins). Type both with `Metadata`; `MetadataContext` types the argument. The surface is Next.js-compatible.

```ts
import type { Metadata, MetadataContext } from '@webjsdev/core';

export const metadata: Metadata = { title: 'Home', description: 'Welcome' };

export async function generateMetadata(ctx: MetadataContext): Promise<Metadata> {
  return { title: `Post: ${ctx.params.slug}`, metadataBase: new URL(ctx.url).origin };
}
```

Common fields: `title` (string or `{ template, default, absolute }`), `description`, `keywords`, `metadataBase` (resolves relative URLs in `openGraph` / `twitter` / `alternates` / `icons`), `openGraph`, `twitter`, `robots`, `alternates.canonical`, `icons`, `manifest`, and `jsonLd` (schema.org structured data, single object or array, HTML-safe-escaped automatically). `viewport`, `themeColor`, and `colorScheme` may also be set via a split `export const viewport = { ... }`. `cacheControl` is emitted as a response HEADER (not a `<meta>`); pages default to `no-store`, and any other value enables conditional GET (a weak `ETag` + `304`), `private` included. See https://webjs.dev/docs for the full field list.

## Control-flow throws

From `@webjsdev/core`: throw to short-circuit a page / layout render or a form-bound action.

- `notFound()` renders the nearest `not-found.ts` (nearest wins from the throwing chain).
- `redirect(url[, status])`. The no-status default is convention-picked at the catch site: `302` for a GET page render, `307` (method-preserving) for a form-bound action. Override with `redirect(url, 308)` or `redirect(url, { status })`.
- `forbidden()` renders the nearest `forbidden.ts` (authenticated user lacking permission); `unauthorized()` renders the nearest `unauthorized.ts` (request not authenticated).

None of these belong in a `route.ts` (return a `Response` there). Inside a `'use server'` RPC action, return an `ActionResult` for an auth failure rather than throwing (`data-and-actions.md`).

## The no-JS write path (a form-bound action)

A page imports a `'use server'` action and binds it into the form: `<form action=${sendMessage}>`. There is no page `action` export; the binding IS the wiring. The renderer omits the `action` attribute (so the form posts to the page's own url), supplies `method="post"` and an enctype, and emits a hidden `__webjs_action` field carrying the action's `<hash>/<fn>` identity. A non-GET/HEAD submission carrying that identity runs the action, wrapped in the segment middleware of the URL it was submitted to AND the action's own declared `middleware`. It works with JS off; with JS on the client router posts the same body to the same url and applies the response in place.

**Do not treat the page's segment middleware as the action's authorization gate.** An identity names the action, not the page that rendered it, so the same action is reachable by submitting to any page path (and, being a `'use server'` export, at its RPC endpoint too, where no segment middleware runs at all). That is the same reachability every server action has always had, and the removed page `action` export was the one shape where the URL really did scope the handler. Authorize the action itself: an `export const middleware = [requireAdmin]` on the action, or a check in its body, both of which run on either transport.

A form-bound action always receives the `FormData` as its first argument, which is where it differs from the same action called over RPC. `validate` is the typing seam: it receives that `FormData`, and its transform-return becomes the action's typed input.

```ts
// modules/contact/actions/send-message.server.ts
'use server';
export async function sendMessage(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const body = String(formData.get('body') || '').trim();
  const values = { email, body };
  const fieldErrors: Record<string, string> = {};
  if (!email.includes('@')) fieldErrors.email = 'Enter a valid email';
  if (body.length < 10) fieldErrors.body = 'Message is too short';
  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors, values, status: 422 };
  await deliver({ email, body });
  return { success: true, redirect: '/contact/thanks' };
}
```

```ts
// app/contact/page.ts
import { html } from '@webjsdev/core';
import { sendMessage } from '#modules/contact/actions/send-message.server.ts';

export default function Contact({ actionData }: {
  actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> };
}) {
  const errors = actionData?.fieldErrors || {};
  const values = actionData?.values || {};
  return html`
    <form action=${sendMessage} class="flex flex-col gap-3">
      <input name="email" type="email" value=${values.email || ''} required>
      ${errors.email ? html`<p class="text-sm text-red-600">${errors.email}</p>` : ''}
      <textarea name="body" required>${values.body || ''}</textarea>
      ${errors.body ? html`<p class="text-sm text-red-600">${errors.body}</p>` : ''}
      <button type="submit">Send</button>
    </form>
  `;
}
```

How the result is read (server side): a success PRG-redirects with `303` (to a same-site `redirect` path if present, else the page's own URL); a failure re-SSRs the SAME page with `status` (default `422`) and the result on `ctx.actionData`. Failure is detected robustly (`success === false`, OR `fieldErrors` present, OR `error` present with `success !== true`), so an error is never swallowed. `result.redirect` must be a same-site local path (a single leading `/`); for a real external redirect, throw `redirect(absoluteUrl)` instead. On a plain GET render `actionData` is `undefined`. Prefer a bound `<form>` over `fetch` in a `@click` for any write a form can express.

Three responses that are not the happy path:

- **A submission carrying no identity is a `405` + `Allow: GET, HEAD`.** A bare `<form method="post">` binds nothing, and the page path exists but only renders, so the method is what is wrong rather than the url.
- **An identity whose hash no longer resolves re-renders at `422`** with a resubmit message and the submitted values on `actionData`. That is a form held open across a deploy; a 404 would discard what was typed and a silent no-op would show success for a write that never happened.
- **A bound action declaring `export const method = 'GET'` is a `405`.** A GET action rides its args in the url and is CSRF-exempt, so it cannot answer a form POST. `webjs check`'s `form-action-not-a-get-action` catches it at edit time.

The submission is Origin-verified (the same `Sec-Fetch-Site` / `Origin` check the RPC endpoint applies), so a no-JS form needs no CSRF token field.

A submitter's own `formmethod` / `formenctype` / `formtarget` overrides the form's on PRESENCE, not on the value being non-empty, and the client router resolves them the same way (#1322). So `<button type="submit" formmethod="">` really does submit as a GET, because a present-but-empty enumerated attribute falls to its own invalid-value default rather than inheriting the form's `method="post"`.

Refusals worth knowing: `formaction=${fn}` is supported on a `<button>` anywhere, bound form or not (#1307: the renderer gives the button its own `formmethod` and `formenctype`), and that button may not carry `name`, `value`, `form`, or a static `formaction` attribute (`<input type="submit">` is refused, because the identity needs its `value`, which is also its label). A bound form may not declare `method="get"`, and a function bound to `action=` that is not a `'use server'` export throws at render rather than producing a form that posts nowhere. See `muscle-memory-gotchas.md` for the full table.

## Error, loading, and 404 boundaries

- `error.ts` default-exports `({ error, ...ctx }) => TemplateResult`; catches sibling-page and deeper render errors, innermost wins (prod sends only `error.message`).
- `loading.ts` wraps the sibling page in `Suspense` with an immediately-flushed fallback.
- `not-found.ts` / `forbidden.ts` / `unauthorized.ts` render the nearest matching boundary for the thrown control-flow signal.
- Root-only (in `app/` exactly): `global-error.ts` is the app-wide catch-all after nested `error` boundaries are exhausted and renders its OWN `<!doctype><html><body>` (returned verbatim, so keep it static HTML with no components or hydration). `global-not-found.ts` renders for an unmatched-anywhere URL when no `not-found` matches.

Metadata routes (`sitemap.ts`, `robots.ts`, `manifest.ts`, `icon.ts`, `apple-icon.ts`, `opengraph-image.ts`, `twitter-image.ts`) live at app root or static segments and default-export a possibly-async function; `sitemap()` / `sitemapIndex()` from `@webjsdev/server` serialize spec-valid XML.

The IMAGE metadata routes (`icon`, `apple-icon`, `opengraph-image`, `twitter-image`) default-export a function returning a `Response` with an explicit `content-type`, so an inline SVG needs no asset file (buildless).

**`icon` and `apple-icon` are LINKED for you.** An app that declares no `metadata.icons` gets `<link rel="icon" href="/icon">` and `<link rel="apple-touch-icon" href="/apple-icon">` in the head automatically, for whichever of the two routes it defines (base-path prefixed, since that is where the route answers). No `type` or `sizes` is asserted, because the route picks its content type at request time and the browser sniffs the served one.

Declaring `metadata.icons` **suppresses** the routes rather than merging with them, which is what Next does with its static icon files. So an app that outgrows a placeholder `app/icon.ts` names its real icons and the route stops being linked without having to be deleted:

```ts
// app/layout.ts  ->  these win; /icon and /apple-icon are no longer linked
export const metadata = {
  icons: {
    icon: [
      { url: '/public/favicon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/public/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
    ],
    apple: { url: '/public/apple-touch-icon.png', sizes: '180x180' },
  },
};
```

Declare a favicon through `metadata.icons` (or a metadata route), never as a hand-written `<link rel="icon">`: only the root layout may write a shell at all (invariant 8), so a hand-written tag is unavailable to every other layout. A `public/favicon.ico` needs no declaration either way, since the framework serves it at the origin root for crawlers that read no markup.

`opengraph-image` and `twitter-image` are NOT auto-linked (a preview image is a per-page editorial choice, not a site-wide default). Point `metadata` at those via `openGraph.images` / `twitter.images`.

```ts
// app/opengraph-image.ts  (OG is 1200x630; apple-icon 180x180)
export default function OgImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">...</svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
}
// app/page.ts  ->  export const metadata = { openGraph: { images: ['/opengraph-image'] } };
```
