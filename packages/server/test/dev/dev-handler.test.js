/**
 * Integration tests for `createRequestHandler`: exercises the core
 * request → Response pipeline in packages/server/src/dev.js against a
 * minimal app fixture written to a tmpdir. Uses Web-standard Request/
 * Response so the tests don't need a real HTTP server.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler, startServer } from '../../src/dev.js';
import { publishedBuildId } from '../../src/importmap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(
  resolve(__dirname, '../../../core/src/html.js')
).toString();

let tmpRoot;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-dev-'));
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

/* ------------ health / reload / core serving ------------ */

test('handle: /__webjs/health returns 200 JSON', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/health'));
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await resp.json(), { status: 'ok' });
});

test('handle: /__webjs/ready is 503 until ensureReady completes, then 200', async () => {
  // Runtime-first boot makes /ready a REAL readiness gate: 503 while the lazy
  // analysis has not finished (so a k8s readinessProbe holds traffic off an
  // un-analysed instance), 200 once it has. The probe itself does not block on
  // the analysis; it kicks off the warm in the background and reports current state.
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });

  const pending = await app.handle(new Request('http://x/__webjs/ready'));
  assert.equal(pending.status, 503);
  assert.equal(pending.headers.get('cache-control'), 'no-store');
  assert.equal((await pending.json()).status, 'pending');

  await app.warmup(); // drives ensureReady to completion
  const ready = await app.handle(new Request('http://x/__webjs/ready'));
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ok' });
});

test('handle: a pinned app publishes a stable build id from the first response', async () => {
  // #146: a committed .webjs/vendor/importmap.json is deterministic, so dev.js
  // resolves it AT BOOT and publishes the build id immediately. The recommended
  // posture advertises a stable, non-empty X-Webjs-Build from its very first
  // response, with zero warmup window, so an old-deploy client navigating into
  // a freshly-deployed pinned instance hard-reloads correctly. Matches Rails
  // importmap (committed pins, deterministic at boot) and the pre-#143 behavior.
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    '.webjs/vendor/importmap.json': JSON.stringify({
      imports: { dayjs: 'https://ga.jspm.io/npm:dayjs@1.11.13/index.js' },
    }),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  // The boot pinned-read publishes the build id DURING createRequestHandler,
  // before any handle()/warmup(). Capture it now, off the same importmap module
  // instance the handler uses. This is the load-bearing assertion: if the boot
  // block were removed, publishedBuildId() here would NOT match the served id
  // (it would still be empty or a stale leaked value, and only the deferred
  // resolve inside the first handle() would later publish the real hash). So
  // asserting bootId equals the served id is what catches a reverted boot block,
  // whereas merely checking the first response is non-empty passes either way
  // (handle() awaits ensureReady, which publishes on the deferred path too).
  const bootId = publishedBuildId();
  assert.match(bootId, /^[0-9a-f]{64}\.c[\w.-]+$/, 'pinned app publishes a build id (importmap hash + core version, #899) at boot, before any request');
  // First page response: it advertises exactly the boot-published id.
  const first = await app.handle(new Request('http://x/'));
  const build1 = first.headers.get('x-webjs-build');
  assert.equal(build1, bootId, 'the first response advertises the boot-published id, not a first-request one');
  // Stable across responses within the process (no warmup drift).
  const second = await app.handle(new Request('http://x/'));
  assert.equal(second.headers.get('x-webjs-build'), build1, 'build id is stable across requests');
});

test('handle: a transient vendor failure does not block readiness', async () => {
  // Readiness gates on a fully warm instance (analysis plus the first vendor
  // attempt), but on the ATTEMPT completing, not succeeding: a transient jspm
  // failure (here a mocked network reject) is a completed attempt, so the app
  // still becomes READY and serves. An offline or CDN-degraded instance is
  // therefore not held down. The failed resolve is re-attempted on the next
  // request, not via a background timer.
  const appDir = makeApp({
    'package.json': JSON.stringify({ name: 'host', webjs: { elide: false } }),
    'node_modules/testpkg/package.json': JSON.stringify({ name: 'testpkg', version: '1.0.0', main: 'index.js' }),
    'node_modules/testpkg/index.js': 'export const x = 1;\n',
    'app/page.ts': `import 'testpkg';\nexport default () => 'ok';`,
  });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const app = await createRequestHandler({ appDir, dev: true });
    await app.warmup(); // analysis succeeds; the jspm fetch for testpkg fails
    const ready = await app.handle(new Request('http://x/__webjs/ready'));
    assert.equal(ready.status, 200, 'a transient vendor failure must not block readiness');
    assert.equal((await ready.json()).status, 'ok');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('handle: a malformed pin file falls through to the real deferred resolve', async () => {
  // Regression: hasVendorPin is a cheap existence check, but a malformed pin
  // (exists, unparseable) must NOT be treated as pinned-at-boot. If it were,
  // the boot read would short-circuit resolveVendorImports with the empty
  // boot-time scan thunk, resolve zero deps, set bootVendorPinned, and the real
  // deferred resolve (with the actual bare-import scan) would never run, serving
  // an importmap missing every dependency. With the fix, an invalid pin falls
  // through to the normal deferred resolve, which scans the real imports. We
  // detect that by spying on the jspm fetch: the broken path never reaches it.
  const appDir = makeApp({
    'package.json': JSON.stringify({ name: 'host', webjs: { elide: false } }),
    'node_modules/testpkg/package.json': JSON.stringify({ name: 'testpkg', version: '1.0.0', main: 'index.js' }),
    'node_modules/testpkg/index.js': 'export const x = 1;\n',
    'app/page.ts': `import 'testpkg';\nexport default () => 'ok';`,
    '.webjs/vendor/importmap.json': '{ not valid json at all',
  });
  const origFetch = globalThis.fetch;
  let jspmAttempted = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes('jspm')) jspmAttempted = true;
    throw new Error('ECONNREFUSED');
  };
  try {
    const app = await createRequestHandler({ appDir, dev: true });
    await app.warmup(); // runs the deferred analysis + first vendor attempt
    assert.ok(jspmAttempted,
      'a malformed pin must fall through to the real bare-import scan + jspm resolve, not short-circuit at boot with an empty map');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('handle: /__webjs/ready runs an optional readiness.{js,ts} check once warm', async () => {
  // An app can gate readiness on live dependency health (e.g. a DB ping) by
  // default-exporting an async check from readiness.js. Returning false or
  // throwing reports 503 unready even though the analysis is warm, so a
  // readinessProbe holds traffic off an instance whose deps are down.
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'readiness.js': `let n = 0; export default async () => (n++ > 0);`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  await app.warmup();

  // first probe: check returns false -> 503 unready
  const down = await app.handle(new Request('http://x/__webjs/ready'));
  assert.equal(down.status, 503);
  assert.equal((await down.json()).status, 'unready');

  // second probe: check returns true -> 200 ok (analysis was already warm)
  const up = await app.handle(new Request('http://x/__webjs/ready'));
  assert.equal(up.status, 200);
  assert.deepEqual(await up.json(), { status: 'ok' });
});


test('handle: /__webjs/reload.js in dev returns the client JS', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/reload.js'));
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.includes('EventSource'));
});

test('handle: /__webjs/reload.js in prod is 404', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: false });
  const resp = await app.handle(new Request('http://x/__webjs/reload.js'));
  assert.equal(resp.status, 404);
});

test('handle: /__webjs/core/* serves core source files', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/core/index.js'));
  assert.equal(resp.status, 200);
  assert.ok(resp.headers.get('content-type').includes('javascript'));
});

