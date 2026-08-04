/**
 * Cross-runtime forwarded-header proof (#1090): boot a real WebJs app through
 * `startServer` and assert, under WHICHEVER runtime runs it, that a request
 * carrying `X-Forwarded-Proto` / `X-Forwarded-Host` is seen by the app with the
 * ORIGINAL scheme + host:
 *
 *   node test/bun/forwarded-proto.mjs   # the node:http shell (urlFromRequest -> toWebRequest)
 *   bun  test/bun/forwarded-proto.mjs   # the Bun.serve shell (applyForwarded -> forwardedRequest)
 *
 * The node shell always got this right, because `toWebRequest` builds its
 * `Request` from an already-corrected url. The Bun shell handed `Bun.serve`'s
 * request straight through, so `req.url` kept the internal `http://container`
 * view and every absolute URL the app derived came out `http://`. That shipped:
 * https://webjs.dev (Bun on Railway behind Cloudflare) served
 * `<meta property="og:image" content="http://webjs.dev/public/og.png">`.
 *
 * Both surfaces are asserted, because they fail independently:
 *   1. a PAGE's `ctx.url` (what `generateMetadata` builds og:image from), and
 *   2. a `route.ts` handler's raw `req.url` (what app code reads directly).
 * A fix that only threads a corrected url into the framework's own metadata
 * path would pass (1) and still leave (2) broken.
 *
 * A plain assert script (not node:test), so the SAME file runs on both runtimes.
 * Run from the repo root so the bare `@webjsdev/server` specifier resolves.
 *
 * The failure is reported by an explicit `process.exit(1)` rather than by letting
 * the assertion propagate. That is now BELT AND BRACES rather than load-bearing:
 * it was written when `startServer`'s `uncaughtException` handler began a
 * graceful shutdown that exited 0 unconditionally, so a top-level assertion
 * failure was swallowed and CI's `bun test/bun/<file>.mjs` step went GREEN on a
 * real regression. #1092 fixed that at the source (a fatal shutdown now exits 1),
 * and the note here that only Bun was affected was wrong: node routes a
 * module-body throw to the same handler and was exiting 0 too. The explicit exit
 * is kept because this script catches its own failure in a `finally`, so it has
 * to report the verdict itself either way.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from 'node:net';
import { startServer } from '@webjsdev/server';

/**
 * Issue a GET with a VERBATIM request target, bypassing the fetch client.
 *
 * Both runtimes' `fetch` normalize the path before it reaches the wire (Bun
 * collapses a leading `//`), which is exactly the shape being attacked here, so
 * a raw socket is the only way to put it on the wire.
 *
 * @param {number} port
 * @param {string} target
 * @param {Record<string, string>} [headers]
 * @returns {Promise<string>} the raw response text
 */
