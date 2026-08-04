/**
 * Cross-runtime proof for the reverse-proxy TRUST posture (#1097, #1104): boot
 * a real WebJs app through `startServer` and assert, under WHICHEVER runtime
 * runs it, that
 *
 *   1. a hostile `X-Forwarded-Host` cannot poison the SHARED HTML response
 *      cache for a later visitor who sends no such header (#1097), and
 *   2. `WEBJS_NO_TRUST_PROXY=1` is honored by every forwarded-header reader,
 *      including the CSRF host resolution that used to ignore it (#1104).
 *
 *   node test/bun/forwarded-trust.mjs   # the node:http shell (urlFromRequest -> toWebRequest)
 *   bun  test/bun/forwarded-trust.mjs   # the Bun.serve shell (applyForwarded -> forwardedRequest)
 *
 * Both shells matter and can fail independently. The URL correction runs in a
 * different place on each (`startNodeListener` builds its `Request` from an
 * already-corrected url; `listener-bun.js` rebuilds one via `forwardedRequest`),
 * and the cache key is computed downstream from whatever url that produced. A
 * shell that corrected the origin differently would key differently, so the
 * poisoning could be closed on one runtime and open on the other. This is the
 * companion to `forwarded-proto.mjs`, which proves the CORRECTION itself; this
 * file proves what is TRUSTED and what the correction is then allowed to reach.
 *
 * A plain assert script (not node:test), so the SAME file runs on both runtimes.
 * Run from the repo root so the bare `@webjsdev/server` specifier resolves.
 *
 * The failure is reported by an explicit `process.exit(1)` rather than by
 * letting the assertion propagate, because `startServer` installs an
 * `uncaughtException` handler that begins a graceful shutdown and exits 0. On
 * Bun a top-level assertion failure routes through that handler, so a broken
 * proof would exit 0 and CI's `bun test/bun/<file>.mjs` step would go GREEN on a
 * real regression (#1092, the shape every proof script here shares).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from '@webjsdev/server';
import { actionEndpoint } from '@webjsdev/server/testing';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = pathToFileURL(resolve(__dirname, '../../packages/core/index.js')).toString();
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

const dir = mkdtempSync(join(tmpdir(), 'wj-fwd-trust-'));
const w = (rel, body) => {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

let close;
const prevFlag = process.env.WEBJS_NO_TRUST_PROXY;
/** @type {unknown} */
let failure = null;
try {
  delete process.env.WEBJS_NO_TRUST_PROXY;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fwd-trust', type: 'module', webjs: {} }));
  w(
    'app/layout.ts',
    `import { html } from ${JSON.stringify(CORE)};\n` +
      `export default ({ children }: { children: unknown }) => html\`<!doctype html><html><head></head><body>\${children}</body></html>\`;`,
  );
  // A cache-opted-in page baking ctx.url.origin into its body, the og:image /
  // canonical / OAuth-callback shape. `revalidate` is the opt-in that makes the
  // rendered body SHARED, which is the whole precondition for the poisoning.
  w(
    'app/page.ts',
    `import { html } from ${JSON.stringify(CORE)};\n` +
      `export const revalidate = 60;\n` +
      `export default ({ url }: { url: string }) => {\n` +
      `  const origin = new URL(url).origin;\n` +
      `  return html\`<main>og \${origin}/public/og.png</main>\`;\n` +
      `}\n`,
  );
  // An action, so the CSRF host resolution (#1104) is exercised through the
  // real RPC dispatch rather than by calling the helper directly.
  w('actions.server.ts', `'use server';\nexport async function ping() {\n  return { success: true };\n}\n`);

  let server;
  ({ server, close } = await startServer({ appDir: dir, dev: false, port: 0, logger: quiet }));
  const port = typeof server.port === 'number' ? server.port : server.address().port;
  const base = `http://localhost:${port}`;
  const endpoint = await actionEndpoint(dir, 'actions.server.ts', 'ping');

  /* ---- 1. the HTML cache cannot be poisoned across origins (#1097) ---- */

  const attack = await fetch(`${base}/`, {
    headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(attack.status, 200, 'the attack request renders');
  const attackBody = await attack.text();
  assert.match(
    attackBody,
    /https:\/\/evil\.example\/public\/og\.png/,
    `the attacker gets their own origin back on ${runtime}: that response is theirs, and is not the bug`,
  );

  // The victim: no forwarded headers at all, so the origin comes from `Host`.
  const clean = await (await fetch(`${base}/`)).text();
  assert.doesNotMatch(clean, /evil\.example/, `the poisoned body is not served to a clean visitor on ${runtime}`);
  assert.match(clean, new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/public/og\\.png`),
    'the clean visitor gets the real origin');

  // And the cache is still a cache: a second clean request is a HIT, so the
  // fix did not close the hole by disabling the feature.
  const cachedAgain = await (await fetch(`${base}/`)).text();
  assert.equal(cachedAgain, clean, `a single-origin deploy still serves the cached body on ${runtime}`);

  /* ---- 2. WEBJS_NO_TRUST_PROXY is honored by the CSRF host too (#1104) ---- */

  // The legacy fallback branch: no `Sec-Fetch-Site` (an older browser), so
  // `verifyOrigin` compares `Origin` against the resolved request host. Behind
  // a trusted proxy the forwarded host is that host, so this passes.
  const legacy = { origin: 'https://app.example', 'x-forwarded-host': 'app.example', 'content-type': 'application/json' };
  const trusted = await fetch(base + endpoint, { method: 'POST', headers: legacy, body: '[]' });
  assert.notEqual(trusted.status, 403, `the forwarded host is trusted by default on ${runtime}`);

  // With the flag set, the same request resolves its host from the raw `Host`
  // (localhost:<port>), which no longer matches `Origin`, so it is refused.
  // Before #1104 this stayed 200: the flag was honored by the URL rewrite and
  // the HSTS gate but silently ignored here.
  process.env.WEBJS_NO_TRUST_PROXY = '1';
  const distrusted = await fetch(base + endpoint, { method: 'POST', headers: legacy, body: '[]' });
  assert.equal(distrusted.status, 403, `WEBJS_NO_TRUST_PROXY=1 reaches the CSRF host resolution on ${runtime}`);

  // The PRIMARY path is untouched by the flag: a modern browser sends
  // `Sec-Fetch-Site`, which never reaches the host resolution at all.
  const modern = await fetch(base + endpoint, {
    method: 'POST',
    headers: { ...legacy, 'sec-fetch-site': 'same-origin' },
    body: '[]',
  });
  assert.notEqual(modern.status, 403, `the Sec-Fetch-Site path is unchanged by the flag on ${runtime}`);
  delete process.env.WEBJS_NO_TRUST_PROXY;

  await close();
  close = null;
  console.log(`OK  forwarded trust passed on ${runtime} (cache not poisonable across origins, opt-out reaches CSRF)`);
} catch (e) {
  failure = e;
} finally {
  try { if (close) await close(); } catch {}
  if (prevFlag === undefined) delete process.env.WEBJS_NO_TRUST_PROXY;
  else process.env.WEBJS_NO_TRUST_PROXY = prevFlag;
  rmSync(dir, { recursive: true, force: true });
}

if (failure) {
  console.error(`FAIL forwarded trust on ${runtime}`);
  console.error(failure instanceof Error ? failure.stack || failure.message : String(failure));
  process.exit(1);
}
