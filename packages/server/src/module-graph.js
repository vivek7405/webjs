/**
 * Lightweight module dependency graph.
 *
 * On the first request (lazily, via `ensureReady`), scans the app directory and builds an in-memory map of
 * `file → Set<imported files>`. The SSR pipeline queries this graph to
 * emit *complete* modulepreload hints: including transitive dependencies
 * of components: so the browser can fetch the entire tree in parallel
 * rather than discovering imports one waterfall at a time.
 *
 * The graph is file-path-based (absolute paths). URLs are derived when
 * emitting preload hints.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, extname, sep } from 'node:path';
import { redactStringsAndTemplates, redactToPlaceholders } from './js-scan.js';

/**
 * Per-appDir cache of the parsed `package.json "imports"` subpath-alias map
 * (#555). `null` means "no imports block" (the common case for an app that
 * does not use the `#` alias). Read once per appDir; cleared with the parse
 * cache on rebuild.
 * @type {Map<string, Record<string,string> | null>}
 */
const IMPORTS_CACHE = new Map();

/**
 * Read an app's `package.json "imports"` subpath-import map (Node's native
 * import-alias mechanism). Cached per appDir.
 * @param {string} appDir
 * @returns {Record<string,string> | null}
 */
export function appImportsMap(appDir) {
  if (IMPORTS_CACHE.has(appDir)) return IMPORTS_CACHE.get(appDir) ?? null;
  let map = null;
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    if (pkg && typeof pkg.imports === 'object' && pkg.imports) map = pkg.imports;
  } catch { /* no package.json / unparseable: no aliases */ }
  IMPORTS_CACHE.set(appDir, map);
  return map;
}

/**
 * Expand a `package.json "imports"` subpath alias (e.g. `#lib/db.server.ts`
 * with the scaffold's catch-all `"#*": "./*"`) to its real APP-RELATIVE target
 * string (`./lib/db.server.ts`).
 * The security-critical seam (#555): the graph walker, auth gate, elision, and
 * `no-server-import-in-browser-module` all route through `resolveImport`, so
 * expanding the alias here (to the real path) is what stops an alias from
 * laundering a `.server.ts` past those checks. Driven off the actual `"imports"`
 * map so a non-default base (`"#lib/*": "./src/lib/*"`) is honored; never
 * hardcodes `./`. Supports one trailing `*` wildcard per key (Node's rule) plus
 * exact keys. (A `#/`-prefixed key is avoided in the scaffold because Bun's
 * native resolver rejects it; the expansion here is key-shape-agnostic.)
 * @param {string} spec  the import specifier, e.g. `'#lib/db.server.ts'`
 * @param {string} appDir
 * @returns {string | null}  the app-relative target (e.g. `'./lib/db.server.ts'`), or null if no alias matches
 */
export function expandImportAlias(spec, appDir) {
  const map = appImportsMap(appDir);
  if (!map) return null;
  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== 'string') continue; // conditional-export objects are not graph-resolvable
    const star = key.indexOf('*');
    if (star === -1) {
      if (spec === key) return value;
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
    const middle = spec.slice(prefix.length, spec.length - suffix.length);
    return value.replace('*', middle);
  }
  return null;
}

/** @type {RegExp} match static `import … from '…'` and `import '…'` */
const IMPORT_RE = /\bimport\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/gd;

/**
 * @type {RegExp} match `export … from '…'` re-exports.
 * Examples:
 *   export * from './bar';
 *   export { x } from './bar';
 *   export { x as y } from './bar';
 *   export type { T } from './bar';
 *   export {
 *     a,
 *     b,
 *   } from './bar';     <-- multi-line, very common in real barrel files
 *
 * Barrel files are common (`lib/index.ts` re-exports its siblings),
 * and the graph must follow these edges or downstream consumers of
 * the barrel see authorisation 404s on the underlying files. The gap
 * class excludes quotes, `;`, AND the backtick but DOES allow newlines,
 * so multi-line brace lists are caught. The primary defence against a
 * stray `export` word inside a literal swallowing a real later edge is
 * that `parseFile` scans over the FULLY-BLANKED mask (every comment /
 * string / template / regex body blanked), so no keyword can anchor
 * inside a literal at all (#753); the exclusions here are belt-and-
 * suspenders on top of that.
 */
