# Runtime: Node and Bun

## What This Covers

- Running a WebJs app on **Node 24+** or **Bun**, and why the app source you write is identical on either.
- The three things that actually differ under the hood (the listener shell, the TypeScript stripper, a handful of built-ins), and the one feature gap (103 Early Hints on Bun).
- Scaffolding a Bun-flavored app and the `bun --bun run dev` / `start` commands.
- Where Deno fits (planned, not yet supported).

Read this when you are choosing a runtime, deploying, debugging a runtime-specific difference, or a scaffold emitted `bun.lock` and you want to know what changed. For the TypeScript stripping mechanics see `typescript.md`. For SQLite, caching, and other built-ins see `built-ins.md`. For the cross-runtime test matrix see `testing.md`.

## The app source is identical

There is nothing runtime-specific in the app you write. The same `app/`, `modules/`, `components/`, and `db/` files run byte-for-byte on Node and Bun, and the bytes the browser fetches are identical either way. WebJs picks the runtime shell at boot through a runtime-neutral seam inside its server (`node:http` on Node, `Bun.serve` on Bun), so nothing in your code branches on the runtime.

Pick a runtime from the deploy target, not the code. Default to Node unless you specifically want Bun's faster listener or a Bun-native deploy image. You do not import a runtime adapter, set a flag in your pages, or handle Node and Bun differently anywhere in application code. The one place the runtime is chosen is the scaffold (`--runtime`) plus the run command (`bun --bun` versus `npm`), covered below.

### Where the difference actually lives

Three seams pick a runtime-specific implementation, all inside the framework, none in your app:

- **The listener.** `startServer` selects the `node:http` request shell on Node and a native `Bun.serve` shell on Bun. Both parse the request, run middleware, dispatch to your routes, and stream the response through the same downstream pipeline, so an SSR page, a server action RPC, and a route handler behave identically.
- **The type stripper.** WebJs serves `.ts` / `.mts` as ES modules by erasing the types in place with no bundler. Those two are the whole set: there is no JSX anywhere in the framework, so a `.tsx` file is not served. On Node that is the built-in `module.stripTypeScriptTypes`; on Bun it is `amaro` (the same engine, byte-identical and position-preserving so stack traces still point at the right line). Either way your TypeScript must be erasable (see `typescript.md`).
- **A few built-ins.** SQLite, hot reload, and WebSockets each bind to the runtime's native primitive (see the table).

## Node vs Bun at a glance

