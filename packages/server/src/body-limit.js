/**
 * Request body-size limits (413) and node:http server timeouts (issue #237).
 *
 * webjs's prod server reads request bodies on three paths: the server-action
 * RPC endpoint (actions.js), `route.{js,ts}` handlers via `readBody` (json.js),
 * and the no-JS form-submission path (form-dispatch.js). Without a cap, an
 * uncapped body is a memory-exhaustion vector. This module is the SINGLE place
 * that decides the limit and performs a bounded read, so every body-read site
 * enforces it uniformly.
 *
 * Two ideas, both web-standard / node:http-native, no library:
 *
 *   1. A bounded read. `readTextBounded` / `readFormDataBounded` reject a body
 *      over the configured limit with a 413 WITHOUT buffering the whole thing:
 *      a `Content-Length` over the limit is a fast reject (the body is never
 *      read), and a chunked/streamed body without `Content-Length` is counted
 *      while it streams and abandoned the moment it crosses the limit (so the
 *      process never holds more than roughly one chunk past the limit).
 *
 *   2. Server timeouts. `computeServerTimeouts` derives the `requestTimeout`,
 *      `headersTimeout`, and `keepAliveTimeout` values applied to the node:http
 *      server in `startServer`, with secure production defaults and config / env
 *      overrides. node semantics: `headersTimeout` MUST be < `requestTimeout`
 *      (node measures the header-receipt deadline from the start of the request,
 *      so a headers deadline at or above the whole-request deadline can never
 *      fire), so the helper clamps it below `requestTimeout` when a config sets
 *      them inconsistently.
 */

/** Default JSON / RPC body cap: 1 MiB. Generous for an action payload. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Default form / multipart body cap: 10 MiB. A form submission (the form-dispatch
 * path) may legitimately carry more than a JSON RPC call (a textarea, a small
 * upload), so it gets a separate, higher, still-bounded limit. Large file
 * uploads are a distinct concern (#247) with their own streaming story.
 */
export const DEFAULT_MAX_MULTIPART_BYTES = 10 * 1024 * 1024;

/**
 * Thrown by `readBody` (json.js) when a route handler's body exceeds the limit.
 * The RPC and form-dispatch paths return a 413 Response inline, but `readBody`
 * runs INSIDE a user route handler and returns parsed data, so it signals the
 * over-limit case by throwing. The API dispatcher (`handleApi`) catches this and
 * maps it to a 413, so a handler that just does `await readBody(req)` gets the
 * correct status with no extra code.
 */
export class BodyLimitError extends Error {
  constructor() {
    super('Payload Too Large');
    this.name = 'BodyLimitError';
    /** Marker so `handleApi` can detect it without an instanceof across module copies. */
    this.webjsBodyLimit = true;
  }
}

/** requestTimeout: time to receive the ENTIRE request (headers + body). 30s. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * headersTimeout: time to receive the request headers. Must be < requestTimeout
 * (node measures both from the same request start, so an equal-or-greater value
 * never fires). 20s is comfortably under the 30s whole-request deadline.
 */
export const DEFAULT_HEADERS_TIMEOUT_MS = 20_000;

/** keepAliveTimeout: idle time before closing a kept-alive socket. 5s. */
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5_000;

/**
 * Read a non-negative integer from an env var, or undefined when unset / blank /
 * not a finite non-negative integer. A value of `0` is honored (it disables the
 * limit / timeout), so the check is on parseability, not truthiness.
 *
 * @param {string | undefined} raw
 * @returns {number | undefined}
 */
function envInt(raw) {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/**
 * Read a non-negative integer from a package.json `webjs.<key>` value, or
 * undefined when absent / not a finite non-negative integer.
 *
 * @param {unknown} pkg parsed package.json (or any object)
 * @param {string} key the `webjs.<key>` field name
 * @returns {number | undefined}
 */
function pkgInt(pkg, key) {
  const v =
    pkg && typeof pkg === 'object' && /** @type {any} */ (pkg).webjs
      ? /** @type {any} */ (pkg).webjs[key]
      : undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
    return undefined;
  }
  return v;
}

