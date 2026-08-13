/**
 * Runtime-neutral listener core (#511): the pieces both the node:http shell and
 * the `Bun.serve` shell share, so the two adapters cannot drift.
 *
 * `createRequestHandler` already returns a runtime-agnostic `handle(req): Response`.
 * The remaining shell work (accept a socket, dispatch SSE live-reload, upgrade a
 * WebSocket, apply timeouts + compression, run graceful shutdown) is split here
 * into the genuinely-shared decision logic (this module) and the irreducibly
 * transport-specific glue (the node `res.write` path in `dev.js`, the `Bun.serve`
 * streaming-`Response` path in `listener-bun.js`). The SSE registry + fanout, the
 * live-reload path predicate, the WS module loader, the runtime detector, and the
 * lifecycle wiring all live here so a feature added to one shell is added to both.
 *
 * The seam also sets up future `Deno.serve` / embedded-host adapters: a new shell
 * supplies its own client wrapper to `SseHub`, its own socket-to-`Request` bridge,
 * and its own `closeServer` thunk, and reuses everything else verbatim.
 */
import { pathToFileURL } from 'node:url';
import {
  createBrotliCompress, createGzip, createDeflate,
  brotliCompressSync, gzipSync, deflateSync,
  constants as zlibConstants,
} from 'node:zlib';
import { stripBasePath } from './base-path.js';
import { randomUUID } from 'node:crypto';

/** The dev live-reload SSE path (matched after base-path stripping). */
export const EVENTS_PATH = '/__webjs/events';

/**
 * A per-PROCESS id sent on the dev SSE `hello` frame (#893). It is regenerated
 * on every server start, so a `node --watch` RESTART yields a NEW id while a
 * transient reconnect (laptop sleep/wake, a network blip, a tab evicted at the
 * HTTP/1.1 connection cap) reconnects to the SAME process and sees the SAME id.
 * The reload client reloads only when this id CHANGES, so a mere reconnect never
 * triggers a spurious full reload that would discard in-page dev state.
 */
export const DEV_BOOT_ID = randomUUID();

/**
 * Detect the host runtime so `startServer` can pick an adapter. Bun sets
 * `process.versions.bun` (and also reports a `node` version via its compat
 * layer, so the Bun check must come first).
 * @returns {'bun' | 'node'}
 */
export function serverRuntime() {
  return (typeof process !== 'undefined' && process.versions && process.versions.bun)
    ? 'bun'
    : 'node';
}

/**
 * Is this request the dev live-reload SSE stream? Base-path-aware so the stream
 * answers at `<basePath>/__webjs/events` under a sub-path deploy (#256); a no-op
 * pass-through when there is no base path.
 * @param {string} pathname
 * @param {string} basePathStr
 */
export function isEventsPath(pathname, basePathStr) {
  return stripBasePath(pathname, basePathStr) === EVENTS_PATH;
}

/**
 * Whether a response body of this content type is worth compressing. Shared by
 * the node `sendWebResponse` and the Bun `maybeCompress` so both shells gzip the
 * exact same set of media types.
 * @param {string | string[] | null | undefined} contentType
 */
export function isCompressible(contentType) {
  if (!contentType) return false;
  const ct = Array.isArray(contentType) ? contentType[0] : contentType;
  // Never compress an event stream: a compressor buffers/chunk-delays bytes that
  // an SSE body (a user route.ts returning text/event-stream) is meant to flush
  // incrementally, so it would stall the stream. The framework's own
  // /__webjs/events stream is intercepted before compression; this guards a
  // user-authored one on both shells.
  if (/^text\/event-stream/i.test(ct)) return false;
  return /^(?:text\/|application\/(?:javascript|json|xml|wasm|manifest)|image\/svg\+xml)/i.test(ct);
}

/**
 * Negotiate a response content-encoding from a request's `Accept-Encoding`,
 * preferring brotli (best ratio), then gzip, then deflate. Returns `''` when
 * none is acceptable. Shared by BOTH listener shells so they negotiate
 * identically; the matching uses the same `(?:^|,\s*)<enc>(?:;|,|$)` token test
 * the node shell has always used.
 * @param {string | string[] | undefined | null} acceptEncoding
 * @returns {'br' | 'gzip' | 'deflate' | ''}
 */
