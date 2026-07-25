import { html } from '@webjsdev/core';

export const metadata = {
  title: 'Security | WebJs',
  description:
    'The WebJs threat model and hardening surface: CSRF, CSP, secure headers, CORS, body limits, SRI, the .server boundary, sessions, and rate limiting, with which protections are automatic and which are opt-in.',
};

export default function Security() {
  return html`
    <h1>Security</h1>
    <p>This page consolidates webjs's threat model and hardening surface into one reference. The per-feature pages go deeper; this page is the map of what protects you, what is on by default, and what you must turn on before going live. Pair it with the <a href="/docs/deployment">Deployment</a> checklist for the go-live overlap.</p>

    <h2>Automatic vs opt-in at a glance</h2>
    <p>WebJs ships a secure baseline that needs no configuration, plus a set of protections you opt into when your app needs them.</p>
    <p><strong>Automatic (on by default, no config):</strong></p>
    <ul>
      <li>Secure response headers (<code>X-Content-Type-Options</code>, <code>X-Frame-Options</code>, <code>Referrer-Policy</code>, <code>Permissions-Policy</code>).</li>
      <li>CSRF protection on server-action RPC calls (Origin / Sec-Fetch-Site check, no token cookie).</li>
      <li>Server-only source protection and the browser-reachability gate (the <code>.server</code> boundary).</li>
      <li>Request body-size limits (413) and connection timeouts (slowloris defense).</li>
      <li>Subresource Integrity (SRI) on vendor imports, both pinned and live-resolved.</li>
      <li>Environment variables are server-only unless prefixed <code>WEBJS_PUBLIC_</code> (fail-closed).</li>
      <li>Open-redirect protection on declarative redirects and action redirects (same-site paths only).</li>
      <li>HSTS, but only in production over HTTPS.</li>
    </ul>
    <p><strong>Opt-in (you enable when needed):</strong></p>
    <ul>
      <li>Content-Security-Policy with a per-request nonce (<code>webjs.csp</code>).</li>
      <li>CORS for cross-origin route handlers (the <code>cors()</code> middleware).</li>
      <li>Rate limiting (the <code>rateLimit()</code> middleware).</li>
      <li>A shared session / cache / rate-limit store for horizontal scaling (Redis via <code>setStore</code>).</li>
    </ul>

    <h2>The <code>.server</code> boundary is the security boundary</h2>
    <p>The single most important invariant: server-only code goes in <code>.server.{js,ts}</code> files, <code>route.{js,ts}</code> handlers, or <code>middleware.{js,ts}</code>, and never in a page, layout, or component. The <code>.server</code> extension is a path-level boundary. The dev server refuses to serve its source to the browser. A file with a <code>'use server'</code> directive becomes RPC-callable (its browser import is rewritten to a typed stub that POSTs to the action endpoint); a file without it is a server-only utility (its browser import resolves to a stub that throws at load).</p>
    <p>On top of that, only files reachable from a browser-bound entry (a page, layout, error, loading, not-found, or component) are servable at all. The dev server walks the static import graph and any other file (your database connection module, <code>node:*</code> usage, secrets) returns a 404 by construction, the same posture as Next's bundler-manifest model derived statically. So the way to keep a dependency or a secret off the client is the <code>.server</code> boundary, not a runtime check. See <a href="/docs/no-build">No-Build Model</a> for the gate and <a href="/docs/server-actions">Server Actions</a> for the RPC model.</p>

    <h2>CSRF: an Origin / Sec-Fetch-Site check</h2>
    <p>Server-action RPC calls (the typed stubs generated from a <code>'use server'</code> import) are CSRF-protected by a cross-origin check, the model Remix 3 and Go 1.25 use. On a state-changing request the server reads the <code>Sec-Fetch-Site</code> fetch-metadata header (browser-set, unforgeable by page JS): <code>same-origin</code> and <code>none</code> pass. When that header is absent (an older browser), it falls back to comparing the <code>Origin</code> host against the request host. A cross-site request is rejected with 403 unless its origin is listed in <code>webjs.allowedOrigins</code>. You write nothing; importing the action and calling it is the whole API, and there is no token or cookie to manage.</p>
    <p>Because there is no per-request CSRF cookie, SSR responses carry no <code>Set-Cookie</code>, so a page that opts into a public <code>Cache-Control</code> (via <code>metadata.cacheControl</code>, e.g. on a root layout for a whole visitor-identical app) can be cached at a CDN edge. For a reverse-proxy or multi-domain setup, list the extra origins the check should accept in <code>webjs.allowedOrigins</code> (the check honors <code>x-forwarded-host</code>).</p>
    <div role="note" style="border-left:4px solid var(--accent,#3b82f6);padding:1rem 1.25rem;background:var(--bg-elev);border-radius:.25rem;margin:1.25rem 0">
      <p style="margin:0 0 .5rem;font-weight:600">Sharp edge: <code>route.ts</code> REST endpoints are NOT CSRF-protected</p>
      <p style="margin:0">A <code>route.ts</code> handler that exposes a server action over REST (whether hand-written or via the <code>route()</code> adapter) is NOT covered by the action RPC's cross-origin check (it is meant for external, often non-browser, consumers). You MUST authenticate every mutating REST endpoint yourself: a bearer token, an API key, an explicit CSRF scheme, or an origin allow-list. Treat a REST endpoint like any public API route, not like an internal action.</p>
    </div>

    <h2>Content-Security-Policy (opt-in, nonce-based)</h2>
    <p>CSP is off by default and enabled with a <code>webjs.csp</code> key in <code>package.json</code> (<code>true</code> for a strict default policy, or an object to customize directives and toggle report-only). When enabled the server mints a fresh per-request CSPRNG nonce, stamps it on the inline boot script, the importmap, and the modulepreload hints, and emits a matching <code>Content-Security-Policy</code> header carrying that exact nonce. One value flows from mint to header, so there is no drift, and it changes every request.</p>
    <p>To stamp the nonce on your own inline <code>&lt;script&gt;</code>, read it during SSR with <code>import { cspNonce } from '@webjsdev/core'</code>. For a strict <code>script-src 'self'</code> deploy with no CDN, pair CSP with <code>webjs vendor pin --download</code> so vendor bundles serve from your own origin. See <a href="/docs/configuration">Configuration</a> for the directive reference.</p>

    <h3>CSP and the client router</h3>
    <p>The policy is enforced by the <code>Content-Security-Policy</code> response HEADER, never by a <code>&lt;meta http-equiv&gt;</code> tag, so directives like <code>frame-ancestors</code> and <code>report-uri</code> that a meta-tag CSP cannot express work normally. The <code>&lt;meta name="csp-nonce"&gt;</code> tag WebJs emits is not an enforcement mechanism, it is a carrier: the client router reads the nonce from it to stamp any element it inserts.</p>
    <p>This matters on a soft navigation. The browser keeps enforcing the ORIGINAL page load's CSP header, because a fetched response's CSP never binds to the already-live document, so the ORIGINAL nonce stays authoritative for the life of that document. The router therefore preserves that first <code>&lt;meta name="csp-nonce"&gt;</code> across every swap and re-stamps each script, module preload, and inline script it inserts with the original nonce (via <code>getCspNonce()</code>), even though the server minted a fresh nonce for the navigation response. A hard reload or a full page load is the harmless case: it creates a NEW document that enforces that response's own fresh nonce, so the nonce stays consistent either way. Nothing gets blocked, and this needs no configuration. It is the client-side equivalent of the Rails and Turbo reuse-the-original-nonce workaround. CSP pages are also excluded from the server HTML cache, so a nonce is never replayed stale.</p>

    <h2>Secure headers and HSTS</h2>
    <p>Every response carries a baseline of standard security headers, so a scaffolded app is not clickjackable or MIME-sniffable without a reverse proxy:</p>
    <ul>
      <li><code>X-Content-Type-Options: nosniff</code></li>
      <li><code>X-Frame-Options: SAMEORIGIN</code></li>
      <li><code>Referrer-Policy: strict-origin-when-cross-origin</code></li>
      <li><code>Permissions-Policy: camera=(), microphone=(), geolocation=()</code></li>
      <li><code>Strict-Transport-Security</code>, set only in production over HTTPS (detected from the trusted edge proxy's <code>X-Forwarded-Proto</code>).</li>
    </ul>
    <p>A default is set only when absent, so a header your middleware or route handler already set is never clobbered. Override or disable a default per path with the <code>webjs.headers</code> config (a <code>value</code> of <code>null</code> drops a default, for example to allow framing on a public-embed route). Precedence runs secure defaults, then the path config, then app middleware (which always wins).</p>

    <h2>CORS for cross-origin route handlers</h2>
    <p>A cross-origin browser caller needs CORS. Wrap a <code>route.{js,ts}</code> handler or a <code>middleware.{js,ts}</code> with the <code>cors()</code> middleware, which handles origin reflection, the <code>OPTIONS</code> preflight, and <code>Vary: Origin</code>. One rule is non-negotiable: a credentialed endpoint (<code>credentials: true</code>) REQUIRES an explicit origin allow-list and must never combine with a wildcard <code>'*'</code>. The CORS spec forbids the pair, and reflecting any origin under credentials grants every site credentialed access. <code>cors()</code> narrows a wildcard to the reflected origin to keep the request working but warns once; do not rely on that for a real allow-list.</p>

    <h2>Request limits: body size and timeouts</h2>
    <p>Every path that reads a request body enforces a size cap (1 MiB for JSON/RPC, 10 MiB for forms, configurable via <code>webjs.maxBodyBytes</code> / <code>webjs.maxMultipartBytes</code> or the env overrides), returning 413 without buffering an over-limit body whole. The server also bounds connection lifetimes (<code>requestTimeout</code>, <code>headersTimeout</code>, <code>keepAliveTimeout</code>) as a slowloris defense. Both apply with secure defaults; a value of <code>0</code> disables a given cap when an edge already enforces it.</p>

    <h2>Subresource Integrity on vendor imports</h2>
    <p>Cross-origin vendor modules (resolved from jspm.io) carry a standard SRI <code>integrity</code> hash so a swapped or compromised CDN response cannot execute unverified. This now applies on both paths: a pinned app (<code>webjs vendor pin</code>) ships the hashes in its committed importmap, and an un-pinned app computes them live at warmup. SRI computation is fail-open: a CDN fetch failure during the live path skips that one hash with a warning rather than taking the app down. For reproducible hashes and zero warmup fetches, pin. See <a href="/docs/no-build">No-Build Model</a>.</p>

    <h2>Sessions and secret management</h2>
    <p>Session cookies are signed, so set a strong <code>AUTH_SECRET</code> (and <code>SESSION_SECRET</code> where used), 32 or more random characters, in production. Keep all secrets server-only: any <code>process.env</code> name WITHOUT the <code>WEBJS_PUBLIC_</code> prefix never reaches the browser (reading <code>process.env.DATABASE_URL</code> from a component returns <code>undefined</code>, the same as a typo). The prefix is fail-closed, so a secret cannot leak by accident. Prefer your platform's secret injection over a committed <code>.env</code> file. See <a href="/docs/sessions">Sessions</a> and <a href="/docs/auth">Auth</a>.</p>

    <h2>Rate limiting</h2>
    <p>Protect auth endpoints and other abuse-prone routes with the <code>rateLimit({ window, max })</code> middleware, placed at any route level (it applies to that subtree). Behind a reverse proxy or CDN, set <code>trustProxy: true</code> so it keys on the forwarded client IP, and make sure the proxy strips an inbound <code>X-Forwarded-For</code> before adding its own. See <a href="/docs/rate-limiting">Rate Limiting</a>.</p>

    <h2>The REST-endpoint security checklist</h2>
    <p>Because a <code>route.ts</code> REST endpoint is a public API, restate the rules every time you add one:</p>
    <ol>
      <li>Authenticate every mutating endpoint (bearer or API key, an explicit CSRF scheme, or an origin allow-list). A <code>route.ts</code> REST endpoint is NOT CSRF-protected.</li>
      <li>Validate input with the <code>validate</code> config export (or the <code>route()</code> adapter's <code>validate</code> option). Never trust a merged <code>{...query, ...params, ...body}</code>.</li>
      <li>Log responsibly. No user input or secrets in error messages (in production a thrown server action returns a generic message plus a correlation digest, never the raw message or the stack; the full error is logged server-side).</li>
      <li>Configure CORS narrowly with the <code>cors()</code> middleware. A credentialed endpoint requires an explicit origin list, never <code>'*'</code>.</li>
      <li>Rate-limit at the edge with <code>rateLimit()</code>.</li>
    </ol>

    <h2>Going live</h2>
    <p>Before a production deploy, walk the <a href="/docs/deployment">Deployment</a> checklist: terminate TLS at the edge (the production server speaks plain HTTP/1.1), set <code>AUTH_SECRET</code>, point a shared store at Redis if you scale horizontally, enable <code>webjs.csp</code> if your threat model calls for it, and pin vendors. The secure baseline covers the rest with no configuration.</p>
  `;
}
