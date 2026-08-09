/**
 * Integration tests for the declarative redirects config (issue #254).
 * Exercised through createRequestHandler so they cover the real response
 * pipeline (the redirect runs at the start of produce(), before routing /
 * SSR / asset serving), not the matcher in isolation. Web-standard
 * Request/Response, no real HTTP server.
 *
 * The redirect contract under test:
 *   - a configured source returns a 308 to the destination (permanent default)
 *   - a `:param` source substitutes the captured group into the destination
 *   - `permanent: false` returns 307
 *   - a `statusCode` override wins (e.g. legacy 301)
 *   - a non-matching path falls through to normal routing (200)
 *   - the incoming query string is preserved
 *   - a malformed entry is dropped without crashing (valid rules still apply)
 *   - an absolute-URL destination redirects externally
 *   - framework /__webjs/* paths are never redirected
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';
import { compileRedirectRules, applyRedirects } from '../../src/redirects.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_URL = pathToFileURL(
  resolve(__dirname, '../../../core/src/html.js')
).toString();

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-redirects-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

function page(body) {
  return (
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default function P() { return html\`${body}\`; }\n`
  );
}

function pkg(redirects) {
  return JSON.stringify({ name: 'redirect-app', webjs: { redirects } });
}

/* --------------------------- the happy paths --------------------------- */