test('handle: /__webjs/core/* and reload.js serve BEFORE ensureReady (cold instance)', async () => {
  // #190: the core runtime bundle is on every page's boot path, so it must not
  // be gated behind the first-request vendor resolve (a cold instance stalled it
  // for up to ~30s while jspm resolved). Proven by serving it on a handler that
  // is never warmed and then checking readiness is STILL pending: serving the
  // asset did not run the whole-app analysis. On the pre-#190 ordering the core
  // branch sat after `await ensureReady()`, so this request would have flipped
  // readiness to ready here.
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true }); // no warmup()

  const core = await app.handle(new Request('http://x/__webjs/core/index.js'));
  assert.equal(core.status, 200, 'core asset serves on a cold handler');
  const reload = await app.handle(new Request('http://x/__webjs/reload.js'));
  assert.equal(reload.status, 200, 'reload client serves on a cold handler');

  // Neither request ran ensureReady, so readiness is still pending. (This probe
  // returns 503 from the synchronous not-ready check before its own background
  // warm kicks in.)
  const ready = await app.handle(new Request('http://x/__webjs/ready'));
  assert.equal(ready.status, 503, 'serving a static asset must not trigger ensureReady');
});

test('handle: /__webjs/core/ refuses path traversal → 403', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/core/../../etc/passwd'));
  // Either 403 (traversal detected) or 404 (normalised outside dir): both safe.
  assert.ok(resp.status === 403 || resp.status === 404, `expected 403/404, got ${resp.status}`);
});

test('handle: /__webjs/core/ refuses an encoded-slash sibling escape → 403', async () => {
  // `..%2f` survives URL normalization (the slash is encoded) and then decodes
  // to `../`, so a raw startsWith(coreDir) prefix check would admit a sibling
  // package like @webjsdev/core-evil. The trailing-separator boundary blocks it.
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/core/..%2fcore-evil/secret.js'));
  assert.equal(resp.status, 403, `expected 403, got ${resp.status}`);
});

/* ------------ vendor URLs: --download mode handler ------------ */
//
// In the default jspm.io mode, the importmap routes bare imports to
// https://ga.jspm.io/npm:<pkg>@<version>/... URLs and the browser
// fetches the bundle directly from jspm.io. The webjs server never
// sees those requests.
//
// In `webjs vendor pin --download` mode, the importmap routes to
// local `/__webjs/vendor/<filename>.js` paths and the server serves
// the downloaded bundle from `.webjs/vendor/<filename>.js`. The
// handler exists but returns 404 when the file isn't on disk.

test('handle: /__webjs/vendor/<file>.js returns 404 when no downloaded bundle exists', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/anything@1.0.0.js'));
  assert.equal(resp.status, 404);
  // Response body should hint at the resolution path.
  const body = await resp.text();
  assert.match(body, /webjs vendor pin --download/);
});

test('handle: /__webjs/vendor/<file>.js serves a real bundle when present on disk', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  mkdirSync(`${appDir}/.webjs/vendor`, { recursive: true });
  writeFileSync(`${appDir}/.webjs/vendor/fake@1.0.0.js`, 'export default 1;');
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/fake@1.0.0.js'));
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-type') || '', /javascript/);
  const body = await resp.text();
  assert.equal(body, 'export default 1;');
});

test('handle: /__webjs/vendor/ rejects path-traversal filenames', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/..%2F..%2Fetc%2Fpasswd.js'));
  // Either 400 (rejected by serveDownloadedBundle's safety check) or
  // 404 (URL parser normalised it away). Both are safe outcomes.
  assert.ok(resp.status === 400 || resp.status === 404, `expected 400 or 404, got ${resp.status}`);
});

test('handle: /__webjs/vendor/<file>.js rejects non-GET/HEAD/OPTIONS methods with 405', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  mkdirSync(`${appDir}/.webjs/vendor`, { recursive: true });
  writeFileSync(`${appDir}/.webjs/vendor/fake@1.0.0.js`, 'export default 1;');
  const app = await createRequestHandler({ appDir, dev: true });
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const resp = await app.handle(new Request('http://x/__webjs/vendor/fake@1.0.0.js', { method }));
    assert.equal(resp.status, 405, `${method} should return 405`);
    assert.equal(resp.headers.get('allow'), 'GET, HEAD, OPTIONS');
  }
});

test('handle: /__webjs/vendor/<file>.js OPTIONS preflight returns 204 with Allow header', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  mkdirSync(`${appDir}/.webjs/vendor`, { recursive: true });
  writeFileSync(`${appDir}/.webjs/vendor/fake@1.0.0.js`, 'export default 1;');
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/fake@1.0.0.js', { method: 'OPTIONS' }));
  assert.equal(resp.status, 204);
  assert.equal(resp.headers.get('allow'), 'GET, HEAD, OPTIONS');
});

test('handle: /__webjs/vendor/<file>.js HEAD returns same headers as GET, empty body', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  mkdirSync(`${appDir}/.webjs/vendor`, { recursive: true });
  writeFileSync(`${appDir}/.webjs/vendor/fake@1.0.0.js`, 'export default 1;');
  const app = await createRequestHandler({ appDir, dev: true });
  const head = await app.handle(new Request('http://x/__webjs/vendor/fake@1.0.0.js', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type') || '', /javascript/);
  const body = await head.text();
  assert.equal(body, '', 'HEAD body must be empty');
});

/* ------------ static files + TS compilation ------------ */

test('handle: /public/* serves static files with MIME', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'public/hello.txt': 'hello world',
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/public/hello.txt'));
  assert.equal(resp.status, 200);
  assert.ok(resp.headers.get('content-type').includes('text/plain'));
  assert.equal(await resp.text(), 'hello world');
});

test('handle: /favicon.ico is aliased to /public/favicon.ico', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'public/favicon.ico': 'X',
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/favicon.ico'));
  assert.equal(resp.status, 200);
  assert.ok(resp.headers.get('content-type').includes('image/x-icon'));
});

