/**
 * Local registry composer (#983).
 *
 * The registry SOURCES ship inside this npm package (`packages/ui/package.json`
 * `files` includes `packages/registry`), so `webjsui add` / `list` / `view` and
 * the MCP `ui` tool can resolve a component with NO network round-trip. This
 * module reads those on-disk sources and composes the same shadcn-compatible
 * item shape the hosted registry serves, so a local read and a network fetch
 * are interchangeable for every consumer.
 *
 * It is the plain-JS twin of the website gallery composer
 * (`website/modules/ui/queries/registry.server.ts`): both read
 * `packages/registry/registry.json` + the `components/*.ts` sources and
 * synthesize the 6 non-neutral base-colour themes from `themes/base-colors.js`.
 * Keeping the CLI on this module (rather than always hitting the network) is
 * what makes an autonomous agent's `add` deterministic and offline-safe.
 *
 * Resolution is relative to THIS module (`import.meta.url`), i.e. the installed
 * `@webjsdev/ui` package, NOT `process.cwd()`: `webjsui` runs inside a user's
 * project but the registry lives in the installed package.
 *
 * @module registry/local
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
} from '../../packages/registry/themes/base-colors.js';

/** Absolute path to the packaged registry root (`packages/ui/packages/registry`). */
export const REGISTRY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'registry',
);
const MANIFEST_PATH = join(REGISTRY_ROOT, 'registry.json');
const NEUTRAL_CSS_PATH = join(REGISTRY_ROOT, 'themes', 'index.css');
const SCHEMA = 'https://ui.webjs.dev/schema/registry-item.json';

let manifestCache = null;
let neutralCssCache = null;
const itemCache = new Map();
let indexCache = null;

function readManifest() {
  if (manifestCache) return manifestCache;
  manifestCache = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  return manifestCache;
}

function readNeutralCss() {
  if (neutralCssCache) return neutralCssCache;
  neutralCssCache = readFileSync(NEUTRAL_CSS_PATH, 'utf8');
  return neutralCssCache;
}

/**
 * Return the item with each declared file's on-disk content inlined. A file
 * whose source is missing degrades to empty content rather than throwing.
 *
 * @param {any} item
 * @returns {any}
 */
function inlineFiles(item) {
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
 * Synthesize a `theme-<color>` item by merging the colour's overrides into the
 * canonical neutral CSS, matching the manifest's `theme-neutral` shape so
 * `webjsui init --base-color <color>` handles all 7 colours via one path.
 *
 * @param {string} color
 * @returns {any|null}
 */
function synthesizeColorTheme(color) {
  if (!BASE_COLORS.includes(color)) return null;
  const overrides = BASE_OVERRIDES[color];
  const content = mergeThemeCss(readNeutralCss(), overrides);
  return {
    $schema: SCHEMA,
    name: `theme-${color}`,
    type: 'registry:theme',
    title: BASE_TITLES[color],
    description: BASE_DESCRIPTIONS[color],
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

/**
 * Load one registry item by name with its file content inlined. Returns null
 * when the name is neither a manifest item nor a synthesizable colour theme.
 *
 * @param {string} name
 * @returns {any|null}
 */
export function loadRegistryItem(name) {
  if (itemCache.has(name)) return itemCache.get(name);

  const manifestItem = readManifest().items.find((it) => it.name === name);
  if (manifestItem) {
    const composed = inlineFiles(manifestItem);
    itemCache.set(name, composed);
    return composed;
  }

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

/**
 * Load the flat registry index (metadata only, no inlined content), including
 * the synthesized non-neutral colour themes.
 *
 * @returns {any[]}
 */
export function loadRegistryIndex() {
  if (indexCache) return indexCache;
  const fromManifest = readManifest().items.map((item) => ({
    name: item.name,
    type: item.type,
    description: item.description,
    dependencies: item.dependencies,
    registryDependencies: item.registryDependencies,
  }));
  const manifestNames = new Set(fromManifest.map((it) => it.name));
  const synthesized = BASE_COLORS.filter(
    (color) => !manifestNames.has(`theme-${color}`),
  ).map((color) => ({
    name: `theme-${color}`,
    type: 'registry:theme',
    description: BASE_DESCRIPTIONS[color],
  }));
  indexCache = [...fromManifest, ...synthesized];
  return indexCache;
}

/**
 * Strip `/* *​/` block comments and `//` line comments so a token check keys on
 * CODE, not prose. Rough (does not honour a `//` inside a string), but a
 * component's JSDoc is the realistic false-positive source, and the leading
 * module JSDoc is exactly what this removes.
 *
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * True when a component source defines/registers a custom element (Tier-2). A
 * Tier-1 helper file exports only class-string functions and matches none of
 * these. Used to gate the example-strip (Tier-2 files are left whole) and to
 * label the kit inventory. Comments are stripped first so a JSDoc that merely
 * MENTIONS `.register(` or `WebComponent` does not misclassify a Tier-1 helper.
 *
 * @param {string} src
 * @returns {boolean}
 */
export function isCustomElementSource(src) {
  const code = stripComments(src);
  return (
    /\bextends\s+WebComponent\b/.test(code) ||
    /\bcustomElements\.define\b/.test(code) ||
    /\.register\(/.test(code)
  );
}

/** Reset the in-memory caches. Test-only. */
export function _resetCache() {
  manifestCache = null;
  neutralCssCache = null;
  indexCache = null;
  itemCache.clear();
}
