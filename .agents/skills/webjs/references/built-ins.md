# Built-ins and Configuration

Env vars, caching, rate limiting, broadcast, file storage, and the `package.json` `"webjs"` config block plus observability. Everything here is imported from `@webjsdev/server`.

## What This Covers

- **Environment variables**, the `WEBJS_PUBLIC_` browser-exposed prefix, and `env.ts` boot validation.
- **Caching primitives.** `cache()` with tag invalidation, HTTP `Cache-Control`, the server HTML response cache (`export const revalidate`), content-hash asset URLs, conditional GET (ETag).
- **Rate limiting** (`rateLimit()` middleware) and **broadcast** (`broadcast()` over WebSockets).
- **File storage.** `FileStore` / `diskStore`, safe keys, signed URLs.
- **The `"webjs"` config block.** Security headers, CSP, redirects, trailing-slash, basePath, allowed origins, client-router opt-out, ingress caps, dev/start task orchestration, the doctor severity gate.
- **Observability.** Access log, `requestId()`, the `onError` hook, `instrumentation.ts`, the build-info endpoint.

Read this when wiring caching or rate limiting, storing uploads, hardening headers, or configuring redirects and observability. **Auth and sessions are a separate reference (`auth-and-sessions.md`).** Server actions, `revalidateTag` from a mutation, and the `ActionResult` envelope live in `data-and-actions.md`.

## Environment variables

`process.env.X` reads are **server-only**. `NODE_ENV` is defined both sides. A variable named with the `WEBJS_PUBLIC_` prefix is exposed to the browser via an inline `<script>` (no build step), so read it client-side as `process.env.WEBJS_PUBLIC_ANALYTICS_ID`.

| Variable | Effect |
|---|---|
| `REDIS_URL` | When set, sessions, rate limit, and cache use Redis instead of memory |
| `SESSION_SECRET` / `AUTH_SECRET` | Session and auth signing (see `auth-and-sessions.md`) |
| `PORT` | Listen port. Precedence `--port` flag, then `PORT` (real env or `.env`), then `8080` |

Defaults are single-instance memory stores. To scale horizontally, switch the store once at startup: `setStore(redisStore({ url: process.env.REDIS_URL }))`.

**Validate required vars at boot with an app-root `env.ts`** (optional). It default-exports either a SCHEMA object (each var mapped to a type `string` / `number` / `boolean` / `url` / `enum`, or an options object with `optional` / `default` / `minLength` / `pattern` / `values`) OR a validator function `(env) => void` that throws. It runs at boot after `.env` loads, coerces values and writes defaults back to `process.env`, and fails fast naming EVERY bad var:

```ts
// env.ts
export default {
  DATABASE_URL: 'url',
  SESSION_SECRET: { type: 'string', minLength: 16 },
  PORT: { type: 'number', default: 8080 },
  LOG_LEVEL: { type: 'enum', values: ['debug', 'info', 'warn'], default: 'info' },
};
```

## Caching

### `cache()` for query and computation results

Wrap an async function so identical calls serve from the store until the TTL expires. Cached values and keys round-trip through the rich serializer, so a `Date` stays a `Date` on a warm hit.

```ts
// modules/posts/queries/list-posts.server.ts
'use server';
import { cache } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';

export const postById = cache(
  async (id: string) => db.query.posts.findFirst({ where: { id } }),
  { key: 'post', ttl: 300, tags: (id) => ['post:' + id] } // per-entity tag
);
export const listPosts = cache(
  async () => db.query.posts.findMany(),
  { key: 'posts', ttl: 60, tags: ['posts'] } // static tag
);
```

A mutation invalidates a tagged read from an unrelated module with `revalidateTag('post:' + id)` (evicts only that entry) or `revalidateTags([...])`. See `data-and-actions.md` for the mutation side. An untagged `cache()` is untouched by any `revalidateTag`.

### HTTP `Cache-Control`

Standard HTTP caching. Let browsers, CDNs, and proxies do the work. Set it on a `route.ts` `Response` or via page `metadata.cacheControl`.

```ts
export const metadata = { cacheControl: 'public, max-age=60' };
```

### Server HTML response cache (`export const revalidate`)

