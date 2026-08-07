/**
 * The differential-elision primitives, shared by the framework's own guard and
 * by the app-facing one (#1308).
 *
 * Elision's defining invariant is that removing the elided JS NEVER changes
 * observable output. `packages/server/test/elision/differential-elision.test.js`
 * proves that for the blog corpus by rendering every route with elision ON and
 * OFF and diffing the bytes with the JS-loaded set masked out. `webjs elision
 * --verify` runs the identical comparison over an arbitrary app's own route
 * table, so every app gets the framework's own guard rather than inheriting a
 * guarantee it cannot verify locally.
 *
 * `maskJsSet` therefore lives HERE and not in either consumer: it is the
 * definition of "the JS-loaded set", and two copies is the one way the two
 * guards could silently disagree about what the invariant even means.
 *
 * A leaf module: `node:path` is not even needed, and nothing here reads the
 * filesystem or builds a graph.
 */

/**
 * Mask the JS-loaded set so the diff sees only observable output. The
 * importmap, the boot module script, and the modulepreload hints are
 * REMOVED (not placeheld) because their COUNT differs on vs off, and the
 * build-id hash is derived from them; collapsing whitespace afterwards
 * means the differing-length preload block in the head leaves no trace. The
 * two responses come from the identical SSR template pipeline, so any
 * legitimate text/whitespace is the same on both sides regardless.
 *
 * Because the whole JS-loaded set is masked BY CONSTRUCTION, only the
 * DANGEROUS direction (elision changed what the SSR emits) can fail a diff
 * built on this. The SAFE direction (over-ship) lives entirely inside the
 * masked region and is invisible here, by design.
 *
 * @param {string} html
 * @returns {string}
 */
export function maskJsSet(html) {
  return html
    .replace(/<script type="importmap"[\s\S]*?<\/script>/g, '')
    .replace(/<script type="module"[\s\S]*?<\/script>/g, '')
    .replace(/<link rel="modulepreload"[^>]*>/g, '')
    // The auto vendor preconnect / dns-prefetch (#243) is a connection-warming
    // HINT derived from the served vendor map, which legitimately differs on vs
    // off (a vendor reachable only through an elided component is pruned on the
    // ON side, so its preconnect drops too, exactly like its modulepreload). It
    // is part of the same JS-loaded set, so mask it. The blog corpus declares
    // no `metadata.preconnect` of its own, so every preconnect/dns-prefetch
    // there is the auto vendor one.
    .replace(/<link rel="preconnect"[^>]*>/g, '')
    .replace(/<link rel="dns-prefetch"[^>]*>/g, '')
    .replace(/ data-webjs-build="[^"]*"/g, '')
    .replace(/ data-webjs-src="[^"]*"/g, '')
    // Render-clock nondeterminism: a page that SSRs a live wall-clock time
    // ("posts loaded · 3:10:10 AM") ticks between the on and off captures. This
    // is unrelated to elision (elision never changes rendered text), so
    // normalise it. The counterfactual in differential-elision.test.js still
    // fails because a removed element is a structural change, not a clock tick.
    .replace(/\b\d{1,2}:\d{2}:\d{2}\s?[AP]M\b/gi, 'TIME')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The URL paths of every STATIC page route in a route table, sorted and
 * deduped. The corpus `webjs elision --verify` renders on both sides.
 *
 * A DYNAMIC route is excluded rather than guessed at: rendering it would mean
 * inventing param values, and a route that 404s or throws on invented params
 * proves nothing. The command reports the excluded routes by name and takes
 * `--routes` for an author who wants to cover them with real values.
 *
 * Normalization is `routePathFromDir`'s, restated here so this leaf does not
 * depend on `@webjsdev/mcp`: a route group `(group)` and a `_private` segment
 * drop out of the URL, and the root `.` is `/`.
 *
 * @param {{ pages?: Array<{ routeDir?: string, paramNames?: string[] }> }} table  a `buildRouteTable(appDir)` result
 * @returns {string[]}
 */
export function staticPageRoutes(table) {
  const out = new Set();
  for (const r of table?.pages || []) {
    if (r.paramNames && r.paramNames.length) continue;
    out.add(routePath(r.routeDir));
  }
  return [...out].sort();
}

/**
 * `blog` -> `/blog`, the root `.` -> `/`. Route groups and `_private` segments
 * drop, the same normalization `buildRouteTable` uses for matching.
 * @param {string|undefined} routeDir
 * @returns {string}
 */
function routePath(routeDir) {
  if (!routeDir || routeDir === '.') return '/';
  const segs = routeDir
    .split('/')
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('_'));
  return segs.length ? '/' + segs.join('/') : '/';
}
