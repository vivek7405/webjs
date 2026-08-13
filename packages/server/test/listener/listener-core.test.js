/**
 * Unit tests for the runtime-neutral listener core (#511): the SSE registry +
 * fanout, the live-reload path predicate, the compressible media-type set, the
 * runtime detector, and the WS module loader, all shared by the node:http shell
 * and the Bun.serve shell so the two cannot drift.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SseHub,
  serverRuntime,
  isEventsPath,
  isCompressible,
  EVENTS_PATH,
  loadWsModule,
  negotiateEncoding,
  createCompressor,
  varyWithAcceptEncoding,
  webStreamChunks,
  compressBufferSync,
  readBufferedOrStream,
  MAX_SYNC_COMPRESS_BYTES,
  makeShutdown,
} from '../../src/listener-core.js';
import { setBasePath } from '../../src/importmap.js';
import { Readable } from 'node:stream';

/* ---------------- buffered-compress fast path (#756) ---------------- */

/** Drain an async iterable of Uint8Array into one Buffer. */
async function collect(iter) {
  const parts = [];
  for await (const c of iter) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

/** Stream a node Transform (the streaming compressor) to a Buffer. */
function streamCompress(encoding, buf) {
  const c = createCompressor(encoding);
  c.end(buf);
  return collect(Readable.toWeb(c));
}

for (const encoding of ['br', 'gzip', 'deflate']) {
  test(`compressBufferSync(${encoding}) is byte-identical to the streaming compressor`, async () => {
    const input = Buffer.from('hello compressible world '.repeat(200));
    const sync = compressBufferSync(encoding, input);
    const streamed = await streamCompress(encoding, input);
    assert.ok(Buffer.isBuffer(sync) && sync.length > 0, 'produces bytes');
    assert.deepEqual(sync, streamed, 'sync output equals streamed output (parity)');
  });
}

test('compressBufferSync returns null for an empty encoding', () => {
  assert.equal(compressBufferSync('', Buffer.from('x')), null);
});

test('readBufferedOrStream: a single-chunk body is returned as buffered bytes', async () => {
  const data = new TextEncoder().encode('a buffered body in one chunk');
  const web = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } });
  const r = await readBufferedOrStream(web, MAX_SYNC_COMPRESS_BYTES);
  assert.ok(r.buffered !== undefined, 'classified as buffered');
  assert.deepEqual(Buffer.from(r.buffered), Buffer.from(data));
});

test('readBufferedOrStream: a multi-chunk body is returned as a replayable stream', async () => {
  const a = new TextEncoder().encode('chunk-1;');
  const b = new TextEncoder().encode('chunk-2;');
  const web = new ReadableStream({ start(c) { c.enqueue(a); c.enqueue(b); c.close(); } });
  const r = await readBufferedOrStream(web, MAX_SYNC_COMPRESS_BYTES);
  assert.ok(r.stream !== undefined, 'classified as streamed');
  assert.equal((await collect(r.stream)).toString(), 'chunk-1;chunk-2;', 'no chunk lost in replay');
});

test('readBufferedOrStream: an oversized single chunk falls back to streaming', async () => {
  const big = new Uint8Array(MAX_SYNC_COMPRESS_BYTES + 1);
  const web = new ReadableStream({ start(c) { c.enqueue(big); c.close(); } });
  const r = await readBufferedOrStream(web, MAX_SYNC_COMPRESS_BYTES);
  assert.ok(r.stream !== undefined, 'oversized body is streamed, not sync-compressed');
  assert.equal((await collect(r.stream)).length, big.length, 'full body preserved');
});

test('readBufferedOrStream: an empty body is buffered (zero bytes)', async () => {
  const web = new ReadableStream({ start(c) { c.close(); } });
  const r = await readBufferedOrStream(web, MAX_SYNC_COMPRESS_BYTES);
  assert.ok(r.buffered !== undefined && r.buffered.length === 0, 'empty buffered body');
});

