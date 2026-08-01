/**
 * Route-types generator (#258).
 *
 * `generateRouteTypes(appDir)` walks `app/` (reusing `buildRouteTable`, the
 * one route enumerator) and emits the `.d.ts` TEXT that augments
 * `@webjsdev/core`, narrowing the `Route` href union and the per-route
 * `params` shape. It is the opt-in codegen behind `webjs types`; the static
 * types in `@webjsdev/core` (`PageProps`, `LayoutProps`, `Route`, …) work
 * without it (un-generated apps see `Route = string`).
 *
 * Design choices:
 *   - PAGES ONLY. A `route.{js,ts}` handler is an API endpoint, not a
 *     navigable HTML page, so its path is excluded from the navigable `Route`
 *     union. Pages (including ones hosting a bound form) are what a valid href points
 *     at.
 *   - The route KEY is the literal pattern (`/blog/[slug]`), derived from the
 *     page's directory with route groups `(group)` stripped and `_private`
 *     dirs excluded, matching `buildRouteTable`'s own URL normalization.
 *   - The optional catch-all `[[...slug]]` emits TWO `WebjsRoutes` keys (the
 *     with-segment `/docs/[[...slug]]` and the without-segment `/docs`), so a
 *     bare `/docs` and a `/docs/a/b` both type-check. Keeping the with/without
 *     split in the generator lets the pure `RoutePattern` type stay simple.
 *   - Param object shapes are known here: `[slug]` -> `{ slug: string }`,
 *     `[...rest]` -> `{ rest: string[] }`, `[[...rest]]` -> `{ rest?: string[] }`.
 *   - Deterministic: keys are sorted so re-running yields a byte-identical
 *     file (clean diffs, idempotent).
 */

import { buildRouteTable } from './router.js';

/** @param {string} seg */
function isUrlSegment(seg) {
  if (seg.startsWith('(') && seg.endsWith(')')) return false; // route group
  if (seg.startsWith('_')) return false; // private
  return true;
}

/**
 * The literal route key for a page directory, e.g. `app/blog/[slug]/page.ts`
 * (routeDir `blog/[slug]`) -> `/blog/[slug]`. The root page (routeDir `.`)
 * -> `/`. Route groups and private segments are dropped from the path.
 *
 * @param {string} routeDir  POSIX-style, `.` for the app root.
 * @returns {string}
 */
export function routeKeyFromDir(routeDir) {
  if (routeDir === '.' || routeDir === '') return '/';
  const segs = routeDir.split('/').filter(isUrlSegment);
  if (segs.length === 0) return '/';
  return '/' + segs.join('/');
}

/**
 * @typedef {{ name: string, kind: 'single' | 'catchAll' | 'optionalCatchAll' }} DynSeg
 */

/**
 * Extract the dynamic segments of a route key in order.
 *
 * @param {string} key  A literal route key like `/blog/[slug]`.
 * @returns {DynSeg[]}
 */
export function dynamicSegments(key) {
  /** @type {DynSeg[]} */
  const out = [];
  for (const seg of key.split('/')) {
    if (seg.startsWith('[[...') && seg.endsWith(']]')) {
      out.push({ name: seg.slice(5, -2), kind: 'optionalCatchAll' });
    } else if (seg.startsWith('[...') && seg.endsWith(']')) {
      out.push({ name: seg.slice(4, -1), kind: 'catchAll' });
    } else if (seg.startsWith('[') && seg.endsWith(']')) {
      out.push({ name: seg.slice(1, -1), kind: 'single' });
    }
  }
  return out;
}

/**
 * The TypeScript params-object literal for a route key, e.g.
 * `{ slug: string }` / `{ rest: string[] }` / `{ slug?: string[] }`. Returns
 * null for a static route (no entry needed in `RouteParamMap`).
 *
 * @param {string} key
 * @returns {string | null}
 */
export function paramTypeForKey(key) {
  const dyn = dynamicSegments(key);
  if (dyn.length === 0) return null;
  const fields = dyn.map((d) => {
    if (d.kind === 'single') return `${d.name}: string`;
    if (d.kind === 'catchAll') return `${d.name}: string[]`;
    return `${d.name}?: string[]`; // optionalCatchAll
  });
  return `{ ${fields.join('; ')} }`;
}

/**
 * Build the set of `WebjsRoutes` HREF keys for a route key. These keys drive
 * the `Route` href union, so each must be a form the pure `RoutePattern` type
 * can expand cleanly (it only understands the single `[x]` and catch-all
 * `[...x]` segments, NOT the doubled `[[...x]]`). So:
 *   - A static route yields itself.
 *   - A normal dynamic route (`[x]` / `[...x]`) yields itself.
 *   - An OPTIONAL catch-all `[[...x]]` yields TWO keys: the WITHOUT-segment
 *     form (the segment elided, the `//` collapsed) so a bare path matches,
 *     and a NORMALIZED with-segment form where `[[...x]]` is rewritten to the
 *     plain catch-all `[...x]` so the deep path matches. The author-facing
 *     literal `[[...x]]` stays the `RouteParamMap` key (that is what a page
 *     passes to `PageProps`), but it is NOT a Route-union key.
 *
 * @param {string} key
 * @returns {string[]}
 */
export function webjsRoutesKeysForKey(key) {
  if (!key.includes('[[...')) return [key];
  // With-segment: rewrite each `[[...name]]` to the plain catch-all `[...name]`.
  const withSeg = key.replace(/\[\[\.\.\.([^\]]+)\]\]/g, '[...$1]');
  // Without-segment: drop the optional catch-all segment entirely.
  let without = key.replace(/\/\[\[\.\.\.[^\]]+\]\]/g, '');
  if (without === '') without = '/';
  const out = new Set([withSeg]);
  out.add(without);
  return [...out];
}

/**
 * Generate the augmentation `.d.ts` text for an app's routes.
 *
 * @param {string} appDir  The app root (the dir containing `app/`).
 * @returns {Promise<string>}
 */
export async function generateRouteTypes(appDir) {
  const table = await buildRouteTable(appDir);

  /** @type {Set<string>} */
  const routeKeys = new Set();
  /** @type {Map<string, string>} */
  const paramEntries = new Map();

  for (const page of table.pages) {
    const key = routeKeyFromDir(page.routeDir);
    const paramType = paramTypeForKey(key);
    if (paramType) paramEntries.set(key, paramType);
    for (const k of webjsRoutesKeysForKey(key)) routeKeys.add(k);
  }

  const sortedKeys = [...routeKeys].sort();
  const sortedParamKeys = [...paramEntries.keys()].sort();

  const routeLines = sortedKeys.map((k) => `    ${JSON.stringify(k)}: true;`);
  const paramLines = sortedParamKeys.map(
    (k) => `    ${JSON.stringify(k)}: ${paramEntries.get(k)};`,
  );

  // The without-segment optional-catch-all key has no dynamic segment, so it
  // gets no RouteParamMap entry (its params are optional anyway); the
  // with-segment key carries the `{ name?: string[] }` shape.

  const out = `// AUTO-GENERATED by \`webjs types\`. Do not edit. Regenerated from app/ routes.
//
// Augments @webjsdev/core so the Route href union, navigate(), and per-route
// params are typed for this app. Regenerated per machine (gitignored, like
// Next's .next/types). Re-run \`webjs types\` after adding or removing a route.
import '@webjsdev/core';

declare module '@webjsdev/core' {
  interface WebjsRoutes {
${routeLines.join('\n')}
  }
  interface RouteParamMap {
${paramLines.join('\n')}
  }
}
`;
  return out;
}
