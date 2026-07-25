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
 * Threat model: in webjs's typical deployment topology, the
 * container's HTTP port is only reachable through the trusted edge
 * proxy. There's no path for an attacker to inject these headers
 * without going through that proxy. For self-hosted bare-VM deploys
 * where the container is somehow directly exposed, set
 * `WEBJS_NO_TRUST_PROXY=1` to fall back to the raw `Host` header and
 * `http://` default.
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
  const finalHost = host || /** @type {string|undefined} */ (req.headers.host) || 'localhost';
  const finalProto = proto || 'http';
  return new URL(req.url || '/', `${finalProto}://${finalHost}`);
}

/**
 * Apply the forwarded headers to an ALREADY-PARSED url, for a shell whose
 * request is a web `Request` (Bun) rather than a node `IncomingMessage`.
 *
 * `urlFromRequest` above cannot be reused directly: it reads `req.headers` as a
 * plain node object, while a web `Request` exposes a `Headers` instance whose
 * values come from `.get()`. Reusing it against a `Request` silently reads
 * `undefined` for every header, so it LOOKS wired up while changing nothing.
 * Both entry points funnel through `readForwarded` so the two runtimes cannot
 * drift on the trust switch or the comma-chain rule.
 *
 * Returns the SAME URL instance when nothing changes (no proxy, or the headers
 * already agree), so the caller can use identity to skip rebuilding a request
 * on the hot path.
 *
 * @param {URL} url  the url as the local listener saw it
 * @param {Headers} headers  the web `Request` headers
 * @returns {URL} the corrected url, or `url` itself when unchanged
 */
export function applyForwarded(url, headers) {
  const { host, proto } = readForwarded((n) => headers.get(n));
  const finalHost = host || url.host;
  // `url.protocol` carries its trailing colon; the forwarded header does not.
  const finalProto = proto || url.protocol.slice(0, -1);
  if (finalHost === url.host && `${finalProto}:` === url.protocol) return url;
  return new URL(`${url.pathname}${url.search}${url.hash}`, `${finalProto}://${finalHost}`);
}

/**
 * Read the forwarded host / proto through a header getter, honoring the
 * `WEBJS_NO_TRUST_PROXY=1` opt-out. The one place the trust decision and the
 * comma-chain rule live, shared by the node and Bun entry points above.
 *
 * @param {(name: string) => string | string[] | undefined | null} getHeader
 * @returns {{ host: string | null, proto: string | null }}
 */
function readForwarded(getHeader) {
  if (process.env.WEBJS_NO_TRUST_PROXY === '1') return { host: null, proto: null };
  return {
    host: firstHeaderValue(getHeader('x-forwarded-host')),
    proto: firstHeaderValue(getHeader('x-forwarded-proto')),
  };
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
