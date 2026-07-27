/**
 * RFC 7232 conditional GET (ETag + If-None-Match -> 304).
 *
 * One shared funnel that, given a Request and the buffered Response the
 * pipeline produced, attaches a content-hash `ETag` when the response is
 * cacheable and missing one, then turns a matching `If-None-Match` into a
 * `304 Not Modified` with no body. Wired once at the response funnel in
 * `dev.js`'s `handle()`, so it covers SSR HTML pages, static assets, app
 * source modules, vendor / core runtime modules, and route-handler bodies
 * uniformly.
 *
 * What is EXCLUDED, and why:
 *   - `no-store` responses (the default for a dynamic page), which forbid
 *     storage outright, so there is nothing to validate. `private` is NOT
 *     excluded: it forbids SHARED storage, not validation, and the ETag hashes
 *     THIS response's body, so two users with different bodies get different
 *     ETags and neither can match the other's, while two users with identical
 *     bodies are asking about identical bytes, where a 304 discloses nothing
 *     (#1140).
 *     That is what lets the client router's partial responses stay `private`
 *     without losing their 304s.
 *   - Any body the framework did not positively mark as fully buffered. The
 *     funnel only hashes a response that ALREADY carries an `ETag` (a serve
 *     branch hashed its own bytes) OR carries the internal `X-Webjs-Buffered`
 *     marker the buffered serve branches stamp on a string / bytes body. It
 *     never calls `arrayBuffer()` on an unmarked body. This is the guard that
 *     keeps a user `route.{js,ts}` handler returning a `ReadableStream` (and
 *     especially an SSE `text/event-stream`, whose stream NEVER ends) from
 *     being buffered into memory or, worse, awaited forever so the response
 *     hangs. A web `Response` exposes a `ReadableStream` body for a string and
 *     for a live stream alike, with no public way to tell them apart, so a
 *     positive opt-in marker is the only safe discriminator.
 *   - Streaming Suspense bodies, flagged with `X-Webjs-Stream: 1` by the SSR
 *     pipeline (a stricter form of the unmarked-body rule: the marker is
 *     stripped and the response returned untouched). Streaming responses are
 *     not conditional-GET cached, by design.
 *   - Non-GET / non-HEAD methods, and any status other than 200. A validator
 *     is only meaningful for a successful, replayable read.
 *
 * The ETag is WEAK (`W/"..."`). It is computed over the UNCOMPRESSED body
 * bytes, then the prod compression step (`sendWebResponse` in `dev.js`) may
 * stamp `Content-Encoding: gzip` / `br` on the SAME response. A STRONG
 * validator must be unique per content-coding (RFC 7232 2.3.3), so reusing one
 * strong ETag across identity / gzip / br would be non-conformant; a WEAK
 * validator is the conformant choice for a hash shared across codings, and
 * `If-None-Match` already uses weak comparison so a `304` still fires.
 *
 * The ETag is computed over the response's OWN body bytes, so an identical
 * body yields an identical ETag across requests. Per-response varying bits
 * that ride RESPONSE HEADERS (the `x-webjs-build` id, a `set-cookie` CSRF
 * token, the CSP nonce on the header) are NOT part of the body hash, so they
 * do not destabilise the ETag. The one body-level varying input is the CSP
 * nonce stamped INTO the inline boot script: when CSP is enabled the HTML
 * body changes every request, so its ETag changes every request and a 304 is
 * simply never produced for that page (correct, not a bug). CSP is off by
 * default, so the common case has a stable body and a stable ETag.
 *
 * @module conditional-get
 */

import { digestHex } from './crypto-utils.js';

/**
 * Internal header a buffered serve branch stamps to opt a response into
 * conditional GET. Stripped at the funnel; it never reaches a client. A web
 * `Response` exposes a `ReadableStream` body whether it was built from a
 * string, bytes, or a live stream, so this explicit marker is how the funnel
 * KNOWS a body is safe to hash without risking buffering a route handler's
 * stream or hanging on an SSE response.
 */
export const BUFFERED_MARKER = 'x-webjs-buffered';

/** Internal header the SSR pipeline stamps on a genuinely-streamed body. */
export const STREAM_MARKER = 'x-webjs-stream';

/**
 * Headers that must not ride a 304 response (it has no body). Everything
 * else (ETag, Cache-Control, Vary, the framework's X-Webjs-Build /
 * X-Request-Id, Set-Cookie) is preserved so a shared cache and the client
 * router behave identically to a 200.
 */
const STRIP_ON_304 = ['content-length', 'content-encoding', 'content-type'];

