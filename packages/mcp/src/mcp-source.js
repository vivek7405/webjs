/**
 * The `source` tool for `webjs mcp` (#378): read-only access to the FRAMEWORK
 * source itself.
 *
 * WebJs is buildless, so every app's `node_modules/@webjsdev/<pkg>/src` holds the
 * authored JSDoc `.js`, and server-side that source runs directly. (The one built
 * artifact is the `@webjsdev/core` browser bundle in `dist/`, which this tool
 * deliberately skips: it surfaces only the authored `src/`.) That is a real
 * advantage: when the docs do not answer a question, an agent can read the real
 * authored source. This tool makes that first-class and
 * discoverable (and reachable for an MCP-only client with no filesystem tools):
 *   - no args (or `package`): list the resolved `@webjsdev/*` packages + their
 *     `src/` entry-point files.
 *   - `query`: grep the framework `src/` trees, returning bounded `file:line`
 *     hits (with a disclosed cap, no silent truncation).
 *   - `path`: read one source file (e.g. `server/src/ssr/head.js`; the bare
 *     `server/src/ssr.js` is a barrel over the sibling directory), traversal-guarded
 *     to stay inside a resolved framework package root.
 *
 * READ-ONLY and side-effect-free: it only reads files, loads no module, and
 * cannot read outside the resolved `@webjsdev/*` package roots. Zero-dependency,
 * consistent with the rest of the server. PURE given injected `deps`
 * (`{ roots, readFile, readdir }`), so it is testable against a fake tree.
 *
 * @module mcp-source
 */

import { createRequire } from 'node:module';
import { join, resolve, sep, relative } from 'node:path';

/** The published framework packages whose source an agent may want to read. */
export const FRAMEWORK_PACKAGES = ['core', 'server', 'cli', 'intellisense', 'ui'];

/** Source file extensions worth grepping / reading (text, not assets). */
const TEXT_EXT = /\.(?:js|ts|mjs|mts|cjs|cts|json|md)$/i;

/** Bound the grep output (disclosed when hit) and the walk (defensive). */
const MAX_HITS = 60;
const MAX_FILES = 4000;

/**
 * Resolve each `@webjsdev/*` package's root + source dir from `cwd`. Locates the
 * root by checking each `require.resolve.paths` node_modules dir on disk for
 * `@webjsdev/<pkg>/package.json`, so it works for a real `node_modules` install
 * AND the monorepo workspace (where the dir is a symlink to `packages/<pkg>`),
 * and honours hoisting. This fs check is deliberate: `<pkg>/package.json` is
 * blocked by `exports` for server/cli/ui, and the bin-only cli has no main
 * entry, so neither `resolve('<pkg>/package.json')` nor `resolve('<pkg>')` is
 * reliable. The source dir is `src/`, or `lib/` for the cli. A package that is
 * not installed is skipped (not every app depends on every `@webjsdev/*`).
 *
 * @param {string} cwd
 * @param {{ exists: (p: string) => boolean }} fsDeps
 * @returns {Array<{ pkg: string, root: string, src: string }>}
 */
export function resolveFrameworkRoots(cwd, fsDeps) {
  const req = createRequire(join(cwd, '__webjs_mcp_source__.js'));
  /** @type {Array<{ pkg: string, root: string, src: string }>} */
  const out = [];
  for (const pkg of FRAMEWORK_PACKAGES) {
    // Find the package ROOT by checking each node_modules search path on disk,
    // NOT via `require.resolve('<pkg>')` or `<pkg>/package.json`: a package whose
    // `exports` omits `./package.json` (server/cli/ui) or that has no main entry
    // (cli is a bin-only package) would otherwise be unreachable. The fs check
    // bypasses both and still honours hoisting (the search paths include every
    // parent `node_modules`).
    const bases = req.resolve.paths(`@webjsdev/${pkg}`) || [];
    let root = '';
    for (const base of bases) {
      const cand = join(base, '@webjsdev', pkg);
      if (fsDeps.exists(join(cand, 'package.json'))) { root = cand; break; }
    }
    if (!root) continue;
    // Most packages keep source in `src/`; the cli keeps it in `lib/`. Use
    // whichever exists so every framework package's source is reachable.
    const src = fsDeps.exists(join(root, 'src'))
      ? join(root, 'src')
      : fsDeps.exists(join(root, 'lib'))
        ? join(root, 'lib')
        : '';
    if (src) out.push({ pkg, root, src });
  }
  return out;
}

