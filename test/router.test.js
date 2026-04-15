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
