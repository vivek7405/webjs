/**
 * Fast HTTP-level integration tests for the blog example, split off from the
 * Puppeteer e2e suite (#777). The e2e suite (`test/e2e/e2e.test.mjs`) drives a
 * real browser, which is 10-50x slower per navigation than an in-process
 * request AND runs twice (Node + Bun), so every assertion that only inspects the
 * HTTP response / SSR HTML / headers / importmap was paid for four times over.
 *
 * These blocks need no browser: they assert the RESPONSE (status, headers,
 * JSON) and the SSR HTML STRING (importmap, modulepreload hints, <title> /
 * <meta>), all of which the request handler produces. So they run here in the
 * fast `node --test` driver via ONE in-process `createRequestHandler({ dev:
 * false })` boot (the same pattern as `test/preload-subset.test.mjs`), asserting
 * over `handle(new Request(...))`. No spawn, no port, no browser. The genuinely
 * browser-facing blocks (hydration, client-router nav, streaming into the DOM,
 * custom-element upgrade) stay in the Puppeteer suite.
 *
 * Needs the blog's seeded SQLite DB (the `/api/posts` + dynamic-slug cases read
 * real rows): CI's `unit` job runs `db:migrate` + `db:seed` in examples/blog
 * before this, the same setup the e2e job uses. Locally `npm run worktree:link` does the same for a fresh worktree, and `before()` fails with the remedy if neither ran. It is DENYLISTED from the Bun
 * test matrix (a cold blog boot + jspm vendor resolution exceeds `bun test`'s 5s
 * per-test timeout; the Bun listener path is covered by test/bun/listener.mjs).
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';
import { assertBlogSeeded } from '../fixtures/blog-seeded.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = resolve(__dirname, '..', '..', 'examples', 'blog');
const ORIGIN = 'http://localhost';

let handler;
/** GET/POST the blog in-process; returns the web Response. */
function req(path, init) {
  return handler.handle(new Request(ORIGIN + path, init));
}
/** Parse the `<script type="importmap">` JSON from an SSR HTML string. */
function importmapOf(html) {
  const m = html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}
/** Same-origin `modulepreload` hrefs from an SSR HTML string. */
function preloadsOf(html) {
  return [...html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/g)]
    .map((x) => x[1]).filter((h) => h.startsWith('/'));
}