export function negotiateEncoding(acceptEncoding) {
  const accept = Array.isArray(acceptEncoding) ? acceptEncoding.join(',') : String(acceptEncoding || '');
  if (/(?:^|,\s*)br(?:;|,|$)/.test(accept)) return 'br';
  if (/(?:^|,\s*)gzip(?:;|,|$)/.test(accept)) return 'gzip';
  if (/(?:^|,\s*)deflate(?:;|,|$)/.test(accept)) return 'deflate';
  return '';
}

/**
 * Create a `node:zlib` compressor Transform for a negotiated encoding, or null.
 * `node:zlib` runs NATIVELY on Bun, so both shells get brotli through it (the web
 * `CompressionStream` the Bun shell used before had gzip/deflate only, no brotli).
 * Brotli quality 4 / gzip + deflate level 6 match the node shell's prior tuning
 * (fast, good ratio for on-the-fly compression).
 * @param {'br' | 'gzip' | 'deflate' | ''} encoding
 * @returns {import('node:stream').Transform | null}
 */
export function createCompressor(encoding) {
  if (encoding === 'br') return createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
  if (encoding === 'gzip') return createGzip({ level: 6 });
  if (encoding === 'deflate') return createDeflate({ level: 6 });
  return null;
}

/**
 * The largest buffered body that takes the SYNCHRONOUS compression fast path
 * (#756). Sync `node:zlib` blocks the event loop, whereas the streaming
 * compressor offloads to the libuv threadpool, so the sync path is a win ONLY
 * for small bodies (a typical SSR HTML page) where the per-response stream
 * bridge dominates; a larger buffered body keeps the non-blocking stream path.
 */
export const MAX_SYNC_COMPRESS_BYTES = 256 * 1024;

/**
 * Compress an already-buffered body synchronously, byte-for-byte identical to
 * the streaming `createCompressor` ON THE SAME RUNTIME (same algorithm + params:
 * brotli quality 4, gzip / deflate level 6, over the same `node:zlib`), so a
 * buffered fast path and a streamed slow path produce the same wire bytes within
 * a runtime (#756). Across runtimes the exact gzip / deflate bytes can differ
 * (Bun's bundled zlib is not Node's build; brotli matches), which is fine since
 * each response is self-describing via `content-encoding`. For a buffered body
 * (one that cannot error mid-stream) this skips the per-response
 * web -> node -> web stream bridge entirely. Returns null for an unknown / empty
 * encoding so the caller leaves the body uncompressed.
 * @param {'br' | 'gzip' | 'deflate' | ''} encoding
 * @param {Uint8Array} buf
 * @returns {Buffer | null}
 */
export function compressBufferSync(encoding, buf) {
  if (encoding === 'br') return brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
  if (encoding === 'gzip') return gzipSync(buf, { level: 6 });
  if (encoding === 'deflate') return deflateSync(buf, { level: 6 });
  return null;
}

/**
 * Merge `Accept-Encoding` into an existing `Vary` header (or create it) without
 * duplicating, so compressing a response that already varies (on `Cookie`, an
 * `Origin`, etc.) does not clobber that. Shared so both shells behave identically.
 * @param {string | null | undefined} existingVary
 * @returns {string}
 */
export function varyWithAcceptEncoding(existingVary) {
  const vary = existingVary || '';
  return vary && !/accept-encoding/i.test(vary) ? `${vary}, Accept-Encoding` : (vary || 'Accept-Encoding');
}

/**
 * Read a web `ReadableStream` chunk by chunk as an async iterable. A read error
 * (a source body that errors mid-stream) throws OUT of the generator, which
 * `Readable.from` surfaces as a node stream `error` that `pipeline` then
 * propagates by destroying the whole chain. This is the cross-runtime-reliable
 * way to feed a web body into a node stream: `Readable.fromWeb` does NOT
 * propagate a web-stream error through `pipeline` on Bun (the #509 hang), so the
 * Bun compression path must NOT use it. On early termination (the consumer
 * aborted, e.g. a client disconnect destroyed the compressor) the source is
 * cancelled so an upstream producer stops.
 * @param {ReadableStream} web
 */
export async function* webStreamChunks(web) {
  const reader = web.getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { finished = true; return; }
      yield value;
    }
  } finally {
    if (!finished) { try { await reader.cancel(); } catch {} }
    try { reader.releaseLock(); } catch {}
  }
}

