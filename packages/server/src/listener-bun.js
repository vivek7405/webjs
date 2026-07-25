/**
 * Bun.serve listener adapter (#511): the `Bun.serve` shell for `startServer`,
 * selected when the host runtime is Bun. Bun's server is `Request`/`Response`
 * native, so this path skips the node:http `toWebRequest` / `sendWebResponse`
 * bridge entirely and hands the app's `handle(req): Response` straight to
 * `Bun.serve({ fetch })`. A microbenchmark of the LISTENING PATH ONLY (a trivial
 * handler: node:http compat on Bun vs `Bun.serve`) measured ~1.9x more req/s,
 * which is what justifies a second shell rather than running the node compat path
 * on Bun. That figure is the listening-path delta, NOT end-to-end throughput: for
 * a real SSR page the render cost dominates and the listener delta is small (see
 * the end-to-end benchmark in `scripts/bench-listener.mjs`, #756). The hot path
 * is kept allocation-lean: the remote IP is stamped out of band (no per-request
 * `Request` clone, #756) and a buffered response is compressed synchronously (no
 * per-response stream bridge).
 *
 * Feature parity with the node shell, routed through the shared
 * `listener-core.js` so the two cannot drift:
 *   - **SSE live-reload** (#264): a streaming `text/event-stream` `Response` whose
 *     `ReadableStream` controller is registered in the shared `SseHub`; the
 *     request `AbortSignal` (and the stream `cancel`) deregister it on disconnect.
 *   - **WebSocket upgrade**: a `route.ts` `WS` export. Bun's native WS dispatches
 *     through server-level `websocket` handlers (not the node `ws`-library
 *     EventEmitter contract the `WS(ws, …)` export expects), so a small
 *     `BunWsAdapter` re-exposes `.on('message')` / `.on('close')` / `.send()` /
 *     `.readyState` over Bun's `ServerWebSocket`, keeping the handler contract and
 *     the `broadcast()` registry identical across runtimes.
 *   - **Compression**: brotli / gzip / deflate via `node:zlib` (which runs
 *     natively on Bun), the SAME negotiation + compressor factory the node shell
 *     uses (shared in `listener-core.js`), so the Bun path gets brotli too (#517).
 *   - **Timeouts** (#237): the node `requestTimeout` maps to Bun's single
 *     `idleTimeout` (seconds), clamped above the 25s SSE keepalive so a dev
 *     live-reload stream is never reaped.
 *   - **Proxy IP**: `server.requestIP(req).address` stamps the framework-trusted
 *     `x-webjs-remote-ip` (the node socket-address equivalent), after stripping
 *     any spoofed inbound value.
 *
 * Not supported on Bun (documented, node-only): **103 Early Hints**. `Bun.serve`
 * exposes no API to write an informational response before the body.
 *
 * This module is imported DYNAMICALLY by `dev.js` only when `serverRuntime()` is
 * `'bun'`, so the `Bun.*` global is never referenced on Node. It still LINKS on
 * Node (the global is only read inside functions), but it is never loaded there.
 */
import { EventEmitter } from 'node:events';
import { Readable, pipeline } from 'node:stream';
import { matchApi } from './router.js';
import { registerClient } from './broadcast.js';
import { setTrustedRemoteIp, propagateTrustedRemoteIp } from './rate-limit.js';
import { applyForwarded } from './forwarded.js';
import {
  isCompressible,
  isEventsPath,
  loadWsModule,
  installProcessHandlers,
  makeShutdown,
  negotiateEncoding,
  createCompressor,
  compressBufferSync,
  MAX_SYNC_COMPRESS_BYTES,
  varyWithAcceptEncoding,
  readBufferedOrStream,
  DEV_BOOT_ID,
} from './listener-core.js';

/* global Bun */

/**
 * Start the Bun.serve listener.
 * @param {import('./listener-types.js').ListenerContext} ctx
 * @returns {{ server: any, close: () => Promise<void> }}
 */