test('handle: .ts source served as JS with types stripped', async () => {
  const appDir = makeApp({
    'app/page.ts':
      `import { greet } from '../components/widget.ts';\n` +
      `export default () => greet('world');\n`,
    'components/widget.ts':
      `export const greet = (n: string): string => \`hi \${n}\`;\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/components/widget.ts'));
  assert.equal(resp.status, 200);
  const code = await resp.text();
  assert.ok(/greet/.test(code));
  // Type annotations should be gone.
  assert.ok(!/: string/.test(code));
});

test('handle: .ts source with non-erasable TS returns 500 pointing at the lint rule (DEV)', async () => {
  // webjs is buildless end-to-end. Node's stripTypeScriptTypes
  // rejects enum / namespace / parameter properties / legacy
  // decorators / import = require; there is no longer an esbuild
  // fallback. The dev server returns a clean 500 with the file path
  // and a pointer at the no-non-erasable-typescript lint rule.
  const appDir = makeApp({
    'app/page.ts':
      `import { initial } from '../components/advanced.ts';\n` +
      `export default () => initial;\n`,
    'components/advanced.ts': `
      enum Status { Active = 'active', Inactive = 'inactive' }
      export const initial: Status = Status.Active;
    `,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/components/advanced.ts'));
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.match(body, /non-erasable TypeScript/, 'body should explain the error');
  assert.match(body, /advanced\.ts/, 'body should name the offending file');
  assert.match(body, /no-non-erasable-typescript/, 'body should point at the lint rule');
  // #263: the error carries a stable, fetchable docs URL an agent can act on.
  assert.match(body, /https:\/\/webjs\.dev\/docs\/typescript/, 'body should anchor a docs URL');
});

test('handle: .ts source with non-erasable TS returns terse 500 in PROD (no filesystem path leak)', async () => {
  // Prod mode must NOT leak filesystem paths or Node's error message
  // (which can include source snippets) to the browser. Lint catches
  // non-erasable TS at edit time, so this only fires if someone
  // misconfigured tsconfig and shipped. Operators get full detail in
  // server logs (via console.error).
  const appDir = makeApp({
    'app/page.ts':
      `import { initial } from '../components/advanced.ts';\n` +
      `export default () => initial;\n`,
    'components/advanced.ts': `
      enum Status { Active = 'active' }
      export const initial: Status = Status.Active;
    `,
  });
  const app = await createRequestHandler({ appDir, dev: false });
  const resp = await app.handle(new Request('http://x/components/advanced.ts'));
  assert.equal(resp.status, 500);
  const body = await resp.text();
  // Filesystem path must NOT appear in the response.
  assert.ok(!body.includes(appDir),
    `prod response must not leak appDir; got: ${body}`);
  // Node's specific error text must NOT appear either (it can include source).
  assert.ok(!/enum is not supported/.test(body),
    `prod response must not leak Node's stripTypeScriptTypes error message; got: ${body}`);
  // But the response should still be helpful enough that the operator
  // knows where to look (server logs).
  assert.match(body, /Check server logs/i);
});

test('handle: /foo.js falls through to sibling foo.ts when .js is missing', async () => {
  const appDir = makeApp({
    'app/page.ts':
      // Import the sibling via `.js` to verify the gate covers both
      // the .js name (browser asks for) and the .ts file on disk.
      `import { greeting } from '../components/util.js';\n` +
      `export default () => greeting;\n`,
    'components/util.ts':
      `export const greeting = 'hello';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/components/util.js'));
  assert.equal(resp.status, 200);
  const code = await resp.text();
  // Node's stripTypeScriptTypes preserves the source verbatim aside
  // from type annotations; the identifier reaches the output unchanged.
  assert.ok(/greeting/.test(code), `missing greeting in ${code.slice(0, 200)}`);
  assert.ok(/["']hello["']/.test(code));
});

test('handle: prod responses on user source include ETag + max-age', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'public/hello.txt': 'hello',
  });
  const app = await createRequestHandler({ appDir, dev: false });
  const resp = await app.handle(new Request('http://x/public/hello.txt'));
  assert.equal(resp.status, 200);
  const etag = resp.headers.get('etag');
  // The ETag is WEAK (W/"..."): it is computed over the uncompressed body and
  // shared across content-codings, which a strong validator may not do
  // (RFC 7232 2.3.3). See conditional-get.js.
  assert.ok(etag && etag.startsWith('W/"'));
  assert.ok(/max-age/.test(resp.headers.get('cache-control')));
});

/* ------------ page + API routes ------------ */

test('handle: page route renders HTML', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<h1>home</h1>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.status, 200);
  assert.ok(resp.headers.get('content-type').includes('text/html'));
  const body = await resp.text();
  assert.ok(body.includes('<h1>home</h1>'));
});

test('handle: api route.js GET returns the handler response', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/api/ping/route.js':
      `export async function GET() { return Response.json({ pong: true }); }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/api/ping'));
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { pong: true });
});

test('handle: 404 for unknown path, HTML body', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/nope'));
  assert.equal(resp.status, 404);
  assert.ok(resp.headers.get('content-type').includes('text/html'));
});

test('handle: JSON-preferring requests to unknown path → JSON 404', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/does-not-exist', {
    headers: { accept: 'application/json' },
  }));
  assert.equal(resp.status, 404);
  const body = await resp.json();
  assert.equal(body.error, 'Not found');
});

test('handle: request to /__webjs/* path always prefers JSON 404', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  // Unknown __webjs path: not a vendor, not a core, not health…
  const resp = await app.handle(new Request('http://x/__webjs/no-such-thing'));
  assert.equal(resp.status, 404);
  assert.ok(resp.headers.get('content-type').includes('application/json'));
});

/* ------------ middleware ------------ */

test('handle: top-level middleware.js wraps all requests', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'middleware.js':
      `export default async function (req, next) {\n` +
      `  const resp = await next();\n` +
      `  const h = new Headers(resp.headers);\n` +
      `  h.set('x-mw', 'yes');\n` +
      `  return new Response(resp.body, { status: resp.status, headers: h });\n` +
      `}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.headers.get('x-mw'), 'yes');
});

test('handle: middleware that throws → 500', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'middleware.js':
      `export default async function () { throw new Error('mw-died'); }\n`,
  });
  const logs = [];
  const logger = { info: () => {}, warn: () => {}, error: (m, o) => logs.push({ m, o }) };
  const app = await createRequestHandler({ appDir, dev: true, logger });
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.status, 500);
  assert.ok(logs.some(l => /middleware/.test(l.m)), 'error was logged');
});

test('handle: broken middleware.js fails to load → logger.error, request continues', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'middleware.js': `this is not valid javascript !!!`,
  });
  const errors = [];
  const logger = { info: () => {}, warn: () => {}, error: (m, o) => errors.push({ m, o }) };
  const app = await createRequestHandler({ appDir, dev: true, logger });
  // Broken middleware: loadMiddleware catches and returns null → request runs straight.
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.status, 200);
  assert.ok(errors.some(l => /middleware/.test(l.m)));
});

/* ------------ routeFor / rebuild ------------ */

test('routeFor: returns module URLs for a known page', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/layout.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function L({ children }) { return html\`<main>\${children}</main>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const match = app.routeFor('/');
  assert.ok(match);
  assert.ok(match.moduleUrls.length >= 2, 'includes page + layout');
  for (const u of match.moduleUrls) assert.ok(u.startsWith('/'));
});

test('routeFor: unknown path returns null', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  assert.equal(app.routeFor('/nope'), null);
});

test('rebuild: re-scans routes so new pages appear without restart', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>home</p>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });

  // Initially /later is 404.
  let resp = await app.handle(new Request('http://x/later'));
  assert.equal(resp.status, 404);

  // Add a new page file and rebuild.
  mkdirSync(join(appDir, 'app/later'), { recursive: true });
  writeFileSync(join(appDir, 'app/later/page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default function P() { return html\`<p>later</p>\`; }\n`);

  let reloaded = false;
  await app.rebuild();
  reloaded = true;
  assert.equal(reloaded, true);

  resp = await app.handle(new Request('http://x/later'));
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.includes('<p>later</p>'));
});

test('createRequestHandler: onReload callback fires on rebuild()', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>x</p>\`; }\n`,
  });
  let reloads = 0;
  const app = await createRequestHandler({
    appDir,
    dev: true,
    onReload: () => { reloads++; },
  });
  await app.rebuild();
  await app.rebuild();
  assert.equal(reloads, 2);
});

