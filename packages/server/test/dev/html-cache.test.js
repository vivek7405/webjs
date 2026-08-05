/**
 * Integration tests for issue #241: the server HTML response cache (ISR for
 * no-build). Exercised through createRequestHandler against minimal app
 * fixtures using Web-standard Request/Response, plus direct unit tests of the
 * html-cache helpers.
 *
 * Headline behaviours:
 *   - a page WITH `export const revalidate = N` is rendered once, then a
 *     second request within the window serves the CACHED HTML without
 *     re-running the page function (proven by a per-render counter baked into
 *     the HTML), and the cached body equals the fresh render.
 *   - a page WITHOUT `revalidate` is NEVER cached (re-renders each time).
 *   - revalidatePath(path) evicts so the next request re-renders.
 *   - a page that sets a per-user cookie (the cookies()/session contract,
 *     never set revalidate on such a page, and even if it did, a non-framework
 *     Set-Cookie blocks caching) is never cached.
 *   - a CSP-enabled page is not HTML-cached (its body varies per request).
 *
 * COUNTERFACTUAL: removing the cache LOOKUP (the readHtmlCache short-circuit in
 * ssrPage) makes "the page fn is not called twice" fail, because every request
 * would re-run the page and bump the counter. That is exactly the assertion in
 * the first test.
 *
 * The per-render counter survives across requests via globalThis (dev mode
 * cache-busts the module import per request, so a module-scope variable would
 * reset; globalThis does not). It is incremented INSIDE the page function, so
 * it counts page-function invocations, not module loads.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';
import { setStore, memoryStore, getStore } from '../../src/cache.js';
import {
  readRevalidate,
  htmlCacheKey,
  isCacheableResponse,
  revalidatePath,
  revalidateAll,
  writeHtmlCache,
  setAppSourceFingerprint,
} from '../../src/html-cache.js';
import { STREAM_MARKER } from '../../src/conditional-get.js';
import { setVendorEntries, publishBuildId, publishedBuildId, setBasePath } from '../../src/importmap.js';
import { applyForwarded } from '../../src/forwarded.js';
import { actionEndpoint } from '../../src/testing.js';
import { withRequest } from '../../src/context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(
  resolve(__dirname, '../../../core/src/html.js')
).toString();
// File URL of the server context module, so a page fixture can import the
// real `cookies()` helper (which marks the request dynamic, the #241 defense).
const CONTEXT_URL = pathToFileURL(
  resolve(__dirname, '../../src/context.js')
).toString();
// File URL of the auth module, so a page fixture can call the real `auth()`
// (whose readSession path marks the request dynamic, the #241 auth-path fix).
const AUTH_URL = pathToFileURL(
  resolve(__dirname, '../../src/auth.js')
).toString();
// File URL of the html-cache module, so an action fixture can import the REAL
// `revalidatePath` rather than a stand-in.
const HTML_CACHE_URL = pathToFileURL(
  resolve(__dirname, '../../src/html-cache.js')
).toString();

let tmpRoot;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-htmlcache-'));
});
after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

// A page that increments a globalThis counter on every page-function call and
// bakes the current count into the HTML, so a cache HIT (page fn NOT re-run)
// is observable as a stale count in the body. `counterKey` namespaces each
// test's counter so they do not interfere.
function counterPage(counterKey, { revalidate } = {}) {
  return (
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    (revalidate != null ? `export const revalidate = ${revalidate};\n` : '') +
    `export default function P() {\n` +
    `  const k = ${JSON.stringify(counterKey)};\n` +
    `  globalThis.__renders = globalThis.__renders || {};\n` +
    `  globalThis.__renders[k] = (globalThis.__renders[k] || 0) + 1;\n` +
    `  return html\`<h1>render #\${globalThis.__renders[k]}</h1>\`;\n` +
    `}\n`
  );
}

// A page that reads cookies() (the real framework helper, which marks the
// request dynamic) during render AND declares `revalidate`. This is the wrong
// combination the #241 dynamicAccess defense must catch: the page varies per
// user but opted into caching, so the framework must refuse to cache it.
function cookieReadingPage(counterKey, { revalidate } = {}) {
  return (
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import { cookies } from ${JSON.stringify(CONTEXT_URL)};\n` +
    (revalidate != null ? `export const revalidate = ${revalidate};\n` : '') +
    `export default function P() {\n` +
    `  const k = ${JSON.stringify(counterKey)};\n` +
    `  globalThis.__renders = globalThis.__renders || {};\n` +
    `  globalThis.__renders[k] = (globalThis.__renders[k] || 0) + 1;\n` +
    `  const who = cookies().get('uid') || 'anon';\n` +
    `  return html\`<h1>render #\${globalThis.__renders[k]} for \${who}</h1>\`;\n` +
    `}\n`
  );
}

// A page that calls auth() (the real createAuth current-user accessor, the
// primary per-user read in the saas scaffold) during render AND declares
// `revalidate`. The auth read reaches readSession() (auth.js), which marks the
// request dynamic, so the framework must refuse to cache the page even though
// it sets no new Set-Cookie. This is the residual auth-path leak the #241 fix
// closes. The page branches its body on the logged-in user.
function authReadingPage(counterKey, { revalidate } = {}) {
  return (
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import { createAuth, Credentials } from ${JSON.stringify(AUTH_URL)};\n` +
    `const { auth } = createAuth({\n` +
    `  secret: 'test-secret-test-secret',\n` +
    `  providers: [Credentials({ authorize: async () => null })],\n` +
    `});\n` +
    (revalidate != null ? `export const revalidate = ${revalidate};\n` : '') +
    `export default async function P() {\n` +
    `  const k = ${JSON.stringify(counterKey)};\n` +
    `  globalThis.__renders = globalThis.__renders || {};\n` +
    `  globalThis.__renders[k] = (globalThis.__renders[k] || 0) + 1;\n` +
    `  const session = await auth();\n` +
    `  const who = session?.user?.name || 'guest';\n` +
    `  return html\`<h1>render #\${globalThis.__renders[k]} for \${who}</h1>\`;\n` +
    `}\n`
  );
}

// A page that bakes `ctx.url.origin` into its output, the way a real page
// builds an og:image / canonical / OAuth callback URL. This is the shape the
// #1097 poisoning was observable through: the origin comes from the forwarded
// headers, so a hostile one ends up in a body the cache then SHARES.
function originPage({ revalidate } = {}) {
  return (
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    (revalidate != null ? `export const revalidate = ${revalidate};\n` : '') +
    `export default function P({ url }) {\n` +
    `  const origin = new URL(url).origin;\n` +
    `  return html\`<h1>og \${origin}/public/og.png</h1>\`;\n` +
    `}\n`
  );
}

// Build the Request a LISTENER SHELL hands `handle()`, i.e. with the
// forwarded-header URL correction already applied. `createRequestHandler` is
// deliberately not the seam that reads those headers (an embedded host owns
// its own adapter), so a test that fires a bare Request at `handle()` would
// never reproduce the attack. This mirrors `listener-bun.js`'s
// `forwardedRequest`, minus the remote-IP plumbing that is not under test.
function shellRequest(url, headers = {}) {
  const req = new Request(url, { headers });
  const parsed = new URL(req.url);
  const fwd = applyForwarded(parsed, req.headers);
  return fwd === parsed ? req : new Request(fwd, { headers: req.headers });
}

// Reset the shared default store between tests so cache state does not leak.
function freshStore() {
  setStore(memoryStore());
}

/* ---------------- opt-in: revalidate caches the HTML ---------------- */

