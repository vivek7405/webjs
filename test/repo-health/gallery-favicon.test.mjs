/**
 * The gallery's favicon: linked, served, and the real brand mark.
 *
 * gallery.webjs.dev rendered with a blank tab. `gallery/app/icon.ts` answered
 * /icon the whole time, but a metadata ROUTE is not auto-linked: the framework
 * emits `<link rel="icon">` only from `metadata.icons`
 * (packages/server/src/ssr.js), and the gallery's root layout declared only a
 * title and a description. So the head named no icon, the browser fell back to
 * /favicon.ico, and the gallery shipped no such file. Linking /icon then fixed
 * the blank tab with the DEMO route's placeholder grey "w" rather than the
 * WebJs mark webjs.dev serves, so the gallery read as a different product in a
 * tab strip.
 *
 * Three independent things have to hold and each stayed green while another was
 * broken, so all three are asserted: the head must LINK an icon, every URL it
 * links must be SERVED, and the bytes must be the BRAND mark. The last is why
 * the middle is not enough, since a linked-and-served placeholder is
 * indistinguishable from the real thing to the request pipeline.
 *
 * This lives in the REPO suite rather than in `gallery/test/`, for two reasons.
 * It is a cross-app assertion (it reads `website/public/`, which exists only
 * here), and `gallery/test/**` is scaffold PAYLOAD: `copyGallery()` copies it
 * into every generated app, where a `website/` to compare against never exists
 * and where a stray directory also defeats `gallery:clear`'s prune of an empty
 * `test/` (asserted by test/scaffolds/scaffold-gallery.test.js).
 *
 * Companion to site-seo-tags.test.mjs, which covers the website's own icons.
 * That one asserts hand-written `<link>` markup because the website writes its
 * icons that way; this renders the page instead, because the gallery declares
 * them through metadata.icons and there is no markup in the layout to read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '@webjsdev/server';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GALLERY = resolve(REPO_ROOT, 'gallery');

/** The website's committed asset, which is the canonical copy of the mark. */
const canonical = (file) => readFileSync(resolve(REPO_ROOT, 'website', 'public', file));

const makeHandler = () => createRequestHandler({ appDir: GALLERY, dev: true });

/** Every icon href the rendered head declares, as request paths. */
async function declaredIconPaths(handle) {
  const res = await handle(new Request('http://localhost/'));
  assert.equal(res.status, 200, 'the gallery home page renders');
  // A favicon <link> in <body> is ignored by browsers, so landing in the HEAD
  // is the assertion, not merely appearing somewhere in the document.
  const head = (await res.text()).split('</head>')[0];
  // One pattern covering every rel the framework emits from metadata.icons:
  // "icon", "shortcut icon" and "apple-touch-icon" all carry `icon` in the rel.
  return [...head.matchAll(/<link rel="[^"]*icon[^"]*"[^>]*href="([^"]+)"/g)]
    // absUrl() may have made the href absolute; the handler routes on the path.
    .map((m) => (m[1].startsWith('http') ? new URL(m[1]).pathname : m[1]));
}

test('the gallery head declares a favicon', async () => {
  const app = await makeHandler();
  const paths = await declaredIconPaths(app.handle);
  assert.ok(paths.length > 0, 'the head emits at least one <link rel="icon">');
});

test('every favicon the gallery head declares is actually served', async () => {
  // The original failure mode: a head naming a URL nothing answers. Resolve
  // each one rather than trusting the markup.
  const app = await makeHandler();
  for (const path of new Set(await declaredIconPaths(app.handle))) {
    const res = await app.handle(new Request(`http://localhost${path}`));
    assert.equal(res.status, 200, `${path} is served, not a 404`);
    assert.match(
      res.headers.get('content-type') ?? '',
      /^image\//,
      `${path} is served as an image, so a browser renders it rather than downloading markup`,
    );
  }
});

test('the gallery answers /favicon.ico at the origin root', async () => {
  // The no-markup fallback: crawlers that parse no HTML fetch this path
  // directly. The framework serves public/favicon.ico from the root, so
  // shipping the file is the whole wiring, and it 404'd before.
  const app = await makeHandler();
  const res = await app.handle(new Request('http://localhost/favicon.ico'));
  assert.equal(res.status, 200, '/favicon.ico is served');
});

test('the gallery serves the same brand mark as the website', async () => {
  const app = await makeHandler();
  const bytes = async (path) =>
    Buffer.from(await (await app.handle(new Request(`http://localhost${path}`))).arrayBuffer());

  for (const file of ['favicon.svg', 'favicon-192.png', 'apple-touch-icon.png']) {
    assert.ok(
      (await bytes(`/public/${file}`)).equals(canonical(file)),
      `/public/${file} is byte-identical to the website's copy`,
    );
  }
  assert.ok(
    (await bytes('/favicon.ico')).equals(canonical('favicon.ico')),
    "/favicon.ico is byte-identical to the website's copy",
  );
});

test('the gallery declares the raster icon ahead of the SVG', async () => {
  // Same rule the website follows: Google's favicon crawler takes the first
  // usable icon and renders raster reliably. metadata.icons emits array order,
  // so the order in the layout is the order in the head.
  const app = await makeHandler();
  const paths = await declaredIconPaths(app.handle);
  const png = paths.findIndex((p) => p.endsWith('favicon-192.png'));
  const svg = paths.findIndex((p) => p.endsWith('favicon.svg'));
  assert.ok(png > -1 && svg > -1, 'declares both a PNG and an SVG icon');
  assert.ok(png < svg, 'the PNG is declared ahead of the SVG');
});