const EXPORT_FROM_RE = /\bexport\b[^'";`]+?\sfrom\s+['"]([^'"]+)['"]/gd;

/**
 * @type {RegExp} match a dynamic `import('…')` with a STRING-LITERAL specifier
 * only (`import('./x.ts')`, `await import("#lib/y.ts")`). A computed specifier
 * (`import(expr)`) cannot be captured and is intentionally left out: it stays a
 * documented limitation (and `webjs check` warns on it), not a phantom edge.
 *
 * Unlike the static `IMPORT_RE` (which requires `\s+` after `import`), this
 * matches `import` immediately or with whitespace before the `(`, so the two
 * never overlap. `m.index` is the `import` keyword start, so the same
 * redaction-mask guard (keyword-in-code-position) applies.
 *
 * The specifier may be followed by `)` OR `,` so the import-attributes form
 * `import('./data.json', { with: { type: 'json' } })` (a JSON / CSS module
 * import) is captured too. A computed specifier still falls out: in
 * `import('./pages/' + name)` the char after the closing quote is `+`, neither
 * `,` nor `)`, so it does not match.
 */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*[,)]/gd;

/**
 * @typedef {Map<string, Set<string>>} ModuleGraph
 * A map of absolute file path → Set of absolute file paths it STATICALLY imports.
 */

/**
 * Dynamic-import edges (string-literal `import('…')` only), kept SEPARATE from
 * the static graph and keyed by it in a WeakMap. The authorization gate
 * (`reachableFromEntries`) unions these in so a lazily-imported app module is
 * servable instead of 404ing, but the preload walk (`transitiveDeps`) and the
 * elision analysis stay on the static graph ONLY: a dynamic import is lazy by
 * author intent, so eagerly preloading its target would over-fetch on every
 * page load, and feeding dynamic edges into elision could flip a verdict. The
 * module is fetched at call time, now served correctly by the gate.
 * @type {WeakMap<ModuleGraph, ModuleGraph>}
 */
const DYNAMIC_EDGES = new WeakMap();

/**
 * The dynamic-import edges discovered for a built graph (string-literal targets
 * only), or an empty map if none. Exposed for tests/ops.
 * @param {ModuleGraph} graph
 * @returns {ModuleGraph}
 */
export function dynamicEdges(graph) {
  return DYNAMIC_EDGES.get(graph) || new Map();
}

/**
 * Bare (npm vendor) import specifiers per file, kept SEPARATE from the static
 * app graph (which only tracks relative + `#`-alias edges) and keyed by the
 * graph in a WeakMap. Records the EXACT specifier as written (`dayjs`,
 * `dayjs/plugin/utc`) so SSR can look it up in the vendor importmap and emit a
 * `modulepreload` for the reached vendor URL (#754), flattening the vendor CDN
 * waterfall. Excludes `node:` builtins and protocol specifiers.
 * @type {WeakMap<ModuleGraph, Map<string, Set<string>>>}
 */
const BARE_EDGES = new WeakMap();

/**
 * The bare (npm vendor) import specifiers per file for a built graph, or an
 * empty map if none. The values are specifiers (not resolved URLs); the caller
 * maps them through the vendor importmap.
 * @param {ModuleGraph} graph
 * @returns {Map<string, Set<string>>}
 */
export function bareImports(graph) {
  return BARE_EDGES.get(graph) || new Map();
}

/**
 * Bare (npm vendor) specifiers imported DYNAMICALLY (`await import('dayjs')`),
 * kept apart from `BARE_EDGES` for the same reason `DYNAMIC_EDGES` is kept
 * apart from the static graph: a lazily-imported vendor must RESOLVE when the
 * import finally runs, so it belongs in the importmap, but it must not be
 * preloaded (that would fetch a bundle the author deliberately deferred). So
 * `reachableBareSpecifiers` (the importmap) unions both maps while
 * `bareImports` (the #754 modulepreload source) stays static-only.
 * @type {WeakMap<ModuleGraph, Map<string, Set<string>>>}
 */