| Area | Node 24+ | Bun |
|---|---|---|
| Install | `npm install` | `bun install` |
| Run | `npm run dev` / `npm run start` | `bun run dev` / `bun run start` |
| Listener | `node:http` shell | native `Bun.serve` (faster on the listening path only, not end-to-end, because SSR render dominates a real page) |
| TS strip | built-in `module.stripTypeScriptTypes` | `amaro` (byte-identical, position-preserving) |
| SQLite | built-in `node:sqlite` + `drizzle-orm/node-sqlite` | built-in `bun:sqlite` + `drizzle-orm/bun-sqlite` |
| Hot reload | `node --watch` | `bun --hot` |
| WebSocket | the `ws` library | native `Bun.serve` + a bridge adapter |
| 103 Early Hints | yes | no (`Bun.serve` has no informational-response API) |
| Dev edit to a page / layout | full reload (the `node --watch` restart replaces the process) | refreshes IN PLACE, no reload (#1398) |
| Reverse-proxy headers | `X-Forwarded-Proto` / `X-Forwarded-Host` honored | same |

**The in-place dev refresh (#1398) needs the server process to SURVIVE the edit,** which is the whole of the Node-versus-Bun difference in that row. A page or layout never hydrates, so a freshly rendered page is the complete truth for it and the client router can swap it in without a reload, keeping scroll and (for a page edit) the hydrated state of components outside the changed region. The server classifies the changed file and puts the verdict on the live-reload event, so this needs a process that is still alive to do the classifying.

Bun's `bun --hot` invalidates modules in place without restarting, so it gets the refresh. Node's `bun --hot` equivalent is `node --watch`, which RESTARTS the process on a change under `app`, `components`, `modules`, `lib`, or `actions`, or to a root `middleware.{ts,js,mts,mjs}`, and a fresh process holds no record of what changed, so those edits are always a full reload. Two Node cases still refresh in place: an edit OUTSIDE that watched set (`db/schema.server.ts`, a `webjs.dev.watch` content dir), and running `npm run dev -- --no-hot`, which keeps the server in one process on either runtime. A component edit is a full reload everywhere by design, because `customElements.define` is once-per-tag and swapping fresh markup onto the old class would be worse than the reload.

The 103 Early Hints gap costs only a small first-load latency edge where an edge proxy forwards the 103, never correctness. The `modulepreload` hints still ship in the document head on both runtimes.

Behind a TLS-terminating proxy (Railway, Fly, Render, Cloudflare, nginx), both shells rewrite the request URL from `X-Forwarded-Proto` / `X-Forwarded-Host`, so `ctx.url` in a page, `req.url` in a `route.{js,ts}` handler, and every absolute URL you build from either carry the ORIGINAL scheme and host rather than the internal `http://container` hop. A comma-separated chain (a CDN in front of a load balancer) takes the value closest to the client, only `http` and `https` are accepted as a scheme, and a malformed host is ignored rather than failing the request. This was Bun-only broken before #1090, which shipped an `http://` `og:image` on an HTTPS site.

`WEBJS_NO_TRUST_PROXY=1` is the global switch for "nothing trusted sits in front of this container, stop believing these headers". It is read in ONE place and is ABSOLUTE across every forwarded-header read: the URL rewrite, the HSTS scheme check, the CSRF host resolution, and `clientIp` (`x-forwarded-for` / `cf-connecting-ip` / `x-real-ip`) alike. So `rateLimit({ trustProxy: true })` is inert while the flag is set, falling back to the framework-stamped peer address (its default with no option) and warning once per process. The two CAN be set in contradiction, and the direction rule is what resolves it: the flag only ever SUBTRACTS trust and the per-call option can only add it, so the flag wins. Setting both is a misconfiguration that buckets every visitor behind the proxy onto one key, which is what the warning is for. It used to miss the CSRF host, which read `X-Forwarded-Host` regardless; that gap closed in #1104. Setting it on a genuinely proxied deploy is a misconfiguration, and it now shows up as one, since the legacy no-`Sec-Fetch-Site` CSRF fallback compares `Origin` against the raw `Host` and rejects a legitimate cross-host request. The primary `Sec-Fetch-Site` path, which nearly every real browser request takes, never consults the host at all and is unaffected either way.

One limit worth knowing: the rewrite belongs to `startServer`. An app embedded through `createRequestHandler` gets the `Request` its host adapter built, so that adapter owns the correction, the same boundary that already applies to the trusted client IP.

**Anything SHARED that you derive from `ctx.url` must be keyed by the origin.** Neither Cloudflare nor Railway strips a client-supplied `X-Forwarded-Host`, they forward it, so a hostile value reaches the container through the proxy rather than around it. That is fine for a per-request response (the attacker only poisons their own), and a real problem the moment a response is shared. WebJs handles the cache it owns: the server HTML response cache (`export const revalidate`) folds `url.origin` into every cache key (#1097), so a poisoned body is unreachable from any origin the attacker does not already control. Apply the same rule to anything you cache yourself off `ctx.url`, and note the rule reaches caches WebJs does not own either. A page served `Cache-Control: public` is stored by a CDN under the CDN's OWN key, which does not include `X-Forwarded-Host`, so keying the server cache cannot protect that copy. Derive nothing origin-dependent into a page you make publicly cacheable, or pin the origin from config rather than from `ctx.url`.

## Scaffolding a Bun app

`webjs create <name>` defaults to Node. Add `--runtime bun` for a Bun-flavored app (or run `bun create webjs <name>`, which auto-detects Bun from the invoking package manager):

```sh
webjs create my-app --runtime bun
```

`--runtime` is orthogonal to `--template`, so it re-flavors either full-stack or api. A Bun scaffold emits a `bun.lock`, a pure `oven/bun:1` Dockerfile plus a bun-install CI, and bun-command agent docs. The test, db, and check tooling still runs on Node.

## Running on Bun

A Bun app installs with `bun install` like Node, then its `dev` / `start` / `db` scripts force `bun --bun` so the server itself runs on Bun:

```sh
bun install
bun run dev      # or: bun run start
```

`bun --bun` overrides the `webjs` bin's Node shebang so the server runs on Bun, selecting the native `Bun.serve` listener and `amaro` type stripping. The app's dependencies resolve from `node_modules` exactly as on Node. The `start.before` migrate step (`webjs db migrate`) runs under Bun too. Commit the `bun.lock` for reproducible, offline installs. The scaffold's Bun Dockerfile runs `bun install` and serves via `CMD ["bun", "--bun", "run", "start"]`.

## Deploying either runtime

Production runs `npm run start` (Node) or `bun run start` (Bun), which serves the source directly with no build step. Both speak plain HTTP/1.1, so put a reverse proxy or platform edge in front for TLS and HTTP/2 (production perf leans on HTTP/2 multiplexing plus `modulepreload` hints, not a bundle). A `start.before` migrate runs first on both runtimes.

The scaffold ships a matching Dockerfile per runtime: a Node image for the default, a pure `oven/bun:1` image for `--runtime bun`. Commit the lockfile the runtime uses (`package-lock.json` for Node, `bun.lock` for Bun) so the deploy install is reproducible and offline.

## SQLite busy_timeout

Both `node:sqlite` and `bun:sqlite` default `busy_timeout` to 0, so a contended write throws `database is locked` immediately. The generated connection sets `PRAGMA busy_timeout = 5000` plus `PRAGMA journal_mode = WAL` on the raw client before Drizzle wraps it, on both runtime branches, so you get a sane 5-second wait instead of an instant failure. This is already wired in the scaffold's `db/connection.server.ts`.

## Verifying a runtime-sensitive change

Most app code needs no runtime-specific testing, because it does not touch a runtime seam. If you DO change something runtime-sensitive (the serializer, a stream, `node:crypto`, low-level request handling, anything that behaves differently under `Bun.serve` versus `node:http`), prove it on both runtimes. The Node suite is the source of truth, and an additive Bun matrix re-runs the runtime-sensitive tests under Bun. See `testing.md` for the cross-runtime matrix and the `test/bun/**` assertions.

For an ordinary feature (a page, an action, a component) a single-runtime test is enough, since the source is identical on either runtime.

## Future runtimes

The listener seam is runtime-neutral, so a `Deno.serve` shell (or an embedded adapter) slots in at the same point when added. Edge runtimes with no filesystem are a separate, later target. Until then, treat Deno as planned, not supported, and build on Node or Bun.
