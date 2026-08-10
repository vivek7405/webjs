/**
 * Cross-app SEO-tag invariants for the in-repo web apps (#1088).
 *
 * webjs.dev, the docs, and ui.webjs.dev each shipped the SAME two defects,
 * because each root layout was copied from the last:
 *
 *  1. `<link rel="icon" ... sizes="32x32">` pointing at an asset that is
 *     really 512x512. The declared size was wrong AND under Google's floor
 *     (it wants a square whose side is a multiple of 48px), so webjs.dev
 *     showed no favicon in search results at all.
 *  2. No `<link rel="canonical">` anywhere, so every query-string and
 *     trailing-slash variant of every URL split its ranking signals.
 *
 * A per-app test would not have caught the copy-paste spread, so this asserts
 * the invariant across every app at once. Adding an app to APPS is the
 * intended way to bring it under the same guard.
 *
 * The docs are no longer a separate app here (#1098): they are served by the
 * website at /docs and share its root layout, so the website row now covers
 * them. `docs.webjs.dev` still resolves, but as a Cloudflare redirect rule
 * with nothing indexable of its own, which is the point of the move.
 *
 * The icon assertions RENDER the app rather than reading its layout source.
 * They used to regex the layout for hand-written `<link>` markup, which
 * pinned an authoring style the framework tells apps not to use: only a ROOT
 * layout may write a shell at all (invariant 8), so a hand-written tag is a
 * pattern no other layout can copy, and favicons are declared through
 * `metadata.icons`. Rendering asserts what a browser actually receives, which
 * is the thing that matters and is also the only way to see icons the
 * framework splices in. The canonical check stays source-level: it asserts
 * how the value is DERIVED (origin plus pathname, trailing slash stripped),
 * which one rendered URL cannot show.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '@webjsdev/server';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Only apps that actually SERVE HTML are checked here. `docs.webjs.dev` and
 * `ui.webjs.dev` are Cloudflare redirect rules: they render no markup at all,
 * so they have no layout, no icons, and no canonical to assert. The pages they
 * used to serve now live under `website/` (at /docs and /ui) and are covered
 * by this app's entry.
 */
const APPS = [
  { name: 'website (webjs.dev, incl. /docs and /ui)', dir: 'website' },
];

const layoutOf = (dir) => readFileSync(resolve(REPO_ROOT, dir, 'app', 'layout.ts'), 'utf8');
const publicFile = (dir, file) => resolve(REPO_ROOT, dir, 'public', file);