const BARE_DYNAMIC_EDGES = new WeakMap();

/**
 * The dynamically-imported bare specifiers per file for a built graph, or an
 * empty map if none.
 * @param {ModuleGraph} graph
 * @returns {Map<string, Set<string>>}
 */
export function dynamicBareImports(graph) {
  return BARE_DYNAMIC_EDGES.get(graph) || new Map();
}

/**
 * Every app source file walked while building a graph (#899). `graph` itself
 * holds only files that HAVE imports, so a leaf (e.g. a no-import `.server.ts`)
 * is absent from it; this side-channel carries the COMPLETE set of `.js/.ts/
 * .mjs/.mts` files under the appDir (excluding `node_modules`/`.webjs`/`public`/
 * dotfiles), INCLUDING server-only files. Used to derive the app-source deploy
 * signal that covers an SSR-only change a browser-bound-only set would miss.
 * @type {WeakMap<ModuleGraph, Set<string>>}
 */
const SEEN_FILES = new WeakMap();

/**
 * The complete set of app source files walked for a built graph, or an empty
 * set if none. Absolute paths.
 * @param {ModuleGraph} graph
 * @returns {Set<string>}
 */
export function seenFilesFor(graph) {
  return SEEN_FILES.get(graph) || new Set();
}

/**
 * True for a bare npm vendor specifier (`dayjs`, `@scope/pkg/sub`), excluding
 * relative / absolute / `#`-alias paths and `node:` / protocol specifiers.
 * Inlined here (not imported from vendor.js) to avoid a module cycle.
 * @param {string} spec
 * @returns {boolean}
 */
function isVendorSpecifier(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#') || spec.startsWith('__')) return false;
  if (spec.startsWith('node:') || /^[a-z][a-z0-9+.-]*:/.test(spec)) return false;
  return true;
}

/**
 * Build the module graph for all source files under `appDir`.
 *
 * @param {string} appDir
 * @returns {Promise<ModuleGraph>}
 */
export async function buildModuleGraph(appDir) {
  // Re-read the app's `package.json "imports"` each build so an edit to the
  // alias map (#555) is picked up on rebuild.
  IMPORTS_CACHE.delete(appDir);
  /** @type {ModuleGraph} */
  const graph = new Map();
  /** @type {ModuleGraph} dynamic-import edges, keyed to `graph` below */
  const dynamic = new Map();
  /** @type {Map<string, Set<string>>} bare vendor specifiers per file (#754) */
  const bare = new Map();
  /** @type {Map<string, Set<string>>} DYNAMICALLY-imported bare vendor specifiers
   * per file: importmap-bound but never preloaded (#1399) */
  const bareDynamic = new Map();
  /** @type {Set<string>} every file walked this build (graph holds only files
   * with deps, so a separate set is needed to know what is still live). */
  const seen = new Set();
  await walk(appDir, appDir, graph, seen, dynamic, bare, bareDynamic);
  if (dynamic.size) DYNAMIC_EDGES.set(graph, dynamic);
  if (bare.size) BARE_EDGES.set(graph, bare);
  if (bareDynamic.size) BARE_DYNAMIC_EDGES.set(graph, bareDynamic);
  if (seen.size) SEEN_FILES.set(graph, seen);
  // Evict parse-cache entries for files no longer in the tree (a rebuild after
  // a rename or delete), so a long dev session does not accumulate dead
  // entries. Scoped to appDir so a multi-app process (tests, dogfood smoke)
  // keeps other apps' entries.
  const prefix = appDir.endsWith(sep) ? appDir : appDir + sep;
  for (const key of PARSE_CACHE.keys()) {
    if ((key === appDir || key.startsWith(prefix)) && !seen.has(key)) PARSE_CACHE.delete(key);
  }
  return graph;
}