test('readBufferedOrStream: a slow second chunk does NOT block classification (streaming TTFB, #756 review)', async () => {
  // The regression this guards: classifying buffered-vs-streamed by awaiting the
  // SECOND read would withhold a streamed body's first byte until its second
  // chunk arrives (a Suspense boundary resolving), so a compressed streamed page
  // on Bun would lose progressive first paint. Here the first chunk is immediate
  // but the second is delayed; classification must return PROMPTLY as a stream.
  const DELAY = 300;
  const web = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('shell;')); }, // first byte: immediate
    async pull(c) {
      await new Promise((r) => setTimeout(r, DELAY)); // a far-off boundary
      c.enqueue(new TextEncoder().encode('boundary;'));
      c.close();
    },
  });
  const t0 = Date.now();
  const r = await readBufferedOrStream(web, MAX_SYNC_COMPRESS_BYTES);
  const classifyMs = Date.now() - t0;
  assert.ok(r.stream !== undefined, 'a slow-second-chunk body is classified as streamed, not buffered');
  assert.ok(classifyMs < DELAY,
    `classification returned in ${classifyMs}ms, before the ${DELAY}ms second chunk (did not block first paint)`);
  // The full body still streams in order afterwards (no chunk lost in the handoff).
  assert.equal((await collect(r.stream)).toString(), 'shell;boundary;', 'both chunks stream in order');
});

test('readBufferedOrStream: a mid-stream source error propagates through the replay stream (no hang)', async () => {
  const boom = new Error('source failed mid-stream');
  const web = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('first;')); },
    pull(c) { c.error(boom); },
  });
  const r = await readBufferedOrStream(web, MAX_SYNC_COMPRESS_BYTES);
  assert.ok(r.stream !== undefined, 'classified as streamed (the second read errored)');
  await assert.rejects(collect(r.stream), /source failed mid-stream/, 'the error surfaces, not a hang');
});

/* ---------------- SseHub: registry + fanout ---------------- */

/** A fake transport client recording the frames written to it. */
function fakeClient() {
  const frames = [];
  let closed = false;
  return {
    frames,
    get closed() { return closed; },
    send: (s) => { if (closed) throw new Error('write after close'); frames.push(s); },
    close: () => { closed = true; },
  };
}

test('SseHub.reload fans a reload frame to every registered client', () => {
  const hub = new SseHub({ keepaliveMs: 1_000_000 });
  const a = fakeClient(); const b = fakeClient();
  hub.add(a); hub.add(b);
  hub.reload();
  assert.deepEqual(a.frames, ['event: reload\ndata: {"v":"reload"}\n\n']);
  assert.deepEqual(b.frames, ['event: reload\ndata: {"v":"reload"}\n\n']);
  hub.closeAll();
});

// #1398: the frame carries the change's classification so the browser can pick
// the lightest correct response. A single-line JSON `data:` payload, matching
// the devError sibling.
test('SseHub.reload carries the change verdict as a parseable JSON payload (#1398)', () => {
  const hub = new SseHub({ keepaliveMs: 1_000_000 });
  const a = fakeClient();
  hub.add(a);
  hub.reload({ v: 'page', by: 'app/page.ts', why: 'page-module' });
  assert.equal(a.frames.length, 1);
  assert.ok(a.frames[0].startsWith('event: reload\ndata: '));
  const json = a.frames[0].slice('event: reload\ndata: '.length).trimEnd();
  assert.equal(json.includes('\n'), false, 'the payload stays on ONE data line');
  assert.deepEqual(JSON.parse(json), { v: 'page', by: 'app/page.ts', why: 'page-module' });
  hub.closeAll();
});

// Fail safe on the emitting end too, so a caller with nothing to say can only
// ever produce the full reload this always was.
test('SseHub.reload emits `reload` for an absent or malformed verdict (#1398)', () => {
  const hub = new SseHub({ keepaliveMs: 1_000_000 });
  const a = fakeClient();
  hub.add(a);
  hub.reload();
  hub.reload(null);
  hub.reload(/** @type any */ ({}));
  hub.reload(/** @type any */ ({ v: 7 }));
  for (const f of a.frames) assert.equal(f, 'event: reload\ndata: {"v":"reload"}\n\n');
  assert.equal(a.frames.length, 4);
  hub.closeAll();
});

