/**
 * Cross-runtime proof for the Bun listener overhead reductions (#756). webjs runs
 * on Node 24+ OR Bun, and these touch the request / response hot path (the Bun
 * shell's out-of-band IP stamp and the buffered-compression fast path), so both
 * must stay behaviourally identical across runtimes. Run from the repo root:
 *
 *   node test/bun/listener-overhead.mjs   # node:http shell (header IP + streaming compress)
 *   bun  test/bun/listener-overhead.mjs   # Bun.serve shell (out-of-band IP + sync buffered compress)
 *
 * Asserts, under WHICHEVER runtime runs it:
 * (1) a buffered HTML page compressed with br / gzip / deflate decodes back to
 *     the original bytes under whichever runtime runs (the buffered fast path on
 *     Bun, the streaming path on node). The assertion is a ROUND-TRIP (decode ==
 *     original), NOT a cross-runtime byte equality: Bun's bundled zlib is not
 *     Node's build, so the gzip/deflate bytes can differ across runtimes (brotli
 *     matches), which is fine since each response is self-describing via
 *     content-encoding, and
 * (2) the framework-trusted remote IP reaches `clientIp` (stamped out of band on
 *     Bun without a Request clone, via the header on node), and a client-spoofed
 *     `x-webjs-remote-ip` does NOT override it,
 * (3) the spoof does not survive the form-dispatch body rebuild (`parseFormBody`),
 * (4) a STREAMED compressible body does not have its response head withheld until
 *     its slow second chunk (the buffered-vs-streamed classifier must not block on
 *     the second read, #756 review MUST-FIX 2), and
 * (5) a `webjs.basePath` request rebuild does not re-open the IP spoof on Bun
 *     (the fresh Request loses the WeakMap stamp + copies the inbound header, so
 *     it must strip + propagate, #773 round-2 MUST-FIX 1).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from 'node:net';
import { startServer } from '@webjsdev/server';

/**
 * Fetch the RAW HTTP/1.1 response head for a path WITHOUT decompressing (unlike
 * `fetch`, which strips `content-length` when it transparently decodes a
 * compressed body). Lets the proof discriminate the Bun sync buffered-compress
 * fast path (which SETS `content-length`) from the stream bridge (which DELETES
 * it). Resolves the lowercased header lines of the status+header block.
 * @param {number} port @param {string} path @param {Record<string,string>} headers
 * @returns {Promise<string>} the raw header block, lowercased
 */
function rawHead(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const sock = connect(port, 'localhost', () => {
      const lines = [`GET ${path} HTTP/1.1`, `Host: localhost:${port}`, 'Connection: close'];
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
      sock.write(lines.join('\r\n') + '\r\n\r\n');
    });
    let buf = '';
    const done = (out) => { try { sock.destroy(); } catch {} resolve(out); };
    sock.setTimeout(4000, () => { sock.destroy(); reject(new Error('rawHead timeout')); });
    sock.on('data', (d) => { buf += d.toString('latin1'); const i = buf.indexOf('\r\n\r\n'); if (i !== -1) done(buf.slice(0, i).toLowerCase()); });
    sock.on('error', reject);
    sock.on('end', () => done(buf.toLowerCase()));
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = pathToFileURL(resolve(__dirname, '../../packages/core/index.js')).toString();
const SERVER = pathToFileURL(resolve(__dirname, '../../packages/server/index.js')).toString();
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

const dir = mkdtempSync(join(tmpdir(), 'webjs-756-'));
const w = (rel, body) => { const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, body); };