function rawGet(port, target, headers = {}) {
  return new Promise((res, rej) => {
    const sock = connect(port, '127.0.0.1', () => {
      const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('');
      sock.write(`GET ${target} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n${extra}\r\n`);
    });
    let buf = '';
    sock.setTimeout(8000, () => { sock.destroy(); rej(new Error(`raw GET ${target} timed out`)); });
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => res(buf));
    sock.on('error', rej);
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = pathToFileURL(resolve(__dirname, '../../packages/core/index.js')).toString();
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

const dir = mkdtempSync(join(tmpdir(), 'wj-forwarded-'));
const w = (rel, body) => { const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, body); };

let close;
/** @type {unknown} */
let failure = null;
try {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'forwarded', type: 'module', webjs: {} }));
  w('app/layout.ts', `import { html } from ${JSON.stringify(CORE)};\nexport default ({ children }: { children: unknown }) => html\`<!doctype html><html><head></head><body>\${children}</body></html>\`;`);
  // The real shape: a page building an absolute asset URL from ctx.url, exactly
  // how website/app/layout.ts derives its og:image.
  w('app/page.ts', `import { html } from ${JSON.stringify(CORE)};\nexport function generateMetadata(ctx: { url: string }) {\n  const origin = new URL(ctx.url).origin;\n  return { title: 'fwd', openGraph: { image: origin + '/public/og.png' } };\n}\nexport default () => html\`<main>page</main>\`;`);
  // A route handler reading the raw request url, the app-code surface.
  w('app/api/whoami/route.ts', `export async function GET(req: Request) {\n  return Response.json({ url: req.url, origin: new URL(req.url).origin, ip: req.headers.get('x-webjs-remote-ip') });\n}`);
  w('app/api/echo/route.ts', `export async function POST(req: Request) {\n  return Response.json({ method: req.method, body: await req.text(), ct: req.headers.get('content-type'), origin: new URL(req.url).origin });\n}`);
  // The target of the scheme-relative-authority attack below. If the path is
  // resolved rather than assigned, `//evil.com/x` collapses to `/x` and reaches
  // THIS route; correct behaviour never matches it.
  w('app/x/route.ts', `export async function GET(req: Request) {\n  return Response.json({ reached: true, url: req.url });\n}`);
  // A WebSocket endpoint, so the upgrade path's correction is asserted too.
  w('app/live/route.ts', `export function WS(ws: any, req: Request) {\n  ws.send(JSON.stringify({ url: req.url }));\n}`);

  let server;
  ({ server, close } = await startServer({ appDir: dir, dev: true, port: 0, logger: quiet }));
  const port = typeof server.port === 'number' ? server.port : server.address().port;
  const base = `http://localhost:${port}`;
  const proxied = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'webjs.dev' };

  // 1. The page's ctx.url origin, read back off the rendered og:image tag.
  const page = await fetch(`${base}/`, { headers: proxied });
  assert.equal(page.status, 200, 'page is 200');
  const html = await page.text();
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html);
  assert.ok(og, 'the page rendered an og:image tag');
  assert.equal(og[1], 'https://webjs.dev/public/og.png', `ctx.url honors the forwarded headers on ${runtime}`);

  // 2. A route handler's raw req.url. This is the surface a threaded-url-only
  // fix would miss.
  const api = await fetch(`${base}/api/whoami`, { headers: proxied });
  const body = await api.json();
  assert.equal(body.origin, 'https://webjs.dev', `route.ts req.url honors the forwarded headers on ${runtime}`);

  // 3. Proto alone (the Railway shape: Host already public, only the scheme is
  // internal) still upgrades.
  const protoOnly = await fetch(`${base}/api/whoami`, { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(new URL((await protoOnly.json()).url).protocol, 'https:', 'proto-only forwarding upgrades the scheme');

  // 4. A comma-separated chain (CDN then LB, i.e. Cloudflare in front of
  // Railway) takes the value closest to the client.
  const chained = await fetch(`${base}/api/whoami`, {
    headers: { 'x-forwarded-proto': 'https,http', 'x-forwarded-host': 'webjs.dev, internal.railway' },
  });
  assert.equal((await chained.json()).origin, 'https://webjs.dev', 'the first value of each chain wins');

  // 5. No forwarded headers: the local origin is untouched (the no-proxy path
  // that must keep working for dev).
  const plain = await fetch(`${base}/api/whoami`);
  assert.equal((await plain.json()).origin, base, 'an unproxied request keeps its own origin');

  // 6. A `//`-prefixed path must NOT be read as an authority. Resolving the
  // path against the corrected origin turns `//evil.com/x` into
  // `https://evil.com/x`, handing over the origin AND collapsing the path to
  // `/x` so a DIFFERENT route matches, using only the proto header every proxy
  // sets. The control proves `/x` is really routable, so the 404 below is the
  // attack being refused and not the fixture missing a route.
  // It has to go over a RAW SOCKET: Bun's `fetch` client rewrites
  // `//evil.com/x` to `/evil.com/x` before sending, so driving this through
  // `fetch` silently tests nothing on the very runtime the bug was on (this
  // assertion passed against a deliberately reintroduced bug until it was
  // moved off `fetch`).
  const control = await rawGet(port, '/x');
  assert.match(control, /^HTTP\/1\.1 200/, 'control: /x is a real route');
  assert.match(control, /"reached":true/, 'control: /x answers');

  const hostile = await rawGet(port, '//evil.com/x', { 'x-forwarded-proto': 'https' });
  assert.doesNotMatch(hostile, /"reached":true/, 'a //-prefixed path must not collapse onto the /x route');
  assert.match(hostile, /^HTTP\/1\.1 404/, 'a //-prefixed path is not a route');

  // 7. A client-supplied `x-webjs-remote-ip` must never reach a handler as-is.
  // Node stamps its own socket address over it; Bun strips it and answers from
  // the WeakMap. Either way the client's value must not survive.
  const spoof = await fetch(`${base}/api/whoami`, { headers: { ...proxied, 'x-webjs-remote-ip': '9.9.9.9' } });
  assert.notEqual((await spoof.json()).ip, '9.9.9.9', 'a spoofed remote-ip header does not survive the rebuild');

  // 8. The rebuild must not lose the request body or method.
  const echo = await fetch(`${base}/api/echo`, {
    method: 'POST',
    headers: { ...proxied, 'content-type': 'application/json' },
    body: '{"n":42}',
  });
  const echoed = await echo.json();
  assert.equal(echoed.method, 'POST', 'method survives the rebuild');
  assert.equal(echoed.body, '{"n":42}', 'body survives the rebuild');
  assert.equal(echoed.ct, 'application/json', 'content-type survives the rebuild');
  assert.equal(echoed.origin, 'https://webjs.dev', 'a POST is origin-corrected too');

  // 9. The WS upgrade path corrects its handler request too. The node shell
  // gets this from `buildRequestFromUpgrade`; on Bun it is `bunUpgrade`
  // applying the same helper. Untested, a regression here would be silent.
  const wsUrl = await new Promise((res, rej) => {
    const sock = new WebSocket(`ws://localhost:${port}/live`, { headers: proxied });
    const timer = setTimeout(() => { try { sock.close(); } catch {} rej(new Error('WS handshake timed out')); }, 8000);
    sock.onmessage = (ev) => { clearTimeout(timer); try { sock.close(); } catch {} res(JSON.parse(String(ev.data)).url); };
    sock.onerror = () => { clearTimeout(timer); rej(new Error('WS connection failed')); };
  });
  assert.equal(new URL(wsUrl).origin, 'https://webjs.dev', `the WS handler request is origin-corrected on ${runtime}`);

  await close();
  close = null;
  console.log(`OK  forwarded proto/host passed on ${runtime} (page ctx.url + route req.url + WS all https)`);
} catch (e) {
  failure = e;
} finally {
  try { if (close) await close(); } catch {}
  rmSync(dir, { recursive: true, force: true });
}

if (failure) {
  console.error(`FAIL forwarded proto/host on ${runtime}`);
  console.error(failure instanceof Error ? failure.stack || failure.message : String(failure));
  process.exit(1);
}