/**
 * Given a set of entry files, return all transitive dependencies (deduplicated).
 * Entry files themselves are NOT included (they're already preloaded by the
 * boot script).
 *
 * `skip` files are neither included nor traversed into: used to prune
 * display-only components (and the subtree reachable only through them)
 * from preload hints, since their imports are stripped from the served
 * source and the browser never fetches them.
 *
 * @param {ModuleGraph} graph
 * @param {string[]} entryFiles  absolute paths
 * @param {string} appDir
 * @param {Set<string>} [skip]  absolute paths to exclude and not traverse
 * @returns {string[]}  absolute paths of transitive deps
 */
export function transitiveDeps(graph, entryFiles, appDir, skip) {
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
      if (skip && skip.has(dep)) continue;
      visited.add(dep);
      // Only include files within the app dir (skip node_modules, core, etc.)
      if (dep.startsWith(appDir)) {
        result.push(dep);
      }
      // Stop at server-file boundaries, exactly like reachableFromEntries
      // (the authorization gate). The browser fetches a `.server.*` URL as
      // an RPC or throw-at-load stub, never its source, so the server
      // file's own imports are never fetched. Following them would emit
      // modulepreload hints for server-only modules that the gate then
      // 404s (a preload set wider than the servable set). The `.server.*`
      // file itself stays in the result; the preload emitter filters it via
      // the server-file index. A file imported through BOTH a server file
      // and a real client path is still reached via the client path, so it
      // is not wrongly dropped.
      if (SERVER_FILE_RE.test(dep)) continue;
      queue.push(dep);
    }
  }
  return result;
}

/** @type {RegExp} files the dev server NEVER serves as source: it
 * returns a stub instead. We stop graph traversal at these boundaries
 * because the browser never sees their transitive imports anyway. */
const SERVER_FILE_RE = /\.server\.m?[jt]s$/;

/**
 * Compute the set of files reachable from a set of browser-entry files.
 *
 * Same idea as Next.js's bundler-produced manifest: the static import
 * graph from each page / layout / error / loading / not-found / component
 * entry is the authoritative set of "files the browser may legitimately
 * fetch as ES modules". Anything outside this set is server-only or
 * unrelated and must not be served over HTTP.
 *
 * Result includes the entries themselves PLUS all transitive deps, all
 * restricted to absolute paths under `appDir`. Files outside `appDir`
 * (node_modules, @webjsdev/core, vendor URLs) are excluded; those have
 * their own routing layers (`/__webjs/core/*`, `/__webjs/vendor/*`).
 *
 * Traversal stops at `.server.{js,ts,mjs,mts}` files. They ARE in the
 * result (so a client import like `import { fn } from './x.server.ts'`
 * resolves to the RPC stub and the gate lets the request through), but
 * we do not walk INTO them. The browser only ever sees the RPC stub or
 * the throw-at-load stub for those files, so a non-server file imported
 * ONLY by a server file is never legitimately requested by the
 * browser and should stay out of the authorisation set. Matches
 * Next.js's behaviour, where the bundler emits server-component and
 * server-action code into separate chunks that the client bundle
 * never references.
 *
 * The dev server uses this as a runtime authorization gate before
 * serving any `.{js,mjs,ts,mts,css,svg,…}` URL: in-set → served (still
 * subject to the `.server.{js,ts}` stub guardrail), out-of-set → 404.
 *
 * @param {ModuleGraph} graph
 * @param {string[]} entryFiles absolute paths of browser-bound entries
 * @param {string} appDir
 * @returns {Set<string>}
 */