test('a configured source returns a 308 to the destination (permanent default)', async () => {
  const appDir = makeApp({
    'package.json': pkg([{ source: '/old', destination: '/new' }]),
    'app/new/page.js': page('<h1>new</h1>'),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/old'));
  // COUNTERFACTUAL anchor: remove the applyRedirects call in produce() and
  // /old 404s (no page there) instead of 308-ing, so this fails.
  assert.equal(resp.status, 308);
  assert.equal(resp.headers.get('location'), '/new');
});

test('a :param source substitutes the captured group into the destination', async () => {
  const appDir = makeApp({
    'package.json': pkg([{ source: '/blog/:slug', destination: '/posts/:slug' }]),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/blog/hello-world'));
  assert.equal(resp.status, 308);
  assert.equal(resp.headers.get('location'), '/posts/hello-world');
});

test('permanent: false returns a 307 temporary redirect', async () => {
  const appDir = makeApp({
    'package.json': pkg([{ source: '/legacy', destination: '/', permanent: false }]),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/legacy'));
  assert.equal(resp.status, 307);
  assert.equal(resp.headers.get('location'), '/');
});

test('a statusCode override wins (legacy 301)', async () => {
  const appDir = makeApp({
    'package.json': pkg([{ source: '/old', destination: '/new', statusCode: 301 }]),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/old'));
  assert.equal(resp.status, 301);
  assert.equal(resp.headers.get('location'), '/new');
});

test('a non-matching path falls through to normal routing (200, not redirected)', async () => {
  const appDir = makeApp({
    'package.json': pkg([{ source: '/old', destination: '/new' }]),
    'app/page.js': page('<h1>home</h1>'),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/'));
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('location'), null);
  const body = await resp.text();
  assert.match(body, /home/);
});

test('the incoming query string is preserved on the redirect', async () => {
  const appDir = makeApp({
    'package.json': pkg([{ source: '/blog/:slug', destination: '/posts/:slug' }]),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/blog/hi?ref=twitter&page=2'));
  assert.equal(resp.status, 308);
  assert.equal(resp.headers.get('location'), '/posts/hi?ref=twitter&page=2');
});

test('a malformed entry is dropped without crashing; valid rules still apply', async () => {
  const appDir = makeApp({
    // First entry has no destination (invalid, dropped). Second is valid.
    'package.json': pkg([
      { source: '/broken' },
      { source: '/good', destination: '/dest' },
    ]),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  // The valid rule still works...
  const ok = await app.handle(new Request('http://x/good'));
  assert.equal(ok.status, 308);
  assert.equal(ok.headers.get('location'), '/dest');
  // ...and the dropped one does not redirect (404, no page), no crash.
  const dropped = await app.handle(new Request('http://x/broken'));
  assert.notEqual(dropped.status, 308);
});

test('an absolute-URL destination redirects externally', async () => {
  const appDir = makeApp({
    'package.json': pkg([{ source: '/docs', destination: 'https://docs.example.com/' }]),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/docs'));
  assert.equal(resp.status, 308);
  assert.equal(resp.headers.get('location'), 'https://docs.example.com/');
});

test('an absolute-URL destination substitutes named groups too', async () => {
  const appDir = makeApp({
    'package.json': pkg([
      { source: '/u/:id', destination: 'https://app.example.com/users/:id' },
    ]),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/u/42'));
  assert.equal(resp.status, 308);
  assert.equal(resp.headers.get('location'), 'https://app.example.com/users/42');
});

test('framework /__webjs/* paths are never redirected', async () => {
  const appDir = makeApp({
    // A catch-all redirect that would otherwise swallow everything.
    'package.json': pkg([{ source: '/:rest*', destination: '/moved' }]),
    'app/page.js': page('<h1>home</h1>'),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const health = await app.handle(new Request('http://x/__webjs/health'));
  // The health probe answers 200, never a 308 from the catch-all rule.
  assert.equal(health.status, 200);
  assert.notEqual(health.status, 308);
});

test('secure headers still wrap the redirect Response', async () => {
  const appDir = makeApp({
    'package.json': pkg([{ source: '/old', destination: '/new' }]),
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request('http://x/old'));
  assert.equal(resp.status, 308);
  // The #232 funnel wraps every response, including a redirect.
  assert.equal(resp.headers.get('x-content-type-options'), 'nosniff');
});

/* ----------------------- the compile unit surface ---------------------- */

test('compileRedirectRules: no config yields an empty rule set', () => {
  assert.deepEqual(compileRedirectRules(undefined), []);
  assert.deepEqual(compileRedirectRules({}), []);
  assert.deepEqual(compileRedirectRules({ webjs: {} }), []);
  assert.deepEqual(compileRedirectRules({ webjs: { redirects: 'nope' } }), []);
});

test('compileRedirectRules: an invalid statusCode drops the entry', () => {
  const rules = compileRedirectRules({
    webjs: { redirects: [{ source: '/a', destination: '/b', statusCode: 200 }] },
  });
  assert.equal(rules.length, 0);
});

test('compileRedirectRules: an invalid source pattern drops the entry', () => {
  const rules = compileRedirectRules({
    // An unterminated group is an invalid URLPattern.
    webjs: { redirects: [{ source: '/a/(', destination: '/b' }] },
  });
  assert.equal(rules.length, 0);
});

test('compileRedirectRules: a non-object entry is dropped AND warned about', () => {
  // This branch used to `continue` in silence while every other drop warned,
  // so a `["/old"]` entry (the shape you write when you forget the object
  // wrapper) vanished with nothing said, and three doc surfaces plus this
  // function's own docblock all promised a warning. The valid sibling next to
  // it must still compile, which is the point of dropping rather than throwing.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let rules;
  try {
    rules = compileRedirectRules({
      webjs: { redirects: ['/old', null, 42, { source: '/a', destination: '/b' }] },
    });
  } finally {
    console.warn = realWarn;
  }

  assert.equal(rules.length, 1, 'the one valid entry still compiles');
  assert.equal(rules[0].destination, '/b');
  assert.equal(warnings.length, 3, 'each of the three bad entries warned');
  for (const w of warnings) {
    assert.match(w, /dropping invalid webjs\.redirects entry/);
    assert.match(w, /entry must be an object/);
  }
});

test('applyRedirects: returns null with no rules (pass-through)', () => {
  assert.equal(applyRedirects(new Request('http://x/old'), []), null);
});

test('applyRedirects: a destination query is merged, destination keys winning', () => {
  const rules = compileRedirectRules({
    webjs: { redirects: [{ source: '/old', destination: '/new?keep=1&ref=site' }] },
  });
  const resp = applyRedirects(new Request('http://x/old?ref=incoming&extra=2'), rules);
  assert.equal(resp.status, 308);
  const loc = resp.headers.get('location');
  const u = new URL(loc, 'http://x');
  assert.equal(u.pathname, '/new');
  assert.equal(u.searchParams.get('keep'), '1');
  assert.equal(u.searchParams.get('ref'), 'site'); // destination wins
  assert.equal(u.searchParams.get('extra'), '2'); // incoming preserved
});