For a page that renders the **same HTML for every visitor**, opt into caching the SSR output (WebJs's no-build equivalent of ISR). Keyed by the request origin plus the full URL.

```ts
// app/blog/page.ts
export const revalidate = 60;   // cache this page's HTML for 60s
```

**Safety.** This asserts the page is identical for everyone for N seconds. Never set it on a page that reads `cookies()`, a session, or per-user data. The framework auto-marks a request dynamic and refuses to cache when the render reads per-user state through a framework helper (`cookies()`, `headers()`, `getSession()`, `auth()`), so an `auth()`-gated page fails safe. It also never caches a non-200, a streamed Suspense body, a `Set-Cookie` response, or a page under CSP. Evict on a write with `revalidatePath('/blog')`; `revalidateAll()` clears everything (single-instance / dev). This differs from the client-side `revalidate()` in `@webjsdev/core`, which evicts the browser snapshot cache. Keys carry the request ORIGIN as well as the path (#1097), because `ctx.url` comes from forwarded headers a proxy passes through rather than strips, so a hostile `X-Forwarded-Host` would otherwise bake an attacker-chosen origin into a body every later visitor gets served. A single-host deploy is unaffected (one origin, one entry per URL). It does mean a bare path does not name one entry, so `revalidatePath` resolves the origin from the calling request, which is exact for a server action; pass an absolute url from a background job that serves no requests of its own, where a bare path warns and evicts nothing. Under `webjs.basePath` the absolute url is the public one and its mount prefix is stripped, so it evicts the entry the write stored.

### Content-hash asset URLs and conditional GET

Both are automatic, prod-focused, and need no config. In production every served MODULE gets a per-file `?v=<hash>`, and a `?v=`-carrying request is answered `Cache-Control: public, max-age=31536000, immutable`, so a returning client fetches a changed file only when its bytes change.

A `public/` asset you reference yourself is opt-in, via `asset()` (#1194):

```ts
import { html, asset } from '@webjsdev/core';
html`<link rel="stylesheet" href=${asset('/public/app.css')}>`
```

That emits `/public/app.css?v=<hash>` in production and gets the immutable year; the same url un-marked gets a ~1h cap and can serve stale bytes from a CDN after a deploy until something purges it. `asset()` resolves on the server; the browser has no resolver and returns the path unchanged. Call it from a PAGE, LAYOUT, or metadata route, which render only on the server. Inside a component that ships to the browser it silently costs you the caching: hydration is a full client re-render, so the bare path overwrites the hashed one and the asset downloads twice. The url stays valid either way, so this is a convention rather than a `webjs check` rule (`webjs doctor` does flag the plain form, see below). Under `webjs.basePath`, include the prefix yourself (`asset('/app/public/x.css')`): the framework base-path-prefixes only the urls it emits, so an author-written url is already yours to prefix. Two more constraints: call it INSIDE the render function, because a module-scope call is a side effect the elision analyser reads as client work and it ships the whole module; and mark only files that change with a DEPLOY, because the hash is memoized for the process lifetime, so a `public/` file rewritten in place at runtime would keep its old url while being served `immutable` for a year. Off in dev, so dev output is byte-identical. Only `public/` paths resolve; anything else (and a path that fails to resolve) is returned untouched.

Forgetting it is the one real cost of opt-in, so `webjs doctor` catches it: a page, layout, or error boundary writing a plain `<link rel="stylesheet" href="/public/app.css">` gets a WARN naming the `file:line` and the fix (#1095). It reads your source and rewrites nothing, and it stays quiet about the non-marks that are deliberate: a cross-origin sheet, a `rel="icon"`, a `rel="preload"`, and any `href=${expr}` hole. Same posture as Rails (a `stylesheet_link_tag` helper over a digest manifest) and Remix (a hashed url from the build graph, surfaced through `links()`): take the fingerprint at the point the url is PRODUCED, never by rewriting a rendered document. A warning is easy to miss, so make it fatal in the app that cares: gate `UNMARKED_ASSET_LINKS` to `error` (see the doctor severity gate below) and one `npm run doctor` step in CI stops the un-versioned url reaching a deploy. The scaffold ships exactly that.

It is opt-in rather than automatic because only the author knows which urls are the REQUEST. Do NOT mark a `rel="preload"` hint whose asset is actually fetched by CSS `url()`: the preload cache is keyed on the full url, so a versioned hint can never satisfy the unversioned request the stylesheet makes, and the file is fetched twice. Mark the thing that fetches, not the hint. Every cacheable response also carries a weak `ETag`, and a repeat request with a matching `If-None-Match` gets a `304 Not Modified` with no body. Unstorable (`no-store`) and streamed responses are excluded from the ETag path. A `private` response IS validated: `private` forbids SHARED storage, not validation, and the ETag hashes that response's own body, so two users with different bodies get different ETags and neither can match the other's, while two users with identical bodies are asking about identical bytes, where a 304 discloses nothing (#1140). That is what keeps the client router's partial responses cheap on a page that opted into caching; a default `no-store` page has nothing to validate either way. Dev is byte-faithful (no hashing).

**A page's ETag is only useful if the page renders the same bytes twice.** The ETag is a hash of the response body, so any per-render-varying value anywhere in the document defeats it: a `Date.now()`, a `Math.random()`, an id from a module-scope counter (which never resets in a long-lived server), or a CSP nonce. The failure is silent and total. The page renders correctly, every content assertion still passes, the header is still present, and the only symptom is that no `If-None-Match` ever matches, so every revalidation ships the whole document instead of an empty 304. A page under CSP is excluded from the server HTML cache for exactly this reason (the nonce must differ per response). If a page opts into a public `Cache-Control`, guard it with a test that renders the page twice, through its layout, and asserts the two outputs are byte-identical.

## Rate limiting

`rateLimit()` is middleware backed by the pluggable cache store (memory by default, Redis when the global store is switched). Fixed-window.

```ts
// middleware.ts (or a per-segment middleware.ts)
import { rateLimit } from '@webjsdev/server';
export default rateLimit({ window: '1m', max: 60 });
```

Options: `window` (ms or a string like `'1m'`), `max`, `key` (a string prefix or a `(req) => string` function, defaults to the framework-stamped socket peer), `message`, `store`, `trustProxy` (honour the forwarded-IP headers; inert while `WEBJS_NO_TRUST_PROXY=1` is set, which outranks it and keeps the limiter on the framework-stamped peer). Over-limit responds `429` with `Retry-After` and `X-RateLimit-*` headers; an allowed response carries the remaining-quota headers too. For multi-instance scaling, set the global store to Redis once at startup.

**The default key is the socket PEER, which is the visitor only when the browser connects to you directly.** Deploy behind a CDN or a platform router and the peer is that proxy, so `trustProxy: true` is what a deployed limiter almost always wants. Get it wrong and nothing looks broken: a single shared proxy buckets every visitor together, and a proxy POOL (the common case) hands out one full allowance PER proxy, so the effective limit is multiplied by the pool size while `X-RateLimit-Remaining` still counts down convincingly inside each bucket. Diagnose it by sending the requests over ONE keep-alive connection, which pins them to one peer: counts that descend there but reset on a fresh connection mean you are bucketing proxies. `trustProxy: true` has one precondition, that the proxy in front strips an inbound `X-Forwarded-For` before adding its own (Cloudflare, Railway, Fly, Render, and Vercel do; nginx and Caddy only if configured), or a client can forge the header and choose its own bucket.

**Behind a CDN, `trustProxy: true` alone is usually still wrong, so name the header: `rateLimit({ trustProxy: true, clientIpHeader: 'cf-connecting-ip' })`.** The default chain starts at the leftmost `X-Forwarded-For` entry, which behind Cloudflare is Cloudflare's EGRESS address rather than the visitor. Cloudflare pins one egress IP per connection, so the symptom is a limiter that counts down correctly for a button that pings on one connection and never refuses anyone who opens a new one. When `clientIpHeader` is set it is the only wire header read (falling back to the peer, then `_anon_`), a blank value falls through rather than becoming a key every visitor shares, and a comma chain is split so an appending proxy cannot mint a bucket per hop. The framework will NOT prefer `CF-Connecting-IP` on its own, because Cloudflare overwrites it, which makes it unforgeable behind Cloudflare and forgeable anywhere else: on an nginx or bare-platform deploy a client could then send it and outrank the header the real proxy set. Name the header YOUR edge sets and overwrites.

## Broadcast

Send data to every WebSocket client connected to a route path, from inside that route's `WS` handler.

```ts
// app/api/chat/route.ts
import { broadcast } from '@webjsdev/server';
export function WS(ws, req) {
  ws.on('message', (data) => broadcast('/api/chat', data, { except: ws }));
}
```

`broadcast(path, data, opts?)` fans out to all clients on `path`; `opts.except` skips one socket (typically the sender). Single-instance by default; wire Redis pub/sub yourself for multi-instance.

## File storage

WebJs round-trips a native `File` / `Blob` / `FormData` over the wire; the file-storage primitive decides where the bytes land. Same adapter pattern as cache and sessions: a `FileStore` interface, a default `diskStore`, and a `setFileStore` / `getFileStore` singleton so swapping the backend touches no call site.

```ts
import { getFileStore, setFileStore, diskStore, generateKey, signedUrl, verifySignedUrl } from '@webjsdev/server';
// Default: <cwd>/.webjs/uploads served under /uploads. Override at startup:
setFileStore(diskStore({ dir: '/var/data/uploads', baseUrl: '/files' }));
```

`FileStore` methods (all web-standard, so an S3 / R2 adapter is a drop-in): `put(key, file, opts?)` streams to storage, `get(key)` returns a streaming handle (`{ body, size, contentType }`) or `null`, `delete(key)` (idempotent), `url(key)`, `has(key)`.

**Never trust a user filename as a key.** `generateKey(file.name)` returns an opaque `<uuid>.<ext>` with a sanitized extension; a traversal attempt yields a bare safe key. Keys are containment-checked before any filesystem op.

**Signed URLs** gate serving without a session lookup. `signedUrl(key, { secret, expiresIn })` mints an expiring HMAC signature; `verifySignedUrl(searchParams, secret)` returns `{ valid }`. An `expiresIn` of `0` or negative fails closed. Pass `base` to point the signed link at your own serve route instead of the default upload URL: `signedUrl(key, { secret, base: '/files/' + key, expiresIn: 3600 })`.

**Serving-XSS warning.** The recorded content-type is attacker-controlled (the browser sent it at upload). A serving route MUST send `X-Content-Type-Options: nosniff` and SHOULD send `Content-Disposition: attachment` for user uploads. Only serve inline after validating bytes against a strict inert allowlist, never `text/html` / `image/svg+xml`. Add the uploads directory to `.gitignore`.

## The `"webjs"` config block (package.json)

All keys are optional, and a malformed entry in a key the SERVER reads is dropped at boot rather than crashing the pipeline, some readers warning as they drop it. `headers` and `redirects` warn on every drop. Both warn for the key itself when it is present but not an array, and for each rule or entry inside it; `headers` has a third level and warns per header directive too. An absent key is the default and says nothing. An UNKNOWN top-level key no longer passes in silence either (#1300): the block is validated against the published JSON Schema once per boot, in dev and in prod alike, and one aggregated warning names what was ignored. So a `"redirect"` typed for `"redirects"` now says so in the server output instead of silently leaving the feature at its default. It never fails the boot. Know its exact reach, since what it passes over looks like what it catches. It reports any unknown TOP-LEVEL key, whatever it is called, and it checks the VALUE of 9 of the 17 known keys, being the one `enum` and the `boolean` / `integer` leaves. It does not descend into a nested object, so a misspelling inside `dev` or `start` is not reported, and it does not type-check the other 8 (`headers`, `redirects`, `basePath`, `allowedOrigins`, `csp`, `dev`, `start`, `doctor`), whose schemas are the free-form ones a blunt check would start refusing working configs over. Whether anything else notices a value this check passes over is up to that value's own reader, and it varies by reader. `doctor.gate` varies furthest, since the boot check never descends into any key and the `webjs doctor` CLI, not the server, is what reads this one, rejecting a bad entry outright (see the doctor severity gate below): a gate whose typo was quietly ignored would leave CI un-gated while looking gated, which is the one thing that mechanism cannot afford.

### Security headers

On by default (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, plus HSTS in prod over HTTPS). A default is set only when absent. Override per path:

```jsonc
{ "webjs": { "headers": [
  { "source": "/embed/:path*", "headers": [{ "key": "X-Frame-Options", "value": null }] }
] } }
```

`source` uses the native URLPattern syntax (`:param`, `:rest*`). A `value` of `null` disables a default. Precedence lowest to highest: secure defaults, then `webjs.headers`, then app middleware.

### CSP (opt-in, nonce)

Off by default. `{ "webjs": { "csp": true } }` enables a strict-dynamic + per-request nonce posture. An object form merges `directives` and supports `reportOnly`. Read the nonce with `cspNonce()` from `@webjsdev/core` to stamp your own inline `<script>`.

Enforcement is the HTTP `Content-Security-Policy` HEADER, never a `<meta http-equiv>` tag, so `frame-ancestors` / `report-uri` work. The emitted `<meta name="csp-nonce">` is only the client-side nonce CARRIER. Across a client-router soft navigation the ORIGINAL page-load nonce stays authoritative (the browser enforces the original document's CSP header, not the fetched response's fresh one), so the router preserves that meta and re-stamps every dynamically-inserted script / preload with the original nonce via `getCspNonce()`. The server still mints a fresh nonce per request, and CSP pages are excluded from the HTML cache so a nonce is never served stale. No client config is needed.

### Redirects, trailing-slash, basePath, allowed origins

```jsonc
{ "webjs": {
  "redirects": [{ "source": "/blog/:slug", "destination": "/posts/:slug" }],
  "trailingSlash": "never",
  "basePath": "/app",
  "allowedOrigins": ["admin.example.com"],
  "clientRouter": true
} }
```

- **`redirects`** run first in the pipeline. `permanent` defaults to `true` (308); set `statusCode` for a legacy code. The query string is preserved. No server-side loop guard, so keep a `destination` off another rule's `source`.
- **`trailingSlash`** picks a canonical form and 308-redirects the other. `"never"` (recommended), `"always"`, `"ignore"` (default). The root `/` is always exempt.
- **`basePath`** prefixes every framework-emitted URL for a sub-path mount and strips the prefix at ingress. Author-written `<a href>` links are NOT auto-prefixed. Empty default is a byte-identical no-op.
- **`allowedOrigins`** is the action-RPC CSRF allowlist (CSRF is an Origin / `Sec-Fetch-Site` check, not a token cookie). Default same-origin only. This is not CORS; use the `cors()` middleware for cross-origin `route.ts` reads.
- **`clientRouter: false`** opts the whole app out of SPA navigation (pure MPA) while components still hydrate. Per-page escape hatch: `disableClientRouter()`.

### Ingress caps

Inbound bodies and connection lifetimes are capped by default. Override in the block or via env; precedence is env, then package.json, then default. A value of `0` disables a cap.

| Cap | Default | Config key |
|---|---|---|
| JSON / RPC body | 1 MiB | `maxBodyBytes` |
| Form / multipart body | 10 MiB | `maxMultipartBytes` |
| Full request receive | 30s | `requestTimeoutMs` |
| Headers receive | 20s | `headersTimeoutMs` |
| Keep-alive idle | 5s | `keepAliveTimeoutMs` |

An over-limit body responds `413` without buffering the whole payload.

### Dev/start task orchestration

`webjs dev` and `webjs start` run per-environment tasks from the block, so the primitive matches `npm run dev` / `npm start`.

```jsonc
{ "webjs": {
  "dev":   { "before": ["webjs db migrate"], "parallel": ["tailwindcss ... --watch"], "watch": ["../blog"] },
  "start": { "before": ["webjs db migrate"] }
} }
```

`before` runs to completion first (a non-zero exit aborts the boot). `parallel` (dev only) runs long-lived watchers alongside the server and tears them down on exit. `watch` (dev only) adds extra live-reload directories outside the app tree.

### Doctor severity gate

`webjs doctor` reports project health, and by default only a broken toolchain fails the exit. `--strict` makes EVERY warning fatal, which is unusable in CI, because four checks are environment-shaped: `GIT_HOOK` wants a local pre-commit hook a runner has no reason to have, `ENV_DRIFT` compares against a `.env` CI does not carry, `VENDOR_PIN` fetches the network, and `FRAMEWORK_RESOLVE` plus `FRAMEWORK_LINKS` depend on the environment. So per-check severity is CONFIG, keyed by the stable code every result carries.

```jsonc
{ "webjs": {
  "doctor": { "gate": {
    "UNMARKED_ASSET_LINKS": "error",   // fail the exit on this one
    "ELISION_CARRIERS": "off"          // silence it entirely, even under --strict
  } }
} }
```

Three levels, the same scale ESLint uses: `error` fails the exit, `warn` reports without failing, `off` silences the check, meaning its finding is not printed and it cannot fail the exit (it still appears on the checklist as `[off]` and in the summary's silenced count, so a silenced check is never invisible, and `--json` still carries the whole result). A code with no entry keeps its default (`error` for a hard toolchain failure, `warn` otherwise), so an app that declares nothing behaves exactly as before. Read the codes off `webjs doctor --json`, where every result carries its `code` and its effective `severity`.

Two guarantees worth knowing. A result that could not check (a network or toolchain outage) is capped at `warn` and can never be escalated, so a jspm or npm outage cannot red your CI. And a malformed gate exits 1 naming the offender rather than being ignored, so a typo cannot silently un-gate the build. That covers an unknown code, a bad severity, a wrong shape (a non-object `doctor` or `gate`), and a misspelled sibling of `gate` such as `gates`, since every one of those would otherwise leave the build un-gated while the `package.json` looks gated. Under `--json` the offenders come back as a `configErrors` array alongside an empty `results`, each entry a `{ kind }` of `malformed` / `unknown-key` / `unknown-code` / `bad-severity`. Wire it up with one workflow step, `npm run doctor`, and change what is fatal in `package.json` rather than in the workflow.

## Observability

Wired at the single response funnel, covering pages, routes, actions, and assets uniformly.

- **Access log.** One structured `info` line per handled request (`method`, `path`, `status`, `durationMs`, `requestId`). Never logs bodies or secrets; framework `/__webjs/*` traffic is suppressed.
- **Request id.** Each request gets a `crypto.randomUUID()` correlation id, set as `X-Request-Id` (honoring a trusted inbound one) and readable server-side with `requestId()` from `@webjsdev/server` (returns `null` outside a request scope).
- **`onError` hook.** Register via `createRequestHandler({ onError })` or `startServer({ onError })`. Called with `(error, { request, requestId, phase })` on any caught pipeline error, before the sanitized response is sent. Best-effort (a throwing hook is ignored), purely additive (the sanitized 500 / action digest is unchanged). Point it at Sentry or an APM. It also carries two framework DIAGNOSTICS that are not request failures, each with an `err.code` to group or filter on, both under `phase: 'action'`: `WEBJS_FORM_SUBMITTED_AS_GET` (a page GET carrying the reserved `__webjs_action` field in its query string, so a submission holding a bound action's identity went out as a GET and the action never ran, #1307; a bound submitter carries its own `formmethod="post"`, so what reaches this is an explicit `formmethod="get"` / `method="get"` the author wrote and the renderer honours rather than refuses) and `WEBJS_FORM_ACTION_MISSING` (a PARSEABLE form body carrying no identity, the 405; an `enctype="text/plain"` submission is answered before its body is read, so it stays a bare 405). Both are detect-only, so the 200 and the 405 are unchanged; both carry `method`, `pathname`, and for the second the submitted field NAMES, never the values; and both are deduplicated per process on the code, the method, and the matched ROUTE (not the request pathname, so crafted urls on a dynamic route cannot exhaust the 256-entry cap and silence the diagnostics), since either is reachable by an unauthenticated request and an uncapped report would be a free amplifier into a paid sink.

```ts
const app = await createRequestHandler({
  appDir: process.cwd(),
  onError(error, { requestId, phase }) { Sentry.captureException(error, { tags: { requestId, phase } }); },
});
```

- **`instrumentation.ts`** (app root) default-exports or names a `register()` function run once at boot, before the route table builds. Inside it, `setOnError(fn)` composes with the handler option. A sibling `instrumentation-client.ts` runs first in the client boot script for browser-side init.
- **Build info.** `GET /__webjs/version` returns `{ version, build, node, uptime }` (`Cache-Control: no-store`), alongside the `/__webjs/health` and `/__webjs/ready` probes, so a deploy can confirm which build is live.