describe('Blog HTTP integration (non-browser assertions, #777)', () => {
  before(async () => {
    handler = await createRequestHandler({ appDir: BLOG_DIR, dev: false });
    if (handler.warmup) await handler.warmup();
    // Fail once, naming the database, instead of leaving the slug test to fail
    // on a missing anchor in a fresh worktree (#1323).
    assertBlogSeeded(await (await req('/')).text());
  });
  after(async () => { if (handler && handler.close) await handler.close(); });

  test('import map includes all framework entries', async () => {
    const html = await (await req('/')).text();
    const map = importmapOf(html);
    assert.ok(map, 'Import map should exist');
    assert.ok(map.imports['@webjsdev/core'], 'Should have @webjsdev/core entry');
    assert.ok(map.imports['@webjsdev/core/directives'], 'Should have @webjsdev/core/directives entry');
    assert.ok(map.imports['@webjsdev/core/context'], 'Should have @webjsdev/core/context entry');
    assert.ok(map.imports['@webjsdev/core/task'], 'Should have @webjsdev/core/task entry');
  });

  test('modulepreload links are deduplicated', async () => {
    const preloads = preloadsOf(await (await req('/')).text());
    const unique = new Set(preloads);
    assert.equal(preloads.length, unique.size, 'Modulepreloads should be deduplicated');
    assert.ok(preloads.length > 0, 'Should have at least one modulepreload');
  });

  test('every modulepreload resolves (no preload points at a 404)', async () => {
    // Regression for #158 / #159: the preload set must be a subset of the
    // servable set (the blog once emitted preloads for server-only files the
    // auth gate 404s). Probe every same-origin preload on more than one route,
    // through the SAME in-process handler. The synthetic four-app + graph layer
    // is test/preload-subset.test.mjs (#182); this is the real rendered-blog layer.
    const broken = [];
    for (const route of ['/', '/about']) {
      const preloads = preloadsOf(await (await req(route)).text());
      assert.ok(preloads.length > 0, `expected at least one same-origin preload on ${route}`);
      for (const href of preloads) {
        const resp = await req(href);
        if (resp.status >= 400) broken.push(`${route}: ${href} -> ${resp.status}`);
      }
    }
    assert.equal(broken.length, 0, `no modulepreload may point at a non-servable URL:\n${broken.join('\n')}`);
  });

  test('health endpoint responds', async () => {
    const body = await (await req('/__webjs/health')).json();
    assert.equal(body.status, 'ok');
  });

  test('dynamic route: /blog/[slug] renders the post title in <head>', async () => {
    const home = await (await req('/')).text();
    const href = home.match(/<a[^>]+href=["'](\/blog\/[^"']+)["']/)?.[1];
    assert.ok(href, 'homepage should list at least one /blog/... link');
    const resp = await req(href);
    assert.equal(resp.status, 200, `slug page ${href} should be 200`);
    const html = await resp.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '';
    assert.ok(title.toLowerCase().includes('blog'), `slug page title should mention "blog", got: ${title}`);
    assert.ok(/<article[\s>]/.test(html), 'slug page should render an <article>');
  });

  test('dynamic route: unknown slug hits notFound() -> 404 page', async () => {
    const resp = await req('/blog/this-post-definitely-does-not-exist-xyz-98765');
    assert.equal(resp.status, 404);
    const body = (await resp.text()).toLowerCase();
    assert.ok(/not found|404/.test(body), `custom 404 page should render a "not found" message; got: ${body.slice(0, 200)}`);
  });

  test('dashboard middleware redirects unauthenticated requests to /login', async () => {
    // In-process, the handler returns the redirect RESPONSE (not followed), so
    // assert the 3xx + Location (Puppeteer previously asserted the followed URL).
    const resp = await req('/dashboard');
    assert.ok(resp.status >= 300 && resp.status < 400, `unauthenticated /dashboard should redirect (3xx), got ${resp.status}`);
    const loc = resp.headers.get('location') || '';
    assert.ok(loc.includes('/login'), `redirect should target /login; got: ${loc}`);
    assert.ok(loc.includes('then='), 'redirect should carry a ?then= parameter');
  });

  test('metadata: <title> and <meta description> update per route', async () => {
    const home = await (await req('/')).text();
    const homeTitle = home.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '';
    const homeDesc = home.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/)?.[1];
    assert.ok(homeTitle.toLowerCase().includes('blog'), `homepage <title> should mention "blog"; got ${homeTitle}`);
    assert.ok(homeDesc && homeDesc.length > 0, 'homepage has a description meta');

    const login = await (await req('/login')).text();
    const loginTitle = login.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '';
    assert.ok(loginTitle.toLowerCase().includes('sign in'), `/login <title> should mention "sign in"; got: ${loginTitle}`);
  });

  test('/api/posts GET returns an array of posts', async () => {
    const resp = await req('/api/posts');
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.ok(Array.isArray(data), '/api/posts should return an array');
  });

  test('POST /api/posts without auth is rejected', async () => {
    const resp = await req('/api/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', body: 'y' }),
    });
    assert.ok(resp.status >= 400 && resp.status < 500, `unauthenticated POST should be 4xx, got ${resp.status}`);
  });

  test('404 for unknown pathname serves text/html', async () => {
    const resp = await req('/nothing-here-abcxyz');
    assert.equal(resp.status, 404);
    const ct = resp.headers.get('content-type');
    assert.ok(ct && ct.includes('text/html'), `expected html 404, got ${ct}`);
  });

  test('no CSRF cookie on a GET response (Origin-checked, so SSR is cacheable)', async () => {
    // CSRF is an Origin / Sec-Fetch-Site check (#659), not a token cookie, so a
    // page response carries no webjs_csrf cookie, which is what lets a
    // public-Cache-Control page be CDN-cached.
    const resp = await req('/');
    assert.equal(resp.status, 200);
    const setCookie = resp.headers.get('set-cookie') || '';
    assert.ok(!/csrf/i.test(setCookie), `expected NO csrf cookie; got Set-Cookie: ${setCookie}`);
  });
});