test('SseHub.devError fans a JSON overlay frame (#264)', () => {
  const hub = new SseHub({ keepaliveMs: 1_000_000 });
  const a = fakeClient();
  hub.add(a);
  hub.devError({ message: 'boom', file: 'app/page.ts' });
  assert.equal(a.frames.length, 1);
  assert.ok(a.frames[0].startsWith('event: webjs-error\ndata: '));
  const json = a.frames[0].slice('event: webjs-error\ndata: '.length).trimEnd();
  assert.deepEqual(JSON.parse(json), { message: 'boom', file: 'app/page.ts' });
  hub.closeAll();
});

test('SseHub.remove stops delivering to a removed client', () => {
  const hub = new SseHub({ keepaliveMs: 1_000_000 });
  const a = fakeClient(); const b = fakeClient();
  hub.add(a); hub.add(b);
  hub.remove(a);
  hub.reload();
  assert.equal(a.frames.length, 0);
  assert.equal(b.frames.length, 1);
  hub.closeAll();
});

test('SseHub fanout isolates a throwing client from the rest', () => {
  const hub = new SseHub({ keepaliveMs: 1_000_000 });
  const dead = { send: () => { throw new Error('socket gone'); }, close: () => {} };
  const live = fakeClient();
  hub.add(dead); hub.add(live);
  assert.doesNotThrow(() => hub.reload());
  assert.equal(live.frames.length, 1, 'a dead client must not abort the fan-out');
  hub.closeAll();
});

test('SseHub.closeAll closes every client and empties the registry', () => {
  const hub = new SseHub({ keepaliveMs: 1_000_000 });
  const a = fakeClient(); const b = fakeClient();
  hub.add(a); hub.add(b);
  hub.closeAll();
  assert.ok(a.closed && b.closed, 'every client is closed');
  assert.equal(hub.clients.size, 0, 'registry is emptied');
});

test('SseHub keepalive writes a comment frame on the timer', async () => {
  const hub = new SseHub({ keepaliveMs: 5 });
  const a = fakeClient();
  hub.add(a);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(a.frames.some((f) => f === ': ka\n\n'), 'a keepalive comment frame is written');
  hub.closeAll();
});

/* ---------------- isEventsPath (base-path aware) ---------------- */

test('isEventsPath matches the live-reload path, base-path aware', () => {
  assert.equal(isEventsPath('/__webjs/events', ''), true);
  assert.equal(isEventsPath('/', ''), false);
  assert.equal(isEventsPath('/__webjs/version', ''), false);
  assert.equal(EVENTS_PATH, '/__webjs/events');
});

test('isEventsPath honors a configured base path (#256)', () => {
  setBasePath('/app');
  try {
    assert.equal(isEventsPath('/app/__webjs/events', '/app'), true);
    // The bare (un-prefixed) path is not under the base path.
    assert.equal(isEventsPath('/__webjs/events', '/app'), false);
  } finally {
    setBasePath('');
  }
});

/* ---------------- isCompressible ---------------- */

test('isCompressible covers text + the structured-text application types', () => {
  for (const ct of ['text/html', 'text/plain; charset=utf-8', 'application/javascript', 'application/json', 'application/xml', 'image/svg+xml', 'application/manifest+json']) {
    assert.equal(isCompressible(ct), true, `${ct} should compress`);
  }
  for (const ct of ['image/png', 'application/octet-stream', 'video/mp4', 'font/woff2', undefined, null, '']) {
    assert.equal(isCompressible(ct), false, `${String(ct)} should NOT compress`);
  }
  // text/event-stream is text/* but must NOT compress: a compressor would buffer
  // an SSE body that is meant to flush incrementally (both shells guard on this).
  assert.equal(isCompressible('text/event-stream'), false, 'an SSE stream must not be compressed');
  assert.equal(isCompressible('text/event-stream; charset=utf-8'), false, 'SSE with params must not compress');
  // An array-valued header (node's multi-value shape) reads its first entry.
  assert.equal(isCompressible(['text/html', 'x']), true);
});

/* ---------------- compression negotiation (#517) ---------------- */

