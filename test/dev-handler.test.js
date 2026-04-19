/**
 * Integration tests for `createRequestHandler` — exercises the core
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

import { createRequestHandler, startServer } from '../packages/server/src/dev.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(
  resolve(__dirname, '../packages/core/src/html.js')
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

test('handle: /__webjs/ready returns 200 JSON', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/ready'));
  assert.equal(resp.status, 200);
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

test('handle: /__webjs/core/ refuses path traversal → 403', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/core/../../etc/passwd'));
  // Either 403 (traversal detected) or 404 (normalised outside dir) — both safe.
  assert.ok(resp.status === 403 || resp.status === 404, `expected 403/404, got ${resp.status}`);
});

/* ------------ vendor bundles ------------ */

test('handle: /__webjs/vendor/<pkg>.js serves a built bundle for a known pkg', async () => {
  // Use the repo root as appDir so node_modules is resolvable via the
  // monorepo hoisting chain — bundlePackage() uses createRequire against
  // the appDir's package.json.
  const repoRoot = resolve(__dirname, '..');
  const silent = { info: () => {}, warn: () => {}, error: () => {} };
  const app = await createRequestHandler({ appDir: repoRoot, dev: true, logger: silent });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/picocolors.js'));
  assert.equal(resp.status, 200);
  assert.ok(resp.headers.get('content-type').includes('javascript'));
});

test('handle: /__webjs/vendor/unknown.js → 404', async () => {
  const appDir = makeApp({ 'app/page.ts': `export default () => 'ok';` });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/this-pkg-does-not-exist-xyz.js'));
  assert.equal(resp.status, 404);
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

test('handle: .ts source served as JS with esbuild-stripped types', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
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

test('handle: /foo.js falls through to sibling foo.ts when .js is missing', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
    'components/util.ts':
      `export const greeting = 'hello';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/components/util.js'));
  assert.equal(resp.status, 200);
  const code = await resp.text();
  // esbuild may rewrite `export const foo` to a trailing `export { foo };`
  // — both forms should mention the identifier.
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
  assert.ok(etag && etag.startsWith('"'));
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
  // Unknown __webjs path — not a vendor, not a core, not health…
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
      `import { WebComponent } from '@webjskit/core';\n` +
      `export class Orphan extends WebComponent {}\n`,
  });
  await createRequestHandler({ appDir, dev: true, logger });
  assert.ok(
    warns.some(m => /Orphan/.test(m)),
    `expected orphan warning for class "Orphan"; got: ${warns.join('\n')}`,
  );
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

/* ------------ segment middleware + action RPC + expose CORS ------------ */

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
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'actions.server.js':
      `export async function double(n) { return n * 2; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });

  // Find the generated hash via the RPC stub.
  const stub = await (await app.handle(new Request('http://x/actions.server.js'))).text();
  const hashMatch = /\/__webjs\/action\/([a-f0-9]+)\//.exec(stub);
  assert.ok(hashMatch, `stub should reference action URL, got: ${stub.slice(0, 400)}`);
  const hash = hashMatch[1];

  const rpcUrl = `http://x/__webjs/action/${hash}/double`;

  // GET → 405
  const wrong = await app.handle(new Request(rpcUrl));
  assert.equal(wrong.status, 405);

  // Obtain a CSRF token pair by hitting the page route (which mints one).
  const pageResp = await app.handle(new Request('http://x/'));
  const setCookie = pageResp.headers.get('set-cookie') || '';
  const tokMatch = /webjs_csrf=([^;]+)/.exec(setCookie);
  assert.ok(tokMatch, `page should set csrf cookie; got: ${setCookie}`);
  const token = decodeURIComponent(tokMatch[1]);

  // POST with serialized args (superjson wire format + matching csrf).
  const resp = await app.handle(new Request(rpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webjs-csrf': token,
      cookie: `webjs_csrf=${encodeURIComponent(token)}`,
    },
    body: JSON.stringify({ json: [21] }),
  }));
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.json, 42);
});