/** An async generator that throws on first pull (a source that errored before
 * any output), so the caller's `pipeline` tears down exactly as it would for a
 * mid-stream error. @param {unknown} err */
async function* failingStream(err) { throw err; }

/** Yield a fixed set of already-read chunks with no further reads (the source is
 * already exhausted). @param {Uint8Array[]} chunks */
async function* justChunks(chunks) { for (const c of chunks) yield c; }

/**
 * Drain a reader after replaying already-peeked `prefix` chunks, mirroring
 * `webStreamChunks`' error + early-cancel semantics (so the #509 hang fix is
 * preserved for the reconstructed stream). If `pendingError` is set (the peek's
 * second read rejected, a mid-stream source error), the prefix is replayed and
 * then the error is rethrown.
 * @param {Uint8Array[]} prefix
 * @param {ReadableStreamDefaultReader} reader
 * @param {unknown} pendingError
 */
async function* drainAfter(prefix, reader, pendingError) {
  let finished = false;
  try {
    for (const c of prefix) yield c;
    if (pendingError) { finished = true; throw pendingError; }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { finished = true; return; }
      yield value;
    }
  } finally {
    if (!finished) { try { await reader.cancel(); } catch {} }
    try { reader.releaseLock(); } catch {}
  }
}

/** Sentinel: the classifying second read has not settled within a macrotask, so
 * the body is genuinely streaming and must not be withheld (#756). */
const STREAM_PENDING = Symbol('webjs.stream-pending');

/**
 * Drain a reader for a STREAMED body whose classifying second read is still
 * in flight (`secondP`, a settled-shape promise `{ r }` | `{ e }`). Yields the
 * already-peeked `firstChunk`, then CONSUMES the in-flight second read (never
 * issuing a duplicate `reader.read()`), then drains the rest. Same error +
 * early-cancel teardown as `drainAfter` / `webStreamChunks` (the #509 fix).
 * @param {Uint8Array} firstChunk
 * @param {ReadableStreamDefaultReader} reader
 * @param {Promise<{ r?: ReadableStreamReadResult<Uint8Array>, e?: unknown }>} secondP
 */
async function* drainAfterPending(firstChunk, reader, secondP) {
  let finished = false;
  try {
    yield firstChunk;
    const settled = await secondP;
    if (settled.e !== undefined) { finished = true; throw settled.e; }
    if (settled.r.done) { finished = true; return; }
    yield settled.r.value;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { finished = true; return; }
      yield value;
    }
  } finally {
    if (!finished) { try { await reader.cancel(); } catch {} }
    try { reader.releaseLock(); } catch {}
  }
}

/**
 * Decide whether a web body is a single bounded buffered chunk (the common SSR
 * page / JSON / file response) or a genuinely streamed body (Suspense, an action
 * / route `ReadableStream`), WITHOUT buffering a real stream and WITHOUT
 * withholding a streamed body's first byte (#756). It peeks the first chunk, then
 * classifies on the SECOND read, but does NOT block on it: a buffered Response
 * (built from a string / Uint8Array) has an already-closed underlying stream, so
 * its second read settles on the next microtask; a streamed body's second chunk
 * may be arbitrarily far in the future (a Suspense boundary resolving), and
 * awaiting it would stall the status line + first byte until then. So the second
 * read is RACED against a macrotask sentinel: if it settles first AND is `done`
 * (single chunk) within `maxBytes`, the body is buffered and returned as bytes so
 * the caller can sync-compress and skip the stream bridge; otherwise (still
 * pending = streaming, or multi-chunk, oversized, empty, or a mid-stream error)
 * it returns an async iterable that replays the peeked chunk(s) then drains the
 * rest, with the same error + cancel semantics as `webStreamChunks`.
 *
 * @param {ReadableStream} web
 * @param {number} maxBytes
 * @returns {Promise<{ buffered: Uint8Array } | { stream: AsyncIterable<Uint8Array> }>}
 */
