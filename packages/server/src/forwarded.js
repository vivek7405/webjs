/**
 * Build a full URL from a Node IncomingMessage, respecting standard
 * reverse-proxy headers (`X-Forwarded-Proto`, `X-Forwarded-Host`).
 *
 * Why: WebJs apps are almost always deployed behind a reverse proxy
 * (Railway, Fly, Render, Vercel, Cloudflare, nginx, Caddy, Traefik -
 * see the no-build architecture docs). The proxy terminates TLS and
 * speaks plain HTTP/1.1 to the container, so `req.url` inside the
 * container reflects the internal "http" view. Without honoring the
 * forwarded headers, `ctx.url.origin` returns `http://container-host`
 * even though the browser is on `https://your-domain.com`: which
 * breaks OG / og:image tags, OAuth callback URLs, and any user code
 * that builds absolute URLs.
 *
 * Threat model: the two headers have DIFFERENT trust properties, so do
 * not reason about them as one.
 *
 * `X-Forwarded-Proto` is written by the proxy that terminates TLS, which
 * OVERWRITES whatever the client sent. In WebJs's typical deployment
 * topology the container's HTTP port is only reachable through that
 * trusted edge, so the value this code reads is the edge's, not the
 * client's. The guarantee is the overwrite, not the topology: an edge
 * that APPENDS instead would put the client's entry first in the chain,
 * and the comma rule below takes the first entry.
 *
 * `X-Forwarded-Host` is NOT covered by that argument. Cloudflare and
 * Railway FORWARD a client-supplied `X-Forwarded-Host` rather than
 * overwriting it, so going through the trusted proxy is exactly how a
 * hostile value arrives. Treat a forged forwarded host as reachable in
 * the NORMAL topology, not just on a directly-exposed container.
 * Consequence, and the rule to apply to your own code: anything SHARED
 * that is derived from the resulting origin must be KEYED by that origin
 * rather than assumed constant. That is what `html-cache.js` does, folding
 * `url.origin` into every cache key (#1097), after a single request
 * carrying a hostile host could poison a `revalidate` page for every
 * later visitor.
 *
 * `WEBJS_NO_TRUST_PROXY=1` makes THIS module ignore both headers and
 * fall back to the raw `Host` header and the `http://` default. It is
 * the remedy for a directly-exposed container, and it also narrows the
 * forwarded-host exposure above, so it is not only a bare-VM concern.
 * That switch is `trustProxy()` below, and it is now the ONE place the
 * posture is decided: `csrf.js`'s `requestHost` used to read
 * `x-forwarded-host` without consulting it, which is what #1104
 * centralized. See `trustProxy()` for the one deliberate non-consumer.
 *
 * Header semantics:
 * - `X-Forwarded-Host` / `X-Forwarded-Proto` can be a comma-separated
 *   chain if multiple proxies are in front (e.g. CDN -> load balancer
 *   -> container). The first entry is the value closest to the
 *   original client: that's what we want.
 * - Node sometimes returns headers as an array (when the same header
 *   appears multiple times); handle both string and array shapes.
 *
 * @param {{ url?: string, headers: Record<string, string | string[] | undefined> }} req
 * @returns {URL}
 */
export function urlFromRequest(req) {
  const { host, proto } = readForwarded((n) => /** @type {any} */ (req.headers)[n]);
  const rawHost = /** @type {string|undefined} */ (req.headers.host) || '';
  const u = resolveOrigin(proto || 'http', host, rawHost);
  // Assign the request target's parts rather than RESOLVING it against `u`.
  // Resolving is unsafe: a request line may carry `//evil.com/x`, a
  // scheme-relative reference, so `new URL('//evil.com/x', 'https://real-host')`
  // resolves to `https://evil.com/x`, handing over the origin AND silently
  // rewriting the path to `/x` so a different route matches. A request target
  // is a path, never a full reference, so it is assigned as one.
  const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(req.url || '/');
  u.pathname = (m && m[1]) || '/';
  u.search = (m && m[2]) || '';
  u.hash = (m && m[3]) || '';
  return u;
}

