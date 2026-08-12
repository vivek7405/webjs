/**
 * The browser-bound ENTRY files of an app: every module the client boot can
 * import directly.
 *
 * Feeding these to `reachableFromEntries` produces webjs's equivalent of
 * Next.js's bundler-produced page manifest, derived lazily on the first
 * request (and re-derived on every rebuild) instead of at compile time. The
 * dev server uses that closure as an authorization gate on its source-file
 * branch: in-set is served (subject to the `.server.{js,ts}` stub guardrail),
 * out-of-set 404s. Feeding them to `reachableBareSpecifiers` produces the
 * vendor importmap, which is why this half is its own module: the CLI-side
 * vendor paths (`pinAll`, `webjs doctor`) root at exactly the entries the gate
 * does, without booting a server.
 *
 * Entries:
 *   - page / layout (both re-run on the client for hydration)
 *   - the error / loading / not-found / forbidden / unauthorized boundaries
 *   - the two root-only boundaries (global-error, global-not-found)
 *   - instrumentation-client (imported first in the boot)
 *   - every discovered component (a `static lazy` one is fetched by the lazy
 *     loader rather than imported by a page, so the component scan is an entry
 *     source in its own right)
 *
 * NOT entries, because the browser never fetches them as a module:
 *   - route.{js,ts} (API handlers) and middleware.{js,ts}
 *   - metadata routes (sitemap.js, robots.js, manifest.js, …)
 *   - .server.{js,ts} files (the browser gets a stub, not the source)
 */

/**
 * Components are passed in (rather than rescanned) so the caller can share one
 * scan with `primeComponentRegistry`, saving a full appDir walk per analysis.
 *
 * @param {Awaited<ReturnType<typeof import('./router.js').buildRouteTable>>} routeTable
 * @param {Awaited<ReturnType<typeof import('./component-scanner.js').scanComponents>>} components
 * @returns {Set<string>}
 */
export function browserEntryFiles(routeTable, components) {
  /** @type {Set<string>} */
  const entries = new Set();
  for (const page of routeTable.pages) {
    if (page.file) entries.add(page.file);
    for (const f of page.layouts || []) entries.add(f);
    for (const f of page.errors || []) entries.add(f);
    for (const f of page.loadings || []) entries.add(f);
    for (const f of page.forbiddens || []) entries.add(f);
    for (const f of page.unauthorizeds || []) entries.add(f);
  }
  if (routeTable.notFound) entries.add(routeTable.notFound);
  if (routeTable.notFounds) {
    for (const f of routeTable.notFounds.values()) entries.add(f);
  }
  if (routeTable.globalError) entries.add(routeTable.globalError);
  if (routeTable.globalNotFound) entries.add(routeTable.globalNotFound);
  // instrumentation-client is browser-bound (imported first in the boot), so it
  // must be servable through the gate.
  if (routeTable.instrumentationClient) entries.add(routeTable.instrumentationClient);
  // Lazy components live in the registry but no page imports their
  // class directly; the lazy-loader fetches their module URLs on
  // viewport entry. Add every discovered component file as an entry so
  // the graph walk covers both eager and lazy paths.
  for (const c of components) entries.add(c.file);
  return entries;
}