export function reachableFromEntries(graph, entryFiles, appDir) {
  // The gate unions in dynamic-import edges (#751) so a lazily-imported app
  // module (`await import('./widget.ts')`) is servable instead of 404ing. A
  // dynamically-imported module's OWN static imports are then walked normally
  // (it joins the queue), so its subtree is servable too. The `.server.*`
  // boundary still holds: a dynamic `import('./x.server.ts')` is admitted (a
  // stub is served) but, like any server file, not traversed into.
  const dynamic = DYNAMIC_EDGES.get(graph);
  /** @type {Set<string>} */
  const visited = new Set();
  /** @type {string[]} */
  const queue = [];
  for (const entry of entryFiles) {
    if (!entry || !entry.startsWith(appDir)) continue;
    visited.add(entry);
    queue.push(entry);
  }
  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    // Stop at server-file boundaries. The file itself stays in the
    // visited set so its URL is servable (yields a stub at request
    // time), but we don't add its imports because the browser never
    // sees them.
    if (SERVER_FILE_RE.test(file)) continue;
    const staticDeps = graph.get(file);
    const dynDeps = dynamic && dynamic.get(file);
    if (!staticDeps && !dynDeps) continue;
    for (const set of [staticDeps, dynDeps]) {
      if (!set) continue;
      for (const dep of set) {
        if (visited.has(dep)) continue;
        if (!dep.startsWith(appDir)) continue;
        visited.add(dep);
        queue.push(dep);
      }
    }
  }
  return visited;
}

/**
 * Bare npm vendor specifiers reachable from `entryFiles`, the importmap
 * analogue of ssr.js's per-page `reachedVendorSpecifiers` (#754).
 *
 * Walks the SAME edges the authorization gate walks (static + dynamic, #751,
 * stopping at `.server.*` boundaries) so the answer is exactly "what a browser
 * could load from these entries", then unions each reached file's recorded
 * bare edges, static AND dynamic. Both dynamic forms are included here even
 * though `transitiveDeps` (preload) ignores them, for the same reason: a
 * lazily imported module is not preloaded, but its bare specifier still has to
 * resolve when the import finally runs, so it belongs in the importmap. That
 * is why a dynamically-imported VENDOR gets its own map (`dynamicBareImports`)
 * rather than joining `bareImports`, which feeds the preload hints.
 *
 * `.server.*` files are reached (the browser fetches a stub at that URL) but
 * their bare imports are NOT collected: the source never ships, so a DB driver
 * imported by a server file must never enter the importmap.
 *
 * `skip` files are neither collected nor traversed into, so a specifier
 * reachable ONLY through an elided component drops out along with the subtree
 * behind it (#197 / #170). Omit `skip` for the un-pruned superset the pin path
 * needs.
 *
 * @param {ModuleGraph} graph
 * @param {string[]} entryFiles  absolute paths
 * @param {string} appDir
 * @param {Set<string>} [skip]  absolute paths to exclude and not traverse
 * @returns {Set<string>}
 */
export function reachableBareSpecifiers(graph, entryFiles, appDir, skip) {
  /** @type {Set<string>} */
  const specs = new Set();
  const bare = BARE_EDGES.get(graph);
  const bareDynamic = BARE_DYNAMIC_EDGES.get(graph);
  if (!bare?.size && !bareDynamic?.size) return specs;
  const dynamic = DYNAMIC_EDGES.get(graph);
  /** @type {Set<string>} */
  const visited = new Set();
  /** @type {string[]} */
  const queue = [];
  for (const entry of entryFiles) {
    if (!entry || !entry.startsWith(appDir)) continue;
    if (skip && skip.has(entry)) continue;
    visited.add(entry);
    queue.push(entry);
  }
  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    if (SERVER_FILE_RE.test(file)) continue;
    for (const map of [bare, bareDynamic]) {
      const fileBare = map?.get(file);
      if (fileBare) for (const spec of fileBare) specs.add(spec);
    }
    const staticDeps = graph.get(file);
    const dynDeps = dynamic && dynamic.get(file);
    for (const set of [staticDeps, dynDeps]) {
      if (!set) continue;
      for (const dep of set) {
        if (visited.has(dep)) continue;
        if (!dep.startsWith(appDir)) continue;
        if (skip && skip.has(dep)) continue;
        visited.add(dep);
        queue.push(dep);
      }
    }
  }
  return specs;
}

/**
 * Recursively walk a directory, parse imports, and populate the graph.
 * @param {string} dir
 * @param {string} appDir
 * @param {ModuleGraph} graph
 */
