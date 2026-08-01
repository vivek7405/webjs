/**
 * Bun install for SSR action-result seeding (#472, #529).
 *
 * Bun has no `module.registerHooks`, so the seed facade is installed via a
 * `Bun.plugin` `onLoad`, the Bun analog of the Node load hook in
 * `action-seed.js`. This module is dynamically imported by `registerActionHooks`
 * ONLY when `serverRuntime()` is `'bun'`, so the `Bun.*` global is never
 * referenced on Node (the same isolation as `listener-bun.js`).
 *
 * The faceting DECISION (`isSeedCandidate`) and the facade SOURCE
 * (`buildSeedFacade`) are the shared, runtime-neutral helpers passed in, so Node
 * and Bun emit byte-identical facades that feed the same `AsyncLocalStorage`
 * collector. The only Bun-specific glue here is the plugin shell + reading the
 * source via `Bun.file`.
 *
 * Bun's `onLoad` `args.path` includes any query (verified), so the facade's
 * `?webjs-seed-orig` passthrough and a dev `?t=` re-import are both seen, exactly
 * like the Node hook's URL.
 *
 * UNLIKE Node's hook, a Bun `onLoad` registered for a filter MUST return a
 * `{ contents, loader }` object for EVERY match; returning `undefined` to defer
 * to the default loader is an error ("onLoad() expects an object returned"). So
 * the non-facet cases (the `?webjs-seed-orig` passthrough, a `.server.*` with no
 * `'use server'`, an unenumerable `export *`) are handled by reading and
 * RETURNING the real source ourselves with the extension's loader, which is the
 * same module Bun would have loaded.
 */

/**
 * Install the `Bun.plugin` seed `onLoad`. Idempotency is the caller's
 * responsibility (`registerActionHooks` guards on `_registered`).
 *
 * @param {{
 *   isSeedCandidate: (specifier: string) => boolean,
 *   buildSeedFacade: (origSpec: string, absPath: string, src: string) => (string | null),
 *   serverFileRe: RegExp,
 * }} helpers
 */
export function installBunSeedPlugin({ isSeedCandidate, buildSeedFacade, serverFileRe }) {
  Bun.plugin({
    name: 'webjs-action-seed',
    setup(build) {
      // The filter is a cheap path pre-screen (`*.server.*`, optional query).
      build.onLoad({ filter: serverFileRe }, async (args) => {
        const absPath = args.path.split('?')[0];
        // `.ts` / `.mts` strip via the `ts` loader; `.js` / `.mjs` via `js`.
        const loader = /\.m?ts$/.test(absPath) ? 'ts' : 'js';
        // Read the real source. A genuine read failure (missing file) propagates,
        // which Bun reports as a load error exactly as it would without the plugin.
        const src = await Bun.file(absPath).text();
        try {
          // Facet only a `'use server'` candidate (not the `?webjs-seed-orig`
          // passthrough); a non-candidate or a passthrough falls through to the
          // raw source below.
          if (isSeedCandidate(args.path)) {
            const source = buildSeedFacade(args.path, absPath, src);
            if (source != null) return { contents: source, loader: 'js' };
          }
        } catch {
          // Fail-open: any faceting error serves the raw source (no seeding for
          // this module), the Bun analog of the Node hook's `nextLoad` fallback.
        }
        return { contents: src, loader };
      });
    },
  });
}