test('handle: orphan component warning fires in dev', async () => {
  const warns = [];
  const logger = { info: () => {}, warn: (m) => warns.push(m), error: () => {} };
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>x</p>\`; }\n`,
    // A class extending WebComponent with no customElements.define()
    'components/orphan.ts':
      `import { WebComponent } from '@webjsdev/core';\n` +
      `export class Orphan extends WebComponent {}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true, logger });
  // Orphan detection runs in the lazy first-request analysis (boot does no
  // whole-app scan), so drive one request before asserting.
  await app.handle(new Request('http://x/'));
  assert.ok(
    warns.some(m => /Orphan/.test(m)),
    `expected orphan warning for class "Orphan"; got: ${warns.join('\n')}`,
  );
});

test('handle: the orphan warning covers BOTH shapes and names Class.register (#1308)', async () => {
  // `findOrphanComponents` reports two shapes: a class with no registration
  // call, and one whose registration tag is COMPUTED. The warning used to
  // describe only the first ("has no customElements.define(...) call"), so an
  // author with a computed tag was told they had not registered at all, and
  // was pointed at `customElements.define` rather than the idiomatic
  // `Class.register`. Nothing asserted this message, so it could regress
  // silently while the doctor and CLI siblings stayed correct.
  const warns = [];
  const logger = { info: () => {}, warn: (m) => warns.push(m), error: () => {} };
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>x</p>\`; }\n`,
    // Registered, but with a COMPUTED tag, so the scanner cannot see it.
    'components/dyn.ts':
      `import { WebComponent } from '@webjsdev/core';\n` +
      `const TAG = 'dyn-' + 'badge';\n` +
      `export class DynBadge extends WebComponent {}\n` +
      `DynBadge.register(TAG);\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true, logger });
  await app.handle(new Request('http://x/'));

  const warning = warns.find((m) => /DynBadge/.test(m));
  assert.ok(warning, `expected a warning for DynBadge; got: ${warns.join('\n')}`);
  assert.match(warning, /never registered with a literal tag/,
    'must not claim there is no registration call, since there is one');
  assert.match(warning, /its tag is computed/, 'must name the computed-tag shape');
  assert.match(warning, /DynBadge\.register\(/, 'must point at Class.register, the idiomatic form');
  assert.doesNotMatch(warning, /Add `customElements\.define/,
    'the fix line should lead with Class.register, not the native API');
});

/* ------------ metadata routes (sitemap.xml / robots.txt) ------------ */

test('handle: metadata route returns string body with inferred content-type', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/sitemap.js':
      `export default function sitemap() {\n` +
      `  return '<?xml version="1.0"?><urlset></urlset>';\n` +
      `}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/sitemap.xml'));
  assert.equal(resp.status, 200);
  assert.ok(resp.headers.get('content-type').includes('application/xml'));
  assert.ok((await resp.text()).includes('<urlset>'));
});

test('handle: metadata route can return a Response directly', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/robots.js':
      `export default function robots() {\n` +
      `  return new Response('User-agent: *\\nDisallow:', {\n` +
      `    headers: { 'content-type': 'text/plain; charset=utf-8' },\n` +
      `  });\n` +
      `}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/robots.txt'));
  assert.equal(resp.status, 200);
  assert.ok((await resp.text()).includes('User-agent: *'));
});

test('handle: metadata route string body infers text/plain for .txt', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/robots.js':
      `export default function robots() {\n` +
      `  return 'User-agent: *\\nAllow: /';\n` +
      `}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/robots.txt'));
  assert.equal(resp.status, 200);
  assert.ok(resp.headers.get('content-type').includes('text/plain'));
  assert.ok((await resp.text()).startsWith('User-agent: *'));
});

test('handle: metadata route object body is JSON-serialised with application/json', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/manifest.js':
      `export default function manifest() {\n` +
      `  return { name: 'Demo', short_name: 'Demo', start_url: '/' };\n` +
      `}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/manifest.json'));
  assert.equal(resp.status, 200);
  assert.ok(resp.headers.get('content-type').includes('application/json'));
  assert.deepEqual(await resp.json(), { name: 'Demo', short_name: 'Demo', start_url: '/' });
});

test('handle: metadata route that throws → 500', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/sitemap.js':
      `export default function sitemap() { throw new Error('broken'); }\n`,
  });
  const prevErr = console.error;
  console.error = () => {};
  try {
    const app = await createRequestHandler({ appDir, dev: true });
    const resp = await app.handle(new Request('http://x/sitemap.xml'));
    assert.equal(resp.status, 500);
  } finally {
    console.error = prevErr;
  }
});

/* ------------ percent-encoded dynamic segments ------------ */

/* ------------ segment middleware + action RPC + route() REST ------------ */

test('handle: segment middleware.js wraps matching routes', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>root</p>\`; }\n`,
    'app/admin/middleware.js':
      `export default async function (req, next) {\n` +
      `  const r = await next();\n` +
      `  const h = new Headers(r.headers); h.set('x-admin-mw', '1');\n` +
      `  return new Response(r.body, { status: r.status, headers: h });\n` +
      `}\n`,
    'app/admin/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function A() { return html\`<p>admin</p>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/admin'));
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('x-admin-mw'), '1');
});

test('handle: broken segment middleware is skipped without crashing', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>root</p>\`; }\n`,
    'app/admin/middleware.js': `this is not valid javascript !!!`,
    'app/admin/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function A() { return html\`<p>admin</p>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/admin'));
  assert.equal(resp.status, 200);
});

test('handle: POST to /__webjs/action/<hash>/<fn> invokes the action', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      // Import pulls actions.server.js into the browser-bound graph so
      // the RPC stub is reachable. Client code normally writes this
      // import to call the action.
      `import { double } from '../modules/math/actions.server.js';\n` +
      `export default function P() { return html\`<p>\${double}</p>\`; }\n`,
    'modules/math/actions.server.js':
      `'use server';\n` +
      `export async function double(n) { return n * 2; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });

  // Find the generated hash via the RPC stub.
  const stub = await (await app.handle(new Request('http://x/modules/math/actions.server.js'))).text();
  const hashMatch = /\/__webjs\/action\/([a-f0-9]+)\//.exec(stub);
  assert.ok(hashMatch, `stub should reference action URL, got: ${stub.slice(0, 400)}`);
  const hash = hashMatch[1];

  const rpcUrl = `http://x/__webjs/action/${hash}/double`;

  // GET → 405
  const wrong = await app.handle(new Request(rpcUrl));
  assert.equal(wrong.status, 405);

  // POST with serialized args (webjs wire format). Action CSRF is an Origin /
  // Sec-Fetch-Site check (#659), so a same-origin POST needs only that header.
  // The serializer's tagged-inline format is plain JSON for primitive args:
  // an array of values that double() will receive as positional args.
  const resp = await app.handle(new Request(rpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/vnd.webjs+json',
      'sec-fetch-site': 'same-origin',
    },
    body: JSON.stringify([21]),
  }));
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body, 42);
});

test('handle: a server action exposed over REST via a route.ts route() adapter', async () => {
  // REST endpoints go through route.ts (#488); the route() adapter wraps a
  // plain 'use server' action as a route handler so curl / another service can
  // reach the same function the RPC stub calls.
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'modules/api/hello.server.js':
      `'use server';\n` +
      `export async function hello() { return { ok: true }; }\n`,
  });
  // The route.js imports the action by its absolute path (known only after
  // makeApp creates the temp dir) and the server's index.js for route().
  const serverIndexUrl = pathToFileURL(resolve(__dirname, '../../index.js')).toString();
  const actionUrl = pathToFileURL(join(appDir, 'modules/api/hello.server.js')).toString();
  const routeAbs = join(appDir, 'app/api/hello/route.js');
  mkdirSync(dirname(routeAbs), { recursive: true });
  writeFileSync(routeAbs,
    `import { route } from ${JSON.stringify(serverIndexUrl)};\n` +
    `import { hello } from ${JSON.stringify(actionUrl)};\n` +
    `export const GET = route(hello);\n`);
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/api/hello'));
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { ok: true });
});

test('handle: cross-origin POST /__webjs/action → 403', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `import { noop } from '../modules/x/actions.server.js';\n` +
      `export default function P() { return html\`<p>\${noop}</p>\`; }\n`,
    'modules/x/actions.server.js':
      `'use server';\n` +
      `export async function noop() { return 1; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const stub = await (await app.handle(new Request('http://x/modules/x/actions.server.js'))).text();
  const hash = /\/__webjs\/action\/([a-f0-9]+)\//.exec(stub)[1];
  // A cross-site request (Sec-Fetch-Site) is rejected by the Origin CSRF check.
  const resp = await app.handle(new Request(`http://x/__webjs/action/${hash}/noop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    body: '{}',
  }));
  assert.equal(resp.status, 403);
});