test('negotiateEncoding prefers brotli, then gzip, then deflate', () => {
  assert.equal(negotiateEncoding('br, gzip, deflate'), 'br');
  assert.equal(negotiateEncoding('gzip, deflate'), 'gzip');
  assert.equal(negotiateEncoding('deflate'), 'deflate');
  assert.equal(negotiateEncoding('gzip, br'), 'br', 'order in the header does not matter; brotli still wins');
  // Token-boundary: a substring must not false-match.
  assert.equal(negotiateEncoding('xbr, notgzip'), '', 'partial tokens do not match');
  assert.equal(negotiateEncoding(''), '');
  assert.equal(negotiateEncoding(undefined), '');
  assert.equal(negotiateEncoding(['br', 'gzip']), 'br', 'an array header (node multi-value) is joined');
});

test('createCompressor returns a node:zlib Transform per encoding, null otherwise', () => {
  for (const enc of ['br', 'gzip', 'deflate']) {
    const c = createCompressor(enc);
    assert.ok(c && typeof c.pipe === 'function' && typeof c.write === 'function', `${enc} yields a stream`);
    c.destroy();
  }
  assert.equal(createCompressor(''), null, 'no encoding yields null');
  assert.equal(createCompressor('identity'), null, 'an unknown encoding yields null');
});

test('createCompressor brotli actually round-trips (and works on this runtime)', async () => {
  const { brotliDecompressSync } = await import('node:zlib');
  const c = createCompressor('br');
  const chunks = [];
  c.on('data', (d) => chunks.push(d));
  const done = new Promise((r) => c.on('end', r));
  c.end(Buffer.from('hello brotli '.repeat(50)));
  await done;
  const out = brotliDecompressSync(Buffer.concat(chunks)).toString();
  assert.ok(out.startsWith('hello brotli'), 'brotli compress -> decompress round-trips');
});

test('varyWithAcceptEncoding merges without duplicating', () => {
  assert.equal(varyWithAcceptEncoding(''), 'Accept-Encoding');
  assert.equal(varyWithAcceptEncoding(null), 'Accept-Encoding');
  assert.equal(varyWithAcceptEncoding('Cookie'), 'Cookie, Accept-Encoding');
  assert.equal(varyWithAcceptEncoding('Accept-Encoding'), 'Accept-Encoding', 'no duplicate');
  assert.equal(varyWithAcceptEncoding('Origin, Accept-Encoding'), 'Origin, Accept-Encoding', 'already present, unchanged');
});

/* ---------------- webStreamChunks (the compression body bridge) ---------------- */

test('webStreamChunks yields a web stream chunk by chunk', async () => {
  const ws = new ReadableStream({
    start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close(); },
  });
  const out = [];
  for await (const chunk of webStreamChunks(ws)) out.push(...chunk);
  assert.deepEqual(out, [1, 2, 3]);
});

test('webStreamChunks PROPAGATES a mid-stream source error (the #509 anti-hang)', async () => {
  let pulls = 0;
  const ws = new ReadableStream({
    pull(c) { if (pulls++ === 0) c.enqueue(new Uint8Array([1])); else c.error(new Error('boom')); },
  });
  await assert.rejects(async () => { for await (const _ of webStreamChunks(ws)) { void _; } }, /boom/);
});

test('webStreamChunks cancels the source on early break', async () => {
  let cancelled = false;
  const ws = new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array([1])); },
    cancel() { cancelled = true; },
  });
  for await (const _ of webStreamChunks(ws)) { void _; break; } // take one, then break early
  // microtask for the async cancel in the generator's finally to settle
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(cancelled, true, 'the source web stream is cancelled when the consumer stops early');
});

/* ---------------- serverRuntime ---------------- */

test('serverRuntime reports the host runtime', () => {
  const rt = serverRuntime();
  assert.ok(rt === 'node' || rt === 'bun');
  // This suite runs under node:test on Node, so it must report 'node'.
  assert.equal(rt, process.versions.bun ? 'bun' : 'node');
});

test('serverRuntime COUNTERFACTUAL: a faked Bun version flips the verdict', () => {
  const orig = process.versions.bun;
  try {
    process.versions.bun = '1.3.14';
    assert.equal(serverRuntime(), 'bun', 'a present process.versions.bun selects the Bun shell');
  } finally {
    if (orig === undefined) delete process.versions.bun; else process.versions.bun = orig;
  }
});

/* ---------------- loadWsModule ---------------- */