export async function readBufferedOrStream(web, maxBytes) {
  const reader = web.getReader();
  let first;
  try {
    first = await reader.read();
  } catch (e) {
    // Source errored before any output: hand back a stream that rethrows it.
    try { reader.releaseLock(); } catch {}
    return { stream: failingStream(e) };
  }
  if (first.done) {
    try { reader.releaseLock(); } catch {}
    return { buffered: new Uint8Array(0) };
  }
  const firstChunk = first.value;

  // Issue the classifying second read but DO NOT await it directly: race it
  // against a macrotask sentinel so a streamed body (whose second chunk is far
  // off) is handed back immediately as a stream instead of stalling first paint.
  const secondP = reader.read().then((r) => ({ r }), (e) => ({ e }));
  const settled = await Promise.race([
    secondP,
    new Promise((res) => { setImmediate(() => res(STREAM_PENDING)); }),
  ]);
  if (settled === STREAM_PENDING) {
    // Still in flight after a macrotask: a genuinely streamed body. Emit the
    // first chunk now and continue from the in-flight second read (consumed by
    // the generator, never re-issued).
    return { stream: drainAfterPending(firstChunk, reader, secondP) };
  }
  if (settled.e !== undefined) {
    // The second read errored on a short body (a mid-stream source error):
    // replay the first chunk then rethrow, matching webStreamChunks teardown.
    return { stream: drainAfter([firstChunk], reader, settled.e) };
  }
  const second = settled.r;
  if (second.done) {
    try { reader.releaseLock(); } catch {}
    if (firstChunk.byteLength <= maxBytes) return { buffered: firstChunk };
    // One chunk but too large to block the event loop on a sync compress: stream
    // it. The source is already exhausted (second read was `done`), so just
    // replay the single chunk with no further reads.
    return { stream: justChunks([firstChunk]) };
  }
  // Two quick chunks (a small multi-chunk buffered body): not a single buffer,
  // so stream it (replay both, then drain the rest). The second read is already
  // consumed, so drainAfter continues from the third chunk.
  return { stream: drainAfter([firstChunk, second.value], reader, null) };
}

/**
 * Load a `route.{js,ts}` module for its `WS` export, cache-busting in dev so a
 * code edit is picked up per connection. Shared by the node WebSocket subsystem
 * (`websocket.js`) and the Bun upgrade path so both resolve the handler identically.
 * @param {string} file
 * @param {boolean} dev
 */
export function loadWsModule(file, dev) {
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  return import(url + bust);
}

/**
 * Runtime-neutral SSE registry + fanout for dev live-reload and the dev error
 * overlay (#264). Owns the connected-client Set and the keepalive timer; the
 * fanout writes plain SSE frames through each client's `send`. Each shell adds a
 * thin client wrapper over its own transport (node `res.write`, a Bun
 * `ReadableStreamDefaultController`), so this fanout logic is written once.
 */
export class SseHub {
  /** @param {{ keepaliveMs?: number }} [opts] */
  constructor(opts = {}) {
    /** @type {Set<{ send: (s: string) => void, close: () => void }>} */
    this.clients = new Set();
    // Keepalive: a comment frame every 25s defeats proxy idle timeouts (and, on
    // Bun, keeps the connection under the server idleTimeout). Cheap and safe:
    // SSE comments are ignored by the client. Unref'd so it never holds the
    // process open.
    this._timer = setInterval(() => this._raw(': ka\n\n'), opts.keepaliveMs ?? 25_000);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  /** @param {{ send: (s: string) => void, close: () => void }} client */
  add(client) { this.clients.add(client); }
  /** @param {{ send: (s: string) => void, close: () => void }} client */
  remove(client) { this.clients.delete(client); }

  /** @param {string} frame */
  _raw(frame) {
    for (const c of this.clients) {
      try { c.send(frame); } catch { /* a dead client is dropped by its own close handler */ }
    }
  }

  /**
   * Push a live-reload event to every open tab.
   *
   * The frame carries the change's `{ v, by, why }` classification (#1398) as a
   * single-line JSON payload, matching `devError` below. The browser relay
   * resolves ANY payload it cannot read to `reload`, and an absent or malformed
   * verdict is emitted as `reload` here too, so the fail-safe holds on both ends
   * of the wire and a tab running against a restarted server can never be
   * skewed into a lighter response than the change deserves.
   *
   * @param {{ v?: string, by?: string, why?: string } | null} [verdict]
   */
  reload(verdict) {
    const v = verdict && typeof verdict.v === 'string' ? verdict : { v: 'reload' };
    this._raw(`event: reload\ndata: ${JSON.stringify(v)}\n\n`);
  }

  /** Push a dev-error overlay frame (#264) to every open tab. @param {object} frame */
  devError(frame) { this._raw(`event: webjs-error\ndata: ${JSON.stringify(frame)}\n\n`); }

  /** Close every client and stop the keepalive (graceful shutdown). */
  closeAll() {
    for (const c of this.clients) { try { c.close(); } catch {} }
    this.clients.clear();
    clearInterval(this._timer);
  }
}

/**
 * Install once-only process error handlers. Idempotent across multiple
 * `startServer` calls in the same process. Runtime-neutral (plain `process.on`).
 * @param {import('./logger.js').Logger} logger
 * @param {() => void} onFatal Starts the FATAL shutdown, which exits non-zero.
 */
export function installProcessHandlers(logger, onFatal) {
  if (/** @type any */ (globalThis).__webjsProcHandlers) return;
  /** @type any */ (globalThis).__webjsProcHandlers = true;
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', {
      err: reason instanceof Error ? reason.stack || reason.message : String(reason),
    });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { err: err.stack || err.message });
    // Begin orderly shutdown; process state may be corrupt.
    try { onFatal(); } catch {}
  });
}