/**
 * Build the origin both entry points agree on, as an origin-only URL.
 *
 * Sharing this is what keeps the ORIGIN decision identical across the two
 * shells rather than a coincidence of two similar-looking expressions. The
 * layering matters: start from a known-good placeholder, apply the raw `Host`,
 * then let the forwarded host override it. Each assignment goes through
 * `setHost`, which ignores a value it cannot parse, so a junk header falls back
 * to the previous layer rather than 500ing the request or collapsing to
 * localhost.
 *
 * @param {string} proto  http / https. `normalizeProto` guarantees it for a
 *   forwarded value; the callers' fallbacks pass the url's own scheme, which is
 *   http or https for any request a listener shell can receive.
 * @param {string | null} forwardedHost
 * @param {string} rawHost  the `Host` header
 * @returns {URL} an origin-only URL
 */
function resolveOrigin(proto, forwardedHost, rawHost) {
  const u = new URL(`${proto}://localhost`);
  if (rawHost) setHost(u, rawHost);
  if (forwardedHost) setHost(u, forwardedHost);
  return u;
}

/**
 * Assign an authority, clearing any port the previous layer left behind.
 *
 * The `host` setter only updates the port when the new value CARRIES one, so
 * layering `X-Forwarded-Host: docs.webjs.dev` over `Host: container:3000`
 * otherwise yields `docs.webjs.dev:3000`: the public hostname wearing the
 * internal port. Clearing first makes each layer a full replacement.
 *
 * @param {URL} u
 * @param {string} value
 */
function setHost(u, value) {
  let probe;
  try {
    probe = new URL(`${u.protocol}//${value}`);
  } catch {
    // Not a parseable authority (`a b`, `[`, a port over 65535). Leave the
    // previous layer in place rather than throwing, so a junk header is never a
    // 500 on the fetch path or a failed WS handshake.
    return;
  }
  u.hostname = probe.hostname;
  // Assign the port unconditionally, including the empty string, so a value
  // carrying no port clears one the previous layer left behind.
  u.port = probe.port;
}

/**
 * Apply the forwarded headers to an ALREADY-PARSED url, for a shell whose
 * request is a web `Request` (Bun) rather than a node `IncomingMessage`.
 *
 * `urlFromRequest` above cannot be reused directly: it reads `req.headers` as a
 * plain node object, while a web `Request` exposes a `Headers` instance whose
 * values come from `.get()`. Reusing it against a `Request` silently reads
 * `undefined` for every header, so it LOOKS wired up while changing nothing.
 * Both entry points funnel through `readForwarded` (the trust switch, the
 * allowed schemes, the comma-chain rule) and `resolveOrigin` (the host
 * layering), so the HEADER and ORIGIN decisions cannot drift. What each shell
 * RECEIVES still differs: node gets an origin-form request target it treats as
 * a path, Bun gets a url its own parser already resolved, so an absolute-form
 * request line routes differently between them. The security-relevant part, the
 * origin, is decided here for both.
 *
 * Returns the SAME URL instance when nothing changes, so the caller can use
 * identity to skip rebuilding a request on the hot path. That fast path also
 * requires the url's own authority to already AGREE with the `Host` header:
 * `Bun.serve` reports an absolute-form request line (`GET http://evil/x`) as
 * the request's url, so returning early on "no forwarded headers" would let an
 * unproxied app hand a client full control of `ctx.url.origin`. When they
 * disagree the origin is rebuilt from `Host` and the client's authority is
 * discarded. A normal request has `url.host === Host`, so the optimization is
 * intact for every real request.
 *
 * The origin is rebuilt through the shared `resolveOrigin`, and the path parts
 * are COPIED onto it rather than re-parsed against it. Re-parsing is unsafe:
 * `url.pathname` for `GET //evil.com/x` is `//evil.com/x`, a scheme-relative
 * reference, so `new URL('//evil.com/x', 'https://real-host')` resolves to
 * `https://evil.com/x`. An attacker needed only the `X-Forwarded-Proto` every
 * TLS-terminating proxy already sets to take over the origin AND silently
 * change which route matched.
 *
 * The host FALLBACK is the `Host` header, not `url.host`, to match
 * `urlFromRequest` exactly: node builds from the raw header string, so with
 * `Host: webjs.dev:80` + `X-Forwarded-Proto: https` it judges the `:80` against
 * https and keeps it. Falling back to the already-normalized `url.host` dropped
 * it (port 80 is http's default), which made the two shells disagree on the
 * exact proto-only shape this helper exists for.
 *
 * @param {URL} url  the url as the local listener saw it
 * @param {Headers} headers  the web `Request` headers
 * @returns {URL} the corrected url, or `url` itself when unchanged
 */