/**
 * Is this response cacheable enough to carry a validator?  Cacheable means a
 * 200 whose `Cache-Control` is present and does not forbid STORAGE. Only
 * `no-store` is excluded. `no-cache` is INCLUDED: it means "revalidate before
 * reuse", and a 304 is exactly that revalidation answer, so dev's `no-cache`
 * assets still benefit.
 *
 * `private` is INCLUDED too (#1140). It was excluded on the theory that
 * per-user content must never get a "cross-session" 304, but that cannot
 * happen: the ETag is a hash of THIS response's body, and a 304 is returned
 * only when the client's own `If-None-Match` matches it. Two users with
 * different bodies get different ETags, so neither can ever match the other's;
 * two users with identical bodies are asking about identical bytes, where a
 * 304 is the correct answer and carries no body either way. `private` already
 * forbids the one real hazard, a SHARED cache storing the response.
 *
 * Widening this is what makes #1140's fragment downgrade safe to ship. Before
 * that change a reduced fragment INHERITED the page's public header, so it
 * already passed this check and already carried a validator; marking fragments
 * `private` would have taken that away, and since the router fetches them with
 * `cache: 'no-cache'` (#1131), every prefetch and soft navigation would have
 * re-downloaded the whole fragment. The exclusion is dropped rather than
 * special-cased because it was never justified on its own terms either, per
 * the reasoning above.
 *
 * @param {Response} res
 * @returns {boolean}
 */
function isCacheable(res) {
  if (res.status !== 200) return false;
  const cc = res.headers.get('cache-control');
  if (!cc) return false;
  return !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(cc);
}

/**
 * Parse an `If-None-Match` request header and test it against an ETag.
 * Honors the `*` wildcard and a comma-separated list, and compares
 * weak-insensitively (a `W/` prefix on either side is ignored for the
 * comparison, per RFC 7232 weak-comparison semantics, which is the correct
 * function for `If-None-Match`).
 *
 * @param {string | null} header  the raw `If-None-Match` value
 * @param {string} etag  the response ETag, e.g. `"abc123"`
 * @returns {boolean}
 */
export function ifNoneMatchSatisfied(header, etag) {
  if (!header || !etag) return false;
  const want = stripWeak(etag);
  for (const raw of header.split(',')) {
    const tok = raw.trim();
    if (tok === '*') return true;
    if (stripWeak(tok) === want) return true;
  }
  return false;
}

/** @param {string} tag */
function stripWeak(tag) {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

/**
 * Apply conditional-GET semantics to a finished, buffered Response.
 *
 * Returns either the same response (now possibly carrying an `ETag`) or, when
 * the request's `If-None-Match` matches, a fresh `304 Not Modified` with no
 * body and the validators / caching headers preserved. A streaming,
 * non-cacheable, or non-GET/HEAD response is returned unchanged.
 *
 * @param {Request} req
 * @param {Response} res
 * @returns {Promise<Response>}
 */
export async function applyConditionalGet(req, res) {
  const method = req.method.toUpperCase();
  // Always consume the internal buffered marker so it never reaches a client.
  const buffered = res.headers.has(BUFFERED_MARKER);
  if (buffered) res.headers.delete(BUFFERED_MARKER);
  // A genuinely streamed Suspense response is flagged by the SSR pipeline.
  // Strip that marker too and skip conditional-GET so the live stream is
  // never consumed.
  if (res.headers.has(STREAM_MARKER)) {
    res.headers.delete(STREAM_MARKER);
    return res;
  }
  if (method !== 'GET' && method !== 'HEAD') return res;
  if (!isCacheable(res)) return res;

  let etag = res.headers.get('etag');
  if (!etag) {
    // Only hash a body the framework positively marked as fully buffered.
    // Without the marker we must NOT read the body, because a user route
    // handler returning a ReadableStream would be buffered into memory, and
    // an SSE (text/event-stream) stream never ends so the await would hang
    // forever. A web Response exposes a ReadableStream body for a string and
    // for a live stream alike, so the marker is the only safe discriminator.
    if (!buffered) return res;
    let bytes;
    try {
      // Clone so the caller's body is never consumed. Safe here because a
      // marked body is built from a string / bytes, so the clone resolves
      // at once.
      bytes = new Uint8Array(await res.clone().arrayBuffer());
    } catch {
      // A body that refuses to buffer (should not happen for a marked branch)
      // is left without a validator rather than crashing the funnel.
      return res;
    }
    // WEAK validator. The hash is over the uncompressed body and is reused
    // across identity / gzip / br codings (compression runs after this), which
    // a STRONG ETag may not do (RFC 7232 2.3.3). If-None-Match weak-compares.
    etag = `W/"${(await digestHex('SHA-1', bytes)).slice(0, 16)}"`;
    res.headers.set('etag', etag);
  }

  if (ifNoneMatchSatisfied(req.headers.get('if-none-match'), etag)) {
    const headers = new Headers(res.headers);
    for (const h of STRIP_ON_304) headers.delete(h);
    return new Response(null, { status: 304, headers });
  }
  return res;
}
