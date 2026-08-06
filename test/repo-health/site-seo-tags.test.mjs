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
 * These are source-level assertions on the layout file rather than SSR
 * renders, because the three apps have different dependency trees and
 * importing all of them into one test process is not worth the coupling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

for (const app of APPS) {
  test(`${app.name}: the declared favicon size matches the real asset`, () => {
    const src = layoutOf(app.dir);
    const m = src.match(/<link rel="icon" href="\/public\/([\w.-]+\.png)" type="image\/png" sizes="(\d+)x(\d+)"/);
    assert.ok(m, 'declares a PNG icon with an explicit size');

    const [, file, w, h] = m;
    const declared = Number(w);
    const asset = publicFile(app.dir, file);
    assert.ok(existsSync(asset), `${file} exists in public/`);

    const real = pngSize(asset);
    assert.equal(w, h, 'declared as square');
    assert.equal(real.width, real.height, 'the asset really is square');
    // The original bug in one assertion: the markup claimed 32 for a 512 file.
    assert.equal(declared, real.width, 'the DECLARED size matches the real asset');
    // The second half: 32 was under the floor, and 512 would have failed too,
    // since 512 % 48 is 32. Hence the 192px asset.
    assert.equal(declared % 48, 0, 'the size is a multiple of 48px, which Google requires');
  });

  test(`${app.name}: the raster icon is declared before the SVG`, () => {
    // Google's favicon crawler takes the first usable icon, and raster is what
    // search results reliably render. All three led with the SVG before.
    const src = layoutOf(app.dir);
    const png = src.indexOf('type="image/png"');
    const svg = src.indexOf('/public/favicon.svg');
    assert.ok(png > -1 && svg > -1, 'declares both a PNG and an SVG icon');
    assert.ok(png < svg, 'the PNG is declared ahead of the SVG');
  });

  test(`${app.name}: the apple-touch icon points at a correctly sized asset`, () => {
    const src = layoutOf(app.dir);
    const m = src.match(/<link rel="apple-touch-icon" sizes="(\d+)x\d+" href="\/public\/([\w.-]+\.png)"/);
    assert.ok(m, 'declares an apple-touch-icon with an explicit size');
    const asset = publicFile(app.dir, m[2]);
    assert.ok(existsSync(asset), `${m[2]} exists in public/`);
    assert.equal(Number(m[1]), pngSize(asset).width, 'the declared size matches the real asset');
  });

  test(`${app.name}: ships a root favicon.ico with a 48x48 entry`, () => {
    // The framework serves /favicon.ico from public/favicon.ico. All three
    // returned 404 for it before, so the no-markup crawler fallback was absent.
    const ico = publicFile(app.dir, 'favicon.ico');
    assert.ok(existsSync(ico), 'public/favicon.ico exists');
    const buf = readFileSync(ico);
    assert.equal(buf.readUInt16LE(0), 0, 'valid ICO reserved field');
    assert.equal(buf.readUInt16LE(2), 1, 'valid ICO type field');
    const count = buf.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => buf[6 + i * 16] || 256);
    assert.ok(sizes.includes(48), `bundles a 48x48 entry, got ${sizes.join('/')}`);
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
