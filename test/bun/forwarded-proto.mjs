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
 * the assertion propagate, because `startServer` installs an `uncaughtException`
 * handler that begins a graceful shutdown and exits 0. On Bun a top-level
 * assertion failure routes through that handler, so a broken proof would exit 0
 * and CI's `bun test/bun/<file>.mjs` step would go GREEN on a real regression
 * (verified: node exits 1, Bun exits 0). Filed separately as #1092 for the other
 * proof scripts, which all share this shape.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '@webjsdev/server';

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
  w('app/api/whoami/route.ts', `export async function GET(req: Request) {\n  return Response.json({ url: req.url, origin: new URL(req.url).origin });\n}`);

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

  await close();
  close = null;
  console.log(`OK  forwarded proto/host passed on ${runtime} (page ctx.url + route req.url both https)`);
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