export function startBunListener(ctx) {
  const { app, dev, compress, logger, hub, port, basePathStr, timeouts, watcherAbort } = ctx;

  const server = Bun.serve({
    port,
    idleTimeout: bunIdleTimeout(timeouts),
    // WebJs owns its dev error overlay (over SSE) and handles thrown errors in
    // `fetch`, so Bun's own development error page must never interfere; keep it
    // deterministic (off) rather than tied to NODE_ENV.
    development: false,
    /**
     * @param {Request} req
     * @param {any} srv  the Bun server (requestIP / upgrade)
     */
    async fetch(req, srv) {
      try {
        const url = new URL(req.url);

        // SSE live-reload stream (dev only); does not fit the req->Response model
        // on node, but on Bun it is a perfectly ordinary streaming Response.
        if (isEventsPath(url.pathname, basePathStr)) {
          if (!dev) return new Response(null, { status: 404 });
          return bunSseResponse(req, hub, app);
        }

        // WebSocket upgrade: a route.ts exporting WS.
        if ((req.headers.get('upgrade') || '').toLowerCase() === 'websocket') {
          return await bunUpgrade(req, srv, ctx);
        }

        // 103 Early Hints are intentionally skipped: Bun.serve has no API to
        // write an informational response before the body. The modulepreload
        // hints still ship in the rendered <head>, so the only loss is the
        // head-start during SSR compute, not the preloads themselves.

        stampRemoteIp(req, srv);
        const resp = await app.handle(forwardedRequest(req, url));
        return compress ? await maybeCompress(resp, req) : resp;
      } catch (e) {
        logger.error('request pipeline threw', { err: e instanceof Error ? e.stack : String(e) });
        return new Response(
          dev && e instanceof Error ? `webjs error: ${e.stack}` : 'Internal server error',
          { status: 500, headers: { 'content-type': 'text/plain' } },
        );
      }
    },
    websocket: {
      /** @param {any} ws */
      open(ws) {
        const d = ws.data;
        try {
          d.wrapper._bind(ws);
          registerClient(d.pathname, d.wrapper);
          d.mod.WS(d.wrapper, d.req, { params: d.params });
        } catch (e) {
          logger.error('WebSocket handler threw', {
            err: e instanceof Error ? e.stack || e.message : String(e),
          });
          try { ws.close(1011, 'Internal error'); } catch {}
        }
      },
      /** @param {any} ws @param {string | Buffer} message */
      message(ws, message) {
        try { ws.data.wrapper.emit('message', message); } catch {}
      },
      /** @param {any} ws @param {number} code @param {string} reason */
      close(ws, code, reason) {
        const w = ws.data.wrapper;
        w.readyState = 3;
        try { w.emit('close', code, reason); } catch {}
      },
    },
  });

  logger.info(
    `webjs ${dev ? 'dev' : 'prod'} server ready on http://localhost:${server.port} (Bun ${process.versions.bun})`,
  );
  // Warm the first-request analysis in the background; listening does not wait
  // on it, matching the node shell.
  app.warmup();

  const closeServer = () => Promise.resolve(server.stop(true));
  const shutdown = makeShutdown({ closeServer, hub, logger });
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  installProcessHandlers(logger, () => shutdown('uncaughtException'));

  return {
    server,
    close: () => {
      if (watcherAbort) watcherAbort.abort();
      hub.closeAll();
      return Promise.resolve(server.stop(true)).then(() => undefined);
    },
  };
}

/**
 * The node `ws`-library WebSocket contract (`.on('message')` / `.on('close')` /
 * `.send()` / `.readyState` / `.close()`) re-exposed over a Bun `ServerWebSocket`,
 * which otherwise dispatches messages through server-level handlers rather than
 * per-socket events. Constructed at upgrade time and bound to the real socket in
 * the `open` handler; messages/close are forwarded to its emitter from the
 * `websocket.message` / `websocket.close` handlers.
 *
 * Only `'message'` and `'close'` are forwarded (the events WebJs WS handlers and
 * `broadcast()` use). Bun exposes no per-socket `'error'` / `'ping'` / `'pong'`
 * handler to bridge; a socket failure on Bun surfaces as a `'close'`, so
 * `'close'`-keyed cleanup still runs. Documented in the WebSockets doc.
 */
class BunWsAdapter extends EventEmitter {
  constructor() {
    super();
    /** @type {any} */
    this._ws = null;
    // WebSocket.readyState constants: 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED.
    this.readyState = 0;
  }

  /** @param {any} ws  the Bun ServerWebSocket, available once `open` fires */
  _bind(ws) {
    this._ws = ws;
    this.readyState = 1;
  }

  /** @param {string | ArrayBufferView | ArrayBuffer} data */
  send(data) {
    try { if (this._ws) this._ws.send(data); } catch {}
  }

  /** @param {number} [code] @param {string} [reason] */
  close(code, reason) {
    try { if (this._ws) this._ws.close(code, reason); } catch {}
  }

  get bufferedAmount() {
    try { return this._ws ? this._ws.getBufferedAmount() : 0; } catch { return 0; }
  }
}

