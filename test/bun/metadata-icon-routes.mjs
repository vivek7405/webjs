/**
 * Cross-runtime proof that an `app/icon.*` metadata ROUTE is auto-linked into
 * the SSR'd head, on both Node and Bun. Run from the repo root:
 *
 *   node test/bun/metadata-icon-routes.mjs
 *   bun  test/bun/metadata-icon-routes.mjs
 *
 * This is runtime-sensitive on two counts, which is why it is here and not
 * only in test/ssr. It rides the SSR head-emission path, and it is wired
 * through module state that `createRequestHandler` binds at boot from the
 * route table, so a unit test of the head builder alone would pass while the
 * real handler emitted nothing. The route files are `.ts`, so resolving them
 * also crosses each runtime's TypeScript stripper (Node 24+'s built-in one,
 * amaro on Bun).
 *
 * Asserts, on whichever runtime executes it: the route is linked and serves,
 * a declared `metadata.icons` suppresses it (the Next precedence rule), an app
 * with neither emits no icon link, and the auto-emitted href carries the app's
 * `basePath` because that is where the route actually answers.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRequestHandler } from '../../packages/server/src/dev.js';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpdir(), 'webjs-icon-routes-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

const PAGE = `export default function Home() { return 'home'; }\n`;

// A genuinely TypeScript metadata route, so each runtime's stripper has to
// handle it before the router can see the file at all.
const ICON_ROUTE = [
  'export default function Icon(): Response {',
  "  return new Response('<svg xmlns=\"http://www.w3.org/2000/svg\"/>', {",
  "    headers: { 'content-type': 'image/svg+xml' },",
  '  });',
  '}',
  '',
].join('\n');

const APPLE_ICON_ROUTE = ICON_ROUTE.replace('function Icon', 'function AppleIcon');

/** Every icon href the rendered head declares. */
async function headIconHrefs(handle, url = 'http://localhost/') {
  const res = await handle(new Request(url));
  assert.equal(res.status, 200, `page did not render on ${runtime}`);
  const head = (await res.text()).split('</head>')[0];
  return [...head.matchAll(/<link rel="[^"]*icon[^"]*"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
}

// app/icon.ts with no declared icons: linked, and the link resolves.
{
  const appDir = makeApp({ 'app/page.js': PAGE, 'app/icon.ts': ICON_ROUTE });
  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();

  const hrefs = await headIconHrefs(h.handle);
  assert.deepEqual(hrefs, ['/icon'], `app/icon.ts was not auto-linked on ${runtime}`);

  // The whole point of the link: the URL it names has to answer.
  const icon = await h.handle(new Request('http://localhost/icon'));
  assert.equal(icon.status, 200, `/icon did not serve on ${runtime}`);
  assert.match(icon.headers.get('content-type') || '', /^image\//, `/icon served no image on ${runtime}`);
}

// app/apple-icon.ts maps to rel="apple-touch-icon", not a second rel="icon".
{
  const appDir = makeApp({
    'app/page.js': PAGE,
    'app/icon.ts': ICON_ROUTE,
    'app/apple-icon.ts': APPLE_ICON_ROUTE,
  });
  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();

  const res = await h.handle(new Request('http://localhost/'));
  const head = (await res.text()).split('</head>')[0];
  assert.match(head, /<link rel="icon" href="\/icon">/, `icon route missing on ${runtime}`);
  assert.match(
    head,
    /<link rel="apple-touch-icon" href="\/apple-icon">/,
    `apple-icon route missing on ${runtime}`,
  );
}

// A declared metadata.icons wins outright, the way Next merges its static icon
// files only when the resolved metadata declares no icons of its own.
{
  const appDir = makeApp({
    'app/page.js': PAGE,
    'app/icon.ts': ICON_ROUTE,
    'app/apple-icon.ts': APPLE_ICON_ROUTE,
    'app/layout.js': [
      "export const metadata = { icons: '/public/brand.svg' };",
      'export default function Layout({ children }) { return children; }',
      '',
    ].join('\n'),
  });
  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();

  const hrefs = await headIconHrefs(h.handle);
  assert.deepEqual(
    hrefs,
    ['/public/brand.svg'],
    `a declared metadata.icons did not suppress the icon routes on ${runtime}`,
  );
}

// Neither route nor declaration: no icon link at all. The counterfactual that
// keeps every existing app byte-identical.
{
  const appDir = makeApp({ 'app/page.js': PAGE });
  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();

  assert.deepEqual(await headIconHrefs(h.handle), [], `an icon link appeared from nowhere on ${runtime}`);
}

// Under webjs.basePath the route is SERVED at <basePath>/icon (the listener
// strips the prefix before matching), so the emitted href has to carry it or
// the link 404s on exactly the deployments that need it most.
{
  const appDir = makeApp({
    'app/page.js': PAGE,
    'app/icon.ts': ICON_ROUTE,
    'package.json': JSON.stringify({ name: 'basepath-icon-app', webjs: { basePath: '/app' } }, null, 2),
  });
  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();

  const hrefs = await headIconHrefs(h.handle, 'http://localhost/app/');
  assert.deepEqual(hrefs, ['/app/icon'], `the auto-linked icon href ignored basePath on ${runtime}`);

  const icon = await h.handle(new Request('http://localhost/app/icon'));
  assert.equal(icon.status, 200, `the base-path icon href did not serve on ${runtime}`);
}

console.log(`metadata icon routes: auto-link, precedence and basePath OK on ${runtime}`);
