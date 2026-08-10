/**
 * The gallery / scaffold payload boundary.
 *
 * `gallery/` does double duty. It is the single canonical source of the feature
 * gallery that `webjs create` copies into every generated app, AND it is a live
 * app deployed on its own at gallery.webjs.dev. Those two roles want opposite
 * things from its design: the deployed app should carry WebJs branding, and the
 * copied demos must stay neutral, because an app-building agent reads them for
 * idioms and a vividly branded example outweighs a prose instruction telling it
 * to choose its own palette.
 *
 * Both hold at once only because a narrow set of files is gallery-only, namely
 * the four in `packages/cli/lib/gallery-shell-files.js` plus all of
 * `gallery/public/`, which neither copier reads. Nothing enforced that split
 * before this file: `copyGallery()`'s filter could stop filtering, a brand
 * helper could be added under `gallery/lib/`, or the two copiers' directory
 * lists could drift, and every existing suite would stay green while WebJs
 * branding shipped into every generated app.
 *
 * Three assertions, because each catches a regression the other two miss, and
 * each was confirmed to fail against a deliberately broken tree.
 *
 * This lives in the REPO suite rather than in `gallery/test/`, for the reason
 * `gallery-favicon.test.mjs` states in its own header: `gallery/test/**` is
 * itself scaffold payload, so a guard placed there would be copied into every
 * generated app, where the thing it guards does not exist, and a stray
 * directory also defeats `gallery:clear`'s prune of an empty `test/` (asserted
 * by test/scaffolds/scaffold-gallery.test.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scaffoldApp } from '../../packages/cli/lib/create.js';
import { GALLERY_APP_SHELL_FILES } from '../../packages/cli/lib/gallery-shell-files.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GALLERY = resolve(REPO_ROOT, 'gallery');

/** Generate a full-stack app into a temp dir and hand its root to `fn`. */
async function withGeneratedApp(fn) {
  const cwd = await mkdtemp(join(tmpdir(), 'webjs-payload-'));
  try {
    // `install` is opt-in, so this touches no network and runs no npm install.
    await scaffoldApp('demo', cwd, { template: 'full-stack' });
    await fn(join(cwd, 'demo'));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

/** Every file in `dir`, as paths relative to it, POSIX-separated. */
async function walk(dir, root = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await walk(p, root, out);
    else if (entry.isFile()) out.push(relative(root, p).split(sep).join('/'));
  }
  return out;
}

/**
 * The `for (const sub of [...])` subdirectory list a copier iterates. Both
 * copiers hold their own literal, which is exactly the duplication that invites
 * drift, so assertion 3 compares them.
 */
function subdirListOf(file) {
  const src = readFileSync(resolve(REPO_ROOT, file), 'utf8');
  const m = src.match(/for \(const sub of \[([^\]]+)\]\)/);
  assert.ok(m, `${file} still has a for-of over a subdirectory array literal`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

/**
 * `lib/utils/cn.ts` is in the shell list but cannot be asserted this way. The
 * gallery's copy and the generated one are BOTH read verbatim from the same
 * source, `packages/ui/packages/registry/lib/utils.ts` (confirmed byte-equal to
 * both), which is deliberate so that `webjs ui add` stays in lockstep with the
 * kit. So the two files are identical whether the filter runs or not, and an
 * equality check on it would be tautological rather than discriminating. The
 * other three carry generator-only content and do discriminate.
 */
const SHELL_FILES_WITH_DISTINCT_CONTENT = GALLERY_APP_SHELL_FILES.filter(
  (rel) => rel !== 'lib/utils/cn.ts',
);

test('the gallery app-shell files are not copied into a generated app', async () => {
  assert.equal(
    SHELL_FILES_WITH_DISTINCT_CONTENT.length,
    3,
    'the shell list changed, so re-check which entries this assertion can discriminate',
  );
  await withGeneratedApp(async (appDir) => {
    for (const rel of SHELL_FILES_WITH_DISTINCT_CONTENT) {
      const generated = await readFile(join(appDir, rel)).catch(() => null);
      // All three DO exist in a generated app, because the generator writes its
      // own with things the gallery's copies cannot carry (the app's
      // displayName, cspNonce() wiring, LayoutProps typing, metadata.icons). So
      // byte INEQUALITY is what actually fires here; a missing file passes too.
      if (generated === null) continue;
      const galleryCopy = await readFile(join(GALLERY, rel));
      assert.notEqual(
        generated.equals(galleryCopy),
        true,
        `${rel} was copied from gallery/ into the generated app verbatim, so the shell filter is not filtering`,
      );
    }
  });
});

test('no gallery-only branding reaches scaffold payload', async () => {
  // Markers this change introduces into the gallery-only surfaces ONLY. Each is
  // absent from a generated app today, so any hit is a leak. They are chosen to
  // catch the specific mistakes the boundary invites: putting the lockup in
  // gallery/lib/design/brand.ts, or restyling gallery/app/opengraph-image.ts or
  // gallery/app/global-error.ts, which read like brand surfaces and are payload.
  const markers = [
    '/public/brand/webjs-lockup', // the brand lockup asset path
    '/public/fonts/inter', // the self-hosted font paths
    'Inter Tight', // the display face
    '0.16 52', // the warm accent hue literal
  ];
  await withGeneratedApp(async (appDir) => {
    const files = await walk(appDir);
    const leaks = [];
    for (const rel of files) {
      // Skip binaries: a woff2 or a png cannot carry a marker meaningfully and
      // decoding one as utf8 invites a false positive.
      if (/\.(woff2?|png|jpg|jpeg|ico|zip|db|sqlite)$/i.test(rel)) continue;
      const text = await readFile(join(appDir, rel), 'utf8').catch(() => '');
      for (const marker of markers) {
        if (text.includes(marker)) leaks.push(`${rel} contains ${JSON.stringify(marker)}`);
      }
    }
    assert.deepEqual(
      leaks,
      [],
      `gallery-only branding reached scaffold payload:\n  ${leaks.join('\n  ')}`,
    );
  });
});

test('the two copiers agree on which gallery subdirectories are payload', () => {
  // create.js copies the gallery at scaffold time; sync-scaffold-gallery.mjs
  // bundles it into the CLI tarball at prepack. They hold the same five members
  // in a different order, and order is not observable, so compare as sets.
  const fromCreate = subdirListOf('packages/cli/lib/create.js');
  const fromSync = subdirListOf('scripts/sync-scaffold-gallery.mjs');
  assert.deepEqual(
    fromCreate,
    fromSync,
    'copyGallery() and sync-scaffold-gallery.mjs copy different gallery subdirectories, so the published tarball and a monorepo-dev scaffold would not match',
  );
});
