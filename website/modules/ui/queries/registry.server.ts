'use server';

/**
 * Registry composer: reads the source files from `packages/ui/packages/registry/`
 * and produces shadcn-compatible registry JSON on demand. Replaces the old
 * `node scripts/build.js → r/*.json` step: no committed build output, no
 * `prestart` hook, source-of-truth is the .ts files + registry.json manifest
 * + themes/base-colors.js.
 *
 * The 6 non-neutral base-colour themes (`theme-stone`, `theme-zinc`,
 * `theme-mauve`, `theme-olive`, `theme-mist`, `theme-taupe`) are NOT listed
 * in registry.json: they're synthesized here by merging per-colour overrides
 * from `themes/base-colors.js` into the canonical `themes/index.css`. The
 * resulting JSON has the same `files: [{ target: 'app/globals.css', content }]`
 * shape as `theme-neutral` so the CLI's `webjsui init --base-color <color>`
 * works uniformly for all 7 colours.
 *
 * Cached in memory after first read so subsequent requests don't repeat the
 * file I/O. The website dev server restarts on source changes, so cache
 * invalidation isn't needed in dev. Prod is read-only.
 *
 * A note on the one-function-per-file convention for a feature's `queries`
 * directory: this file deliberately exports three reads (item, index,
 * manifest) instead
 * of splitting into three files. They are three views of ONE parse and they
 * share the module-level caches, so splitting them would either duplicate the
 * cache per view (losing the same-reference guarantee the composer tests pin)
 * or need a fourth internal module holding the state the three then import.
 * Both are worse than one cohesive composer. `webjs check` agrees: its
 * one-function rule covers a CONFIGURED action file, which this is not.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASE_COLORS,
  BASE_TITLES,
  BASE_DESCRIPTIONS,
  BASE_OVERRIDES,
  mergeThemeCss,
} from '../../../../packages/ui/packages/registry/themes/base-colors.js';

// modules/ui/queries/ → repo root is four levels up; the registry stays in
// the ui package (it ships inside the published npm tarball), the same way
// app/changelog reads ../../../changelog. The deploy image carries it via
// the Dockerfile's `COPY packages` line.
const REGISTRY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
  'packages', 'ui', 'packages', 'registry',
);
const MANIFEST_PATH = join(REGISTRY_ROOT, 'registry.json');
const NEUTRAL_CSS_PATH = join(REGISTRY_ROOT, 'themes', 'index.css');
// Deliberately unchanged by the move to webjs.dev/ui. This URL 404s today and
// always has (probed live before the migration), and nothing resolves it at
// runtime: it is an inert JSON Schema reference that rides in the served
// registry JSON and gets written into users' components.json. Repointing a
// dead link at a new domain would churn every consumer's file without making
// anything resolve, so the value stays byte-identical to what shipped
// clients already carry. Making it actually resolve is separate work.
const SCHEMA = 'https://ui.webjs.dev/schema/registry-item.json';

export type RegistryFile = {
  path: string;
  type: string;
  target?: string;
  content?: string;
};

export type RegistryItem = {
  $schema?: string;
  name: string;
  type: string;
  description?: string;
  title?: string;
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  files?: RegistryFile[];
};

type Manifest = {
  name?: string;
  homepage?: string;
  items: RegistryItem[];
};

let manifestCache: Manifest | null = null;
let neutralCssCache: string | null = null;
const itemCache = new Map<string, RegistryItem>();
let indexCache: RegistryItem[] | null = null;

function readManifest(): Manifest {
  if (manifestCache) return manifestCache;
  manifestCache = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  return manifestCache;
}

function readNeutralCss(): string {
  if (neutralCssCache) return neutralCssCache;
  neutralCssCache = readFileSync(NEUTRAL_CSS_PATH, 'utf8');
  return neutralCssCache;
}

function inlineFiles(item: RegistryItem): RegistryItem {
  return {
    $schema: SCHEMA,
    ...item,
    files: (item.files || []).map((f) => {
      const abs = resolve(REGISTRY_ROOT, f.path);
      if (!existsSync(abs)) return { ...f, content: '' };
      return { ...f, content: readFileSync(abs, 'utf8') };
    }),
  };
}

/**
 * Synthesize a `theme-<color>` item by merging the colour's overrides
 * into the canonical neutral CSS. Returns the same `files[]` shape as
 * the manifest's `theme-neutral` entry so the CLI handles all colours
 * via one code path.
 */
function synthesizeColorTheme(color: string): RegistryItem | null {
  if (!BASE_COLORS.includes(color)) return null;
  const overrides = BASE_OVERRIDES[color as keyof typeof BASE_OVERRIDES];
  const content = mergeThemeCss(readNeutralCss(), overrides);
  return {
    $schema: SCHEMA,
    name: `theme-${color}`,
    type: 'registry:theme',
    title: BASE_TITLES[color as keyof typeof BASE_TITLES],
    description: BASE_DESCRIPTIONS[color as keyof typeof BASE_DESCRIPTIONS],
    files: [
      {
        path: 'themes/index.css',
        type: 'registry:file',
        target: 'app/globals.css',
        content,
      },
    ],
  };
}

/** Load a single registry item by name. Returns null if not in the manifest. */
export async function loadRegistryItem(name: string): Promise<RegistryItem | null> {
  if (itemCache.has(name)) return itemCache.get(name)!;

  // Manifest items (components, lib-utils, theme-neutral): inline file content.
  const manifestItem = readManifest().items.find((it) => it.name === name);
  if (manifestItem) {
    const composed = inlineFiles(manifestItem);
    itemCache.set(name, composed);
    return composed;
  }

  // Synthesized non-neutral base-colour themes.
  if (name.startsWith('theme-')) {
    const color = name.slice('theme-'.length);
    const synth = synthesizeColorTheme(color);
    if (synth) {
      itemCache.set(name, synth);
      return synth;
    }
  }

  return null;
}

/** Load the flat registry index (one entry per item, metadata-only: no inlined content). */
export async function loadRegistryIndex(): Promise<RegistryItem[]> {
  if (indexCache) return indexCache;
  const fromManifest = readManifest().items.map((item) => ({
    name: item.name,
    type: item.type,
    description: item.description,
    dependencies: item.dependencies,
    registryDependencies: item.registryDependencies,
  }));
  // Append synthesized colour themes that aren't already in the manifest.
  const manifestNames = new Set(fromManifest.map((it) => it.name));
  const synthesized = BASE_COLORS
    .filter((color) => !manifestNames.has(`theme-${color}`))
    .map((color) => ({
      name: `theme-${color}`,
      type: 'registry:theme',
      description: BASE_DESCRIPTIONS[color as keyof typeof BASE_DESCRIPTIONS],
    }));
  indexCache = [...fromManifest, ...synthesized];
  return indexCache;
}

/** Load the full registry manifest with every item's content inlined. Returns a JSON string. */
export async function loadRegistryManifest(): Promise<string> {
  const manifest = readManifest();
  const manifestItems = manifest.items.map(inlineFiles);
  // Append synthesized colour themes so the full manifest includes everything
  // the index lists.
  const manifestNames = new Set(manifestItems.map((it) => it.name));
  const synthesizedThemes = BASE_COLORS
    .filter((color) => !manifestNames.has(`theme-${color}`))
    .map((color) => synthesizeColorTheme(color))
    .filter((it): it is RegistryItem => it !== null);
  return JSON.stringify(
    { ...manifest, items: [...manifestItems, ...synthesizedThemes] },
    null,
    2,
  );
}