/**
 * Resolve a `route.ts` `WS` export and upgrade the connection. Mirrors the node
 * `attachWebSocket` path (match the route, load the module, require a `WS`
 * function) but drives Bun's `server.upgrade`. Returns `undefined` on a
 * successful upgrade (Bun's contract: the fetch handler must not return a
 * Response once the socket is taken over).
 * @param {Request} req
 * @param {any} srv
 * @param {import('./listener-types.js').ListenerContext} ctx
 */
async function bunUpgrade(req, srv, ctx) {
  const url = new URL(req.url);
  // Matches the node WS path, which keys on the full pathname (no base-path
  // stripping) and on `registerClient(url.pathname, …)`.
  const match = matchApi(ctx.app.getRouteTable(), url.pathname);
  if (!match) return new Response('Not Found', { status: 404 });

  let mod;
  try {
    mod = await loadWsModule(match.route.file, ctx.dev);
  } catch (e) {
    ctx.logger.error('WebSocket module load failed', { err: String(e) });
    return new Response('Upgrade failed', { status: 500 });
  }
  if (typeof mod.WS !== 'function') {
    return new Response('Upgrade not supported at this route', { status: 426 });
  }

  const wrapper = new BunWsAdapter();
  // Behind a proxy the handshake arrives as plain http on the internal hop, so
  // the handler request carries the ORIGINAL scheme + host too (the node WS path
  // gets this from `urlFromRequest` in `buildRequestFromUpgrade`). Routing above
  // keyed on `url.pathname`, which the origin swap leaves untouched.
  const handlerReq = upgradeRequest(req, applyForwarded(url, req.headers));
  // Stamp the framework-trusted socket IP on the handler request so a `WS`
  // handler's `clientIp(req)` returns the real peer, not a spoofed inbound
  // `x-webjs-remote-ip` (#778). `srv.requestIP` must be queried with Bun's
  // ORIGINAL `req` (the rebuilt `handlerReq` is unknown to it); the WeakMap
  // stamp then makes `handlerReq` authoritative. Mirrors `stampRemoteIp` on the
  // fetch path (which strips + stamps `req` directly). `upgradeRequest` already
  // dropped any inbound copy of the header.
  let ip;
  try { ip = srv.requestIP(req)?.address; } catch {}
  setTrustedRemoteIp(handlerReq, ip || '');
  const ok = srv.upgrade(req, {
    data: { wrapper, mod, req: handlerReq, params: match.params, pathname: url.pathname },
  });
  if (ok) return undefined;
  return new Response('Upgrade failed', { status: 500 });
}

/**
 * Best-effort `Request` for the WS handler: headers + GET + URL, no body (it is a
 * handshake). Mirrors the node `buildRequestFromUpgrade` so the handler reads the
 * same cookies/auth either side.
 * @param {Request} req
 * @param {URL} url
 */
function upgradeRequest(req, url) {
  const headers = new Headers();
  // Skip a client-supplied `x-webjs-remote-ip`: it is a framework-internal trust
  // header the caller re-stamps via the authoritative WeakMap (#778). Copying it
  // would let a client spoof `clientIp` inside the WS handler on the fallback
  // header read.
  req.headers.forEach((v, k) => {
    if (k.startsWith(':') || k === 'x-webjs-remote-ip') return;
    headers.set(k, v);
  });
  return new Request(url, { method: 'GET', headers });
}

/**
 * Build the dev live-reload SSE `Response`: a streaming `text/event-stream` whose
 * controller is registered in the shared `SseHub`. The request `AbortSignal` and
 * the stream `cancel` both deregister the client on disconnect.
 * @param {Request} req
 * @param {import('./listener-core.js').SseHub} hub
 * @param {any} app
 */
function bunSseResponse(req, hub, app) {
  const enc = new TextEncoder();
  /** @type {{ send: (s: string) => void, close: () => void } | null} */
  let client = null;
  const stream = new ReadableStream({
    start(controller) {
      client = {
        send: (s) => { try { controller.enqueue(enc.encode(s)); } catch {} },
        close: () => { try { controller.close(); } catch {} },
      };
      // `retry: 300` shrinks the EventSource reconnect backoff so a reconnect
      // after a dev restart re-triggers a reload promptly (#893); the `hello`
      // data is the per-process boot id so a reconnect reloads only on a real
      // restart, matching the node:http shell.
      controller.enqueue(enc.encode(`retry: 300\nevent: hello\ndata: ${DEV_BOOT_ID}\n\n`));
      hub.add(client);
      // Replay an unresolved dev error (#264) so a tab connecting AFTER the
      // breaking edit still shows the overlay.
      const pending = app.getLastDevError && app.getLastDevError();
      if (pending) {
        try { controller.enqueue(enc.encode(`event: webjs-error\ndata: ${JSON.stringify(pending)}\n\n`)); } catch {}
      }
    },
    cancel() { if (client) hub.remove(client); },
  });
  if (req.signal) {
    req.signal.addEventListener('abort', () => { if (client) hub.remove(client); });
  }
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
}

