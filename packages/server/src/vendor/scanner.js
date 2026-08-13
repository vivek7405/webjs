import { buildModuleGraph, reachableBareSpecifiers } from '../module-graph.js';
import { browserEntryFiles } from '../browser-entries.js';
import { scanComponents } from '../component-scanner.js';
import { buildRouteTable } from '../router.js';

/**
 * Set of package names whose importmap entries are populated by the
 * framework, not by the vendor scanner. The scanner skips these to
 * keep `@webjsdev/core` (and any future framework-internal package)
 * off the jspm.io path: their bytes are served by the dev server's
 * dedicated `/__webjs/core/*` route, and `buildCoreEntries()` in
 * `importmap.js` derives one importmap line per exported subpath
 * directly from the package's own `exports` field.
 *
 * The `'@webjsdev/core/'` prefix entry is here so that `extractPackageName`
 * returning the bare name is enough to recognise core-subpath imports
 * (`@webjsdev/core/directives`, `@webjsdev/core/task`, …) and skip
 * them; the prefix form catches anything whose extractPackageName
 * returns null but whose specifier starts with the prefix. Same
 * mechanism, no special casing per subpath.
 */
export const BUILTIN = new Set(['@webjsdev/core', '@webjsdev/core/']);

/**
 * Server-only framework packages that must NEVER be vendored to the browser.
 * Unlike `@webjsdev/core` (browser-bound, served locally via `/__webjs/core/*`),
 * these are pure server packages: the CLI, the SSR runtime, the MCP server. A
 * stray browser-graph scan
 * that surfaces one of them must not push it onto the jspm path (#713). Matched
 * on the extracted package name, so subpaths (`@webjsdev/cli/bin/webjs.js`) are
 * covered. `@webjsdev/ui` is intentionally absent: its components ARE
 * browser-bound, so it stays vendorable.
 */
export const FRAMEWORK_SERVER_ONLY = new Set(['@webjsdev/cli', '@webjsdev/server', '@webjsdev/mcp']);

/**
 * Extract the package name from a bare specifier.
 * `'dayjs'`             → `'dayjs'`
 * `'dayjs/locale/en'`   → `'dayjs'`
 * `'@tanstack/query'`   → `'@tanstack/query'`
 * `'@tanstack/query/x'` → `'@tanstack/query'`
 * `'./foo'`, `'../bar'`, `'/baz'` → `null` (relative/absolute)
 * `'#components/x.ts'`, `'#lib/db'` → `null` (`#` path alias, #555: resolves to
 *   a LOCAL file via `package.json` "imports", never an npm package, so it must
 *   not be sent to the vendor resolver, #623)
 *
 * @param {string} spec
 * @returns {string | null}
 */
export function extractPackageName(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('__') || spec.startsWith('#')) return null;
  if (/^[a-z]+:/.test(spec)) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return spec.split('/')[0];
}

/**
 * Bare npm specifiers that could reach the browser, filtered of the framework
 * packages that must never be vendored.
 *
 * The scan is ROOTED IN THE MODULE GRAPH, not in a filesystem walk. Only files
 * reachable from a browser-bound entry (page / layout / error / loading /
 * not-found / forbidden / unauthorized / instrumentation-client / any
 * component) contribute, which is the same authorization gate the dev server
 * uses to decide what it will serve at all. A file nothing imports contributes
 * nothing, so a build script under `scripts/`, a tooling config, a test helper
 * and an unreferenced module all drop out by reachability rather than by name
 * (there is no exclusion LIST any more, which is the point: the old one was
 * open-ended and went stale).
 *
 * Excluded on top of unreachability:
 *   - `.server.{js,ts,mjs,mts}` files. They are REACHED (the browser fetches an
 *     RPC or throw-at-load stub at that URL) but their source never ships, so
 *     their bare imports must not enter the importmap.
 *   - `@webjsdev/core` and its subpaths (BUILTIN, served locally).
 *   - `@webjsdev/cli` / `@webjsdev/server` / `@webjsdev/mcp` (#713).
 *   - `import type` statements and any `import` written inside a comment,
 *     string, template literal or regex body. Both come free from the module
 *     graph's blanked-mask scanner (#753 / #805); this function no longer has
 *     a scanner of its own.
 *
 * This is the OUT-OF-PROCESS entry point (`pinAll`, `webjs doctor`). It builds
 * its own graph, route table and component scan, roughly 70-200ms on the
 * in-repo apps, and applies NO elision pruning, so the result is a SUPERSET of
 * what the running server serves. That superset relation is what lets
 * `prunePinToReachable` intersect a committed pin down to the runtime answer
 * (#197). The dev server calls `reachedBareImports` instead, with the graph it
 * already has and its elision skip set.
 *
 * @param {string} appDir
 * @returns {Promise<Set<string>>}
 */
export async function scanBareImports(appDir) {
  let graph, components, routeTable;
  try {
    graph = await buildModuleGraph(appDir);
    components = await scanComponents(appDir);
    routeTable = await buildRouteTable(appDir);
  } catch {
    // An app the analysis cannot process yields no vendor specifiers rather
    // than a throw, matching how check.js and elision-report.js degrade. The
    // dev server surfaces the real problem.
    return new Set();
  }
  return reachedBareImports(graph, [...browserEntryFiles(routeTable, components)], appDir);
}

/**
 * The in-process form: the caller already has a module graph, the entry set,
 * and (on the runtime path) the elision skip set. Used by the dev server so a
 * vendor resolve does not rebuild analysis it just built.
 *
 * @param {import('../module-graph.js').ModuleGraph} graph
 * @param {string[]} entryFiles
 * @param {string} appDir
 * @param {Set<string>} [skip]  elided / inert / import-only modules
 * @returns {Set<string>}
 */
export function reachedBareImports(graph, entryFiles, appDir, skip) {
  const found = reachableBareSpecifiers(graph, entryFiles, appDir, skip);
  for (const b of BUILTIN) found.delete(b);
  // Drop core subpaths (served locally via `/__webjs/core/*`) and server-only
  // framework packages (#713) so neither reaches the importmap / jspm path.
  for (const spec of found) {
    const p = extractPackageName(spec);
    if (p && (BUILTIN.has(p) || FRAMEWORK_SERVER_ONLY.has(p))) found.delete(spec);
  }
  return found;
}
