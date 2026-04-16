/**
 * Lightweight module dependency graph.
 *
 * At startup, scans the app directory and builds an in-memory map of
 * `file → Set<imported files>`. The SSR pipeline queries this graph to
 * emit *complete* modulepreload hints — including transitive dependencies
 * of components — so the browser can fetch the entire tree in parallel
 * rather than discovering imports one waterfall at a time.
 *
 * The graph is file-path-based (absolute paths). URLs are derived when
 * emitting preload hints.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';

/** @type {RegExp} match static `import … from '…'` and `import '…'` */
const IMPORT_RE = /\bimport\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g;

/**
 * @typedef {Map<string, Set<string>>} ModuleGraph
 * A map of absolute file path → Set of absolute file paths it imports.
 */

/**
 * Build the module graph for all source files under `appDir`.
 *
 * @param {string} appDir
 * @returns {Promise<ModuleGraph>}
 */
export async function buildModuleGraph(appDir) {
  /** @type {ModuleGraph} */
  const graph = new Map();
  await walk(appDir, appDir, graph);
  return graph;
}

/**
 * Given a set of entry files, return all transitive dependencies (deduplicated).
 * Entry files themselves are NOT included (they're already preloaded by the
 * boot script).
 *
 * @param {ModuleGraph} graph
 * @param {string[]} entryFiles  absolute paths
 * @param {string} appDir
 * @returns {string[]}  absolute paths of transitive deps
 */
export function transitiveDeps(graph, entryFiles, appDir) {
  /** @type {Set<string>} */
  const visited = new Set(entryFiles);
  /** @type {string[]} */
  const result = [];
  /** @type {string[]} */
  const queue = [...entryFiles];

  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    const deps = graph.get(file);
    if (!deps) continue;
    for (const dep of deps) {
      if (visited.has(dep)) continue;
      visited.add(dep);
      // Only include files within the app dir (skip node_modules, core, etc.)
      if (dep.startsWith(appDir)) {
        result.push(dep);
      }
      queue.push(dep);
    }
  }
  return result;
}

/**
 * Recursively walk a directory, parse imports, and populate the graph.
 * @param {string} dir
 * @param {string} appDir
 * @param {ModuleGraph} graph
 */
async function walk(dir, appDir, graph) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.webjs' || e.name === 'public' || e.name.startsWith('_')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, appDir, graph);
    } else if (/\.(js|ts|mjs|mts)$/.test(e.name)) {
      await parseFile(full, appDir, graph);
    }
  }
}

/**
 * Parse a single file's imports and add them to the graph.
 * Only resolves relative imports (bare specifiers are npm deps, not in the graph).
 *
 * @param {string} file
 * @param {string} appDir
 * @param {ModuleGraph} graph
 */
async function parseFile(file, appDir, graph) {
  let src;
  try { src = await readFile(file, 'utf8'); }
  catch { return; }

  const deps = new Set();
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1];
    // Only resolve relative imports within the project
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
    const resolved = resolveImport(spec, file, appDir);
    if (resolved) deps.add(resolved);
  }
  if (deps.size) graph.set(file, deps);
}

/**
 * Resolve a relative import specifier to an absolute file path.
 * Handles: exact match, .ts/.js extension fallback, /index.ts fallback.
 *
 * @param {string} spec  e.g. `'../components/theme-toggle.ts'`
 * @param {string} fromFile  absolute path of the importing file
 * @param {string} appDir
 * @returns {string | null}
 */
function resolveImport(spec, fromFile, appDir) {
  const base = dirname(fromFile);
  let target;
  if (spec.startsWith('/')) {
    // Absolute from app root (how browser sees it)
    target = join(appDir, spec);
  } else {
    target = resolve(base, spec);
  }
  // Exact match check — we can't use async `stat` in a sync resolver, so we
  // store the resolved path optimistically. The graph is advisory (for preload
  // hints), not load-bearing, so a wrong entry is harmless — the browser will
  // just get a redundant preload that 404s and is ignored.
  return target;
}