async function walk(dir, appDir, graph, seen, dynamic, bare, bareDynamic) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    // Skip filesystem locations the browser-bound graph never
    // touches: node_modules (huge, npm deps reach the browser via
    // the importmap, not direct fs paths), .webjs (framework cache),
    // public/ (served by a separate route with its own containment
    // check). Do NOT skip `_*` dirs: the `_private` / `_components`
    // / `_lib` convention is a ROUTER-ignore mechanism (router.js
    // line 100), but files inside are still importable by pages and
    // layouts, so the graph walker must enter them or the gate
    // 404s legitimate imports.
    if (e.name === 'node_modules' || e.name === '.webjs' || e.name === 'public') continue;
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, appDir, graph, seen, dynamic, bare, bareDynamic);
    } else if (/\.(js|ts|mjs|mts)$/.test(e.name)) {
      await parseFile(full, appDir, graph, seen, dynamic, bare, bareDynamic);
    }
  }
}

/**
 * mtime-keyed parse cache so a rebuild re-reads only files that actually
 * changed. `buildModuleGraph` re-walks the (cheap) directory tree on every
 * rebuild, but reading + regex-parsing each file is the cost; on an unchanged
 * file the cached import set is reused after a single `stat`. This makes
 * rebuilds incremental for large apps without restructuring the caller.
 * Keyed by mtime AND size: a same-tick edit that also changes the file length
 * is caught even on coarse-resolution filesystems where mtime alone could miss.
 * @type {Map<string, { mtimeMs: number, size: number, deps: Set<string> }>}
 */
const PARSE_CACHE = new Map();

/** Introspection for tests/ops: is `file` currently in the parse cache? */
export function _parseCacheHas(file) { return PARSE_CACHE.has(file); }

/**
 * Parse a single file's imports and add them to the graph.
 * Only resolves relative imports (bare specifiers are npm deps, not in the graph).
 *
 * @param {string} file
 * @param {string} appDir
 * @param {ModuleGraph} graph
 */