test('a page WITH revalidate serves cached HTML without re-running the page fn', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': counterPage('opt-in', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  const first = await app.handle(new Request('http://x/'));
  assert.equal(first.status, 200);
  const firstBody = await first.text();
  assert.ok(firstBody.includes('render #1'), 'first request renders the page');

  const second = await app.handle(new Request('http://x/'));
  assert.equal(second.status, 200);
  const secondBody = await second.text();
  // The page fn was NOT called again, so the counter is still 1 (a fresh
  // render would show "render #2"). This is the headline + counterfactual.
  assert.ok(secondBody.includes('render #1'), 'second request serves the cached render (#1, not #2)');
  assert.equal(secondBody, firstBody, 'cached body is byte-identical to the fresh render');
  // The internal cache marker must never leak to the client on either path.
  assert.equal(first.headers.get('x-webjs-html-cache'), null, 'marker stripped on the warming response');
  assert.equal(second.headers.get('x-webjs-html-cache'), null, 'cache hit carries no internal marker');
});

/* ---------------- no opt-in: never cached ---------------- */

test('a page WITHOUT revalidate is never cached (re-renders each time)', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': counterPage('no-opt-in') });
  const app = await createRequestHandler({ appDir, dev: true });

  const first = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(first.includes('render #1'), 'first render');
  const second = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(second.includes('render #2'), 'second request re-runs the page (no caching without revalidate)');
});