/**
 * Rebuild the request behind a TLS-terminating reverse proxy so `req.url`
 * carries the ORIGINAL scheme + host (`X-Forwarded-Proto` / `X-Forwarded-Host`).
 *
 * Why the request itself and not just a threaded url: everything downstream
 * (the framework's own `new URL(req.url)` reads AND a user's `route.ts` doing
 * `new URL(req.url).origin`) derives from `req.url`, so correcting only a side
 * channel would fix the framework's absolute URLs and leave app code broken.
 * The node shell gets this for free, since `toWebRequest` builds its `Request`
 * FROM the already-corrected `urlFromRequest(req)`; Bun hands us a `Request`
 * whose url reflects the internal `http://container` view, so the correction
 * has to be applied here for the two shells to agree.
 *
 * Hot path: `applyForwarded` returns the SAME url instance when nothing
 * changes, so an app with no proxy in front (local dev, direct exposure,
 * `WEBJS_NO_TRUST_PROXY=1`) does ZERO extra work and keeps the #756 no-clone
 * behaviour. Behind a proxy this costs one `Request` construction per request,
 * which is still strictly less than the node shell, which constructs one
 * unconditionally. The trusted IP is carried across the rebuild the same way
 * the base-path rewrite in `dev.js` does it (#773), so `clientIp` stays
 * authoritative and the inbound spoofable header is never consulted.
 *
 * @param {Request} req
 * @param {URL} url  the url as `Bun.serve` saw it
 * @returns {Request} `req` itself when unchanged, else the corrected request
 */
function forwardedRequest(req, url) {
  const fwd = applyForwarded(url, req.headers);
  if (fwd === url) return req;
  // SECURITY (#778): drop any client-supplied `x-webjs-remote-ip` before it
  // rides onto the rebuilt request. `trustedRemoteIp` reads the WeakMap first,
  // so the header cannot win today, but every other rebuild site strips it
  // (`dev.js`'s base-path rewrite, `upgradeRequest` below) and leaving it
  // attached would re-arm the spoof the moment any later code path rebuilds
  // this request without carrying the WeakMap across.
  const headers = new Headers(req.headers);
  headers.delete('x-webjs-remote-ip');
  const next = new Request(fwd, { ...requestInitFrom(req), headers });
  propagateTrustedRemoteIp(req, next);
  return next;
}

/**
 * The parts of a `Request` that must survive the rebuild, spelled out because
 * the header strip above needs its own `Headers` and passing the `Request` as
 * the init would ignore them.
 *
 * `duplex: 'half'` is required by the spec whenever a body is present, and
 * `mode: 'navigate'` cannot be passed to the constructor, so it is dropped.
 *
 * @param {Request} req
 */
function requestInitFrom(req) {
  /** @type {any} */
  const init = {
    method: req.method,
    signal: req.signal,
    credentials: req.credentials,
    cache: req.cache,
    redirect: req.redirect,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
    integrity: req.integrity,
  };
  if (req.mode && req.mode !== 'navigate') init.mode = req.mode;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }
  return init;
}

/**
 * Stamp the framework-trusted remote IP from Bun's `server.requestIP`,
 * out-of-band via `setTrustedRemoteIp` (#756). The previous implementation
 * cloned the whole `Request` (`new Request(req, { headers })`) on EVERY request
 * just to set one header; the WeakMap channel avoids that hot-path reallocation.
 * The stamp is authoritative (`clientIp` reads it and ignores the inbound
 * `x-webjs-remote-ip` header), so a client cannot spoof it even though the
 * unmodified request still carries any inbound copy. Always stamps (with `''`
 * when no IP is available) so the inbound header is never trusted on Bun.
 * @param {Request} req
 * @param {any} srv
 */
function stampRemoteIp(req, srv) {
  let ip;
  try { ip = srv.requestIP(req)?.address; } catch {}
  setTrustedRemoteIp(req, ip || '');
}