/* ------------ tsResponse cache path ------------ */

test('handle: TS source responses share an mtime-keyed cache (second req is fast)', async () => {
  const appDir = makeApp({
    'app/page.ts':
      `import { flag } from '../components/cached.ts';\n` +
      `export default () => flag;\n`,
    'components/cached.ts': `export const flag = true;\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });

  const first = await app.handle(new Request('http://x/components/cached.ts'));
  assert.equal(first.status, 200);
  const body1 = await first.text();

  // Second request exercises the mtime-cache hit path.
  const second = await app.handle(new Request('http://x/components/cached.ts'));
  assert.equal(second.status, 200);
  const body2 = await second.text();
  assert.equal(body2, body1);
});

/* ------------ prod bundle serving ------------ */

/* ------------ startServer: real HTTP server (toWebRequest / sendWebResponse) ------------ */

test('startServer: boots on an ephemeral port and serves a page', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<h1>served</h1>\`; }\n`,
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: false, port: 0, logger, compress: false });
  try {
    const addr = server.address();
    const url = `http://127.0.0.1:${addr.port}/`;
    const resp = await fetch(url);
    assert.equal(resp.status, 200);
    assert.ok(resp.headers.get('content-type').includes('text/html'));
    const body = await resp.text();
    assert.ok(body.includes('<h1>served</h1>'));
  } finally {
    await close();
  }
});

test('startServer: prod gzip-compressed response with Accept-Encoding: gzip', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>${'x'.repeat(2000)}</p>\`; }\n`,
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: false, port: 0, logger, compress: true });
  try {
    const addr = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/`, {
      headers: { 'accept-encoding': 'gzip' },
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-encoding'), 'gzip');
    assert.equal(resp.headers.get('vary'), 'Accept-Encoding');
  } finally {
    await close();
  }
});

test('startServer: brotli wins over gzip when both are offered', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>${'y'.repeat(2000)}</p>\`; }\n`,
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: false, port: 0, logger, compress: true });
  try {
    const addr = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/`, {
      headers: { 'accept-encoding': 'br, gzip' },
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-encoding'), 'br');
  } finally {
    await close();
  }
});

test('startServer: POST with JSON body round-trips through toWebRequest', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/api/echo/route.js':
      `export async function POST(req) {\n` +
      `  const body = await req.json();\n` +
      `  return Response.json({ got: body });\n` +
      `}\n`,
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: false, port: 0, logger, compress: false });
  try {
    const addr = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/api/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    assert.equal(resp.status, 200);
    assert.deepEqual(await resp.json(), { got: { hello: 'world' } });
  } finally {
    await close();
  }
});

test('startServer: dev SSE endpoint /__webjs/events accepts the connection', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: true, port: 0, logger, compress: false });
  try {
    const addr = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/__webjs/events`, {
      headers: { accept: 'text/event-stream' },
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'text/event-stream');
    // Close the reader ourselves (the server keeps the connection open).
    await resp.body.cancel();
  } finally {
    await close();
  }
});

test('startServer: prod /__webjs/events → 404', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: false, port: 0, logger, compress: false });
  try {
    const addr = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/__webjs/events`);
    assert.equal(resp.status, 404);
  } finally {
    await close();
  }
});

/* ------------ isCompressible / getSetCookie preservation ------------ */

test('startServer: non-text content-type is NOT compressed even with gzip offered', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'public/logo.png': Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),  // PNG header
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: false, port: 0, logger, compress: true });
  try {
    const addr = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/public/logo.png`, {
      headers: { 'accept-encoding': 'gzip' },
    });
    assert.equal(resp.status, 200);
    // PNG = image/png; NOT compressible.
    assert.equal(resp.headers.get('content-encoding'), null);
  } finally {
    await close();
  }
});

test('startServer: multiple set-cookie headers are preserved through getSetCookie()', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/api/multi/route.js':
      `export async function GET() {\n` +
      `  const h = new Headers({ 'content-type': 'text/plain' });\n` +
      `  h.append('set-cookie', 'a=1; Path=/');\n` +
      `  h.append('set-cookie', 'b=2; Path=/');\n` +
      `  return new Response('ok', { headers: h });\n` +
      `}\n`,
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: false, port: 0, logger, compress: false });
  try {
    const addr = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/api/multi`);
    assert.equal(resp.status, 200);
    // Node's fetch concatenates set-cookie with ", ": getSetCookie() splits back.
    const cookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
    if (cookies.length) {
      assert.equal(cookies.length, 2);
      assert.ok(cookies.some(c => c.startsWith('a=1')));
      assert.ok(cookies.some(c => c.startsWith('b=2')));
    }
  } finally {
    await close();
  }
});

/* ------------ misc: rebuild orphan warning, metadata without default ------------ */

test('rebuild: orphan warning fires when rebuilding after a new orphan is added', async () => {
  const warns = [];
  const logger = { info: () => {}, warn: (m) => warns.push(m), error: () => {} };
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>x</p>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true, logger });
  const before = warns.length;
  mkdirSync(join(appDir, 'components'), { recursive: true });
  writeFileSync(join(appDir, 'components/late-orphan.ts'),
    `import { WebComponent } from '@webjsdev/core';\n` +
    `export class LateOrphan extends WebComponent {}\n`);
  await app.rebuild();
  // Rebuild invalidates the lazy analysis; the orphan re-scan runs on the next
  // request, so drive one before asserting.
  await app.handle(new Request('http://x/'));
  assert.ok(warns.slice(before).some(m => /LateOrphan/.test(m)),
    `expected LateOrphan warning after rebuild; got: ${warns.join('\n')}`);
});

test('handle: metadata file with no default export → falls through to 404', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    // sitemap.js with NO default export: the handler should skip and fall through.
    'app/sitemap.js': `export const pages = [];\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/sitemap.xml'));
  // No default export → handler falls through to the normal 404 path (HTML).
  assert.equal(resp.status, 404);
});

test('handle: fileResponse 404 for a deleted file inside /public', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'public/real.txt': 'hi',
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/public/gone.txt'));
  assert.equal(resp.status, 404);
});