/**
 * Build a graceful-shutdown signal handler. Runtime-neutral: the shell supplies a
 * `closeServer()` thunk that resolves once the server has stopped accepting
 * connections (node `server.close`, Bun `server.stop(true)`). Closes the SSE hub,
 * then drains, then exits; hard-exits after 10s if the drain hangs.
 *
 * Exit code, in full. Three things can force a 1, and only their absence
 * leaves a 0:
 *   - a drain that FAILS, so a rejected `closeServer()` and a drain still
 *     hanging at the 10s deadline both exit 1 whatever started them;
 *   - a FATAL start (the `uncaughtException` handler calling `onFatal`), which
 *     exits 1 even when the drain is perfectly clean;
 *   - a FATAL arriving MID-DRAIN, which upgrades a shutdown an operator signal
 *     had already begun (see the upgrade-only note on `code` below).
 * So 0 does NOT mean "a signal started it", it means an operator asked for the
 * stop AND it drained cleanly AND nothing crashed on the way out. A supervisor
 * reads only this code (systemd `Restart=on-failure`, Docker, Railway, and a CI
 * step running a `test/bun/*.mjs` proof script, whose failed top-level assertion
 * arrives here as an uncaught exception, #1092), so every one of those has to
 * come back non-zero.
 * @param {{ closeServer: () => Promise<unknown>, hub: SseHub, logger: import('./logger.js').Logger }} opts
 * @returns {(signal: string, opts?: { fatal?: boolean }) => void}
 */
export function makeShutdown({ closeServer, hub, logger }) {
  let shuttingDown = false;
  // Read at EXIT time, not at entry, so a fatal arriving mid-drain still counts.
  // The drain window is up to 10s wide and in-flight requests are still running
  // in it, so an uncaught exception landing there is an ordinary event, not an
  // exotic race. Because the re-entrancy guard below drops that second call, a
  // code captured at entry would stay 0 and the crashed process would report a
  // successful stop, which is the exact failure this whole mechanism exists to
  // prevent. Upgrade only (1 never falls back to 0), so a signal arriving during
  // a fatal shutdown cannot launder the crash into a success either.
  let code = 0;
  return (signal, { fatal = false } = {}) => {
    if (fatal) code = 1;
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);
    try { hub.closeAll(); } catch {}
    const hard = setTimeout(() => {
      logger.warn('shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    if (typeof hard.unref === 'function') hard.unref();
    // Disarm before exiting. In production `process.exit` ends everything so this
    // is redundant, but it keeps the deadline from outliving the decision it was
    // guarding, which is what let a stubbed-exit test leave a live timer armed to
    // kill an unrelated process 10s later.
    const done = (c) => { clearTimeout(hard); process.exit(c); };
    Promise.resolve()
      .then(closeServer)
      .then(
        () => { logger.info('bye'); done(code); },
        (err) => { logger.error('server close error', { err: String(err) }); done(1); },
      );
  };
}
