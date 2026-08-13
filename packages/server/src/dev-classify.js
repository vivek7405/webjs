/**
 * Classify a dev-watcher file change into a live-reload verdict (#1398).
 *
 * Every dev edit used to produce a full page reload: the page blinks, hydrated
 * component state resets, scroll position is lost. For an edit to a page, a
 * layout, or a server-only module that is heavier than necessary, because pages
 * and layouts never hydrate. Their function runs only on the server, so freshly
 * rendered server HTML is the complete truth for them and nothing in the
 * browser can be stale after a re-render. Such a change can be applied in place
 * through the client router instead of reloading.
 *
 * The decision is made HERE, on the server, and the browser is a dumb executor
 * of the verdict it is handed (the shape Vite and Next.js both settle on). It
 * is kept in its own module, with no server state and no imports, so the ladder
 * is unit-testable without booting anything.
 *
 * The classification walks the MODULE GRAPH, never the path shape. A path-shape
 * heuristic ("anything under `app/**` named `page.ts` can morph") is wrong in
 * both directions and neither failure is exotic:
 *
 * - A page that imports a client-effecting non-component util SHIPS WHOLE (the
 *   import-only rule in `component-elision.js`, #605 / #963). Editing it changes
 *   browser-bound JS, so it must reload despite being a page.
 * - A helper under `modules/<feature>/utils/` imported by both a page and a
 *   component is a component edit by reachability, and its path says nothing.
 *
 * Everything the server cannot classify is a full reload. A wrong morph is a
 * broken page; a wrong reload is a flash.
 */

/**
 * The three verdicts, STRONGEST FIRST. The index in this array IS the strength
 * order, which is what `strongerVerdict` compares and what lets a batch of
 * changes collapse to the strongest verdict it contains rather than the last.
 *
 * - `reload`: a component module, anything transitively reaching one, or any
 *   path the server cannot place. The browser does `location.reload()`.
 * - `shell`: a layout module, or a server-only module. The browser re-renders
 *   the current URL and replaces the whole body, preserving scroll.
 * - `page`: a page module and nothing else. The browser re-renders the current
 *   URL and morphs the deepest shared boundary, preserving scroll AND the
 *   hydrated state of components outside the changed region.
 *
 * @type {readonly ['reload', 'shell', 'page']}
 */
export const RELOAD_VERDICTS = /** @type {const} */ (['reload', 'shell', 'page']);

/**
 * @typedef {{ v: 'page' | 'shell' | 'reload', by: string, why: string }} ReloadVerdict
 */

/**
 * The stronger of two verdicts, treating `null` / `undefined` as weakest and an
 * unrecognised one as `reload` (fail safe, never fail open).
 *
 * Used twice for the same reason. The watcher can see several files change
 * inside one 80ms debounce window, and the browser relay coalesces a burst of
 * signals into ONE emitted reload (#1397). In both places a batch mixing a page
 * edit and a component edit is a COMPONENT edit, so taking the last verdict
 * would leave the old component class running against fresh markup.
 *
 * @param {ReloadVerdict | null | undefined} a
 * @param {ReloadVerdict | null | undefined} b
 * @returns {ReloadVerdict | null}
 */
export function strongerVerdict(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return verdictRank(a.v) <= verdictRank(b.v) ? a : b;
}

/**
 * Strength rank of a verdict name. An unknown name ranks as `reload` (0), the
 * strongest, so a corrupt or future value can only ever over-reload.
 * @param {string} v
 * @returns {number}
 */
function verdictRank(v) {
  const i = RELOAD_VERDICTS.indexOf(/** @type any */ (v));
  return i === -1 ? 0 : i;
}

