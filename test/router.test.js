import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildRouteTable, matchPage, matchApi } from '../packages/server/src/router.js';

async function scaffold(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, body);
  }
  return dir;
}

test('matches root, static, dynamic, and catch-all routes', async () => {
  const dir = await scaffold({
    'app/page.js': 'export default () => ""',
    'app/about/page.js': 'export default () => ""',
    'app/blog/[slug]/page.js': 'export default () => ""',
    'app/files/[...rest]/page.js': 'export default () => ""',
  });
  try {
    const table = await buildRouteTable(dir);

    assert.ok(matchPage(table, '/'));
    assert.equal(matchPage(table, '/about').route.routeDir, 'about');

    const blog = matchPage(table, '/blog/hello');
    assert.ok(blog);
    assert.deepEqual(blog.params, { slug: 'hello' });

    const files = matchPage(table, '/files/a/b/c');
    assert.ok(files);
    assert.deepEqual(files.params, { rest: 'a/b/c' });

    assert.equal(matchPage(table, '/nope'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('attaches per-segment middleware chain to pages and apis', async () => {
  const dir = await scaffold({
    'app/middleware.js': 'export default (r, n) => n()',
    'app/admin/middleware.js': 'export default (r, n) => n()',
    'app/admin/page.js': 'export default () => ""',
    'app/admin/api/stats/route.js': 'export const GET = () => ({})',
    'app/about/page.js': 'export default () => ""', // no extra middleware
  });
  try {
    const table = await buildRouteTable(dir);

    const adminPage = table.pages.find((p) => p.routeDir === 'admin');
    assert.ok(adminPage);
    assert.equal(adminPage.middlewares.length, 2);
    assert.match(adminPage.middlewares[0], /app\/middleware\.js$/);
    assert.match(adminPage.middlewares[1], /app\/admin\/middleware\.js$/);

    const aboutPage = table.pages.find((p) => p.routeDir === 'about');
    assert.equal(aboutPage.middlewares.length, 1);

    const adminApi = table.apis.find((a) => /stats/.test(a.file));
    assert.ok(adminApi);
    assert.equal(adminApi.middlewares.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('attaches layouts from root down to page dir', async () => {
  const dir = await scaffold({
    'app/layout.js': 'export default () => ""',
    'app/blog/layout.js': 'export default () => ""',
    'app/blog/[slug]/page.js': 'export default () => ""',
  });
  try {
    const table = await buildRouteTable(dir);
    const m = matchPage(table, '/blog/x');
    assert.ok(m);
    assert.equal(m.route.layouts.length, 2);
    assert.match(m.route.layouts[0], /app\/layout\.js$/);
    assert.match(m.route.layouts[1], /app\/blog\/layout\.js$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('route groups (folder) and private _folders are excluded from URL', async () => {
  const dir = await scaffold({
    'app/(marketing)/about/page.js': 'export default () => ""',
    'app/(marketing)/layout.js': 'export default () => ""',
    'app/_internal/page.js': 'export default () => ""',
  });
  try {
    const table = await buildRouteTable(dir);
    // /about works (group stripped)
    const m = matchPage(table, '/about');
    assert.ok(m);
    // The group layout is still in the chain for /about
    assert.ok(m.route.layouts.some((p) => /\(marketing\)\/layout\.js$/.test(p)));
    // Private folder is not routable
    assert.equal(matchPage(table, '/_internal'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('matches route.js anywhere under app/, not only /api', async () => {
  const dir = await scaffold({
    'app/api/hello/route.js': 'export const GET = () => ({ ok: true })',
    'app/api/users/[id]/route.js': 'export const GET = () => ({})',
    'app/webhook/route.js': 'export const POST = () => ({})',
    'app/rss.xml/route.js': 'export const GET = () => new Response("")',
    'app/route.js': 'export const GET = () => ({ root: true })',
  });
  try {
    const table = await buildRouteTable(dir);
    assert.ok(matchApi(table, '/api/hello'));
    const u = matchApi(table, '/api/users/42');
    assert.ok(u);
    assert.deepEqual(u.params, { id: '42' });
    assert.ok(matchApi(table, '/webhook'));
    assert.ok(matchApi(table, '/rss.xml'));
    assert.ok(matchApi(table, '/'));
    assert.equal(matchApi(table, '/api/nope'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('optional catch-all [[...slug]] matches with and without params', async () => {
  const dir = await scaffold({
    'app/docs/[[...slug]]/page.js': 'export default () => ""',
  });
  try {
    const table = await buildRouteTable(dir);
    // Matches /docs (no params)
    const root = matchPage(table, '/docs');
    assert.ok(root, '/docs should match optional catch-all');
    // Matches /docs/getting-started
    const one = matchPage(table, '/docs/getting-started');
    assert.ok(one, '/docs/getting-started should match');
    assert.equal(one.params.slug, 'getting-started');
    // Matches /docs/a/b/c
    const deep = matchPage(table, '/docs/a/b/c');
    assert.ok(deep, '/docs/a/b/c should match');
    assert.equal(deep.params.slug, 'a/b/c');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('nested not-found.js files are collected per segment', async () => {
  const dir = await scaffold({
    'app/page.js': 'export default () => ""',
    'app/not-found.js': 'export default () => "root 404"',
    'app/dashboard/page.js': 'export default () => ""',
    'app/dashboard/not-found.js': 'export default () => "dashboard 404"',
  });
  try {
    const table = await buildRouteTable(dir);
    assert.ok(table.notFound, 'root not-found should exist');
    assert.ok(table.notFounds.get('.'), 'root not-found in map');
    assert.ok(table.notFounds.get('dashboard'), 'dashboard not-found in map');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('metadata routes are detected (sitemap, robots)', async () => {
  const dir = await scaffold({
    'app/page.js': 'export default () => ""',
    'app/sitemap.js': 'export default () => "<urlset></urlset>"',
    'app/robots.js': 'export default () => "User-agent: *\\nAllow: /"',
  });
  try {
    const table = await buildRouteTable(dir);
    assert.ok(table.metadataRoutes.length >= 2, `Expected >=2 metadata routes, got ${table.metadataRoutes.length}`);
    const sitemap = table.metadataRoutes.find((r) => r.stem === 'sitemap');
    assert.ok(sitemap, 'sitemap route should exist');
    assert.equal(sitemap.urlPath, '/sitemap.xml');
    const robots = table.metadataRoutes.find((r) => r.stem === 'robots');
    assert.ok(robots, 'robots route should exist');
    assert.equal(robots.urlPath, '/robots.txt');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loading.js files are attached to page routes', async () => {
  const dir = await scaffold({
    'app/page.js': 'export default () => ""',
    'app/loading.js': 'export default () => "Loading..."',
    'app/dashboard/page.js': 'export default () => ""',
    'app/dashboard/loading.js': 'export default () => "Dashboard loading..."',
  });
  try {
    const table = await buildRouteTable(dir);
    const root = matchPage(table, '/');
    assert.ok(root);
    assert.ok(root.route.loadings.length >= 1, 'root page should have loading');
    const dash = matchPage(table, '/dashboard');
    assert.ok(dash);
    assert.ok(dash.route.loadings.length >= 1, 'dashboard page should have loading');
    // Dashboard inherits root loading AND has its own
    assert.ok(dash.route.loadings.length >= 2, 'dashboard should have nested loadings');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