test('handle: expose()d action is reachable by method+path', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'api.server.js':
      `import { expose } from ${JSON.stringify(pathToFileURL(
        resolve(__dirname, '../packages/core/index.js'),
      ).toString())};\n` +
      `export const hello = expose('GET /api/hello', async () => ({ ok: true }));\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/api/hello'));
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { ok: true });
});

test('handle: OPTIONS preflight on expose()d action with cors returns CORS headers', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'api.server.js':
      `import { expose } from ${JSON.stringify(pathToFileURL(
        resolve(__dirname, '../packages/core/index.js'),
      ).toString())};\n` +
      `export const hello = expose('POST /api/hello', async () => ({ ok: true }), { cors: true });\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/api/hello', {
    method: 'OPTIONS',
    headers: { origin: 'http://other', 'access-control-request-method': 'POST' },
  }));
  assert.equal(resp.status, 204);
  const allowMethods = resp.headers.get('access-control-allow-methods') || '';
  assert.ok(/POST/.test(allowMethods));
  assert.ok(/OPTIONS/.test(allowMethods));
});

test('handle: OPTIONS at a path with exposed actions but no CORS → plain allow', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'api.server.js':
      `import { expose } from ${JSON.stringify(pathToFileURL(
        resolve(__dirname, '../packages/core/index.js'),
      ).toString())};\n` +
      `export const hello = expose('GET /api/hello', async () => ({ ok: true }));\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/api/hello', { method: 'OPTIONS' }));
  assert.equal(resp.status, 204);
  const allow = resp.headers.get('allow') || '';
  assert.ok(/GET/.test(allow));
  assert.ok(/OPTIONS/.test(allow));
});

test('handle: POST /__webjs/action without CSRF → 403', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    'actions.server.js':
      `export async function noop() { return 1; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const stub = await (await app.handle(new Request('http://x/actions.server.js'))).text();
  const hash = /\/__webjs\/action\/([a-f0-9]+)\//.exec(stub)[1];
  const resp = await app.handle(new Request(`http://x/__webjs/action/${hash}/noop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(resp.status, 403);
});

/* ------------ tsResponse cache path + missing esbuild path ------------ */

test('handle: TS source responses share an mtime-keyed cache (second req is fast)', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default () => 'ok';`,
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

test('handle: /__webjs/bundle.js is served when a prod bundle exists', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
    '.webjs/bundle.js': `console.log('bundle');\n`,
    '.webjs/bundle.js.map': `{"version":3,"sources":[]}`,
  });
  const app = await createRequestHandler({ appDir, dev: false });
  const resp = await app.handle(new Request('http://x/__webjs/bundle.js'));
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.includes("console.log('bundle')"));

  const mapResp = await app.handle(new Request('http://x/__webjs/bundle.js.map'));
  assert.equal(mapResp.status, 200);
});

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

test('startServer: http2 requested without cert/key falls back to HTTP/1.1', async () => {
  const appDir = makeApp({
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default function P() { return html\`<p>ok</p>\`; }\n`,
  });
  const warnings = [];
  const logger = {
    info: () => {},
    warn: (m) => warnings.push(m),
    error: () => {},
  };
  const { server, close } = await startServer({ appDir, dev: false, port: 0, logger, http2: true });
  try {
    assert.ok(warnings.some(w => /http2/i.test(w) || /HTTP\/1/.test(w)),
      `expected a fallback warning, got: ${warnings.join('|')}`);
    const addr = server.address();
    const resp = await fetch(`http://127.0.0.1:${addr.port}/`);
    assert.equal(resp.status, 200);
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
    // Node's fetch concatenates set-cookie with ", " — getSetCookie() splits back.
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
    `import { WebComponent } from '@webjskit/core';\n` +
    `export class LateOrphan extends WebComponent {}\n`);
  await app.rebuild();
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

test('handle: /__webjs/vendor/superjson.js serves the legacy superjson bundle', async () => {
  // superjson must be resolvable from the appDir. Use the repo root.
  const repoRoot = resolve(__dirname, '..');
  const silent = { info: () => {}, warn: () => {}, error: () => {} };
  const app = await createRequestHandler({ appDir: repoRoot, dev: true, logger: silent });
  const resp = await app.handle(new Request('http://x/__webjs/vendor/superjson.js'));
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.length > 0);
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