/**
 * Classify one changed absolute path into a reload verdict.
 *
 * The ladder, first match wins:
 *
 * 1. The analysis is cold, so nothing is known yet. Fail safe. This mirrors
 *    Vite's pessimistic seed (`needFullReload = modules.length === 0`). A
 *    rebuild invalidates the lazy analysis, so this rung is live between a
 *    rebuild and the next request. In practice the reload or in-place refresh
 *    each verdict produces IS that request, so the analysis is warm again well
 *    before the next edit lands, and the rung only catches an edit that beat
 *    the browser to it.
 * 2. The path is outside `appDir`. The watcher only fires for `appDir` plus the
 *    opt-in `webjs.dev.watch` roots (#894), and a file outside `appDir` is
 *    content the server reads at render time, never a browser module. It can
 *    change what any layout renders, so it takes the whole-body `shell` swap.
 * 3. The path is in the SHIPPED closure. This is the transitive answer and the
 *    one that matters: the browser holds this module, so the page must reload.
 * 4. The path is a page module. Morphable.
 * 5. The path is somewhere else in the module graph (a layout, a server-only
 *    util, a `.server.*` file reachable only from a page). Server-only by
 *    elimination, so `shell`.
 * 6. Anything else. A brand-new file, a deleted file, and every `public/` asset
 *    land here. A `public/` stylesheet MUST: `mergeHead` preserves stylesheets
 *    unconditionally (#936), so a swap would visibly do nothing.
 *
 * Note what step 3 sweeps in deliberately. A `'use server'` action file
 * imported by a SHIPPING component is inside the closure (the graph keeps a
 * `.server.*` node and stops at it), so editing it reloads. That is correct
 * rather than merely conservative, because adding an export to that file
 * changes the generated RPC stub the browser holds. The same action imported
 * only by a page falls to step 5 and gets `shell`.
 *
 * @param {string} abs  absolute path of the changed file
 * @param {object} ctx
 * @param {string} ctx.appDir
 * @param {Set<string>} ctx.shippedFiles  transitive closure of every module the browser can load
 * @param {Set<string>} ctx.graphFiles  every app source file the module graph walked
 * @param {Set<string>} ctx.pageFiles  every `page.{js,ts}` on the route table
 * @param {boolean} ctx.analysisReady  false before the first analysis completes
 * @param {string} [ctx.sep]  path separator, injectable so the ladder is testable off-platform
 * @returns {ReloadVerdict}
 */
export function classifyChangedPath(abs, ctx) {
  const sep = ctx.sep || '/';
  const by = relativize(abs, ctx.appDir, sep);
  if (!abs) return { v: 'reload', by: '', why: 'no-path' };
  if (!ctx.analysisReady) return { v: 'reload', by, why: 'analysis-cold' };
  if (!isUnder(abs, ctx.appDir, sep)) return { v: 'shell', by, why: 'extra-watch-root' };
  if (ctx.shippedFiles && ctx.shippedFiles.has(abs)) return { v: 'reload', by, why: 'ships-to-browser' };
  if (ctx.pageFiles && ctx.pageFiles.has(abs)) return { v: 'page', by, why: 'page-module' };
  if (ctx.graphFiles && ctx.graphFiles.has(abs)) return { v: 'shell', by, why: 'server-only-module' };
  return { v: 'reload', by, why: 'unknown-path' };
}

/**
 * True when `abs` sits inside `dir`. The `dir + sep` boundary is what stops a
 * sibling directory sharing a prefix (`/app-old` against `/app`) from being
 * read as containment, the same guard `asset-hash` uses.
 * @param {string} abs
 * @param {string} dir
 * @param {string} sep
 */
function isUnder(abs, dir, sep) {
  if (!dir) return false;
  return abs === dir || abs.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}

/**
 * The app-relative path, or the absolute path when it is not under `appDir`.
 * Diagnostic only: it rides the SSE frame as `by` so a dev can see which file
 * produced a verdict, and nothing branches on it.
 * @param {string} abs
 * @param {string} dir
 * @param {string} sep
 */
function relativize(abs, dir, sep) {
  if (!abs) return '';
  if (!isUnder(abs, dir, sep)) return abs;
  return abs.slice(dir.endsWith(sep) ? dir.length : dir.length + 1);
}
