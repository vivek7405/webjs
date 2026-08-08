/**
 * Local-first registry resolution (#983).
 *
 * The registry sources ship in the package, so `add` / `list` / `view` resolve
 * with NO network by default; an explicit `--registry <url>` still fetches. The
 * `diff` carve-out (stays network-default) is covered in diff-command.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getRegistryItem,
  getRegistryIndex,
  isDefaultRegistry,
  DEFAULT_REGISTRY_URL,
  HOSTED_REGISTRY_URL,
} from '../src/registry/fetcher.js';
import { loadRegistryItem, loadRegistryIndex, isCustomElementSource } from '../src/registry/local.js';
import { uiComponent } from '../src/registry/extract.js';

const origFetch = globalThis.fetch;

/** Install a fetch that FAILS loudly, so any accidental network use reds the test. */
function noNetwork() {
  globalThis.fetch = async (url) => {
    throw new Error(`network was hit for ${url} but local-first should not fetch`);
  };
}

test('getRegistryItem: resolves the packaged registry with NO network (default registry)', async () => {
  noNetwork();
  try {
    const btn = await getRegistryItem('button');
    assert.equal(btn.name, 'button');
    assert.ok(btn.files?.[0]?.content, 'file content is inlined from disk');
    assert.deepEqual(btn.registryDependencies, ['lib-utils']);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('getRegistryItem: synthesizes a non-neutral colour theme offline', async () => {
  noNetwork();
  try {
    const theme = await getRegistryItem('theme-stone');
    assert.equal(theme.name, 'theme-stone');
    assert.match(theme.files[0].content, /@webjsdev\/ui theme/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('getRegistryItem: an explicit custom --registry still fetches over the network', async () => {
  let hit = null;
  globalThis.fetch = async (url) => {
    hit = String(url);
    return new Response(JSON.stringify({
      name: 'button', type: 'registry:ui',
      files: [{ path: 'button.ts', type: 'registry:ui', content: '// remote' }],
    }), { status: 200 });
  };
  try {
    const btn = await getRegistryItem('button', 'http://custom/registry');
    assert.equal(btn.files[0].content, '// remote');
    assert.match(hit, /^http:\/\/custom\/registry\/button\.json$/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('getRegistryIndex: resolves offline and includes synthesized themes', async () => {
  noNetwork();
  try {
    const index = await getRegistryIndex();
    assert.ok(index.length >= 32);
    assert.ok(index.some((i) => i.name === 'button'));
    assert.ok(index.some((i) => i.name === 'theme-mauve'));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('getRegistryItem: throws a helpful error for an unknown local item', async () => {
  noNetwork();
  try {
    await assert.rejects(() => getRegistryItem('does-not-exist'), /Unknown registry item/);
    // #1264: and the command it points at has to resolve for the reader.
    await assert.rejects(() => getRegistryItem('does-not-exist'), /Run `npx @webjsdev\/ui list`/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('isDefaultRegistry: only the hosted URL (or unset) is default', () => {
  assert.equal(isDefaultRegistry(undefined), true);
  assert.equal(isDefaultRegistry(HOSTED_REGISTRY_URL), true);
  assert.equal(isDefaultRegistry(DEFAULT_REGISTRY_URL), true); // no env override here
  assert.equal(isDefaultRegistry('http://custom/registry'), false);
});

test('REGISTRY_URL env override forces the network path (not silently local)', () => {
  // Set in a child process so DEFAULT_REGISTRY_URL is computed with the env
  // present. A custom REGISTRY_URL must NOT be treated as the (local-first)
  // default, so a self-hosted registry is never shadowed by the packaged one.
  const fetcherPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'registry', 'fetcher.js');
  const script = `import { isDefaultRegistry, DEFAULT_REGISTRY_URL } from ${JSON.stringify(fetcherPath)};
    process.stdout.write(JSON.stringify({ def: DEFAULT_REGISTRY_URL, isDefault: isDefaultRegistry(DEFAULT_REGISTRY_URL) }));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, REGISTRY_URL: 'https://my.registry/r' },
    encoding: 'utf8',
  });
  const r = JSON.parse(out);
  assert.equal(r.def, 'https://my.registry/r');
  assert.equal(r.isDefault, false, 'a custom REGISTRY_URL is NOT local-first');
});

test('loadRegistryItem: returns null for an unknown name', () => {
  assert.equal(loadRegistryItem('nope-nope'), null);
});

test('loadRegistryIndex: metadata-only entries (no inlined content)', () => {
  const index = loadRegistryIndex();
  const btn = index.find((i) => i.name === 'button');
  assert.ok(btn);
  assert.equal(btn.files, undefined);
});

test('isCustomElementSource: distinguishes Tier-2 elements from Tier-1 helpers', () => {
  assert.equal(isCustomElementSource('class X extends WebComponent({}) {}\nX.register("x-y");'), true);
  assert.equal(isCustomElementSource('export const buttonClass = () => "px-4";'), false);
});

test('isCustomElementSource: a JSDoc that MENTIONS register()/WebComponent does not misclassify a Tier-1 helper', () => {
  const src = '/**\n * Migrated from the prior <ui-accordion> set: it used to call\n * `.register()` and `extends WebComponent`, but is now a pure helper.\n */\nexport const accordionClass = () => "w-full";';
  assert.equal(isCustomElementSource(src), false);
});

test('tier classification: dialog is Tier-2, button is Tier-1 (production path)', () => {
  assert.equal(uiComponent('dialog').tier, 2);
  assert.equal(uiComponent('button').tier, 1);
});