/**
 * Resolve the body-size limits. Precedence: env override wins, then the
 * package.json `webjs.maxBodyBytes` / `webjs.maxMultipartBytes` config, then the
 * secure defaults. A value of `0` (from env or config) disables that limit, the
 * deliberate opt-out (e.g. an app fronted by an edge that already caps bodies).
 *
 *   WEBJS_MAX_BODY_BYTES        -> json / rpc cap
 *   WEBJS_MAX_MULTIPART_BYTES   -> form / multipart cap
 *
 * @param {unknown} pkg parsed package.json (or any object)
 * @param {{ env?: NodeJS.ProcessEnv }} [opts] injectable env (tests)
 * @returns {{ json: number, multipart: number }} resolved byte limits (0 = off)
 */
export function readBodyLimits(pkg, opts = {}) {
  const env = opts.env || process.env;
  const json =
    envInt(env.WEBJS_MAX_BODY_BYTES) ??
    pkgInt(pkg, 'maxBodyBytes') ??
    DEFAULT_MAX_BODY_BYTES;
  const multipart =
    envInt(env.WEBJS_MAX_MULTIPART_BYTES) ??
    pkgInt(pkg, 'maxMultipartBytes') ??
    DEFAULT_MAX_MULTIPART_BYTES;
  return { json, multipart };
}

/**
 * Resolve the node:http server timeouts. Precedence mirrors `readBodyLimits`:
 * env override, then package.json `webjs.requestTimeoutMs` /
 * `webjs.headersTimeoutMs` / `webjs.keepAliveTimeoutMs`, then the defaults. A
 * value of `0` disables that timeout (node's own "no limit" sentinel).
 *
 *   WEBJS_REQUEST_TIMEOUT_MS
 *   WEBJS_HEADERS_TIMEOUT_MS
 *   WEBJS_KEEP_ALIVE_TIMEOUT_MS
 *
 * node semantics enforced here: `headersTimeout` MUST be strictly less than
 * `requestTimeout` to fire (both deadlines run from the same request start). So
 * when a non-zero `headersTimeout` is >= a non-zero `requestTimeout`, clamp it
 * to just under `requestTimeout` rather than silently shipping a dead timeout.
 *
 * @param {unknown} pkg parsed package.json (or any object)
 * @param {{ env?: NodeJS.ProcessEnv }} [opts] injectable env (tests)
 * @returns {{ requestTimeout: number, headersTimeout: number, keepAliveTimeout: number }}
 */
export function computeServerTimeouts(pkg, opts = {}) {
  const env = opts.env || process.env;
  const requestTimeout =
    envInt(env.WEBJS_REQUEST_TIMEOUT_MS) ??
    pkgInt(pkg, 'requestTimeoutMs') ??
    DEFAULT_REQUEST_TIMEOUT_MS;
  let headersTimeout =
    envInt(env.WEBJS_HEADERS_TIMEOUT_MS) ??
    pkgInt(pkg, 'headersTimeoutMs') ??
    DEFAULT_HEADERS_TIMEOUT_MS;
  const keepAliveTimeout =
    envInt(env.WEBJS_KEEP_ALIVE_TIMEOUT_MS) ??
    pkgInt(pkg, 'keepAliveTimeoutMs') ??
    DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  // Keep headersTimeout strictly under requestTimeout so it can actually fire.
  // Both are measured from the same request start; a headers deadline at or
  // above the whole-request deadline is dead. Skip when either is 0 (disabled).
  if (requestTimeout > 0 && headersTimeout >= requestTimeout) {
    headersTimeout = Math.max(1, requestTimeout - 1000);
  }
  return { requestTimeout, headersTimeout, keepAliveTimeout };
}