export function applyForwarded(url, headers) {
  const { host, proto } = readForwarded((n) => headers.get(n));
  const rawHost = headers.get('host') || url.host;
  if (!host && !proto && url.host === rawHost) return url;
  // `url.protocol` carries its trailing colon; the forwarded header does not.
  const origin = resolveOrigin(proto || url.protocol.slice(0, -1), host, rawHost);
  if (origin.host === url.host && origin.protocol === url.protocol) return url;
  // Copy the path across verbatim. Never re-parse it against the new origin:
  // `url.pathname` for `GET //evil.com/x` is `//evil.com/x`, a scheme-relative
  // reference, so resolving would resolve the authority out of the PATH and
  // hand an attacker the origin (plus a different matched route) using only the
  // `X-Forwarded-Proto` every TLS-terminating proxy already sets.
  origin.pathname = url.pathname;
  origin.search = url.search;
  origin.hash = url.hash;
  return origin;
}

/**
 * Is a reverse proxy in front of this process trusted to speak for the client?
 *
 * The ONE place the posture is decided (#1104). Every reader of an
 * `X-Forwarded-*` header goes through this: the URL rewrite here, the HSTS
 * scheme gate in `headers.js`, and the CSRF host resolution in `csrf.js`. It
 * used to be three separate reads with two different answers, so
 * `WEBJS_NO_TRUST_PROXY=1` turned off two of them and an operator could not
 * tell from any single file whether their app trusted forwarded headers.
 *
 * Read from `process.env` at CALL time, never cached at boot, so a test (and a
 * runtime that mutates its own env) can toggle it per case.
 *
 * @returns {boolean}
 */
export function trustProxy() {
  return process.env.WEBJS_NO_TRUST_PROXY !== '1';
}

/**
 * Read the forwarded host / proto through a header getter, honoring the
 * `trustProxy()` opt-out. The one place the HEADER SHAPE rules (the
 * comma-chain, the scheme allowlist) live, shared by the node and Bun entry
 * points above.
 *
 * @param {(name: string) => string | string[] | undefined | null} getHeader
 * @returns {{ host: string | null, proto: string | null }}
 */
function readForwarded(getHeader) {
  if (!trustProxy()) return { host: null, proto: null };
  return {
    host: firstHeaderValue(getHeader('x-forwarded-host')),
    proto: normalizeProto(firstHeaderValue(getHeader('x-forwarded-proto'))),
  };
}

/**
 * Accept only `http` / `https` as a forwarded scheme (case-insensitively; the
 * URL normal form is lowercase, and comparing a raw `HTTPS` against
 * `url.protocol` otherwise misses the no-op case).
 *
 * Anything else is dropped rather than honored. A non-special scheme is the
 * damaging shape: `X-Forwarded-Proto: javascript` produced
 * `javascript://host/path`, whose `origin` is the literal string `null`, so
 * every absolute URL the app derived became `null/...`. A proxy in front of an
 * HTTP server only ever forwards http or https, so an allowlist costs nothing.
 *
 * @param {string | null} p
 * @returns {string | null}
 */
function normalizeProto(p) {
  if (!p) return null;
  const v = p.toLowerCase();
  return v === 'http' || v === 'https' ? v : null;
}

/**
 * Pick the first comma-separated value from a header that may be a
 * string, an array of strings, or undefined.
 *
 * @param {string | string[] | undefined | null} h
 * @returns {string | null}
 */
function firstHeaderValue(h) {
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) return null;
  const first = v.split(',')[0].trim();
  return first || null;
}