async function parseFile(file, appDir, graph, seen, dynamic, bare, bareDynamic) {
  let mtimeMs, size;
  try { const st = await stat(file); mtimeMs = st.mtimeMs; size = st.size; }
  catch { return; }
  seen?.add(file); // mark live (both cache-hit and miss paths) for cache eviction
  const cached = PARSE_CACHE.get(file);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    if (cached.deps.size) graph.set(file, cached.deps);
    if (cached.dynDeps && cached.dynDeps.size && dynamic) dynamic.set(file, cached.dynDeps);
    if (cached.bareDeps && cached.bareDeps.size && bare) bare.set(file, cached.bareDeps);
    if (cached.bareDynDeps && cached.bareDynDeps.size && bareDynamic) bareDynamic.set(file, cached.bareDynDeps);
    return;
  }

  let src;
  try { src = await readFile(file, 'utf8'); }
  catch { return; }

  // Mask of `src` with all string / template-literal / comment / regex
  // CONTENT blanked to spaces (positions preserved). Used to reject an
  // `import '…'` / `export … from '…'` that appears as TEXT inside a
  // literal (e.g. example code shown in a `<pre>` inside an `html\`\``
  // template, as the docs site does, OR a code-example written as a plain
  // quoted string) rather than as a real statement. We still read the
  // specifier from the RAW `src` (the specifier is itself a string,
  // blanked in the mask), and only consult the mask to confirm the
  // `import` / `export` KEYWORD survived redaction, i.e. sits in code
  // position and not inside a literal.
  //
  // `blankStrings: true` is load-bearing: the default mask keeps PLAIN
  // string + verbatim-template bodies verbatim (so `register('tag')` stays
  // readable for other scanners), which would leave an `import` written
  // inside a plain string looking like a real keyword and create a phantom
  // graph edge to whatever path that string names. Since this caller only
  // checks keyword-in-code-position, blank every literal body so a
  // code-example `import` string never becomes an edge.
  // Scan for edges over the FULLY-BLANKED mask: every comment / string /
  // template / regex body is blanked to spaces (delimiters kept), `${...}`
  // holes stay as code. Reason (#753, found differentially): a stray `import` /
  // `export` word inside a comment, template, OR regex literal must not anchor a
  // lazy regex match (e.g. `EXPORT_FROM_RE`'s `[^'";`]+?`) that spans across the
  // literal's closing delimiter and consumes the next real `from '<spec>'`,
  // whose keyword then sits in the blanked literal and is dropped, silently
  // losing the real edge (the gate then 404s a legitimately imported module).
  // Scanning over the blanked mask means NO keyword can anchor inside any
  // literal or comment at all, so the whole class of delimiter blind spots
  // (comment, string, template, regex) is closed at once, and there is nothing
  // left for a per-match position guard to reject. The specifier itself is a
  // string (blanked here), so it is read back from raw `src` via the match's
  // group indices (the `d` flag).
  const masked = redactStringsAndTemplates(src, true);
  const deps = new Set();
  /** @type {Set<string>} bare npm vendor specifiers imported by this file (#754) */
  const bareDeps = new Set();
  for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
    for (const m of masked.matchAll(re)) {
      // A statement-leading `import type { X }` / `import type * as X` /
      // `import type Foo` (default type import) / `export type { X }` /
      // `export type *` is fully erased by the TS stripper, so it never becomes
      // a browser fetch or a runtime edge. Skip it, so a type-only import of a
      // `.server.ts` (a common, correct way to share a derived row type) is not
      // mistaken for a runtime dependency by the gate / elision / the
      // no-server-import check. Two carve-outs keep this from over-dropping:
      //   - `import type from '...'` is a VALUE default import whose binding is
      //     literally named `type` (the stripper keeps it), so `type` directly
      //     followed by `from` is NOT type-only.
      //   - a MIXED `import { type A, b }` does NOT lead with `type`, so it is
      //     kept (its `b` binding is a real runtime edge).
      // (m[0] here is over the mask, which keeps the binding syntax verbatim.)
      // #805
      const lead = m[0];
      const typeOnly =
        /^(?:import|export)\s+type\s*[{*]/.test(lead) ||
        (/^import\s+type\s+[A-Za-z_$]/.test(lead) && !/^import\s+type\s+from\b/.test(lead));
      if (typeOnly) continue;
      // The specifier is read from RAW src at the match's captured-group indices
      // (the group is the blanked string body in the mask; its position is the
      // real specifier in src).
      const spec = src.slice(m.indices[1][0], m.indices[1][1]);
      // Only resolve relative imports + `#`-style subpath aliases (#555)
      // within the project. A bare npm specifier (dayjs) has no alias match
      // and is skipped FROM THE GRAPH, but recorded as a vendor edge so SSR
      // can emit a modulepreload for the reached vendor URL (#754); an aliased
      // `#lib/x.server.ts` IS followed so the graph / auth gate / elision see
      // the real path through the alias.
      if (!spec.startsWith('.') && !spec.startsWith('/') && !expandImportAlias(spec, appDir)) {
        if (isVendorSpecifier(spec)) bareDeps.add(spec);
        continue;
      }
      const resolved = resolveImport(spec, file, appDir);
      if (resolved) deps.add(resolved);
    }
  }
  // Dynamic `import('…')` with a string-literal specifier (#751): a separate
  // edge class so the gate admits the lazily-loaded module (no 404) without
  // preloading it. A target already statically imported is not duplicated as a
  // dynamic edge.
  //
  // The static scan above runs over the FULLY-BLANKED mask, which also blanks
  // the code inside `${...}` template holes. That drops a dynamic import written
  // directly inside a hole (`html\`${import('./x.ts')}\``), which the AST counts
  // as an edge but the mask scan did not, so the gate 404s a legitimately-loaded
  // module (#918, the admit-fewer direction of the #753 family). So the dynamic
  // scan instead runs over the PLACEHOLDER redaction (#634), which keeps `${...}`
  // hole code readable (so a hole-position `import(...)` IS seen) while still
  // tokenizing string / template-TEXT bodies to `__STR_<idx>__` and blanking
  // comment / regex bodies (so a dynamic import written as literal TEXT is NOT
  // an edge). The #753 swallow class stays closed because `DYNAMIC_IMPORT_RE` is
  // tightly anchored on `import(`, never a lazy cross-delimiter span. The
  // specifier surfaces as a `__STR_<idx>__` token, recovered from `literals`; a
  // computed `import(expr)` still falls out (its char after the quote is not
  // `,`/`)`), preserving the documented limitation.
  const { redacted: holeAware, literals } = redactToPlaceholders(src);
  const dynDeps = new Set();
  const bareDynDeps = new Set();
  for (const m of holeAware.matchAll(DYNAMIC_IMPORT_RE)) {
    const token = m[1];
    const pm = /^__STR_(\d+)__$/.exec(token);
    const spec = pm ? literals[Number(pm[1])] : token;
    if (spec == null) continue;
    if (!spec.startsWith('.') && !spec.startsWith('/') && !expandImportAlias(spec, appDir)) {
      // A dynamically-imported VENDOR (`await import('dayjs')`). Not a graph
      // edge (there is no local file to serve) and not a preload (lazy by
      // intent), but it still needs an importmap entry or the import fails to
      // resolve when it runs. Recorded in its own map for that one consumer.
      if (isVendorSpecifier(spec)) bareDynDeps.add(spec);
      continue;
    }
    const resolved = resolveImport(spec, file, appDir);
    if (resolved && !deps.has(resolved)) dynDeps.add(resolved);
  }
  PARSE_CACHE.set(file, { mtimeMs, size, deps, dynDeps, bareDeps, bareDynDeps });
  if (deps.size) graph.set(file, deps);
  if (dynDeps.size && dynamic) dynamic.set(file, dynDeps);
  if (bareDeps.size && bare) bare.set(file, bareDeps);
  if (bareDynDeps.size && bareDynamic) bareDynamic.set(file, bareDynDeps);
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
export function resolveImport(spec, fromFile, appDir) {
  const base = dirname(fromFile);
  let target;
  const aliased = expandImportAlias(spec, appDir);
  if (aliased) {
    // `#`-style subpath alias (#555): the app-relative target is resolved
    // against the app root, then run through the same extension fallback below
    // so the boundary / elision / preload all see the real on-disk path.
    target = resolve(appDir, aliased);
  } else if (spec.startsWith('/')) {
    // Absolute from app root (how browser sees it)
    target = join(appDir, spec);
  } else {
    target = resolve(base, spec);
  }
  // Sync exact-then-fallback resolution. The graph is advisory (it
  // drives preload hints, not module loading), so a wrong entry is
  // harmless: the browser just gets a redundant preload that 404s.
  // But emitting a working modulepreload when the user wrote
  // `import x from './foo'` (no extension) is much better than
  // leaving the resolver waterfall to discover it lazily, so probe
  // existsSync for the common fallbacks the JSDoc above promises.
  if (existsSync(target)) return target;
  if (!extname(target)) {
    for (const ext of ['.ts', '.js', '.mts', '.mjs']) {
      if (existsSync(target + ext)) return target + ext;
    }
    for (const ext of ['.ts', '.js']) {
      const indexed = join(target, 'index' + ext);
      if (existsSync(indexed)) return indexed;
    }
  }
  // `.js` import maps to a `.ts` sibling: TypeScript's "rewrite to
  // .js at runtime" convention. The browser asks for the `.js`
  // path; the dev server's source branch falls through to the
  // sibling. Mirror that here so the resolved path matches the
  // file actually on disk (and the authorization gate sees the
  // same path the request handler resolves to).
  if (/\.js$/.test(target)) {
    const tsAbs = target.replace(/\.js$/, '.ts');
    if (existsSync(tsAbs)) return tsAbs;
    const mtsAbs = target.replace(/\.js$/, '.mts');
    if (existsSync(mtsAbs)) return mtsAbs;
  }
  // Optimistic fallback: return the original resolution so the graph
  // still has an entry, even though the path may 404 on the browser.
  // Matches prior behavior.
  return target;
}
