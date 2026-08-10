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
import { GALLERY_APP_SHELL_FILES, isGalleryAppShellFile } from '../../packages/cli/lib/gallery-shell-files.js';

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
 * What actually keeps the gallery's branded shell out of a generated app is the
 * generator's WRITE ORDER, not `copyGallery()`'s filter. Measured on the tree
 * this test was written against:
 *
 *   L1134  writeUiBootstrap()                    writes lib/utils/cn.ts
 *   L1185  copyGallery()                         copies the gallery
 *   L1187  writeFile(app/layout.ts)              overwrites
 *   L1376  writeFile(app/page.ts)                overwrites
 *   L1455  writeFile(components/theme-toggle.ts) overwrites
 *
 * Three of the four shell files are rewritten by the generator AFTER the copy,
 * and the fourth is byte-identical to the gallery's (both are read verbatim
 * from packages/ui/packages/registry/lib/utils.ts, deliberately, so that
 * `webjs ui add` stays in lockstep with the kit). Neutering the filter
 * therefore changes NOTHING about the generated output, which was confirmed by
 * running that exact counterfactual: an equality check on the generated files
 * stays green with the filter fully removed, so it is tautological rather than
 * discriminating and is not worth having.
 *
 * The filter is real defence-in-depth (it keeps the shell out of the published
 * `templates/gallery/` bundle) but it is not the load-bearing mechanism. So
 * assert the mechanism that is: the three generator writes must follow the
 * copy. Move `copyGallery()` below any of them and the gallery's branded shell
 * wins, which is precisely the regression this file exists to catch.
 */
test('the generator writes its own app shell AFTER copying the gallery', () => {
  const src = readFileSync(resolve(REPO_ROOT, 'packages/cli/lib/create.js'), 'utf8');

  const copyAt = src.indexOf('await copyGallery(appDir)');
  assert.notEqual(copyAt, -1, 'create.js still calls copyGallery(appDir)');

  // Each generator write, by the literal that starts its writeFile call.
  const writes = [
    ["app/layout.ts", "await writeFile(join(appDir, 'app', 'layout.ts')"],
    ["app/page.ts", "await writeFile(join(appDir, 'app', 'page.ts')"],
    ["components/theme-toggle.ts", "await writeFile(join(appDir, 'components', 'theme-toggle.ts')"],
  ];

  for (const [rel, needle] of writes) {
    const at = src.indexOf(needle);
    assert.notEqual(at, -1, `create.js still writes its own ${rel}`);
    assert.ok(
      at > copyAt,
      `create.js writes its own ${rel} BEFORE copyGallery(), so the gallery's branded copy would overwrite it and ship into every generated app`,
    );
  }

  // The predicate itself, so a shell entry cannot silently stop matching.
  for (const rel of GALLERY_APP_SHELL_FILES) {
    assert.ok(isGalleryAppShellFile(rel), `${rel} is recognised as a gallery-only shell file`);
  }
  assert.equal(
    isGalleryAppShellFile('app/global-error.ts'),
    false,
    'a payload file is NOT treated as gallery-only',
  );
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