const MARKER = 'buffered-fast-path-content ';
let close;
let failed = null;
try {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'overhead', type: 'module', webjs: {} }));
  w('app/layout.ts', `import { html } from ${JSON.stringify(CORE)};\nexport default ({ children }: { children: unknown }) => html\`<!doctype html><html><head></head><body>\${children}</body></html>\`;`);
  w('app/page.ts', `import { html } from ${JSON.stringify(CORE)};\nexport default () => html\`<main>\${'${MARKER}'.repeat(300)}</main>\`;`);
  // Echo the framework-trusted client IP so we can prove the stamp reached it.
  w('app/api/ip/route.ts', `import { clientIp } from ${JSON.stringify(SERVER)};\nexport async function GET(req: Request) {\n  return new Response(clientIp(req), { headers: { 'content-type': 'text/plain' } });\n}`);
  // A page `action` (the no-JS form write path) that echoes clientIp into the
  // redirect Location. The action receives a REBUILT request (parseFormBody),
  // so this proves the trusted IP survives the rebuild and a spoofed header
  // does not win (#756 review must-fix).
  // The REBUILT request (parseFormBody's copy) is visible only to middleware, so
  // that is where #756's propagation is proven; the action additionally reports
  // the ambient request's ip, which is what an action naturally reads. Both must
  // resist the spoofed header, and they travel by different mechanisms (the
  // out-of-band WeakMap re-stamp vs the ALS store).
  w('ipcheck.server.ts', `'use server';\nimport { redirect } from ${JSON.stringify(CORE)};\nimport { clientIp, getRequest, actionContext } from ${JSON.stringify(SERVER)};\nexport const middleware = [async (ctx: any, next: any) => { ctx.context.rebuiltIp = clientIp(ctx.request); return next(); }];\nexport async function seeIp() { const q = new URLSearchParams({ seenip: clientIp(getRequest()), rebuiltip: String(actionContext().rebuiltIp) }); throw redirect('/?' + q.toString()); }`);
  w('app/ipcheck/page.ts', `import { html } from ${JSON.stringify(CORE)};\nimport { seeIp } from '../../ipcheck.server.ts';\nexport default () => html\`<main><form action=\${seeIp}><button>go</button></form></main>\`;`);
  // A genuinely STREAMED, compressible body whose SECOND chunk is far off. The
  // compression classifier must not block the response head on it (#756 review).
  w('app/api/slow/route.ts', `export async function GET() {\n  const enc = new TextEncoder();\n  let pulled = 0;\n  const stream = new ReadableStream({\n    start(c) { c.enqueue(enc.encode('shell-chunk-' + 'a'.repeat(64) + ';')); },\n    async pull(c) { if (pulled++) { c.close(); return; } await new Promise((r) => setTimeout(r, 400)); c.enqueue(enc.encode('boundary-chunk;')); c.close(); },\n  });\n  return new Response(stream, { headers: { 'content-type': 'text/html; charset=utf-8' } });\n}`);

  let server;
  ({ server, close } = await startServer({ appDir: dir, dev: true, compress: true, port: 0, logger: quiet }));
  const port = typeof server.port === 'number' ? server.port : server.address().port;
  const base = `http://localhost:${port}`;

  // (1) A buffered page compresses + decodes correctly for every encoding.
  for (const enc of ['br', 'gzip', 'deflate']) {
    const r = await fetch(`${base}/`, { headers: { 'accept-encoding': enc } });
    assert.equal(r.status, 200, `[${runtime}] page 200 (${enc})`);
    assert.equal(r.headers.get('content-encoding'), enc, `[${runtime}] served ${enc}`);
    const body = await r.text(); // fetch transparently decompresses
    assert.ok(body.includes(MARKER.trim()), `[${runtime}] ${enc} body decodes to the original page`);
  }

  // (1b) On Bun, prove the BUFFERED sync-compress fast path is actually TAKEN
  // (not silently falling back to the stream bridge): the sync path SETS
  // `content-length` on the fully-compressed buffer, the bridge DELETES it. A raw
  // probe is required because `fetch` strips `content-length` when it
  // decompresses. Bun-only: the node shell stream-compresses a buffered page too,
  // so it carries no content-length (the classifier is a Bun-shell optimization).
  if (process.versions.bun) {
    const head = await rawHead(port, '/', { 'accept-encoding': 'gzip' });
    assert.ok(/content-encoding:\s*gzip/.test(head), `[${runtime}] buffered page served gzip (raw head)`);
    assert.ok(/content-length:\s*\d+/.test(head),
      `[${runtime}] the Bun buffered fast path set content-length (sync compress, not the stream bridge)`);
  }

  // (2) The trusted remote IP reaches clientIp; a spoofed header does not win.
  const ipRes = await fetch(`${base}/api/ip`, { headers: { 'x-webjs-remote-ip': '6.6.6.6' } });
  const ip = (await ipRes.text()).trim();
  assert.notEqual(ip, '6.6.6.6', `[${runtime}] a client-spoofed x-webjs-remote-ip must NOT be trusted`);
  assert.notEqual(ip, '_anon_', `[${runtime}] the framework-stamped socket IP reached clientIp`);
  assert.ok(ip.length > 0, `[${runtime}] a remote IP was resolved (${ip})`);

  // (3) The spoof must not survive the form-dispatch request rebuild (#756
  // review). The identity is read off the rendered page rather than computed,
  // so this submits exactly what a browser would.
  const ipPage = await (await fetch(`${base}/ipcheck`)).text();
  const ipId = /name="__webjs_action" value="([^"]*)"/.exec(ipPage);
  assert.ok(ipId, `[${runtime}] the ipcheck page rendered a bound form`);
  const actRes = await fetch(`${base}/ipcheck`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-webjs-remote-ip': '6.6.6.6' },
    body: new URLSearchParams({ __webjs_action: ipId[1], x: '1' }).toString(),
  });
  const loc = actRes.headers.get('location') || '';
  assert.ok(/seenip=/.test(loc), `[${runtime}] the action redirected with the seen ip (loc=${loc})`);
  assert.ok(/rebuiltip=/.test(loc), `[${runtime}] and with the ip read off the REBUILT request (loc=${loc})`);
  assert.ok(!/seenip=6\.6\.6\.6/.test(loc), `[${runtime}] a spoofed header must NOT reach the ambient request`);
  assert.ok(!/rebuiltip=6\.6\.6\.6/.test(loc), `[${runtime}] a spoofed header must NOT survive the form-dispatch rebuild`);
  assert.ok(!/seenip=_anon_/.test(loc), `[${runtime}] the trusted IP survived to the action (not anon)`);
  assert.ok(!/rebuiltip=_anon_/.test(loc), `[${runtime}] the trusted IP was propagated onto the rebuilt request (not anon)`);

  // (4) A STREAMED compressible body must not have its response head withheld
  // until its slow second chunk (#756 review MUST-FIX 2): the buffered-vs-streamed
  // classifier must not block on the second read. `fetch` resolves when the head
  // arrives (before the body), so time-to-head measures the regression directly.
  const t0 = Date.now();
  const slow = await fetch(`${base}/api/slow`, { headers: { 'accept-encoding': 'gzip' } });
  const headMs = Date.now() - t0;
  assert.equal(slow.status, 200, `[${runtime}] slow stream is 200`);
  assert.ok(headMs < 300, `[${runtime}] response head arrived in ${headMs}ms, not blocked on the 400ms second chunk`);
  const slowBody = await slow.text(); // fetch transparently decompresses
  assert.ok(slowBody.includes('shell-chunk') && slowBody.includes('boundary-chunk'),
    `[${runtime}] the streamed body still decodes in full under compression`);

  await close();
  close = null;

  // (5) basePath rebuild must not re-open the IP spoof on Bun (#773 round-2
  // MUST-FIX 1). When `webjs.basePath` is set, dev.js rebuilds the Request with
  // the stripped path; that fresh object is not in the listener's trusted-IP
  // WeakMap and copies the inbound headers, so without the strip+propagate fix
  // `clientIp` would fall back to the spoofable `x-webjs-remote-ip` on Bun.
  const bpDir = mkdtempSync(join(tmpdir(), 'webjs-756bp-'));
  const bw = (rel, body) => { const abs = join(bpDir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, body); };
  writeFileSync(join(bpDir, 'package.json'), JSON.stringify({ name: 'bp', type: 'module', webjs: { basePath: '/mnt' } }));
  bw('app/layout.ts', `import { html } from ${JSON.stringify(CORE)};\nexport default ({ children }: { children: unknown }) => html\`<!doctype html><html><head></head><body>\${children}</body></html>\`;`);
  bw('app/page.ts', `import { html } from ${JSON.stringify(CORE)};\nexport default () => html\`<main>bp</main>\`;`);
  bw('app/api/ip/route.ts', `import { clientIp } from ${JSON.stringify(SERVER)};\nexport async function GET(req: Request) {\n  return new Response(clientIp(req), { headers: { 'content-type': 'text/plain' } });\n}`);
  bw('ipcheck.server.ts', `'use server';\nimport { redirect } from ${JSON.stringify(CORE)};\nimport { clientIp, actionContext } from ${JSON.stringify(SERVER)};\nexport const middleware = [async (ctx: any, next: any) => { ctx.context.rebuiltIp = clientIp(ctx.request); return next(); }];\nexport async function seeIp() { throw redirect('/?seenip=' + encodeURIComponent(String(actionContext().rebuiltIp))); }`);
  bw('app/ipcheck/page.ts', `import { html } from ${JSON.stringify(CORE)};\nimport { seeIp } from '../../ipcheck.server.ts';\nexport default () => html\`<main><form action=\${seeIp}><button>go</button></form></main>\`;`);
  let bpClose;
  try {
    const { server: bpServer, close: c2 } = await startServer({ appDir: bpDir, dev: true, compress: true, port: 0, logger: quiet });
    bpClose = c2;
    const bpPort = typeof bpServer.port === 'number' ? bpServer.port : bpServer.address().port;
    const bpBase = `http://localhost:${bpPort}`;
    const bpIp = (await (await fetch(`${bpBase}/mnt/api/ip`, { headers: { 'x-webjs-remote-ip': '6.6.6.6' } })).text()).trim();
    assert.notEqual(bpIp, '6.6.6.6', `[${runtime}] a basePath rebuild must NOT trust a spoofed x-webjs-remote-ip`);
    assert.notEqual(bpIp, '_anon_', `[${runtime}] the trusted IP survived the basePath rebuild`);
    // Read the identity off the rendered page, so the POST below is the one a
    // browser would send. Submitting without it answers 405 with no Location,
    // which would make the negative assertion below vacuously true and leave
    // this guard passing even if the spoof came back.
    const bpPage = await (await fetch(`${bpBase}/mnt/ipcheck`)).text();
    const bpId = /name="__webjs_action" value="([^"]*)"/.exec(bpPage);
    assert.ok(bpId, `[${runtime}] the basePath ipcheck page rendered a bound form`);
    const bpAct = await fetch(`${bpBase}/mnt/ipcheck`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-webjs-remote-ip': '6.6.6.6' },
      body: new URLSearchParams({ __webjs_action: bpId[1], x: '1' }).toString(),
    });
    const bpLoc = bpAct.headers.get('location') || '';
    // POSITIVE first: an empty Location must FAIL rather than satisfy the
    // negative regex below.
    assert.ok(/seenip=/.test(bpLoc), `[${runtime}] the basePath action redirected with the seen ip (loc=${bpLoc})`);
    assert.ok(!/seenip=6\.6\.6\.6/.test(bpLoc), `[${runtime}] spoof must not survive basePath + form-dispatch rebuild (loc=${bpLoc})`);
    assert.ok(!/seenip=_anon_/.test(bpLoc), `[${runtime}] the trusted IP survived the basePath + form-dispatch rebuild`);
  } finally {
    try { if (bpClose) await bpClose(); } catch {}
    rmSync(bpDir, { recursive: true, force: true });
  }

  console.log(`OK  listener-overhead #756 passed on ${runtime} (buffered compress decodes + trusted IP stamped + streamed head not blocked + basePath spoof closed, ip=${ip})`);
} catch (err) {
  // Report failures EXPLICITLY rather than letting them propagate as an
  // unhandled top-level-await rejection: Bun exits 0 without flushing the error
  // for a TLA rejection inside a `try/finally`, which would silently swallow a
  // real regression (and make `scripts/run-bun-tests.js` see a false pass). A
  // hard `process.exit(1)` after printing the message keeps the assertion a real
  // guard under BOTH runtimes.
  failed = err;
} finally {
  try { if (close) await close(); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
if (failed) {
  console.error(`FAIL listener-overhead #756 on ${runtime}: ${failed?.stack || failed?.message || failed}`);
  // Hard-exit ONLY when run as a standalone script (`node`/`bun
  // test/bun/listener-overhead.mjs`): Bun swallows a top-level-await rejection
  // inside try/finally, so a plain throw would exit 0. When IMPORTED by the
  // `.test.mjs` wrapper under `node --test`, a `process.exit(1)` would kill the
  // whole single-process run and hide every other file's results, so throw
  // instead and let the test harness report one failed test.
  if (import.meta.main) process.exit(1);
  else throw failed;
}
