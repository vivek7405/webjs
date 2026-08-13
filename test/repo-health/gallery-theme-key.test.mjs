/**
 * The gallery's theme bootstrap and its toggle must read and write ONE key.
 *
 * They disagreed: `gallery/components/theme-toggle.ts` persisted the reader's
 * choice under `webjs_theme` while the inline bootstrap in
 * `gallery/app/layout.ts` read `theme`. So the bootstrap looked up a key nothing
 * ever wrote, found nothing, applied no `data-theme`, and every reader who had
 * chosen a theme got a first paint in the OTHER one, then a flash when the
 * toggle upgraded and corrected it.
 *
 * That is a first-paint timing property, which is exactly the shape a test
 * runner cannot observe reliably: by the time any assertion runs, the toggle has
 * upgraded and the two agree again. So this asserts the invariant STATICALLY,
 * on the source, which is both cheap and the only place the defect is visible.
 *
 * `webjs_theme` is the repo-wide key, not an arbitrary pick. The generated app
 * (`packages/cli/lib/create.js`), `examples/blog` and `website/lib/theme.ts`
 * (as `THEME_STORAGE_KEY`) all use it, so this also pins the gallery to the
 * convention rather than letting it drift back to a private key.
 *
 * Lives in the REPO suite, not `gallery/test/`, for the reason
 * `gallery-favicon.test.mjs` states in its own header: `gallery/test/**` is
 * scaffold payload and would be copied into every generated app, where the
 * gallery's layout does not exist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

/** Every localStorage key `src` reads or writes, deduped. */
function themeStorageKeys(src) {
  const keys = new Set();
  for (const m of src.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g)) {
    keys.add(m[1]);
  }
  return [...keys];
}

test('the gallery bootstrap and toggle agree on one theme storage key', () => {
  const layoutKeys = themeStorageKeys(read('gallery/app/layout.ts'));
  const toggleKeys = themeStorageKeys(read('gallery/components/theme-toggle.ts'));

  assert.deepEqual(
    layoutKeys,
    ['webjs_theme'],
    "gallery/app/layout.ts's inline bootstrap must read exactly the shared theme key",
  );
  assert.deepEqual(
    toggleKeys,
    ['webjs_theme'],
    'gallery/components/theme-toggle.ts must read and write exactly the shared theme key',
  );
  // Stated separately from the two above so a future divergence fails on the
  // relationship, naming both sides, rather than on whichever file is checked
  // first. This is the assertion the flash-of-wrong-theme bug would have tripped.
  assert.deepEqual(
    layoutKeys,
    toggleKeys,
    'the bootstrap reads a key the toggle never writes, so a chosen theme paints wrong on first load',
  );
});

test('the shared theme key matches every other app in the repo', () => {
  // The gallery is the reference a scaffolded app is grown from, so a private
  // key here would teach the wrong convention even though nothing would break.
  for (const [rel, expected] of [
    ['packages/cli/lib/create.js', 'webjs_theme'],
    ['examples/blog/components/theme-toggle.ts', 'webjs_theme'],
  ]) {
    assert.ok(
      themeStorageKeys(read(rel)).includes(expected),
      `${rel} still uses the shared '${expected}' key`,
    );
  }
  assert.match(
    read('website/lib/theme.ts'),
    /THEME_STORAGE_KEY\s*=\s*'webjs_theme'/,
    "website/lib/theme.ts still exports the shared key as THEME_STORAGE_KEY",
  );
});