test('handle: percent-encoded pathname is decoded before matching', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/posts/[slug]/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P({ params }) { return html\`<p>slug:\${params.slug}</p>\`; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  // browsers percent-encode "[" as %5B, "]" as %5D; we don't hit those here
  // but we exercise the general decodeURIComponent path with a safe slug.
  const resp = await app.handle(new Request('http://x/posts/hello%20world'));
  assert.equal(resp.status, 200);
  assert.ok((await resp.text()).includes('slug:hello world'));
});


test('handle: /__webjs/vendor/ round-trips raw bytes byte-for-byte (no UTF-8 decode/re-encode)', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  mkdirSync(`${appDir}/.webjs/vendor`, { recursive: true });
  // Construct a Buffer mixing valid ASCII JS, a comment with raw
  // non-UTF-8 bytes (lone 0xC3 followed by ASCII would be invalid
  // UTF-8 and survive utf8 decode only via U+FFFD replacement),
  // and trailing valid JS. The exact bytes must round-trip end-to-
  // end for the browser's SRI check to pass.
  const orig = Buffer.concat([
    Buffer.from('/* '),
    Buffer.from([0xC3, 0x28, 0xA0, 0xFF]),
    Buffer.from(' */ export default 1;'),
  ]);
  writeFileSync(`${appDir}/.webjs/vendor/binary@1.0.0.js`, orig);
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/binary@1.0.0.js'));
  assert.equal(resp.status, 200);
  const served = Buffer.from(await resp.arrayBuffer());
  assert.equal(served.length, orig.length, 'served length must match on-disk length exactly');
  assert.ok(served.equals(orig), 'served bytes must be byte-identical to on-disk bytes');
});

test('handle: /__webjs/vendor/ serves filenames with semver build-metadata "+" character', async () => {
  // serveDownloadedBundle's filename allowlist must include `+` so
  // packages with build-metadata versions like `1.0.0+build.42`
  // (legal per semver) can be served. Previously the regex was
  // /^[A-Za-z0-9@._-]+\.js$/ which rejected `+` and bundles with
  // such versions wrote to disk fine but 400'd on serve.
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  mkdirSync(`${appDir}/.webjs/vendor`, { recursive: true });
  writeFileSync(`${appDir}/.webjs/vendor/foo@1.0.0+build.42.js`, 'export default 1;');
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/foo@1.0.0+build.42.js'));
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-type') || '', /javascript/);
  const body = await resp.text();
  assert.equal(body, 'export default 1;');
});

test('handle: /__webjs/vendor/ sets ETag for downstream cache revalidation', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  mkdirSync(`${appDir}/.webjs/vendor`, { recursive: true });
  writeFileSync(`${appDir}/.webjs/vendor/fake@1.0.0.js`, 'export default 1;');
  const app = await createRequestHandler({ appDir, dev: false });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/fake@1.0.0.js'));
  const etag = resp.headers.get('etag');
  assert.ok(etag, 'etag header must be present');
  // WEAK validator (W/"..."): the bundle is compressible, so the same ETag
  // can ride identity / gzip / br, which a strong validator may not do
  // (RFC 7232 2.3.3). See conditional-get.js.
  assert.match(etag, /^W\/"[0-9a-f]{16}"$/, 'etag is a weak 16-char hex string in quotes');
  // Same content must produce the same ETag (deterministic).
  const resp2 = await app.handle(new Request('http://x/__webjs/vendor/fake@1.0.0.js'));
  assert.equal(resp2.headers.get('etag'), etag);
});

test('createRequestHandler: auto-loads <appDir>/.env into process.env', async () => {
  // Scaffolded apps ship .env.example. A user who copies it to .env
  // and runs `npm run dev` expects the framework to read it without
  // any extra import (Rails / Next / Astro all do this). Without
  // this, `lib/auth.server.ts` calling `createAuth({ secret:
  // process.env.AUTH_SECRET })` at module init fails to boot the
  // SaaS scaffold. See tracker #37.
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    '.env': 'WEBJS_TEST_ENV_FOO=loaded-from-env-file\n',
  });
  // Pre-condition: var must not already be in process.env.
  delete process.env.WEBJS_TEST_ENV_FOO;
  try {
    await createRequestHandler({ appDir, dev: false });
    assert.equal(
      process.env.WEBJS_TEST_ENV_FOO, 'loaded-from-env-file',
      '.env file in appDir should auto-load into process.env',
    );
  } finally {
    delete process.env.WEBJS_TEST_ENV_FOO;
  }
});

test('createRequestHandler: shell-set env var wins over .env (does not override)', async () => {
  // Standard dotenv precedence: shell / process-manager / parent
  // process beats the file. Allows production deploys to override
  // any value without editing the .env file.
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    '.env': 'WEBJS_TEST_ENV_PRECEDENCE=from-file\n',
  });
  process.env.WEBJS_TEST_ENV_PRECEDENCE = 'from-shell';
  try {
    await createRequestHandler({ appDir, dev: false });
    assert.equal(
      process.env.WEBJS_TEST_ENV_PRECEDENCE, 'from-shell',
      'pre-set process.env value must win over .env file content',
    );
  } finally {
    delete process.env.WEBJS_TEST_ENV_PRECEDENCE;
  }
});

test('createRequestHandler: missing .env file is silent (no error, server boots)', async () => {
  // The common case: dev project with no .env, no shell-set vars.
  // The boot path must NOT throw or log an error.
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  // No .env file created. createRequestHandler should still return
  // a working handler.
  const app = await createRequestHandler({ appDir, dev: false });
  assert.equal(typeof app.handle, 'function', 'handle() must exist even without a .env file');
});

/* ------------ dev mode: fs.watch drives SSE reload ------------ */

test('startServer dev=true: fs.watch fires reload event on file change', async () => {
  // End-to-end test for the chokidar → fs.watch migration. Boots the
  // dev server, opens an SSE stream to /__webjs/events, edits a file
  // inside the appDir, and asserts that a reload event reaches the
  // client. fs.watch should pick up the change and the debounced
  // rebuild() should push a reload frame.
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>v1</p>\`; }\n`,
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: true, port: 0, logger, compress: false });
  try {
    const addr = server.address();
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const ac = new AbortController();
    const resp = await fetch(`${baseUrl}/__webjs/events`, {
      headers: { accept: 'text/event-stream' },
      signal: ac.signal,
    });
    assert.equal(resp.status, 200);
    assert.ok(resp.headers.get('content-type').includes('text/event-stream'));
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const sawReload = (async () => {
      const deadline = Date.now() + 5_000;
      let buf = '';
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) return false;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes('event: reload')) return true;
      }
      return false;
    })();
    // Trigger a change after a tick so the SSE response head is flushed.
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(
      join(appDir, 'app/page.js'),
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>v2</p>\`; }\n`,
    );
    const ok = await sawReload;
    ac.abort();
    assert.equal(ok, true, 'fs.watch should drive an SSE reload event within 5s of a file write');
  } finally {
    await close();
  }
});

test('startServer dev=true: writing a webjs.dev.regenerate OUTPUT does NOT reload; a source edit DOES (#967)', async () => {
  // The server writes public/tailwind.css itself when regenerating on request.
  // The dev watcher must ignore that write, else it reloads the page mid-nav
  // (this exact case broke the blog soft-nav streaming e2e). A real source edit
  // must still reload.
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>v1</p>\`; }\n`,
    'public/tailwind.css': '/* built */',
    'package.json': JSON.stringify({
      name: 'regen-watch',
      webjs: { dev: { regenerate: [{ output: 'public/tailwind.css', command: 'true', inputs: ['app'] }] } },
    }),
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const ac = new AbortController();
  const { server, close } = await startServer({ appDir, dev: true, port: 0, logger, compress: false });
  try {
    const addr = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/__webjs/events`, {
      headers: { accept: 'text/event-stream' },
      signal: ac.signal,
    });
    // ONE continuous reader appends into a shared buffer; phases just wait and
    // inspect the reload count (never call read() concurrently).
    let buf = '';
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
        }
      } catch { /* aborted */ }
    })();
    const reloadCount = () => (buf.match(/event: reload/g) || []).length;
    await new Promise((r) => setTimeout(r, 50));
    // Write the regenerate OUTPUT: must NOT trigger a reload.
    writeFileSync(join(appDir, 'public/tailwind.css'), '/* regenerated */');
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(reloadCount(), 0, 'writing a regenerate output must not reload');
    // Now edit a real source file: MUST reload.
    writeFileSync(
      join(appDir, 'app/page.js'),
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>v2</p>\`; }\n`,
    );
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && reloadCount() < 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(reloadCount() >= 1, 'a real source edit must still reload');
  } finally {
    ac.abort();
    await close();
  }
});

test('fileResponse prod: ETag is a WEAK 16-char SHA-1 hex digest in quotes', async () => {
  // Regression coverage for the createHash → crypto.subtle.digest
  // migration. The Web Crypto path must produce a 16-character hex slice in
  // double quotes, now carried as a WEAK validator (W/"...") so the same hash
  // can ride identity / gzip / br codings (RFC 7232 2.3.3); see
  // conditional-get.js. (Browser/proxy ETag matching is byte-exact, so any
  // shape drift would break revalidation.)
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'public/static.txt': 'fixed body for etag check',
  });
  const app = await createRequestHandler({ appDir, dev: false });
  const resp = await app.handle(new Request('http://x/public/static.txt'));
  assert.equal(resp.status, 200);
  const etag = resp.headers.get('etag');
  assert.match(etag, /^W\/"[0-9a-f]{16}"$/,
    `ETag must be a weak 16-char hex slice in quotes; got ${etag}`);
  // Second request must produce identical ETag (stable hash).
  const resp2 = await app.handle(new Request('http://x/public/static.txt'));
  assert.equal(resp2.headers.get('etag'), etag, 'ETag must be stable across requests');
});

