import { html } from '@webjsdev/core';

export const metadata = { title: 'Deployment | WebJs' };

export default function Deployment() {
  return html`
    <h1>Deployment</h1>
    <p>WebJs runs as a standard server on <strong>Node 24+ or Bun</strong>. There is no static export, no serverless adapter, and no edge runtime yet. Deploy it anywhere you can run Node or Bun: a VPS, a container, a PaaS like Fly.io or Railway, or behind a reverse proxy on bare metal. On Node the minimum is set by the built-in TypeScript type-stripping; on Bun the stripping comes from <code>amaro</code> automatically, so the same source runs on either.</p>

    <h2>Dev vs Prod</h2>
    <p>WebJs has two modes, controlled by the npm script (which wraps the underlying <code>webjs dev</code> / <code>webjs start</code> CLI):</p>
    <code-block># Development: live reload, no compression, no caching, verbose errors
npm run dev -- --port 8080

# Production: compression, ETags, cache headers, graceful shutdown
npm run start -- --port 8080</code-block>
    <p>Key differences:</p>
    <ul>
      <li><strong>Dev:</strong> Node's built-in <code>fs.watch</code> watches your source tree and triggers live reload via SSE. TypeScript files are served with <code>Cache-Control: no-cache</code>. Errors include full stack traces. No compression.</li>
      <li><strong>Prod:</strong> no file watcher, no SSE endpoint. Static files get ETags and <code>Cache-Control: public, max-age=3600</code>, unless the url carries a content hash, which promotes it to <code>max-age=31536000, immutable</code>. Served modules get that hash automatically; a <code>public/</code> asset gets it when you mark the url with <code>asset()</code>. Auto-vendored npm packages get <code>max-age=31536000, immutable</code>. Gzip and Brotli compression are enabled. Error responses omit stack traces.</li>
    </ul>

    <h2>No build step</h2>
    <div role="note" style="border-left:4px solid var(--accent,#3b82f6);padding:1rem 1.25rem;background:var(--bg-elev);border-radius:.25rem;margin:1.25rem 0">
      <p style="margin:0 0 .5rem;font-weight:600">Recommended for production: HTTP/2 at the edge</p>
      <p style="margin:0">webjs's per-file-ESM model rides HTTP/2 multiplex to be competitive with bundling. <strong>PaaS edges already serve HTTP/2 for free.</strong> Railway, Fly, Render, Vercel, Cloudflare Pages, and Heroku all terminate TLS + HTTP/2 at the edge and proxy plain HTTP/1.1 to your container. For bare-VM deploys, put nginx, Caddy, or Traefik in front to do the same job. The production server (<code>npm run start</code>) only speaks plain HTTP/1.1, so TLS termination is the proxy's responsibility, not the framework's.</p>
    </div>
    <p>The same <code>.js</code> / <code>.ts</code> source files that ran in <code>npm run dev</code> run in <code>npm run start</code>. There is no compile, bundle, or "prepare for production" phase. Production performance comes from HTTP/2 multiplex plus SSR-time <code>modulepreload</code> hints, not concatenation.</p>
    <p>The full mechanism (importmap, module graph, vendor bundling, 103 Early Hints, granular cache invalidation) lives in <a href="/docs/no-build">No-Build Model</a>. This page covers the deployment-side concerns.</p>

    <h2>Production Features</h2>

    <h3>Compression</h3>
    <p>In production mode, WebJs automatically negotiates <code>Accept-Encoding</code> and compresses responses with Brotli (quality 4) or Gzip (level 6). Compression applies to text-based content types: HTML, JavaScript, JSON, CSS, SVG, XML. Binary assets (images, fonts) are served uncompressed.</p>

    <h3>ETags and Cache Headers</h3>
    <p>Static files are served with a SHA-1 ETag and a 1-hour <code>max-age</code>, which is the fallback for an un-versioned url. Any request carrying a <code>?v=</code> content hash is served <code>max-age=31536000, immutable</code> instead, since a change to the bytes changes the url. Served modules are hashed automatically; mark a <code>public/</code> asset with <code>asset()</code> to opt it in (see <a href="/docs/cache">Caching</a>). Vendor npm packages resolve through importmap to jspm.io URLs (default) or to local <code>/__webjs/vendor/&lt;pkg&gt;@&lt;version&gt;.js</code> paths (after <code>webjs vendor pin --download</code>). Direct jspm.io URLs use jspm.io's own immutable headers; locally-served <code>--download</code> bundles use <code>max-age=31536000, immutable</code>. In dev, all files use <code>Cache-Control: no-cache</code>.</p>

    <h3>Conditional GET (ETag + If-None-Match)</h3>
    <p>Every <em>cacheable</em> response carries a content-hash <code>ETag</code>, and a repeat request whose <code>If-None-Match</code> matches it gets a <code>304 Not Modified</code> with no body (RFC 7232). A client holding an identical copy revalidates with a tiny 304 instead of re-downloading the whole body. This applies uniformly to static assets, app source modules, the core / vendor runtime, and to SSR HTML pages that opt into caching via <code>metadata.cacheControl</code>. The ETag is a <em>weak</em> validator (<code>W/"..."</code>), since it is computed over the uncompressed body and reused across the identity, gzip, and Brotli encodings, which a strong validator may not do (RFC 7232 2.3.3).</p>
    <p><strong>Unstorable content is excluded.</strong> A page with the default <code>Cache-Control: no-store</code> (every dynamic / per-user page) gets <em>no</em> ETag and never returns a 304: <code>no-store</code> forbids storage outright, so there is nothing to validate. A <code>private</code> response IS validated, because <code>private</code> forbids only SHARED storage and the ETag hashes that response's own body: two users with different bodies get different ETags and neither can match the other's, while two users with identical bodies are asking about identical bytes, where a 304 discloses nothing. <strong>Streaming responses are excluded too</strong>, both streamed Suspense pages and a <code>route.&#123;js,ts&#125;</code> handler that returns a <code>ReadableStream</code> (including an SSE <code>text/event-stream</code>). Their bodies are never buffered to be hashed, so a long-lived or never-ending stream is never read into memory and never stalls the response. A 304 preserves the validators and caching headers (<code>ETag</code>, <code>Cache-Control</code>, <code>Vary</code>) and drops only the body.</p>
    <p>Set a page's <code>metadata.cacheControl</code> to any value other than <code>no-store</code> to enable conditional GET on it:</p>
    <code-block>export const metadata = &#123; cacheControl: 'public, max-age=60' &#125;;</code-block>

    <h3>Content Security Policy (CSP) and vendor packages</h3>
    <p>The default vendor mode serves bundles from <code>https://ga.jspm.io</code> (the jspm.io CDN). If your app sets a strict <code>Content-Security-Policy</code> header with <code>script-src 'self'</code>, the browser blocks the jspm.io script and vendor imports fail to load.</p>
    <p>Two ways to handle this:</p>
    <ol>
      <li><strong>Allow jspm.io in CSP</strong>: add <code>https://ga.jspm.io</code> to your <code>script-src</code> directive. Example: <code>script-src 'self' https://ga.jspm.io</code>. Browsers fetch bundles from jspm.io's CDN. Same-origin-only consumers (compliance-locked, air-gapped) cannot use this mode.</li>
      <li><strong>Switch to <code>--download</code> mode</strong>: run <code>webjs vendor pin --download</code> at deploy-prep time and commit the resulting <code>.webjs/vendor/&lt;pkg&gt;@&lt;version&gt;.js</code> bundle files. The importmap then points at local <code>/__webjs/vendor/</code> paths served by your own origin. <code>script-src 'self'</code> alone is sufficient; no third-party allowlist needed. Suitable for compliance-locked, air-gapped, or strictest-CSP environments.</li>
    </ol>
    <p>Pick the mode that matches your security posture. The choice is per-deploy, not per-package: either everything goes through jspm.io or everything is locally vendored. Mixing modes per-package is not supported.</p>

    <h3>Secure response headers</h3>
    <p>WebJs sets a baseline of standard security headers on every response, so a deployed app is not clickjackable or MIME-sniffable without any reverse-proxy configuration. The defaults are literal HTTP headers:</p>
    <ul>
      <li><code>X-Content-Type-Options: nosniff</code></li>
      <li><code>X-Frame-Options: SAMEORIGIN</code></li>
      <li><code>Referrer-Policy: strict-origin-when-cross-origin</code></li>
      <li><code>Permissions-Policy: camera=(), microphone=(), geolocation=()</code></li>
      <li><code>Strict-Transport-Security: max-age=63072000; includeSubDomains</code> in production over HTTPS only</li>
    </ul>
    <p>HSTS is gated to production AND HTTPS. WebJs detects the original scheme from <code>X-Forwarded-Proto</code> (the header the trusted edge proxy forwards after terminating TLS), honoring the same proxy-trust posture as the rest of the framework, so HSTS is never set on a plain-HTTP hop or in dev. Set <code>WEBJS_NO_TRUST_PROXY=1</code> to stop trusting forwarded headers when nothing trusted sits in front of the container. It is one flag, read in one place, honored by everything that resolves the request ORIGIN: the URL rewrite, the HSTS scheme check, and the CSRF host resolution alike. It covers client-IP resolution too, so it outranks an explicit <code>rateLimit({ trustProxy: true })</code> and puts that limiter back on the stamped socket IP. On a genuinely proxied deploy setting it is a misconfiguration, and it shows up as one: the legacy CSRF fallback then compares <code>Origin</code> against the internal <code>Host</code> and rejects a legitimate cross-host request. Behind a CDN the flag is not what protects you from a forged <code>X-Forwarded-Host</code>, which Cloudflare and Railway forward rather than overwrite. Anything shared that you derive from the request origin must be keyed by that origin instead, the way the HTML response cache already keys itself.</p>
    <p>A default is set only when the response does not already carry that header, so anything your middleware, a <code>route.&#123;js,ts&#125;</code> handler, or <code>expose</code> sets always wins.</p>
    <h4>Per-path overrides</h4>
    <p>Declare per-path header rules in <code>package.json</code> under <code>"webjs": &#123; "headers": [...] &#125;</code>, shaped like Next's. The <code>source</code> is a path pattern matched with the native URLPattern API, so <code>:param</code> and <code>:rest*</code> tokens work:</p>
    <code-block>&#123;
  "webjs": &#123;
    "headers": [
      &#123; "source": "/embed/:path*", "headers": [&#123; "key": "X-Frame-Options", "value": null &#125;] &#125;,
      &#123; "source": "/app/:path*",   "headers": [&#123; "key": "X-Frame-Options", "value": "DENY" &#125;] &#125;
    ]
  &#125;
&#125;</code-block>
    <p>A rule can ADD a header, OVERRIDE a default by giving a new value, or DISABLE a default on a path with a <code>null</code> value (the first example drops <code>X-Frame-Options</code> so a public-embed route can be framed). Precedence, lowest to highest, runs secure defaults, then the <code>webjs.headers</code> path config, then app middleware (which always wins, since its headers are already on the response when WebJs merges).</p>

    <h4>Content-Security-Policy (nonce, opt-in)</h4>
    <p>WebJs can mint a fresh per-request CSP nonce and emit a matching <code>Content-Security-Policy</code> response header. It is OFF by default (a strict policy would break an app with third-party inline scripts/styles, so you opt in). Enable it with a <code>webjs.csp</code> key in <code>package.json</code>:</p>
    <code-block>&#123;
  "webjs": &#123; "csp": true &#125;
&#125;</code-block>
    <p><code>true</code> turns on a strict-by-default policy: <code>script-src 'nonce-&lt;minted&gt;' 'strict-dynamic' 'self' https:</code> plus <code>default-src 'self'</code>, <code>object-src 'none'</code>, <code>frame-ancestors 'self'</code>, and an inline-style allowance. That last one is needed because <code>style-src</code> carries no nonce source at all, so every inline style is admitted by <code>'unsafe-inline'</code>, the framework's own head rule included. What keeps it hard to give up is the style your app puts in the document: a light-DOM component's <code>&lt;style&gt;</code> block in <code>render()</code>, a shadow component's <code>static styles</code>, an inline <code>&lt;style&gt;</code> written by a page or layout, and <code>style="…"</code> attributes, which no nonce could reach even if the directive honoured one, since nonces apply to elements rather than attributes. On every request the framework mints a CSPRNG nonce (16 random bytes, base64), stamps it on every inline <code>&lt;script&gt;</code>, the importmap, and the <code>modulepreload</code> hints it emits (the same value <code>cspNonce()</code> returns during SSR), and sets the header carrying that exact nonce. The nonce on the header and the nonce on the scripts are one minted value, so there is no drift, and it changes every request.</p>
    <p>For a custom policy, give an object. <code>directives</code> is merged over the strict defaults (override one directive without restating the rest; a <code>null</code> value drops a default directive), and <code>reportOnly: true</code> emits <code>Content-Security-Policy-Report-Only</code> for a staged rollout:</p>
    <code-block>&#123;
  "webjs": &#123;
    "csp": &#123;
      "directives": &#123; "connect-src": "'self' https://api.example.com" &#125;,
      "reportOnly": true
    &#125;
  &#125;
&#125;</code-block>
    <p>The <code>__NONCE__</code> placeholder inside a directive value (e.g. in a custom <code>script-src</code>) is substituted with the minted nonce per request. A CSP header your app already set (in middleware, a <code>route.&#123;js,ts&#125;</code> handler, or the <code>webjs.headers</code> config) is never clobbered, so an explicit app policy still wins. Inside layouts/pages, read the nonce with <code>import &#123; cspNonce &#125; from '@webjsdev/core'</code> to stamp it on your own inline <code>&lt;script&gt;</code> tags; it is isomorphic (returns <code>''</code> in the browser, so the same source is safe to ship).</p>

    <h3>Request body limits &amp; server timeouts</h3>
    <p>The server hardens its request ingress by default. Every request body it reads (the action RPC endpoint, <code>route.&#123;js,ts&#125;</code> handlers via <code>readBody</code>, and the no-JS form-action dispatch path) is size-capped: 1 MiB for JSON / RPC (<code>webjs.maxBodyBytes</code> / <code>WEBJS_MAX_BODY_BYTES</code>) and 10 MiB for form / multipart (<code>webjs.maxMultipartBytes</code> / <code>WEBJS_MAX_MULTIPART_BYTES</code>). An over-limit body responds <code>413 Payload Too Large</code> without being buffered whole, so a hostile large upload cannot exhaust memory.</p>
    <p>The HTTP server also sets node:http timeouts to defend against slowloris and hung connections: <code>requestTimeout</code> (30s, <code>webjs.requestTimeoutMs</code> / <code>WEBJS_REQUEST_TIMEOUT_MS</code>), <code>headersTimeout</code> (20s, <code>webjs.headersTimeoutMs</code> / <code>WEBJS_HEADERS_TIMEOUT_MS</code>), and <code>keepAliveTimeout</code> (5s, <code>webjs.keepAliveTimeoutMs</code> / <code>WEBJS_KEEP_ALIVE_TIMEOUT_MS</code>). Per node semantics <code>headersTimeout</code> must be under <code>requestTimeout</code> to fire; an inconsistent config is clamped automatically. A value of <code>0</code> disables any of these (e.g. when an edge proxy already enforces them). On Bun the server uses <code>Bun.serve</code> (see below), which has one inactivity bound rather than three; <code>requestTimeout</code> maps to Bun's <code>idleTimeout</code>, clamped above the live-reload keepalive so a dev SSE stream is never reaped. Note that an inactivity bound is weaker against a slow-but-steady trickle body than node's total-request cap, and Bun has no separate headers/keep-alive timeout, so on Bun put an edge proxy in front for hard request caps if slowloris is a concern.</p>

    <h3>Graceful Shutdown</h3>
    <p>On <code>SIGINT</code> or <code>SIGTERM</code>, webjs:</p>
    <ol>
      <li>Stops accepting new connections.</li>
      <li>Closes all SSE (live reload) clients.</li>
      <li>Waits for in-flight requests to drain.</li>
      <li>Exits cleanly after drain completes, or force-exits after a 10-second timeout.</li>
    </ol>
    <p>Unhandled promise rejections are logged but do not crash the process. Uncaught exceptions trigger an orderly shutdown (state may be corrupted, so continuing is unsafe).</p>
    <p><strong>The process exits <code>0</code> only when an operator asked for the stop, it drained cleanly, and nothing crashed on the way out.</strong> Everything else is a <code>1</code>. A drain that fails is a failure on its own terms, so a server close that errors, or a drain still hanging when the 10-second deadline fires, exits <code>1</code> whichever signal started it. When the drain succeeds, the code instead reports why the process is going down: <code>SIGINT</code> or <code>SIGTERM</code> exits <code>0</code> provided nothing crashed while it drained, while a shutdown started by an uncaught exception exits <code>1</code> even though the drain was perfectly clean, because the process is dying from an error. A crash that lands <em>during</em> a graceful shutdown counts too: the drain window stays open for up to ten seconds while in-flight requests finish, and an uncaught exception thrown in it upgrades the exit to <code>1</code> rather than riding out the shutdown that was already under way. Your supervisor reads only that code, so this is what makes <code>Restart=on-failure</code> (systemd), a Docker restart policy, and a Railway or Kubernetes crash-loop detector actually fire on a crashed server instead of recording a successful exit and leaving the instance down.</p>

    <h3>Health and readiness probes</h3>
    <p>WebJs answers two built-in probe endpoints, and the distinction matters under runtime-first boot:</p>
    <code-block>GET /__webjs/health    # liveness:  always 200 once the process is listening
GET /__webjs/ready     # readiness: 503 until the instance is fully warm, then 200</code-block>
    <p><code>/__webjs/health</code> is <strong>liveness</strong>. It returns <code>200 { "status": "ok" }</code> as soon as the process is accepting connections, so an orchestrator can tell the process is alive. It never waits on the analysis.</p>
    <p><code>/__webjs/ready</code> is <strong>readiness</strong>. Because boot is instant and the whole-app analysis runs lazily on the first request, <code>/ready</code> returns <code>503 { "status": "pending" }</code> until the instance is <strong>fully warm</strong>, then <code>200 { "status": "ok" }</code>. Fully warm means both the deterministic analysis and the first vendor attempt have completed, so the importmap and its build id are settled. Point your <code>readinessProbe</code> at it and the orchestrator holds traffic off an instance until then, instead of routing the first user request into the cold analysis OR into the brief window where the importmap is still resolving. A background warm-up runs automatically once the server is listening, so on a rolling deploy the prior instance keeps serving until the new one is fully warm. The first vendor attempt is bounded by the jspm fetch timeout, so a vendor-CDN hiccup does not hold readiness down indefinitely: the instance becomes ready shortly after the timeout and serves with the resolved-or-best-effort importmap, and a transient failure is re-attempted on the next request.</p>
    <p>Both responses carry <code>Cache-Control: no-store</code>. Use them for Kubernetes probes, Docker HEALTHCHECK, load-balancer health checks, or uptime monitoring.</p>
    <code-block># Kubernetes deployment
livenessProbe:
  httpGet:
    path: /__webjs/health
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /__webjs/ready
    port: 8080
  initialDelaySeconds: 3
  periodSeconds: 5</code-block>
    <h4>Gating readiness on dependencies (optional)</h4>
    <p>Warm-complete does not by itself prove the database or a queue is reachable: the database driver connects lazily on the first query (node:sqlite opens the file, pg connects), not at warm-up. To gate readiness on live dependency health, add a <code>readiness.&#123;js,ts&#125;</code> file at the app root that default-exports an async function. Once the analysis is warm, <code>/ready</code> runs it on every probe; returning <code>false</code> or throwing reports <code>503 { "status": "unready" }</code>, so the orchestrator holds traffic off an instance whose dependencies are down.</p>
    <code-block>// readiness.ts
import { db } from './db/connection.server.ts';

export default async function ready() {
  await db.query.users.findFirst();  // throws if the database is unreachable
  return true;
}</code-block>

    <h2>HTTP/2: at the edge, not in webjs</h2>
    <p>WebJs delegates TLS termination and HTTP/2 negotiation to whatever sits in front of <code>npm run start</code>. The framework's HTTP server speaks plain HTTP/1.1. ALPN, certificates, and h2 framing are entirely the proxy's concern. Two reasons:</p>
    <ul>
      <li><strong>PaaS already gives you HTTP/2.</strong> Railway, Fly, Render, Vercel, Cloudflare Pages, and Heroku all terminate TLS + HTTP/2 at their edge and proxy plain HTTP/1.1 to your container. Zero framework configuration: you get HTTP/2 to the browser the moment you deploy.</li>
      <li><strong>For bare-VM, reverse proxies do it better.</strong> nginx, Caddy, and Traefik are battle-tested for TLS termination. They handle cert renewal (ACME), OCSP, ALPN, HTTP/3, and h2-to-h1 downgrade more capably than Node's <code>http2</code> module.</li>
    </ul>
    <p>Multiplexed streams and header compression (HPACK) are what make per-file ESM competitive with bundling. <a href="/docs/no-build">No-Build Model</a> explains why, and which transport features matter for the import graph.</p>
    <p><strong>Forwarding 103 Early Hints.</strong> WebJs sends a <code>103 Early Hints</code> response carrying <code>Link: rel=modulepreload</code> headers before SSR begins, so the browser can start fetching JS while the server renders. Most major edges (Cloudflare, fly-proxy, Fastly) forward 103 responses to the client transparently. If yours doesn't, the page still works (the headers are just lost) but you skip the head-start. Early Hints are disabled in dev because file churn could send stale URLs.</p>

    <h2>Pluggable Logger</h2>
    <p>WebJs includes a minimal logger that writes structured JSON in production and human-readable lines in development:</p>
    <code-block># Dev output:
[webjs] webjs dev server ready on http://localhost:8080

# Prod output (one JSON line per event):
{"level":"info","msg":"webjs prod server ready on http://localhost:8080","time":"2026-01-15T10:30:00.000Z"}</code-block>
    <p>Replace it with your own logger by passing any object with <code>info</code>, <code>warn</code>, and <code>error</code> methods to <code>createRequestHandler</code>:</p>
    <code-block>import { createRequestHandler } from '@webjsdev/server';
import pino from 'pino';

const logger = pino({ level: 'info' });

const app = await createRequestHandler({
  appDir: process.cwd(),
  dev: false,
  logger: {
    info: (msg, meta) =&gt; logger.info(meta, msg),
    warn: (msg, meta) =&gt; logger.warn(meta, msg),
    error: (msg, meta) =&gt; logger.error(meta, msg),
  },
});</code-block>

    <h2>Observability: access log, request id, error hook, build-info</h2>
    <p>Day-2 ops needs more than liveness probes. WebJs ships four standards-native observability surfaces, all wired at the single response funnel so they apply uniformly across pages, route handlers, server actions, and assets.</p>

    <h3>Per-request access log</h3>
    <p>Every handled request emits ONE structured <code>info</code> line through the pluggable logger after the response is produced, carrying <code>method</code>, <code>path</code>, <code>status</code>, <code>durationMs</code>, and <code>requestId</code>. It never logs request bodies or secrets. In prod the default logger writes it as one JSON object per line; in dev it is a readable line.</p>
    <code-block>{"level":"info","msg":"request","time":"2026-06-03T10:30:00.000Z","requestId":"4f1c…","method":"GET","path":"/dashboard","status":200,"durationMs":12.4}</code-block>
    <p>The framework's own <code>/__webjs/*</code> probe and static traffic is suppressed from the access log so it does not spam. App routes (including your <code>/api/*</code>) are logged. Swap in pino / your aggregator via the pluggable logger above and these lines flow straight into it.</p>
    <p><code>durationMs</code> is time-to-response-headers (a TTFB-like measure), not full-stream completion. For a streaming / Suspense response it reflects when the headers were produced, not when the last chunk flushed.</p>

    <h3>Request id / correlation id (X-Request-Id)</h3>
    <p>Each request gets a correlation id, minted with the native <code>crypto.randomUUID()</code>. An inbound <code>X-Request-Id</code> from a trusted upstream proxy is honored instead (so one trace id propagates across services); a missing or malformed value falls back to a minted id. The id is set on the response as <code>X-Request-Id</code>, included in the access log and the error log, and readable inside any server-side code (pages, layouts, server actions, route handlers, middleware) via <code>requestId()</code>:</p>
    <code-block>import { requestId } from '@webjsdev/server';

export async function GET() {
  const id = requestId();   // same id the response's X-Request-Id carries
  return Response.json({ traceId: id });
}</code-block>

    <h3>onError hook (APM / Sentry integration point)</h3>
    <p>Register an error sink to forward unhandled errors to your APM. <code>createRequestHandler({ onError })</code> (and <code>startServer({ onError })</code>) calls it whenever the request pipeline catches an unhandled error: the 500 path (a thrown route handler, middleware, or page render), or a server action that throws unexpectedly. The sink receives the original error plus a context object with the <code>request</code>, the <code>requestId</code>, and a coarse <code>phase</code> label, so you can correlate the report with the access log line.</p>
    <code-block>import { createRequestHandler } from '@webjsdev/server';
import * as Sentry from '@sentry/node';

const app = await createRequestHandler({
  appDir: process.cwd(),
  onError(error, { request, requestId, phase }) {
    Sentry.captureException(error, { tags: { requestId, phase } });
  },
});</code-block>
    <p><strong>The contract is best-effort.</strong> A throwing <code>onError</code> is caught and ignored so it can never crash the response, and the hook is purely additive: webjs's existing behavior (the sanitized 500, with only <code>error.message</code> in prod and never the stack) is unchanged. The hook fires BEFORE the sanitized response is sent, so the sink always sees the real error.</p>

    <p><strong>Two framework diagnostics ride the same hook</strong>, and neither is a request failure, so both carry an <code>err.code</code> you can group or filter on. <code>WEBJS_FORM_SUBMITTED_AS_GET</code> fires on a page GET carrying the reserved <code>__webjs_action</code> field in its query string, which only a bound submitter inside an UNBOUND form can produce; it is the one form-binding mistake that reaches production silently, because the page still renders a 200. <code>WEBJS_FORM_ACTION_MISSING</code> fires when a parseable form body carries no identity at all, the case answered with a 405. (An <code>enctype="text/plain"</code> submission is answered before its body is read, so that one stays a bare 405.) Both are detect-only, so neither changes the status; each carries <code>method</code> and <code>pathname</code>, plus the submitted field NAMES for the second (template constants that identify WHICH form posted nowhere, never the values, which are user data); and each is deduplicated per process on the code, the method, and the matched ROUTE (not the request pathname, so crafted urls on a dynamic route cannot exhaust the 256-entry cap and silence the diagnostics), because both are reachable by an unauthenticated request and an uncapped report would be a free amplifier into a paid sink. In dev the same two detections also log a warning, which is what makes the no-JS write path visible without an APM wired. See <a href="/docs/troubleshooting">Troubleshooting</a>.</p>

    <h3>Build-info endpoint</h3>
    <p><code>GET /__webjs/version</code> returns JSON describing the live build, alongside the health and readiness probes. A deploy can curl it to confirm which build is serving. It carries no secrets, and it is answered before the analysis warms (like the other probes), so it responds on a cold instance.</p>
    <code-block>GET /__webjs/version
{ "version": "0.8.10", "build": "&lt;importmap-hash&gt;", "node": "v24.4.0", "uptime": 38.21 }</code-block>
    <p><code>version</code> is the <code>@webjsdev/server</code> framework version, <code>build</code> is the published build id (the reload signal the client router reads from <code>data-webjs-build</code>, the importmap hash folded with the installed <code>@webjsdev/core</code> version; empty until the vendor map resolves). An app-source or SSR-only deploy is carried by a separate <code>X-Webjs-Src</code> / <code>data-webjs-src</code> signal (an automatic content hash of the app source) that evicts client caches softly; both are automatic, needing no configuration. <code>node</code> is the running Node version, and <code>uptime</code> is process uptime in seconds. The response carries <code>Cache-Control: no-store</code>.</p>

    <h2>createRequestHandler for Embedding</h2>
    <p>If you need to embed WebJs inside an existing server (Express, Fastify, Bun, Deno, serverless), use <code>createRequestHandler</code> directly. It returns a <code>handle(req: Request) =&gt; Promise&lt;Response&gt;</code> function that takes a standard Web API Request and returns a standard Response:</p>
    <code-block>import { createRequestHandler } from '@webjsdev/server';

const app = await createRequestHandler({
  appDir: '/path/to/your/app',
  dev: false,
});</code-block>

    <h3>Express</h3>
    <code-block>import express from 'express';
import { createRequestHandler } from '@webjsdev/server';

const app = await createRequestHandler({ appDir: process.cwd(), dev: false });
const server = express();

server.all('*', async (req, res) =&gt; {
  const url = new URL(req.url, \`http://\${req.headers.host}\`);
  const webReq = new Request(url, {
    method: req.method,
    headers: Object.fromEntries(
      Object.entries(req.headers)
        .filter(([, v]) =&gt; v != null)
        .map(([k, v]) =&gt; [k, Array.isArray(v) ? v.join(',') : String(v)])
    ),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
    duplex: 'half',
  });
  const resp = await app.handle(webReq);
  res.status(resp.status);
  resp.headers.forEach((v, k) =&gt; res.setHeader(k, v));
  if (resp.body) {
    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
});

server.listen(8080);</code-block>

    <h3>Bun</h3>
    <p>Running a WebJs app with <code>bun --bun run start</code> already uses <code>Bun.serve</code> natively: <code>startServer</code> detects Bun and selects a <code>Bun.serve</code> listener shell (skipping the node:http compatibility bridge for ~1.9x more requests/sec on the listening path), with near-complete feature parity (SSR, <code>route.ts</code>, SSE live-reload, WebSocket upgrade, brotli/gzip compression, timeouts, proxy-IP, and the <code>X-Forwarded-Proto</code> / <code>X-Forwarded-Host</code> URL correction so absolute URLs carry the original scheme and host behind a TLS-terminating proxy). The one node-only exception is 103 Early Hints, which <code>Bun.serve</code> cannot send (no informational-response API). So you only need the snippet below to <em>embed</em> WebJs inside your own <code>Bun.serve</code> alongside other routes:</p>
    <p><strong>Embedding moves the proxy-header responsibility to you.</strong> The parity list above describes <code>startServer</code>, which owns the listener. <code>createRequestHandler</code> takes the <code>Request</code> you hand it and derives every absolute URL from its <code>url</code>, so behind a TLS-terminating proxy you must rebuild that <code>Request</code> with the original scheme and host yourself, or <code>ctx.url</code> stays on the internal <code>http://</code> hop and og:image tags, canonical links, and OAuth callbacks come out wrong. The same applies to the trusted client IP. If you do not need to share the port with other routes, prefer <code>startServer</code> and let the framework handle it.</p>
    <code-block>import { createRequestHandler } from '@webjsdev/server';

const app = await createRequestHandler({ appDir: process.cwd(), dev: false });

Bun.serve({
  port: 8080,
  fetch: (req) =&gt; app.handle(req),
});</code-block>

    <h3>Deno</h3>
    <code-block>import { createRequestHandler } from '@webjsdev/server';

const app = await createRequestHandler({ appDir: Deno.cwd(), dev: false });

Deno.serve({ port: 8080 }, (req) =&gt; app.handle(req));</code-block>

    <h2>Environment Variables</h2>
    <p>WebJs reads the following environment variables:</p>
    <ul>
      <li><strong>PORT</strong>: server port (default: 8080). Resolved with precedence <code>--port</code> &gt; <code>PORT</code> (a real exported env var <em>or</em> a <code>PORT</code> in the app's <code>.env</code>) &gt; <code>8080</code>. A real exported <code>PORT</code> wins over the <code>.env</code> value, matching the auto-load's shell-wins-over-file rule.</li>
      <li><strong>NODE_ENV</strong>: not directly used by webjs (it uses the <code>dev</code> flag from the CLI command), but your app code and dependencies may read it.</li>
    </ul>
    <p>There is no deploy-id env var to set. WebJs detects a deploy automatically from the CONTENT of what it serves (the no-build model, where the source hashes ARE the version): a change to your app source or a <code>@webjsdev/server</code> upgrade turns over the client's stale caches on the next navigation (soft, no reload), and a vendor pin or a <code>@webjsdev/core</code> upgrade hard-reloads. A framework upgrade reflects once the app has installed the new <code>@webjsdev/*</code> version (governed by your dependency range and lockfile).</p>
    <p>For app-specific environment variables, use <code>process.env</code> in server-side code (pages, server actions, middleware, API routes). These are never exposed to the client.</p>
    <code-block># .env at the app root (auto-loaded at boot)
DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"
SESSION_SECRET="change-me"
API_KEY="sk-..."</code-block>
    <p>WebJs auto-loads <code>&lt;appDir&gt;/.env</code> into <code>process.env</code> on boot via Node 24+'s built-in <code>process.loadEnvFile</code>. No <code>dotenv</code> dependency. Shell-exported values take precedence over the file, so production platforms (Railway, Fly, Render, Docker, systemd) keep injecting secrets the same way they already do. See <a href="/docs/configuration">Configuration</a> for the full precedence rules.</p>

    <h2>Secrets: platform injection, not a committed file</h2>
    <p>WebJs deliberately stays out of secret management. There is no encrypted credentials file and no bespoke crypto subsystem. Secrets are plain environment variables, the 12-factor way, and the safe production posture is the standard one your platform already supports.</p>
    <div role="note" style="border-left:4px solid var(--accent,#3b82f6);padding:1rem 1.25rem;background:var(--bg-elev);border-radius:.25rem;margin:1.25rem 0">
      <p style="margin:0 0 .5rem;font-weight:600">Never commit <code>.env</code></p>
      <p style="margin:0">The scaffold gitignores <code>.env</code> for you. Keep it that way. A committed <code>.env</code> leaks every secret to anyone with repo access and into your git history forever. Commit <code>.env.example</code> (keys with placeholder values) instead, so a new contributor knows what to set without seeing real values.</p>
    </div>
    <p><strong><code>.env</code> is for local development only.</strong> It is the convenient way to set <code>DATABASE_URL</code>, <code>AUTH_SECRET</code>, and the rest on your own machine. It is NOT how production secrets should reach a deployed app.</p>
    <p><strong>Inject production secrets through the host platform's secret store.</strong> Because a shell-exported or platform-injected value takes precedence over the <code>.env</code> file (and you do not ship <code>.env</code> to production at all), every platform's native mechanism works with no webjs-specific step:</p>
    <ul>
      <li><strong>Railway / Fly / Render / Vercel / Heroku:</strong> set variables in the project's environment settings (or their CLI / dashboard secret store). They arrive as <code>process.env</code> at runtime.</li>
      <li><strong>Docker / Compose:</strong> pass <code>--env-file</code> at run time (a file that lives on the host, never in the image), or use Docker / Compose <code>secrets</code> for files mounted at <code>/run/secrets</code>. Do not <code>COPY</code> a <code>.env</code> into the image, and keep <code>.env</code> in <code>.dockerignore</code> (the scaffold does).</li>
      <li><strong>Kubernetes:</strong> a <code>Secret</code> surfaced as env vars (or a mounted file) via the pod spec.</li>
      <li><strong>systemd / bare VM:</strong> an <code>EnvironmentFile=</code> directive pointing at a root-owned, <code>0600</code> file outside the repo.</li>
    </ul>
    <p>Server-side code reads these with <code>process.env.X</code>. They never reach the browser: only names prefixed <code>WEBJS_PUBLIC_</code> are exposed client-side, and the boundary is fail-closed, so a secret cannot leak by a typo. See <a href="/docs/security">Security</a> for the full env boundary.</p>
    <h3>Rotate <code>AUTH_SECRET</code></h3>
    <p><code>AUTH_SECRET</code> signs session cookies and auth tokens, so treat it like any signing key: use 32 or more random characters, keep it only in the platform secret store, and rotate it periodically and immediately on any suspected exposure. Rotating it invalidates existing sessions and tokens (everyone is signed out), which is the point. For a zero-downtime rotation, deploy the new value during a low-traffic window and accept that active sessions end. The same applies to any <code>SESSION_SECRET</code> and to OAuth provider secrets.</p>
    <p>See the <a href="/docs/configuration">Configuration</a> page for the precedence rules and the optional <code>env.{js,ts}</code> boot-time validation that fails fast on a missing or malformed secret.</p>

    <h2>Database connections (Drizzle + Postgres)</h2>
    <p>SQLite needs no pool tuning. When you move to Postgres in production, size the connection pool, because connection exhaustion is the most common scaling surprise and WebJs gives no prior signal in dev (SQLite has no pool).</p>
    <p>A WebJs server is ONE Node process per instance, and the <code>pg</code> driver behind Drizzle opens its own connection pool inside that process. A <code>pg.Pool</code> defaults to a max of 10 connections, which is fine for a single instance but multiplies as you scale: with <strong>N</strong> instances the database sees up to <strong>N times the per-instance pool</strong> connections at once. Postgres caps total connections (often 100 on a small managed plan), so a few instances on the default pool can exhaust it.</p>
    <p><strong>Bound the per-instance pool with <code>max</code> in the <code>Pool</code> config</strong> (the snippet below), sized so <code>instances * max</code> stays comfortably under the database's <code>max_connections</code> (leave headroom for migrations and admin tools). The <code>pg</code> driver behind Drizzle takes its pool size from <code>new Pool({ max })</code> in code, not from a <code>DATABASE_URL</code> query parameter:</p>
    <code-block># The URL carries no pool-size hint; db/connection.server.ts sets the pool max.
DATABASE_URL="postgresql://user:pass@db.example.com:5432/app"</code-block>
    <p><strong>Front Postgres with a pooler when instance count is high or variable</strong> (autoscaling, many small instances, or a low <code>max_connections</code> plan). Point <code>DATABASE_URL</code> at a transaction-mode pooler (PgBouncer, or a managed pooler like Supabase, Neon, or PlanetScale) so many app connections share a small set of real database connections. With PgBouncer in transaction mode, the <code>pg</code> pool must NOT use prepared statements, and migrations need a DIRECT connection (the pooler does not support the session features migrations need):</p>
    <code-block># App traffic goes through the pooler (port 6543), migrations go direct (5432).
DATABASE_URL="postgresql://user:pass@pooler.example.com:6543/app?pgbouncer=true"
DIRECT_URL="postgresql://user:pass@db.example.com:5432/app"</code-block>
    <code-block>// db/connection.server.ts (Postgres variant)
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.server.ts';

// max bounds the per-instance pool; 1 behind a transaction pooler.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export const db = drizzle({ client: pool, relations: schema.relations });</code-block>
    <p>Behind a transaction pooler, set <code>max: 1</code> per instance (the pooler does the multiplexing). Without a pooler, set <code>max</code> to a per-instance budget and keep the instance count bounded. Point <code>drizzle-kit</code> (via <code>DIRECT_URL</code>) at the direct connection for migrations. Either way, import <code>db</code> from the scaffolded <code>db/connection.server.ts</code> singleton, never construct a new <code>Pool</code> per request, so a process opens one pool, not one per call.</p>

    <h2>Docker / Containerisation</h2>
    <p>A minimal Dockerfile for a WebJs app:</p>
    <code-block>FROM node:24-slim

WORKDIR /app

# Install dependencies (no native build step needed, since webjs ships no bundler)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy app source as-is; the server serves it directly
COPY . .

EXPOSE 8080
HEALTHCHECK CMD curl -f http://localhost:8080/__webjs/health || exit 1

CMD ["npx", "webjs", "start"]</code-block>
    <p>Tips:</p>
    <ul>
      <li><code>node:slim</code> works fine. WebJs strips TypeScript via the runtime's stripper (Node's built-in <code>module.stripTypeScriptTypes</code>, or <code>amaro</code> on a Bun image), so no extra system packages are needed.</li>
      <li><strong>Serve on Bun (the scaffold's <code>--runtime bun</code> Dockerfile).</strong> <code>webjs create my-app --runtime bun</code> (or <code>bun create webjs my-app</code>) generates a pure <code>oven/bun:1</code> Dockerfile (no Node): <code>bun install</code> and <code>CMD ["bun", "--bun", "run", "start"]</code>. This works because <code>webjs db</code> / <code>webjs test</code> resolve their tools (drizzle-kit, wtr) and run them under the current runtime instead of <code>npx</code> (#570), so the boot-time <code>webjs db migrate</code> runs under Bun with no Node toolchain. SQLite uses the built-in <code>bun:sqlite</code> (no native module), so no build toolchain or <code>trustedDependencies</code> is needed. If you prefer a Node base instead, copy the Bun binary into a Node image with <code>COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun</code> and start with <code>bun node_modules/@webjsdev/cli/bin/webjs.js start</code> (<code>startServer</code> selects the <code>Bun.serve</code> shell either way). Note: a direct <code>bun webjs.js start</code> bypasses npm lifecycle hooks, so any per-app asset a <code>prestart</code> hook generates (Tailwind css, generated component sources) must be baked at BUILD time in the image; only runtime-dependent steps (a DB <code>webjs db migrate</code>) belong in the start command. One trade-off: <code>Bun.serve</code> has no informational-response API, so the 103 Early Hints modulepreload head-start (covered above) is node-only. The preload hints still ship in the document head, so this costs a small first-load latency edge only where your edge forwards 103, not correctness.</li>
      <li><code>npm ci --omit=dev</code> skips dev dependencies. <code>@webjsdev/server</code> is a runtime dependency. WebJs is buildless end-to-end: there is no bundler or transpiler at deploy time.</li>
      <li>Set <code>HEALTHCHECK</code> to the built-in health endpoint for container orchestrators.</li>
      <li>Drizzle has no client codegen step, so nothing to run at build time. Apply migrations at start instead. The scaffold puts <code>webjs db migrate</code> under <code>webjs.start.before</code>, which runs before the server serves (a read-only prod container still applies pending migrations against its writable database).</li>
      <li>Layer-cache deps separately: copy <code>package.json</code> + <code>package-lock.json</code> and <code>npm ci</code> before copying the rest of the source, so application edits don't bust the deps layer.</li>
    </ul>

    <h2>Reverse Proxy (nginx / Caddy), recommended for HTTP/2</h2>
    <p>For production deployments, a reverse proxy handles TLS termination, HTTP/2, static asset caching, and load balancing. WebJs runs as an HTTP/1.1 upstream, and the proxy speaks HTTP/2 to clients.</p>

    <h3>nginx</h3>
    <code-block>upstream webjs {
    server 127.0.0.1:8080;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # WebSocket upgrade
    location / {
        proxy_pass http://webjs;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}</code-block>

    <h3>Caddy</h3>
    <code-block>example.com {
    reverse_proxy localhost:8080
}</code-block>
    <p>Caddy automatically provisions TLS certificates via Let's Encrypt and enables HTTP/2. It also handles WebSocket upgrades transparently.</p>


    <h2>Process Managers</h2>
    <p>For non-containerised deployments, use a process manager to keep WebJs running:</p>
    <code-block># systemd unit
[Unit]
Description=webjs app
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/srv/my-app
ExecStart=/usr/bin/webjs start --port 8080
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://...

[Install]
WantedBy=multi-user.target</code-block>
    <code-block># Or with PM2
pm2 start "webjs start" --name my-app</code-block>

    <h2>Deployment Checklist</h2>
    <ul>
      <li>Node 24+ or Bun installed (the TypeScript type-stripping for both server-side imports and browser-bound <code>.ts</code> files comes from Node's built-in on Node, or <code>amaro</code> on Bun).</li>
      <li><code>npm ci --omit=dev</code> to install only runtime dependencies.</li>
      <li>No database client codegen step (Drizzle). Pending migrations apply via <code>webjs db migrate</code>, which the scaffold runs under <code>webjs.start.before</code>.</li>
      <li>No build step. Source <code>.js</code> / <code>.ts</code> files are deployed as-is. TypeScript types are stripped on first request via Node's built-in stripper (whitespace replacement, byte-exact positions, no sourcemap overhead) and cached by mtime.</li>
      <li>Set environment variables (<code>DATABASE_URL</code>, <code>SESSION_SECRET</code>, etc.).</li>
      <li>Use <code>webjs start</code> (not <code>webjs dev</code>) for production.</li>
      <li>Configure health checks against <code>/__webjs/health</code>.</li>
      <li><strong>HTTP/2 at the edge is recommended.</strong> PaaS deploys (Railway, Fly, Render, Vercel, Cloudflare Pages, Heroku) give you HTTP/2 to the browser automatically. For bare-VM deploys, front <code>npm run start</code> with nginx, Caddy, or Traefik.</li>
      <li>Set up log aggregation (WebJs outputs structured JSON in production).</li>
    </ul>
  `;
}