/* ---------------- host poisoning (#1097) ---------------- */

test('a hostile X-Forwarded-Host cannot poison the cached HTML a clean visitor is served', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': originPage({ revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  // The attack: one request carrying a client-supplied forwarded host. Neither
  // Cloudflare nor Railway strips it, so it arrives THROUGH the proxy.
  const attack = await app.handle(
    shellRequest('http://real.example/', {
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    }),
  );
  assert.match(
    await attack.text(),
    /https:\/\/evil\.example\/public\/og\.png/,
    'the attacker still gets their own chosen origin back: that response is theirs, and is not what this fix is about',
  );

  // The victim: a later request carrying no forwarded headers at all.
  const clean = await (await app.handle(shellRequest('http://real.example/'))).text();
  assert.doesNotMatch(clean, /evil\.example/, 'the poisoned body is never served to a clean request');
  assert.match(clean, /http:\/\/real\.example\/public\/og\.png/, 'the clean request gets its own origin');
});

test('a single-host deploy still serves the cached body (the fix does not disable caching)', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': counterPage('single-host', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  await app.handle(shellRequest('http://real.example/'));
  const second = await (await app.handle(shellRequest('http://real.example/'))).text();
  assert.ok(second.includes('render #1'), 'the second request is a cache HIT: one origin, one key, unchanged hit rate');
});

test('WEBJS_NO_TRUST_PROXY=1 keeps the forwarded host out of the origin entirely', async () => {
  freshStore();
  const prev = process.env.WEBJS_NO_TRUST_PROXY;
  process.env.WEBJS_NO_TRUST_PROXY = '1';
  try {
    const appDir = makeApp({ 'app/page.js': originPage({ revalidate: 60 }) });
    const app = await createRequestHandler({ appDir, dev: true });

    const attack = await (
      await app.handle(
        shellRequest('http://real.example/', {
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'https',
        }),
      )
    ).text();
    assert.doesNotMatch(attack, /evil\.example/, 'the escape hatch still disables forwarded-header trust');
    assert.match(attack, /http:\/\/real\.example\/public\/og\.png/);
  } finally {
    if (prev === undefined) delete process.env.WEBJS_NO_TRUST_PROXY;
    else process.env.WEBJS_NO_TRUST_PROXY = prev;
  }
});

/* ---------------- on-demand revalidation ---------------- */

test('revalidatePath evicts the cached HTML so the next request re-renders', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': counterPage('evict', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  await app.handle(new Request('http://x/')); // render #1, cached
  const cached = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(cached.includes('render #1'), 'served from cache (#1)');

  // Bare-path eviction resolves the origin from the ambient request, which is
  // how a server action reaches it: the mutation runs inside the request of the
  // user who triggered it. Wrapped here to model that, since a naked call from
  // a test has no request to resolve against (#1097).
  await withRequest(new Request('http://x/'), () => revalidatePath('/'));

  const afterEvict = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(afterEvict.includes('render #2'), 'after revalidatePath the page re-renders (#2)');
});

test('revalidatePath still evicts once the key carries an origin (#1097)', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': counterPage('evict-origin', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  await app.handle(shellRequest('http://real.example/'));
  assert.ok(
    (await (await app.handle(shellRequest('http://real.example/'))).text()).includes('render #1'),
    'cached under the real origin',
  );

  // A bare path no longer names one key; it resolves against the ambient
  // request, the shape a server action always has.
  await withRequest(new Request('http://real.example/'), () => revalidatePath('/'));
  assert.ok(
    (await (await app.handle(shellRequest('http://real.example/'))).text()).includes('render #2'),
    'a bare path resolves the ambient origin and evicts',
  );

  // And the absolute form targets an origin exactly, which is the shape a
  // background job with no ambient request must use.
  assert.ok(
    (await (await app.handle(shellRequest('http://real.example/'))).text()).includes('render #2'),
    're-cached under the real origin',
  );
  await revalidatePath('http://real.example/');
  assert.ok(
    (await (await app.handle(shellRequest('http://real.example/'))).text()).includes('render #3'),
    'an absolute url evicts that origin exactly',
  );
});