test('loadWsModule imports a route module (shared by both WS shells)', async () => {
  const { fileURLToPath } = await import('node:url');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'webjs-ws-mod-'));
  const file = join(dir, 'route.js');
  writeFileSync(file, 'export function WS() {}\nexport const marker = 42;\n');
  try {
    const mod = await loadWsModule(file, false);
    assert.equal(typeof mod.WS, 'function');
    assert.equal(mod.marker, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Silence the unused import in environments that tree-shake.
  void fileURLToPath;
});

/* ---------------- makeShutdown exit code (#1092) ---------------- */

/**
 * Drive one shutdown with `process.exit` stubbed, and resolve the code it
 * asked for. The real `process.exit` cannot run here (it would take the test
 * runner down), so the stub records the code and returns. Returning rather than
 * throwing a stop-the-handler sentinel is deliberate: `process.exit(code)` is
 * the last statement on both settle paths, so there is nothing after it to
 * suppress, and a throw from inside the promise chain surfaces as an
 * unhandledRejection once the test has already ended.
 *
 * @param {(signal: string, opts?: { fatal?: boolean }) => void} shutdown
 * @param {[string, { fatal?: boolean }?]} args
 * @returns {Promise<number | undefined>}
 */
function exitCodeOf(shutdown, args) {
  const orig = process.exit;
  return new Promise((res) => {
    // @ts-ignore stubbed for the duration of one shutdown
    process.exit = (code) => { process.exit = orig; res(code); };
    shutdown(...args);
    // The exit happens after `closeServer` resolves, so nothing is synchronous
    // here; the promise settles from the stub above.
  });
}

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };
const okHub = { closeAll() {} };

test('makeShutdown exits 0 for an operator signal', async () => {
  const shutdown = makeShutdown({
    closeServer: () => Promise.resolve(), hub: /** @type any */ (okHub), logger: quietLogger,
  });
  assert.equal(await exitCodeOf(shutdown, ['SIGTERM']), 0);
});

test('makeShutdown exits 1 for a FATAL shutdown even on a clean drain (#1092)', async () => {
  // The drain SUCCEEDS here on purpose. The old code read only the drain and
  // exited 0, which swallowed every crash: a supervisor reading the code saw a
  // successful stop, and a `test/bun/*.mjs` proof script's failed assertion
  // (which reaches this path via the uncaughtException handler) went green.
  const shutdown = makeShutdown({
    closeServer: () => Promise.resolve(), hub: /** @type any */ (okHub), logger: quietLogger,
  });
  assert.equal(await exitCodeOf(shutdown, ['uncaughtException', { fatal: true }]), 1);
});

test('makeShutdown exits 1 when a FATAL arrives mid-drain (#1092)', async () => {
  // A SIGTERM drain is up to 10s wide and in-flight requests are still running
  // in it, so an uncaught exception landing there is ordinary. The re-entrancy
  // guard drops that second call, so a code captured at entry would stay 0 and
  // a crashed process would tell systemd / Docker / Railway it stopped cleanly.
  let release;
  const shutdown = makeShutdown({
    closeServer: () => new Promise((r) => { release = r; }),
    hub: /** @type any */ (okHub),
    logger: quietLogger,
  });
  const exited = exitCodeOf(shutdown, ['SIGTERM']);
  // `closeServer` is invoked from a microtask, so yield until it has actually
  // run and handed back its resolver before crashing into the open drain.
  while (!release) await null;
  shutdown('uncaughtException', { fatal: true }); // crash before the drain settles
  release();
  assert.equal(await exited, 1);
});

test('makeShutdown does not let a later signal downgrade a fatal verdict', async () => {
  let release;
  const shutdown = makeShutdown({
    closeServer: () => new Promise((r) => { release = r; }),
    hub: /** @type any */ (okHub),
    logger: quietLogger,
  });
  const exited = exitCodeOf(shutdown, ['uncaughtException', { fatal: true }]);
  while (!release) await null;
  shutdown('SIGTERM'); // must not launder the crash into a success
  release();
  assert.equal(await exited, 1);
});

test('makeShutdown exits 1 when the drain itself fails', async () => {
  const shutdown = makeShutdown({
    closeServer: () => Promise.reject(new Error('close failed')),
    hub: /** @type any */ (okHub),
    logger: quietLogger,
  });
  assert.equal(await exitCodeOf(shutdown, ['SIGTERM']), 1);
});