test('startServer dev=true: fs.watch does NOT fire reload for db/dev.db writes', async () => {
  // Regression coverage for the IGNORE-regex bug surfaced during
  // PR #110 review: the chokidar substring-style ignore on
  // /db\/(dev\.db|migrations)/ caught `db/dev.db`, but the
  // first cut of the fs.watch replacement required a trailing
  // separator and missed the SQLite sidecar file, causing a
  // rebuild loop on every db:migrate.
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>v1</p>\`; }\n`,
    'db/dev.db': 'placeholder',
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: true, port: 0, logger, compress: false });
  try {
    const addr = server.address();
    const ac = new AbortController();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/__webjs/events`, {
      headers: { accept: 'text/event-stream' },
      signal: ac.signal,
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    // Drain the head of the SSE stream so we know the connection is open.
    await reader.read();
    // Touch db/dev.db plus the journal sidecar. Both are written
    // during db:migrate and must NOT trigger a reload.
    writeFileSync(join(appDir, 'db/dev.db'), 'updated');
    writeFileSync(join(appDir, 'db/dev.db-journal'), 'wal');
    // Wait longer than the 80ms debounce window so any rebuild would
    // have fired by now.
    await new Promise((r) => setTimeout(r, 250));
    // Non-blocking read: collect whatever's been buffered.
    const racer = new Promise((r) => setTimeout(() => r({ done: true, value: null }), 50));
    const { value } = await Promise.race([reader.read(), racer]);
    if (value) buf += decoder.decode(value, { stream: true });
    ac.abort();
    assert.ok(!buf.includes('event: reload'),
      `db/dev.db writes must NOT fire a reload; got SSE buffer: ${JSON.stringify(buf)}`);
  } finally {
    await close();
  }
});

/* ------------ asset-serving gate: only graph-reachable files are servable ------------ */

test('gate: file under an allowed dir but NOT imported by any entry → 404', async () => {
  // Mirrors Next.js's bundler-manifest model: only files reachable from
  // a page / layout / etc. entry through the static import graph are
  // servable. A dangling file at a conventional path is unreachable.
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'components/dangling.ts': `export const x = 1;\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/components/dangling.ts'));
  assert.equal(resp.status, 404,
    'an unimported file at a conventional path must NOT be servable');
});

test('gate: /package.json at app root → 404', async () => {
  // The top-level package.json is never imported by a page entry, so it
  // never enters the graph. Pre-PR, the catch-all source branch served
  // it (and exposed scripts / dep list to anyone fetching the URL).
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'package.json': JSON.stringify({ name: 'sample', version: '0.0.0' }),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/package.json'));
  assert.equal(resp.status, 404,
    'top-level package.json must NOT be browser-fetchable');
});

test('gate: /node_modules/<dep>/index.js → 404', async () => {
  // node_modules is the largest source-disclosure surface and is never
  // in any page's static import graph (bare imports resolve via the
  // importmap to vendor URLs, not direct fs paths).
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'node_modules/some-dep/index.js': `module.exports = 'leaked';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/node_modules/some-dep/index.js'));
  assert.equal(resp.status, 404,
    'node_modules files must NOT be browser-fetchable');
});

test('gate: /scripts/build.js or similar utility file → 404', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'scripts/build.js': `console.log('build');\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/scripts/build.js'));
  assert.equal(resp.status, 404,
    'top-level scripts/ files outside the import graph must NOT be servable');
});