test('a bare path with no ambient request evicts nothing and says so (#1097)', async () => {
  freshStore();
  // A path unique to this file. The warn-once set is module-global and nothing
  // resets it, so reusing '/' would make the "warned exactly once" assertion
  // depend on whether an earlier test in this file had already warned for it.
  const appDir = makeApp({ 'app/no-ambient/page.js': counterPage('no-ambient', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  await app.handle(shellRequest('http://real.example/no-ambient'));
  assert.ok(
    (await (await app.handle(shellRequest('http://real.example/no-ambient'))).text()).includes('render #1'),
    'cached',
  );

  // No ambient request (a cron job / queue worker). There is deliberately no
  // process-local origin registry to fall back on, because it would be
  // attacker-writable through X-Forwarded-Host, so this is a diagnosed no-op
  // rather than a silent one.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    await revalidatePath('/no-ambient');
    await revalidatePath('/no-ambient');
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warnings.length, 1, 'it warns once per path, not once per call');
  assert.match(warnings[0], /evicted nothing/, 'the warning says the eviction did not happen');
  assert.match(warnings[0], /absolute url/, 'and names the fix');
  assert.ok(
    (await (await app.handle(shellRequest('http://real.example/no-ambient'))).text()).includes('render #1'),
    'still cached, as the warning said',
  );

  // The absolute form is the documented remedy, and it works from here.
  await revalidatePath('http://real.example/no-ambient');
  assert.ok(
    (await (await app.handle(shellRequest('http://real.example/no-ambient'))).text()).includes('render #2'),
    'the absolute url evicts without any ambient request',
  );
});

test('a REAL action dispatch supplies the origin, so an existing bare revalidatePath keeps working (#1097)', async () => {
  freshStore();
  // The PR's central compatibility claim: every existing `revalidatePath('/x')`
  // inside a server action still works, because the action runs inside the
  // triggering request and the framework's ALS scope covers that execution.
  // Asserting it through `withRequest` only proves the helper, since the test
  // builds the scope itself. This drives the REAL RPC endpoint instead, so the
  // scope has to come from the request pipeline. If action dispatch ever stopped
  // running inside `withRequest`, this fails and the other tests would not.
  const appDir = makeApp({
    'app/page.js': counterPage('via-action', { revalidate: 60 }),
    'evict.server.js':
      `'use server';\n` +
      `import { revalidatePath } from ${JSON.stringify(HTML_CACHE_URL)};\n` +
      `export async function evict() {\n` +
      `  await revalidatePath('/');\n` +
      `  return { success: true };\n` +
      `}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });

  await app.handle(shellRequest('http://real.example/'));
  assert.ok(
    (await (await app.handle(shellRequest('http://real.example/'))).text()).includes('render #1'),
    'cached under the request origin',
  );

  const endpoint = await actionEndpoint(appDir, 'evict.server.js', 'evict');
  const res = await app.handle(new Request('http://real.example' + endpoint, {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: '[]',
  }));
  assert.equal(res.status, 200, 'the action ran');

  assert.ok(
    (await (await app.handle(shellRequest('http://real.example/'))).text()).includes('render #2'),
    'the bare path evicted: the action dispatch supplied the origin',
  );
});

test('revalidatePath strips the base path off an absolute url (#256 + #1097)', async () => {
  freshStore();
  // Cache entries key on the APP-ROOT-RELATIVE path: the write strips the base
  // path (dev.js) so a mounted app still hits its own cache. A caller with no
  // ambient request is told to pass an absolute url, and the absolute url is
  // the PUBLIC one, which carries the mount prefix. Without stripping it here
  // that caller computes a key nothing was ever stored under, so the one form
  // available to them would be the one that does not work.
  await setBasePath('/app');
  try {
    const key = htmlCacheKey(new URL('http://real.example/blog'));
    assert.notEqual(
      htmlCacheKey(new URL('http://real.example/app/blog')),
      key,
      'the premise: the public /app/blog url keys DIFFERENTLY from the stored /blog entry, which is why the strip has to happen',
    );
    // Store under the app-root-relative path, the way the write does.
    await writeHtmlCache(new URL('http://real.example/blog'), {
      body: '<h1>x</h1>', contentType: 'text/html', cacheControl: 'no-store', status: 200,
    }, 60);
    assert.ok(await getStore().get(key), 'stored under the stripped path');

    // The public absolute url a background job would naturally pass.
    await revalidatePath('http://real.example/app/blog');
    assert.equal(await getStore().get(key), null, 'the public url evicts the stripped-path entry');
  } finally {
    await setBasePath('');
  }
});

test('revalidateAll evicts every cached HTML entry', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': counterPage('evict-all', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  await app.handle(new Request('http://x/'));
  assert.ok((await (await app.handle(new Request('http://x/'))).text()).includes('render #1'), 'cached #1');

  revalidateAll();

  assert.ok(
    (await (await app.handle(new Request('http://x/'))).text()).includes('render #2'),
    'after revalidateAll the page re-renders (#2)'
  );
});

/* ---------------- search params key the cache separately ---------------- */

test('different searchParams are cached under separate keys', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': counterPage('sp', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  const a1 = await (await app.handle(new Request('http://x/?page=1'))).text();
  const b1 = await (await app.handle(new Request('http://x/?page=2'))).text();
  // Each URL renders once (counter increments per distinct key).
  assert.ok(a1.includes('render #1'), '?page=1 renders #1');
  assert.ok(b1.includes('render #2'), '?page=2 renders #2 (different key, fresh render)');
  // Re-requesting ?page=1 serves its own cached entry (#1), not #2.
  const a2 = await (await app.handle(new Request('http://x/?page=1'))).text();
  assert.ok(a2.includes('render #1'), '?page=1 still served from its own cache (#1)');
});

/* ---------------- per-user cookie page is never cached ---------------- */

test('a page that sets a non-framework Set-Cookie is never HTML-cached', async () => {
  freshStore();
  // A middleware that stamps a per-user session cookie on the response. Even
  // with revalidate set (which the author should NOT do), the non-framework
  // Set-Cookie blocks caching, so the page re-renders every request.
  const middleware =
    `export default async function (req, next) {\n` +
    `  const res = await next();\n` +
    `  res.headers.append('set-cookie', 'sid=abc; Path=/');\n` +
    `  return res;\n` +
    `};\n`;
  const appDir = makeApp({
    'app/page.js': counterPage('cookie', { revalidate: 60 }),
    'middleware.js': middleware,
  });
  const app = await createRequestHandler({ appDir, dev: true });

  const first = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(first.includes('render #1'), 'first render');
  const second = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(second.includes('render #2'), 'a per-user Set-Cookie response is never cached (re-renders #2)');
});

/* ---------------- CSP-enabled page is never cached ---------------- */

test('a CSP-enabled page is not HTML-cached (body varies per request)', async () => {
  freshStore();
  const appDir = makeApp({
    'app/page.js': counterPage('csp', { revalidate: 60 }),
    'package.json': JSON.stringify({ name: 'csp-app', webjs: { csp: true } }),
  });
  const app = await createRequestHandler({ appDir, dev: true });

  const first = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(first.includes('render #1'), 'first render');
  const second = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(second.includes('render #2'), 'CSP page re-renders each request (never cached)');
});

/* ---------------- a cached page carries no Set-Cookie (CDN-safe) ---------------- */

test('a cached page sets no cookie, so a cache hit is shareable', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': counterPage('csrf', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  // Warm the cache. SSR no longer issues a CSRF cookie (action CSRF is an
  // Origin / Sec-Fetch-Site check), so the response is cookieless.
  const warm = await app.handle(new Request('http://x/'));
  assert.ok(!warm.headers.get('set-cookie'), 'no Set-Cookie on the warm render');

  // A second visitor hits the cache and gets the same cookieless body, which
  // is exactly what makes the cached HTML safe to share at a CDN edge.
  const hit = await app.handle(new Request('http://x/'));
  const body = await hit.text();
  assert.ok(body.includes('render #1'), 'served from cache (#1)');
  assert.ok(!hit.headers.get('set-cookie'), 'cache hit is cookieless');
});

/* ---------------- X-Webjs-Have partial nav is never cached ---------------- */

test('a partial-nav (X-Webjs-Have) request bypasses the HTML cache', async () => {
  freshStore();
  const appDir = makeApp({ 'app/page.js': counterPage('have', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  // A partial-nav request carries a have-marker; its bytes depend on the
  // header, so it must neither read nor write the full-URL cache.
  const partial = await (await app.handle(
    new Request('http://x/', { headers: { 'x-webjs-have': '/' } })
  )).text();
  assert.ok(partial.includes('render #1'), 'partial render runs the page');
  // A subsequent FULL GET is a fresh render (the partial did not populate the
  // cache), so the counter advances.
  const full = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(full.includes('render #2'), 'full GET after a partial is a fresh render (partial did not cache)');
});

/* ---------------- direct unit tests of the helpers ---------------- */

test('readRevalidate reads a positive numeric export, rejects 0/negative/non-number', () => {
  assert.equal(readRevalidate({ revalidate: 60 }), 60);
  assert.equal(readRevalidate({ revalidate: 0 }), null, '0 means always-dynamic (no cache)');
  assert.equal(readRevalidate({ revalidate: -5 }), null);
  assert.equal(readRevalidate({ revalidate: Infinity }), null);
  assert.equal(readRevalidate({ revalidate: 'x' }), null);
  assert.equal(readRevalidate({}), null, 'no opt-in => no caching');
  assert.equal(readRevalidate(null), null);
});

test('htmlCacheKey normalizes query order and namespaces the key', () => {
  const a = htmlCacheKey(new URL('http://x/p?b=2&a=1'));
  const b = htmlCacheKey(new URL('http://x/p?a=1&b=2'));
  assert.equal(a, b, 'query order does not change the key');
  assert.ok(a.startsWith('webjs:html:'), 'namespaced');
  assert.notEqual(
    htmlCacheKey(new URL('http://x/p')),
    htmlCacheKey(new URL('http://x/p?a=1')),
    'a query variant is a distinct key'
  );
});

test('htmlCacheKey separates entries by origin (#1097)', () => {
  const real = htmlCacheKey(new URL('http://real.example/p'));
  assert.notEqual(
    real,
    htmlCacheKey(new URL('http://evil.example/p')),
    'a different host is a different key, so one host cannot serve another its body'
  );
  assert.notEqual(
    real,
    htmlCacheKey(new URL('https://real.example/p')),
    'the scheme is part of the origin, so http and https do not share an entry'
  );
  assert.notEqual(
    real,
    htmlCacheKey(new URL('http://real.example:8080/p')),
    'the port is part of the origin'
  );
  assert.equal(
    real,
    htmlCacheKey(new URL('http://real.example/p')),
    'the same origin is the same key, so a single-host deploy keeps one entry per URL'
  );
});

test('isCacheableResponse gates on status, streaming, CSP, and non-framework cookies', () => {
  const ok = new Response('<h1>x</h1>', { status: 200, headers: { 'content-type': 'text/html' } });
  assert.equal(isCacheableResponse(ok), true, 'a plain 200 html response is cacheable');

  assert.equal(
    isCacheableResponse(new Response('x', { status: 500 })),
    false,
    'non-200 is not cacheable'
  );

  const streamed = new Response('x', { status: 200, headers: { [STREAM_MARKER]: '1' } });
  assert.equal(isCacheableResponse(streamed), false, 'a streamed Suspense body is not cacheable');

  assert.equal(isCacheableResponse(ok, { cspEnabled: true }), false, 'CSP-on response is not cacheable');

  const sessionCookie = new Response('x', { status: 200 });
  sessionCookie.headers.append('set-cookie', 'sid=xyz; Path=/');
  assert.equal(isCacheableResponse(sessionCookie), false, 'any Set-Cookie blocks caching (per-user)');
});

/* ---------------- dynamicAccess defense: cookie-reading page (#241) ---------------- */

test('a page that reads cookies() AND sets revalidate is NOT cached (dynamicAccess defense)', async () => {
  freshStore();
  // This page reads cookies() during render (per-user output) but wrongly
  // declared `revalidate` and sets NO new Set-Cookie, so the Set-Cookie guard
  // alone would not catch it. The framework's dynamicAccess flag must, so the
  // page re-renders every request (never cached) and a logged-out visitor can
  // never be served a logged-in body.
  const appDir = makeApp({ 'app/page.js': cookieReadingPage('dyn', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    // A logged-in visitor (uid cookie) warms first. If this were cached, the
    // NEXT (logged-out) visitor would see "for alice".
    const first = await (await app.handle(
      new Request('http://x/', { headers: { cookie: 'uid=alice' } })
    )).text();
    assert.ok(first.includes('render #1 for alice'), 'first render reads the cookie');

    // A second, logged-OUT visitor: a fresh render (#2 for anon), proving the
    // logged-in body was never cached and never leaked.
    const second = await (await app.handle(new Request('http://x/'))).text();
    assert.ok(second.includes('render #2 for anon'), 'logged-out visitor gets a fresh render, not the cached logged-in body');
    assert.ok(!second.includes('alice'), 'the logged-in body never leaks to a logged-out visitor');
  } finally {
    console.warn = origWarn;
  }

  // The author is warned once, naming the offending path.
  assert.ok(
    warnings.some((w) => w.includes('/') && w.includes('revalidate') && w.toLowerCase().includes('per-user')),
    'a one-time warning names the per-user revalidate page'
  );
});

test('a page that calls auth() AND sets revalidate is NOT cached (auth-path dynamicAccess defense)', async () => {
  freshStore();
  // The page calls auth() during render (the saas-dashboard pattern). auth()
  // reaches readSession(), which now marks the request dynamic, so the page
  // must never be cached even though it sets no new Set-Cookie. Without the
  // fix the logged-in body would be cached and served to the next visitor.
  const appDir = makeApp({ 'app/page.js': authReadingPage('auth', { revalidate: 60 }) });
  const app = await createRequestHandler({ appDir, dev: true });

  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const first = await (await app.handle(new Request('http://x/'))).text();
    assert.ok(first.includes('render #1'), 'first render calls auth()');
    // A second request re-renders (#2), proving the auth-reading page was never
    // cached. If readSession did not mark dynamic, this would serve cached #1.
    const second = await (await app.handle(new Request('http://x/'))).text();
    assert.ok(second.includes('render #2'), 'an auth()-reading page re-renders each request (never cached)');
  } finally {
    console.warn = origWarn;
  }
});

/* ---------------- build-id key folding: a deploy invalidates (#241) ---------------- */

test('the cache key changes when the published build id changes (a deploy invalidates)', () => {
  const url = new URL('http://x/blog');
  const before = htmlCacheKey(url);
  assert.ok(before.includes(publishedBuildId() || 'nobuild'), 'the key embeds the published build id');

  // Simulate a deploy: a new importmap hash promoted to the published build id.
  return (async () => {
    try {
      await setVendorEntries({ 'deploy-marker-pkg': 'https://cdn.example/deploy-marker.js' });
      publishBuildId();
      const after = htmlCacheKey(url);
      assert.notEqual(after, before, 'a new published build id yields a different cache key');
      assert.ok(after.includes(publishedBuildId()), 'the new key embeds the new build id');
    } finally {
      // Restore the empty vendor map so other tests are unaffected.
      await setVendorEntries({});
      publishBuildId();
    }
  })();
});

/* ---------------- any Set-Cookie blocks caching (#241 / #659) ---------------- */

test('isCacheableResponse treats any Set-Cookie as per-user (non-cacheable)', () => {
  // SSR responses no longer carry a framework cookie (action CSRF is an
  // Origin / Sec-Fetch-Site check), so the guard is the simple presence of a
  // Set-Cookie: any cookie means per-user output, do not cache.
  const withCookie = new Response('x', { status: 200 });
  withCookie.headers.set('set-cookie', 'sid=xyz');
  assert.equal(isCacheableResponse(withCookie), false, 'any Set-Cookie is non-cacheable');

  const clean = new Response('x', { status: 200, headers: { 'content-type': 'text/html' } });
  assert.equal(isCacheableResponse(clean), true, 'a cookieless 200 is cacheable');
});

test('#318: the app-source fingerprint re-keys the HTML cache on an app-only change', () => {
  const url = new URL('http://x/blog');
  const HEX16 = /:[0-9a-f]{16}:/;
  try {
    setAppSourceFingerprint('');
    const empty = htmlCacheKey(url);
    assert.ok(!HEX16.test(empty), 'an empty fingerprint collapses to the prior key shape (byte-identical)');

    setAppSourceFingerprint('app/page.ts:aaaa\ncomponents/x.ts:bbbb');
    const v1 = htmlCacheKey(url);
    assert.ok(HEX16.test(v1), 'a non-empty fingerprint adds a digest segment to the key');
    assert.notEqual(v1, empty, 'the fingerprint changes the key');

    // A deploy that changes ONLY an app module's bytes (its content hash moves).
    setAppSourceFingerprint('app/page.ts:aaaa\ncomponents/x.ts:CHANGED');
    const v2 = htmlCacheKey(url);
    assert.notEqual(v2, v1, 'an app-source byte change re-keys (cache miss to a fresh render, no stale ?v body)');

    // A no-change redeploy reproduces the SAME fingerprint, so the key is stable
    // and a warm cache survives (the whole point: do not invalidate for nothing).
    setAppSourceFingerprint('app/page.ts:aaaa\ncomponents/x.ts:bbbb');
    assert.equal(htmlCacheKey(url), v1, 'the same app source produces the same key (no spurious invalidation)');
  } finally {
    setAppSourceFingerprint('');
  }
});

test('#318: an app-module byte change re-renders a cached revalidate page (prod, end to end)', async () => {
  // A prod handler caches a revalidate page, then a browser-bound component's
  // bytes change and rebuild() runs, so the app-source fingerprint moves, the
  // cache key moves, and the next request MISSES the stale entry and re-renders
  // with the new `?v` boot URLs instead of serving the baked-in old ones (#243
  // finding C). A per-render counter baked into the HTML proves the re-render.
  setStore(memoryStore());
  const key = 'cf318_render';
  const appDir = makeApp({
    'package.json': JSON.stringify({ name: 'fx', type: 'module' }),
    'app/layout.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default ({ children }) => html\`<main>\${children}</main>\`;\n`,
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `import './widget.js';\n` +
      `export const revalidate = 60;\n` +
      `export default function P() {\n` +
      `  const k = ${JSON.stringify(key)};\n` +
      `  globalThis.__renders = globalThis.__renders || {};\n` +
      `  globalThis.__renders[k] = (globalThis.__renders[k] || 0) + 1;\n` +
      `  return html\`<h1>render #\${globalThis.__renders[k]}</h1><x-w></x-w>\`;\n` +
      `}\n`,
    'app/widget.js':
      `import { WebComponent } from ${JSON.stringify(HTML_URL.replace('html.js', 'component.js'))};\n` +
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export class XW extends WebComponent { render() { return html\`<button @click=\${() => 1}>v1</button>\`; } }\n` +
      `XW.register('x-w');\n`,
  });
  try {
    delete globalThis.__renders;
    const app = await createRequestHandler({ appDir, dev: false });
    await app.warmup();

    const r1 = await (await app.handle(new Request('http://x/'))).text();
    assert.match(r1, /render #1/, 'first request renders');
    const r2 = await (await app.handle(new Request('http://x/'))).text();
    assert.match(r2, /render #1/, 'second request is a cache HIT (no re-render)');

    // Change the component's bytes (an app-only deploy), then rebuild.
    writeFileSync(
      join(appDir, 'app', 'widget.js'),
      `import { WebComponent } from ${JSON.stringify(HTML_URL.replace('html.js', 'component.js'))};\n` +
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export class XW extends WebComponent { render() { return html\`<button @click=\${() => 2}>v2-changed</button>\`; } }\n` +
      `XW.register('x-w');\n`,
    );
    await app.rebuild();

    const r3 = await (await app.handle(new Request('http://x/'))).text();
    assert.match(r3, /render #2/, 'after an app-module change the cache key moved, so the page RE-RENDERS (not the stale cached body)');
  } finally {
    delete globalThis.__renders;
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('#318: two deploys of IDENTICAL source at different paths produce the SAME key (no spurious invalidation)', async () => {
  // The location-independence property: the app-source fingerprint is a digest
  // of RELATIVIZED paths + content hashes, so two prod boots of byte-identical
  // source at different absolute tmpdirs (a redeploy to a fresh container)
  // compute the SAME cache key, and a Redis-backed warm cache survives the
  // redeploy instead of being spuriously invalidated. The fp is module-global,
  // so each key is captured right after its OWN warmup.
  const files = {
    'package.json': JSON.stringify({ name: 'fx', type: 'module' }),
    'app/layout.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default ({ children }) => html\`<main>\${children}</main>\`;\n`,
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `import './widget.js';\n` +
      `export const revalidate = 60;\n` +
      `export default () => html\`<x-w></x-w>\`;\n`,
    'app/widget.js':
      `import { WebComponent } from ${JSON.stringify(HTML_URL.replace('html.js', 'component.js'))};\n` +
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export class XW extends WebComponent { render() { return html\`<button @click=\${() => 1}>v1</button>\`; } }\n` +
      `XW.register('x-w');\n`,
  };
  const url = new URL('http://x/');
  const dirA = makeApp(files);
  const dirB = makeApp(files); // identical source, different tmpdir
  try {
    const a = await createRequestHandler({ appDir: dirA, dev: false });
    await a.warmup();
    const keyA = htmlCacheKey(url);

    const b = await createRequestHandler({ appDir: dirB, dev: false });
    await b.warmup();
    const keyB = htmlCacheKey(url);

    assert.match(keyA, /:[0-9a-f]{16}:/, 'the key carries an app-source fingerprint segment');
    assert.equal(keyB, keyA, 'identical source at different paths yields the SAME key (location-independent, no spurious invalidation)');
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});