/**
 * A 413 Payload Too Large response, returned by every body-read site when the
 * bounded read trips the limit. Tiny plain-text body so it stays content-type
 * agnostic; the caller never needs to vary it.
 *
 * @returns {Response}
 */
export function payloadTooLarge() {
  return new Response('Payload Too Large', {
    status: 413,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Read a request body as bytes, bounded by `limit`. The single funnel both text
 * and FormData readers go through.
 *
 *   - `limit <= 0` disables the cap (read the whole body).
 *   - A `Content-Length` header over the limit is a FAST REJECT: the body is
 *     never touched, so an attacker-declared huge upload costs nothing.
 *   - Otherwise the body stream is read chunk by chunk and the running total is
 *     checked AFTER each chunk. The moment it crosses the limit the read is
 *     abandoned (the stream reader is cancelled) and `tooLarge` is returned, so
 *     a chunked body with no `Content-Length` can never buffer more than the
 *     bytes already read (roughly limit + one chunk), not the full payload.
 *
 * @param {Request} req
 * @param {number} limit max bytes (0 / negative = unlimited)
 * @returns {Promise<{ tooLarge: boolean, bytes: Uint8Array | null }>}
 */
export async function readBytesBounded(req, limit) {
  // Fast reject on a declared Content-Length over the limit: never read a byte.
  if (limit > 0) {
    const cl = req.headers.get('content-length');
    if (cl != null) {
      const declared = Number(cl);
      if (Number.isFinite(declared) && declared > limit) {
        return { tooLarge: true, bytes: null };
      }
    }
  }

  const body = req.body;
  if (!body) return { tooLarge: false, bytes: new Uint8Array(0) };

  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      // Enforce WHILE reading so a no-Content-Length stream can't buffer past
      // the limit: bail the instant the running total crosses it.
      if (limit > 0 && total > limit) {
        // Stop pulling more bytes; release the upstream so the socket can close.
        try { await reader.cancel(); } catch { /* already closed */ }
        return { tooLarge: true, bytes: null };
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* reader already released */ }
  }

  // Concatenate the collected chunks into one buffer.
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { tooLarge: false, bytes: out };
}

/**
 * Read a request body as text, bounded by `limit`. Used by the RPC endpoint,
 * `readBody`, and the exposed-action REST path, all of which then parse the
 * text (WebJs wire or JSON).
 *
 * @param {Request} req
 * @param {number} limit max bytes (0 / negative = unlimited)
 * @returns {Promise<{ tooLarge: boolean, text: string }>}
 */
export async function readTextBounded(req, limit) {
  const { tooLarge, bytes } = await readBytesBounded(req, limit);
  if (tooLarge) return { tooLarge: true, text: '' };
  const text = bytes && bytes.byteLength ? new TextDecoder().decode(bytes) : '';
  return { tooLarge: false, text };
}

/**
 * Read a request body as `FormData`, bounded by `limit`. Used by the form-dispatch
 * form path. Reconstructs a bounded Request from the already-read bytes and
 * defers to the platform `formData()` parser, so multipart and
 * urlencoded bodies are decoded exactly as before, just size-checked first.
 *
 * @param {Request} req
 * @param {number} limit max bytes (0 / negative = unlimited)
 * @returns {Promise<{ tooLarge: boolean, formData: FormData | null }>}
 */
export async function readFormDataBounded(req, limit) {
  const { tooLarge, bytes } = await readBytesBounded(req, limit);
  if (tooLarge) return { tooLarge: true, formData: null };
  const ct = req.headers.get('content-type') || '';
  // Hand the bounded bytes back to a fresh Request so its standard formData()
  // parser (multipart boundary handling, urlencoded decoding) runs unchanged.
  const bounded = new Request(req.url, {
    method: 'POST',
    headers: ct ? { 'content-type': ct } : undefined,
    body: bytes && bytes.byteLength ? bytes : undefined,
  });
  const formData = await bounded.formData();
  return { tooLarge: false, formData };
}