test('gate: page-imported file under a NON-default dir (src/) IS servable', async () => {
  // Confirms the auto-derived model honours the user's actual structure
  // rather than a hardcoded dir list. If a page imports from `src/`,
  // `src/` files become servable automatically. No webjs config needed.
  const appDir = makeApp({
    'app/page.ts':
      `import { msg } from '../src/util.ts';\n` +
      `export default () => msg;\n`,
    'src/util.ts': `export const msg = 'from src';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/src/util.ts'));
  assert.equal(resp.status, 200);
  const code = await resp.text();
  assert.ok(/from src/.test(code), 'src/util.ts content should be served');
});

test('gate: path traversal escaping appDir → 404', async () => {
  // Even when a path looks like it might resolve to a graph member,
  // a `..` segment that escapes appDir must NOT be allowed.
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/app/../../etc/passwd'));
  assert.equal(resp.status, 404);
});

test('gate: transitive import N levels deep is reachable', async () => {
  // page → components/a → components/b → lib/c. All three should be
  // servable.
  const appDir = makeApp({
    'app/page.ts':
      `import { a } from '../components/a.ts';\n` +
      `export default () => a;\n`,
    'components/a.ts':
      `import { b } from './b.ts';\n` +
      `export const a = b;\n`,
    'components/b.ts':
      `import { c } from '../lib/c.ts';\n` +
      `export const b = c;\n`,
    'lib/c.ts': `export const c = 'deep';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  for (const url of ['/components/a.ts', '/components/b.ts', '/lib/c.ts']) {
    const resp = await app.handle(new Request(`http://x${url}`));
    assert.equal(resp.status, 200, `${url} should be reachable through transitive imports`);
  }
});

test('gate: page entry itself is servable (browser fetches it for hydration)', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/app/page.ts'));
  assert.equal(resp.status, 200, 'page entries must be servable');
});

test('gate: newly-imported file becomes servable after rebuild', async () => {
  // Boots a dev server, fetches a file that's NOT YET imported, asserts
  // 404. Then rewrites the page to import the file and rebuilds. Asserts
  // the file is now servable. Covers the fs.watch → graph-recompute path.
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'lib/late.ts': `export const k = 'k';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const before = await app.handle(new Request('http://x/lib/late.ts'));
  assert.equal(before.status, 404, 'file is unreachable before any page imports it');

  // Rewrite the page to import lib/late.ts, then trigger a rebuild.
  writeFileSync(
    join(appDir, 'app/page.ts'),
    `import { k } from '../lib/late.ts';\nexport default () => k;\n`,
  );
  await app.rebuild();

  const after = await app.handle(new Request('http://x/lib/late.ts'));
  assert.equal(after.status, 200, 'file becomes servable after rebuild adds it to the graph');
});

test('gate: barrel file re-exports add the re-exported file to the graph', async () => {
  // Regression for the `export * from './x'` / `export { y } from './x'`
  // pattern. Without re-export tracking, a barrel file like
  // lib/index.ts that consolidates lib/util-a.ts and lib/util-b.ts
  // would leave util-a / util-b out of the graph and 404 when the
  // browser fetches them on hydration.
  const appDir = makeApp({
    'app/page.ts':
      `import { a, b } from '../lib/index.ts';\n` +
      `export default () => a + b;\n`,
    'lib/index.ts':
      `export * from './util-a.ts';\n` +
      `export { b } from './util-b.ts';\n`,
    'lib/util-a.ts': `export const a = 'A';\n`,
    'lib/util-b.ts': `export const b = 'B';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  for (const url of ['/lib/index.ts', '/lib/util-a.ts', '/lib/util-b.ts']) {
    const resp = await app.handle(new Request(`http://x${url}`));
    assert.equal(resp.status, 200, `${url} should be reachable via the barrel re-export`);
  }
});

test('gate: multi-line barrel `export { a, b } from` registers re-export targets', async () => {
  // Variant of the single-line barrel test covering the most common
  // real-world shape: a multi-line { ... } before `from`. The EXPORT_FROM_RE
  // gap class allows newlines so this pattern is caught.
  const appDir = makeApp({
    'app/page.ts':
      `import { x, y } from '../lib/index.ts';\n` +
      `export default () => x + y;\n`,
    'lib/index.ts':
      `export {\n` +
      `  x,\n` +
      `  y,\n` +
      `} from './detail.ts';\n`,
    'lib/detail.ts': `export const x = 'X';\nexport const y = 'Y';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/lib/detail.ts'));
  assert.equal(resp.status, 200, 'multi-line barrel should still seed graph edges');
});

test('gate: file imported ONLY by a .server.ts is NOT in the gate', async () => {
  // The browser fetches a server-action URL and gets the RPC stub
  // back; the stub imports `@webjsdev/core`, not the real source.
  // The .server file's own imports are server-side only and the
  // browser never legitimately requests them. Confirm the gate
  // matches Next.js's behaviour: don't follow imports through
  // .server boundaries.
  const appDir = makeApp({
    'app/page.ts':
      `import { create } from '../modules/posts/actions/create.server.ts';\n` +
      `export default () => create;\n`,
    'modules/posts/actions/create.server.ts':
      `'use server';\n` +
      `import { dbCredentials } from '../../../lib/secrets.ts';\n` +
      `export async function create() { return dbCredentials; }\n`,
    // A file containing sensitive content, imported ONLY by the
    // server action. The browser must NEVER be able to fetch it.
    'lib/secrets.ts':
      `export const dbCredentials = { password: 'hunter2' };\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });

  // The server-action URL itself is reachable (gate yields the
  // RPC stub via the guardrail).
  const stubResp = await app.handle(new Request(
    'http://x/modules/posts/actions/create.server.ts'
  ));
  assert.equal(stubResp.status, 200);

  // lib/secrets.ts is imported ONLY by the .server file. Browser
  // never fetches it through the legitimate flow. Gate must 404.
  const leakResp = await app.handle(new Request('http://x/lib/secrets.ts'));
  assert.equal(leakResp.status, 404,
    'file imported only by a .server.ts must NOT be servable');
});

test('gate: file imported by BOTH a page AND a .server.ts stays servable', async () => {
  // Counterpart to the previous test. If the same file IS legitimately
  // imported by a client-bound path (a page), the gate must include
  // it even though a .server file also imports it. Otherwise legitimate
  // shared utilities would 404.
  const appDir = makeApp({
    'app/page.ts':
      `import { format } from '../lib/format.ts';\n` +
      `import { listPosts } from '../modules/posts/queries/list.server.ts';\n` +
      `export default () => format(listPosts);\n`,
    'modules/posts/queries/list.server.ts':
      `'use server';\n` +
      `import { format } from '../../../lib/format.ts';\n` +
      `export async function listPosts() { return format([]); }\n`,
    'lib/format.ts': `export const format = (x) => String(x);\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/lib/format.ts'));
  assert.equal(resp.status, 200, 'utility imported by both a page and a .server file stays servable');
});

test('gate: page imports from app/_components/ stay servable', async () => {
  // The `_components` / `_private` / `_lib` convention is a
  // ROUTER-ignore mechanism (no page route is mounted under
  // them), but files inside are still importable from pages and
  // layouts. The graph walker must enter `_*` dirs to follow
  // those imports, or legitimate imports 404.
  // Real example: a root layout importing from
  // `./_components/theme-toggle.ts`.
  const appDir = makeApp({
    'app/layout.ts':
      `import './_components/theme-toggle.ts';\n` +
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default ({ children }) => html\`<main>\${children}</main>\`;\n`,
    'app/page.ts': `export default () => 'ok';`,
    'app/_components/theme-toggle.ts':
      `import { swatch } from './palette.ts';\n` +
      `export const themeToggle = () => swatch;\n`,
    'app/_components/palette.ts':
      `export const swatch = 'light';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  for (const url of [
    '/app/_components/theme-toggle.ts',
    '/app/_components/palette.ts',  // transitive through _components
  ]) {
    const resp = await app.handle(new Request(`http://x${url}`));
    assert.equal(resp.status, 200, `${url} should be reachable through _components imports`);
  }
});

/* ------------ x-webjs-remote-ip stamping + spoof-strip (rate-limit #114) ------------ */

test('toWebRequest: x-webjs-remote-ip is set from the socket and inbound copies are dropped', async () => {
  // Regression for #114. The wire is presumed hostile: any client can
  // send `X-Webjs-Remote-IP: <fake>` to escape per-IP rate buckets if
  // rate-limit's defaultKey (trustProxy:false) trusts it as-is. The
  // dev server's IncomingMessage → Request wrapper must strip the
  // inbound copy and replace it with `req.socket.remoteAddress`.
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'app/api/echo/route.js':
      `export async function GET(req) {\n` +
      `  return Response.json({ stamped: req.headers.get('x-webjs-remote-ip') });\n` +
      `}\n`,
  });
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const { server, close } = await startServer({ appDir, dev: false, port: 0, logger, compress: false });
  try {
    const addr = server.address();
    // Client tries to spoof the header. Expect the framework to ignore it
    // and emit the actual socket address (127.0.0.1 over localhost loopback).
    const resp = await fetch(`http://127.0.0.1:${addr.port}/api/echo`, {
      headers: { 'x-webjs-remote-ip': '6.6.6.6' },
    });
    assert.equal(resp.status, 200);
    const { stamped } = await resp.json();
    assert.notEqual(stamped, '6.6.6.6',
      'inbound x-webjs-remote-ip must be stripped (spoof attempt rejected)');
    assert.ok(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(stamped),
      `framework must stamp the real socket address; got: ${stamped}`);
  } finally {
    await close();
  }
});

test('runtime-first boot: a throwing server-action module does not break startup', async () => {
  // Boot must do no whole-app analysis: it must not import server modules. A
  // module that throws at load would crash boot under the old import-every-
  // .server-at-boot behaviour; under runtime-first boot it loads only on first
  // call, so createRequestHandler resolves cleanly.
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>x</p>\`; }\n`,
    'modules/x/boom.server.js':
      `'use server';\n` +
      `throw new Error('module-load side effect that must NOT run at boot');\n` +
      `export async function f() { return 1; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  assert.ok(app && typeof app.handle === 'function', 'server boots without importing server modules');
  // The page still renders (boot did the route table only; analysis is lazy).
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.status, 200);
});

test('warmup() runs the first-request analysis in the background, ahead of any request', async () => {
  // Self-warming (#141): the server boots clean, then warmup() primes the lazy
  // analysis so a real first request finds it memoized. The orphan-component
  // scan is a side effect of ensureReady, so it firing after warmup() (with NO
  // handle() call) proves the analysis ran ahead of any request.
  const warns = [];
  const logger = { info: () => {}, warn: (m) => warns.push(m), error: () => {} };
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>x</p>\`; }\n`,
    'components/orphan.ts':
      `import { WebComponent } from '@webjsdev/core';\n` +
      `export class Orphan extends WebComponent {}\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true, logger });
  assert.equal(warns.length, 0, 'boot does no analysis');
  await app.warmup();
  assert.ok(warns.some((m) => /Orphan/.test(m)), 'warmup ran the analysis with no request made');

  // Idempotent + single-flight: a second warmup and a real request are no-ops
  // for the analysis and still serve correctly.
  const before = warns.length;
  await app.warmup();
  assert.equal(warns.length, before, 'second warmup does not re-run the analysis');
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.status, 200);
});
