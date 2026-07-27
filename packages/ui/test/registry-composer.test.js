/**
 * Unit tests for the registry composer
 * (`website/modules/ui/queries/registry.server.ts`).
 *
 * The composer turns the on-disk registry.json + theme synthesis logic
 * into the JSON the CLI fetches at runtime via /registry/<name>.json.
 * Before these tests, the composer was only exercised via live curl
 * during merges: a regression in the contract (e.g. a theme dropping
 * out of the index, or the cache returning a stale value) wouldn't
 * surface until production.
 *
 * The composer moved out of this package with #1099, when the gallery and
 * the registry API merged into the marketing site. It still reads the
 * sources in `packages/ui/packages/registry/`, which is why its tests stay
 * here next to the registry they describe.
 *
 * Imports the .ts module directly: Node 22+ strips types natively, so
 * no transpile step is needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'website',
  'modules',
  'ui',
  'queries',
  'registry.server.ts',
);

const skip = !existsSync(COMPOSER_PATH);

// Note: the composer caches the manifest, the per-item items, and the
// index after first read. These tests are written so they don't depend
// on cache state: each `await` returns whatever the composer has,
// fresh or cached, and we assert on the data shape. The cache test
// explicitly checks that two calls return the same object reference.

test('loadRegistryItem: returns a manifest item (button) with inlined source', { skip }, async () => {
  const { loadRegistryItem } = await import(COMPOSER_PATH);
  const item = await loadRegistryItem('button');
  assert.ok(item, 'button item must exist');
  assert.equal(item.name, 'button');
  assert.equal(item.type, 'registry:ui');
  assert.ok(Array.isArray(item.files));
  assert.ok(item.files.length > 0);
  // File content should be inlined verbatim from disk.
  const file = item.files[0];
  assert.equal(file.path, 'components/button.ts');
  assert.match(file.content, /export function buttonClass/);
});

test('loadRegistryItem: returns lib-utils with target field', { skip }, async () => {
  const { loadRegistryItem } = await import(COMPOSER_PATH);
  const item = await loadRegistryItem('lib-utils');
  assert.ok(item, 'lib-utils must exist');
  assert.equal(item.type, 'registry:lib');
  assert.equal(item.files[0].target, 'lib/utils.ts');
  assert.match(item.files[0].content, /export function cn/);
});

test('loadRegistryItem: returns the canonical theme-neutral from manifest', { skip }, async () => {
  const { loadRegistryItem } = await import(COMPOSER_PATH);
  const item = await loadRegistryItem('theme-neutral');
  assert.ok(item);
  assert.equal(item.type, 'registry:theme');
  assert.equal(item.files[0].target, 'app/globals.css');
  // Neutral CSS contains the canonical :root + .dark blocks.
  assert.match(item.files[0].content, /:root\s*\{/);
  assert.match(item.files[0].content, /\.dark\s*\{/);
});

test('loadRegistryItem: synthesizes theme-stone from base-colors data', { skip }, async () => {
  const { loadRegistryItem } = await import(COMPOSER_PATH);
  const item = await loadRegistryItem('theme-stone');
  assert.ok(item, 'theme-stone is synthesized on demand');
  assert.equal(item.type, 'registry:theme');
  assert.equal(item.title, 'Stone');
  assert.equal(item.files[0].target, 'app/globals.css');
  // Stone overrides include a specific oklch ring value.
  assert.match(item.files[0].content, /--ring: oklch\(0\.709 0\.01 56\.259\)/);
  // The original neutral ring is replaced.
  assert.doesNotMatch(item.files[0].content, /--ring: oklch\(0\.708 0 0\)/);
});

test('loadRegistryItem: synthesizes all 6 non-neutral colour themes', { skip }, async () => {
  const { loadRegistryItem } = await import(COMPOSER_PATH);
  for (const color of ['stone', 'zinc', 'mauve', 'olive', 'mist', 'taupe']) {
    const item = await loadRegistryItem(`theme-${color}`);
    assert.ok(item, `theme-${color} must synthesize`);
    assert.equal(item.type, 'registry:theme');
    assert.ok(item.files[0].content.length > 1000, `${color} must have non-trivial CSS body`);
  }
});

test('loadRegistryItem: returns null for unknown slug', { skip }, async () => {
  const { loadRegistryItem } = await import(COMPOSER_PATH);
  const item = await loadRegistryItem('does-not-exist');
  assert.equal(item, null);
});

test('loadRegistryItem: returns null for unknown theme colour', { skip }, async () => {
  const { loadRegistryItem } = await import(COMPOSER_PATH);
  const item = await loadRegistryItem('theme-fuchsia');
  assert.equal(item, null);
});

test('loadRegistryItem: second call returns the cached object', { skip }, async () => {
  const { loadRegistryItem } = await import(COMPOSER_PATH);
  const a = await loadRegistryItem('button');
  const b = await loadRegistryItem('button');
  assert.equal(a, b, 'identical reference proves cache hit');
});

test('loadRegistryIndex: includes every registry:ui component + lib + theme-neutral + 6 synthesized themes', { skip }, async () => {
  const { loadRegistryIndex } = await import(COMPOSER_PATH);
  const items = await loadRegistryIndex();
  const byName = new Map(items.map((it) => [it.name, it]));

  // Lib + canonical neutral theme.
  assert.ok(byName.has('lib-utils'));
  assert.ok(byName.has('theme-neutral'));

  // All 6 synthesized themes.
  for (const color of ['stone', 'zinc', 'mauve', 'olive', 'mist', 'taupe']) {
    assert.ok(byName.has(`theme-${color}`), `theme-${color} should appear in the index`);
    assert.equal(byName.get(`theme-${color}`).type, 'registry:theme');
  }

  // Spot-check a few Tier-1 + Tier-2 components.
  for (const name of ['button', 'card', 'input', 'dialog', 'tabs', 'popover']) {
    assert.ok(byName.has(name), `${name} should appear in the index`);
    assert.equal(byName.get(name).type, 'registry:ui');
  }

  // Index entries are metadata-only: no inlined file content.
  for (const it of items) {
    assert.equal(it.files, undefined, `${it.name}: index entries must not inline files`);
  }
});

test('loadRegistryIndex: total count: ≥32 ui + lib-utils + 7 themes', { skip }, async () => {
  const { loadRegistryIndex } = await import(COMPOSER_PATH);
  const items = await loadRegistryIndex();
  const ui = items.filter((it) => it.type === 'registry:ui');
  const themes = items.filter((it) => it.type === 'registry:theme');
  const libs = items.filter((it) => it.type === 'registry:lib');
  assert.ok(ui.length >= 32, `expected ≥32 ui items, found ${ui.length}`);
  assert.equal(themes.length, 7, 'exactly 7 themes (1 neutral + 6 synthesized)');
  assert.ok(libs.length >= 1, 'at least lib-utils');
});

test('loadRegistryManifest: returns valid JSON with every item inlined', { skip }, async () => {
  const { loadRegistryManifest } = await import(COMPOSER_PATH);
  const body = await loadRegistryManifest();
  assert.equal(typeof body, 'string');
  const parsed = JSON.parse(body); // throws on invalid JSON
  assert.ok(Array.isArray(parsed.items));
  // Every item must have files[].content inlined (manifest is the "everything bundled" endpoint).
  for (const it of parsed.items) {
    if (!it.files) continue;
    for (const f of it.files) {
      assert.ok(typeof f.content === 'string', `${it.name}: file ${f.path} missing inlined content`);
    }
  }
  // All 7 themes are present.
  const themeNames = parsed.items.filter((it) => it.type === 'registry:theme').map((it) => it.name).sort();
  assert.deepEqual(themeNames, [
    'theme-mauve',
    'theme-mist',
    'theme-neutral',
    'theme-olive',
    'theme-stone',
    'theme-taupe',
    'theme-zinc',
  ]);
});

test('loadRegistryManifest: schema field is set on every item', { skip }, async () => {
  const { loadRegistryManifest } = await import(COMPOSER_PATH);
  const parsed = JSON.parse(await loadRegistryManifest());
  for (const it of parsed.items) {
    assert.equal(it.$schema, 'https://ui.webjs.dev/schema/registry-item.json', `${it.name}: missing $schema`);
  }
});