/** Read a PNG's intrinsic dimensions straight out of the IHDR chunk. */
function pngSize(path) {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * The icon `<link>` tags the app's home page actually serves, in head order.
 *
 * Rendering is what makes this honest: the tags may come from hand-written
 * markup, from `metadata.icons`, or from an auto-linked `app/icon.*` metadata
 * route, and a browser cannot tell the difference. Neither should this.
 */
async function renderedIconLinks(dir) {
  const app = await createRequestHandler({ appDir: resolve(REPO_ROOT, dir), dev: true });
  const res = await app.handle(new Request('http://localhost/'));
  assert.equal(res.status, 200, `${dir} home page renders`);
  // Browsers ignore a favicon <link> in <body>, so only the head counts.
  const head = (await res.text()).split('</head>')[0];
  return [...head.matchAll(/<link rel="[^"]*icon[^"]*"[^>]*>/g)].map((m) => m[0]);
}

/** Pull an attribute off one rendered tag, order-independently. */
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

for (const app of APPS) {
  test(`${app.name}: the declared favicon size matches the real asset`, async () => {
    const links = await renderedIconLinks(app.dir);
    const png = links.find((l) => attr(l, 'type') === 'image/png');
    assert.ok(png, 'serves a PNG icon with an explicit type');

    const href = attr(png, 'href');
    const sizes = attr(png, 'sizes');
    assert.ok(sizes, 'the PNG icon declares a size');
    const [w, h] = sizes.split('x');
    assert.equal(w, h, 'declared as square');

    const file = href.replace(/^\/public\//, '');
    const asset = publicFile(app.dir, file);
    assert.ok(existsSync(asset), `${file} exists in public/`);

    const real = pngSize(asset);
    assert.equal(real.width, real.height, 'the asset really is square');
    // The original bug in one assertion: the markup claimed 32 for a 512 file.
    assert.equal(Number(w), real.width, 'the DECLARED size matches the real asset');
    // The second half: 32 was under the floor, and 512 would have failed too,
    // since 512 % 48 is 32. Hence the 192px asset.
    assert.equal(Number(w) % 48, 0, 'the size is a multiple of 48px, which Google requires');
  });

  test(`${app.name}: the raster icon is served before the SVG`, async () => {
    // Google's favicon crawler takes the first usable icon, and raster is what
    // search results reliably render. All three led with the SVG before.
    const links = await renderedIconLinks(app.dir);
    const png = links.findIndex((l) => attr(l, 'type') === 'image/png');
    const svg = links.findIndex((l) => attr(l, 'type') === 'image/svg+xml');
    assert.ok(png > -1 && svg > -1, 'serves both a PNG and an SVG icon');
    assert.ok(png < svg, 'the PNG comes first in the head');
  });

  test(`${app.name}: the apple-touch icon points at a correctly sized asset`, async () => {
    const links = await renderedIconLinks(app.dir);
    const apple = links.find((l) => attr(l, 'rel') === 'apple-touch-icon');
    assert.ok(apple, 'serves an apple-touch-icon');
    const file = attr(apple, 'href').replace(/^\/public\//, '');
    const asset = publicFile(app.dir, file);
    assert.ok(existsSync(asset), `${file} exists in public/`);
    assert.equal(Number(attr(apple, 'sizes').split('x')[0]), pngSize(asset).width,
      'the declared size matches the real asset');
  });

  test(`${app.name}: every icon it links is actually served`, async () => {
    // A head naming a URL nothing answers is the failure mode that took
    // gallery.webjs.dev two PRs to shake out, so resolve each href rather than
    // trusting the markup.
    const application = await createRequestHandler({ appDir: resolve(REPO_ROOT, app.dir), dev: true });
    for (const link of await renderedIconLinks(app.dir)) {
      const href = attr(link, 'href');
      const res = await application.handle(new Request(`http://localhost${href}`));
      assert.equal(res.status, 200, `${href} is served, not a 404`);
    }
  });

  test(`${app.name}: ships a root favicon.ico with a 48x48 entry`, () => {
    // The framework serves /favicon.ico from public/favicon.ico. All three
    // returned 404 for it before, so the no-markup crawler fallback was absent.
    // Deliberately NOT a rendered assertion: nothing links it, which is the
    // point (crawlers that parse no HTML fetch the path directly).
    const ico = publicFile(app.dir, 'favicon.ico');
    assert.ok(existsSync(ico), 'public/favicon.ico exists');
    const buf = readFileSync(ico);
    assert.equal(buf.readUInt16LE(0), 0, 'valid ICO reserved field');
    assert.equal(buf.readUInt16LE(2), 1, 'valid ICO type field');
    const count = buf.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => buf[6 + i * 16] || 256);
    assert.ok(sizes.includes(48), `bundles a 48x48 entry, got ${sizes.join('/')}`);
  });

  test(`${app.name}: declares its favicons, rather than hand-writing the markup`, () => {
    // The convention the framework documents, and what every other app in the
    // repo does. A hand-written tag works ONLY in a root layout (invariant 8),
    // so it is a pattern no other layout can copy, and the docs told readers
    // not to write it while this app did.
    const src = layoutOf(app.dir);
    assert.match(src, /icons:\s*\{/, 'declares metadata.icons');
    assert.doesNotMatch(src, /<link rel="[^"]*icon/, 'writes no icon <link> by hand');
  });

  test(`${app.name}: the root layout emits a canonical URL`, () => {
    const src = layoutOf(app.dir);
    assert.match(src, /alternates:\s*\{\s*canonical\s*\}/, 'sets alternates.canonical in generateMetadata');
    // Derived from pathname rather than the raw request URL, which is what
    // makes ?utm=... and a trailing slash collapse onto one canonical.
    assert.ok(src.includes('new URL(ctx.url)'), 'derives it from the request URL');
    assert.match(src, /pathname\.replace\(\/\\\/\+\$\/, ''\)/, 'strips a trailing slash');
  });
}