/**
 * Compress a `Response` via `node:zlib` (brotli / gzip / deflate), the SAME
 * negotiation + compressor factory the node shell uses (shared in
 * `listener-core.js`). `node:zlib` runs natively on Bun, so this gives **brotli
 * on Bun** (the web `CompressionStream` used before had no brotli) and full
 * compression parity with the node shell.
 *
 * A BUFFERED body (the common SSR page / JSON / file response, detected by
 * `readBufferedOrStream` peeking a single bounded chunk) is compressed
 * SYNCHRONOUSLY (`compressBufferSync`), skipping the per-response
 * web -> node -> web stream bridge entirely (#756). A genuinely STREAMED body
 * (Suspense, an action / route stream) or an oversized one keeps the bridge
 * (`Readable.from(peeked.stream)` -> `compressor` -> `Readable.toWeb`, driven by
 * `pipeline`; NOT `Readable.fromWeb`, which does not propagate a mid-stream
 * source error through `pipeline` on Bun, the #509 hang). The sync and streamed
 * paths use the SAME algo + params, so WITHIN a runtime the buffered fast path
 * and the streaming bridge produce identical bytes (a buffered body is not
 * served differently from a streamed one). Across runtimes the exact bytes can
 * differ for gzip / deflate (Bun's bundled zlib is not the same build as Node's,
 * so the compressed output is not guaranteed identical, byte-for-byte; brotli
 * does match), which is fine since each response is self-describing via
 * `content-encoding` and a client just decodes it. Skips an already-encoded body
 * and a non-compressible media type (`isCompressible` already excludes
 * `text/event-stream`).
 * @param {Response} resp
 * @param {Request} req
 */
async function maybeCompress(resp, req) {
  if (!resp.body) return resp;
  if (resp.headers.has('content-encoding')) return resp;
  if (!isCompressible(resp.headers.get('content-type'))) return resp;
  const encoding = negotiateEncoding(req.headers.get('accept-encoding'));
  if (!encoding) return resp;

  const headers = new Headers(resp.headers);
  headers.set('content-encoding', encoding);
  headers.set('vary', varyWithAcceptEncoding(headers.get('vary')));

  // Buffered-body fast path (#756): peek the body to tell a single bounded
  // buffered chunk (the common SSR page / JSON / file response) from a genuinely
  // streamed body (Suspense, an action / route stream) WITHOUT buffering a real
  // stream. A buffered body cannot error mid-stream, so compress it synchronously
  // and skip the per-response web -> node -> web stream bridge entirely. The sync
  // path and the streaming bridge share the SAME algo + params, so within this
  // runtime a buffered body and a streamed one compress identically (the wire is
  // self-describing via content-encoding either way). A streamed / oversized body
  // falls through to the bridge below.
  const peeked = await readBufferedOrStream(resp.body, MAX_SYNC_COMPRESS_BYTES);
  if (peeked.buffered !== undefined) {
    const out = compressBufferSync(encoding, peeked.buffered);
    headers.set('content-length', String(out.length));
    return new Response(out, { status: resp.status, statusText: resp.statusText, headers });
  }

  headers.delete('content-length');
  // Allocate the streaming compressor ONLY on the streamed path: the buffered
  // fast path above used `compressBufferSync` and never needs a Transform, so
  // hoisting this would waste a native zlib/brotli handle on the common case.
  // `encoding` is guaranteed br/gzip/deflate (negotiateEncoding), so
  // `createCompressor` never returns null here.
  const compressor = createCompressor(encoding);
  // Feed the (peeked + drained) web body into the compressor through the reader
  // loop (NOT Readable.fromWeb, which does not propagate a mid-stream source
  // error through `pipeline` on Bun, the #509 hang) and drive it with `pipeline`
  // so a source error (or a client disconnect destroying the output) tears down
  // the whole chain instead of leaking/hanging the compressor. Backpressure is
  // preserved: a slow client stalls `toWeb`, which stalls the compressor, which
  // pauses the source.
  const source = Readable.from(peeked.stream);
  pipeline(source, compressor, () => {});
  const body = Readable.toWeb(compressor);
  return new Response(body, { status: resp.status, statusText: resp.statusText, headers });
}

/**
 * Map the node `requestTimeout` (ms) to Bun's single `idleTimeout` (seconds). Bun
 * caps it at 255s; we clamp it above the 25s SSE keepalive so a dev live-reload
 * stream is never reaped as idle. `0` (the node "disable" sentinel) disables it
 * on Bun too.
 * @param {{ requestTimeout?: number } | undefined} timeouts
 */
export function bunIdleTimeout(timeouts) {
  const reqMs = timeouts && timeouts.requestTimeout;
  if (reqMs === 0) return 0;
  let secs = Math.ceil((reqMs || 30_000) / 1000);
  if (secs < 30) secs = 30;
  if (secs > 255) secs = 255;
  return secs;
}