/**
 * Recursively list text-source files under `dir` (absolute paths), skipping
 * `node_modules` / `dist` and bounded by {@link MAX_FILES}.
 *
 * @param {string} dir
 * @param {{ readdir: (d: string) => Array<{ name: string, isDir: boolean }> }} deps
 * @returns {string[]}
 */
export function walkSource(dir, deps) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const stack = [dir];
  while (stack.length && files.length < MAX_FILES) {
    const d = stack.pop();
    let entries = [];
    try { entries = deps.readdir(d); } catch { continue; }
    for (const e of entries) {
      if (e.isDir) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
        stack.push(join(d, e.name));
      } else if (TEXT_EXT.test(e.name)) {
        files.push(join(d, e.name));
        if (files.length >= MAX_FILES) break;
      }
    }
  }
  return files.sort();
}

/**
 * No-args / `package` mode: list the resolved packages and their `src/`
 * top-level files (the entry points), so the agent has a map to grep or read.
 *
 * @param {{ roots: Array<{ pkg: string, root: string, src: string }>, readdir: Function }} deps
 * @param {string} [pkgFilter]
 * @returns {string}
 */
export function listSources(deps, pkgFilter) {
  const roots = pkgFilter ? deps.roots.filter((r) => r.pkg === pkgFilter) : deps.roots;
  if (!roots.length) {
    return pkgFilter
      ? `@webjsdev/${pkgFilter} is not installed/resolvable here. Resolvable: ${deps.roots.map((r) => r.pkg).join(', ') || '(none)'}`
      : 'No @webjsdev/* packages resolvable from here (run inside a webjs app or the monorepo).';
  }
  const lines = ['webjs framework authored source (buildless; server-side this runs directly, and core ships a built browser dist/ that is excluded here). Read with `source({ path })` or search with `source({ query })`.', ''];
  for (const r of roots) {
    const dirName = r.src.split(sep).pop(); // 'src' for most, 'lib' for cli
    let entries = [];
    try { entries = deps.readdir(r.src); } catch { entries = []; }
    const top = entries.filter((e) => !e.isDir && TEXT_EXT.test(e.name)).map((e) => e.name).sort();
    const dirs = entries.filter((e) => e.isDir).map((e) => e.name).sort();
    lines.push(`@webjsdev/${r.pkg}/${dirName}:`);
    if (top.length) lines.push(`  files: ${top.map((f) => `${r.pkg}/${dirName}/${f}`).join(', ')}`);
    if (dirs.length) lines.push(`  subdirs: ${dirs.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * `query` mode: grep every resolved `src/` tree for the (case-insensitive)
 * substring, returning bounded `[<pkg>/src/<rel>:<line>] <text>` hits. Discloses
 * truncation rather than silently capping.
 *
 * @param {{ roots: Array<{ pkg: string, root: string, src: string }>, readFile: Function, readdir: Function }} deps
 * @param {string} query
 * @returns {Promise<string>}
 */
export async function grepSources(deps, query) {
  const q = String(query).toLowerCase();
  if (!q) return 'Provide a non-empty `query`.';
  // No resolvable packages means NOTHING was searched. Returning "no matches"
  // here would read as authoritative absence when the search never ran, which
  // is the #837 dogfood failure: an odd/shimmed node_modules layout resolved
  // zero roots, so a real symbol looked missing and the agent lost trust.
  if (!deps.roots.length) {
    return 'No @webjsdev/* source is resolvable here, so NOTHING was searched (run inside a webjs app or the monorepo). This is not the same as "not found".';
  }
  /** @type {string[]} */
  const hits = [];
  let capped = false;
  outer: for (const r of deps.roots) {
    for (const file of walkSource(r.src, deps)) {
      let text = '';
      try { text = await deps.readFile(file, 'utf8'); } catch { continue; }
      if (!text.toLowerCase().includes(q)) continue; // fast skip whole file
      const lines = text.split('\n');
      const rel = relative(r.root, file).split(sep).join('/');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].toLowerCase().includes(q)) continue;
        if (hits.length >= MAX_HITS) { capped = true; break outer; }
        hits.push(`[@webjsdev/${r.pkg}/${rel}:${i + 1}] ${lines[i].trim()}`);
      }
    }
  }
  // Disclose the SEARCHED scope on a no-match, so "no matches" reads as a
  // comprehensive-search result the agent can trust, not a silent gap (#837).
  const searched = deps.roots.map((r) => r.pkg).join(', ');
  if (!hits.length) return `No matches for "${query}" in the searched @webjsdev/* source (${searched}).`;
  if (capped) hits.push(`... (truncated at ${MAX_HITS} matches; narrow the query or read a file with \`path\`)`);
  return hits.join('\n');
}

/** True when `p` is `base` itself or a descendant of it. */
function within(base, p) {
  return p === base || p.startsWith(base + sep);
}

/**
 * `path` mode: read one AUTHORED-source file. Accepts `<pkg>/...` or
 * `@webjsdev/<pkg>/...`. Scoped to the package's SOURCE dir (`src/`, or `lib/`
 * for cli), so it serves only the authored source and NOT the built `dist/`
 * browser bundle, `node_modules`, etc. Refuses any path that escapes the source
 * dir lexically (`..`/absolute), and (when `deps.realpath` is provided)
 * re-checks the symlink-resolved path so a symlink inside `src/` cannot reach
 * outside. Read-only.
 *
 * @param {{ roots: Array<{ pkg: string, root: string, src: string }>, readFile: Function, realpath?: Function }} deps
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function readSource(deps, path) {
  const cleaned = String(path).replace(/^@webjsdev\//, '');
  const segs = cleaned.split('/').filter(Boolean);
  const pkg = segs[0];
  const entry = deps.roots.find((r) => r.pkg === pkg);
  if (!entry) {
    return `Unknown or unresolvable package "${pkg || path}". Resolvable: ${deps.roots.map((r) => r.pkg).join(', ') || '(none)'}. Pass a path like server/src/ssr/head.js.`;
  }
  const abs = resolve(entry.root, segs.slice(1).join('/'));
  const srcLabel = entry.src.split(sep).pop();
  // Scope to the authored source dir, so dist/ (the built core browser bundle),
  // package.json, node_modules, etc. are not readable; only `src/` (or cli `lib/`).
  if (!within(entry.src, abs)) {
    return `Refusing to read outside the @webjsdev/${pkg} authored source (only ${srcLabel}/ is exposed; the built dist/ is not).`;
  }
  // Defense in depth: a symlink inside the source dir must not resolve outside it.
  if (deps.realpath) {
    try {
      if (!within(deps.realpath(entry.src), deps.realpath(abs))) {
        return `Refusing to read outside the @webjsdev/${pkg} authored source (a symlink escapes ${srcLabel}/).`;
      }
    } catch { /* abs does not exist; the readFile below returns the not-a-file message */ }
  }
  // Legacy guard kept as a belt-and-suspenders against a root escape too.
  if (abs !== entry.root && !abs.startsWith(entry.root + sep)) {
    return `Refusing to read outside @webjsdev/${pkg} (path escapes the package root).`;
  }
  try {
    return await deps.readFile(abs, 'utf8');
  } catch {
    return `Could not read ${path} (not a file under @webjsdev/${pkg}).`;
  }
}

/**
 * The `source` tool entry point. Dispatches on the args: `path` reads a file,
 * `query` greps, otherwise (or with `package`) lists the packages. PURE given
 * `deps` (`{ roots, readFile, readdir }`).
 *
 * @param {object} deps
 * @param {{ query?: string, path?: string, package?: string }} [args]
 * @returns {Promise<string>}
 */
export async function runSourceTool(deps, args) {
  const a = args || {};
  if (a.path) return readSource(deps, a.path);
  if (a.query) return grepSources(deps, a.query);
  return listSources(deps, a.package);
}
