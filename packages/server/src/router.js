import { join, relative, sep, posix } from 'node:path';
import { walk } from './fs-walk.js';
import { findInstrumentationClient } from './instrumentation.js';

/**
 * @typedef {{
 *   pattern: RegExp,
 *   paramNames: string[],
 *   file: string,
 *   routeDir: string,
 *   layouts: string[],
 *   errors: string[],
 *   loadings: string[],
 *   notFounds: string[],
 *   forbiddens: string[],
 *   unauthorizeds: string[],
 *   metadataFiles: string[],
 *   middlewares: string[],
 *   isCatchAll: boolean
 * }} PageRoute
 *
 * @typedef {{
 *   pattern: RegExp,
 *   paramNames: string[],
 *   file: string,
 *   middlewares: string[],
 * }} ApiRoute
 *
 * @typedef {{ stem: string, file: string, urlPath: string }} MetadataRoute
 *
 * @typedef {{
 *   pages: PageRoute[],
 *   apis: ApiRoute[],
 *   notFound: string | null,
 *   notFounds: Map<string, string>,
 *   globalError: string | null,
 *   globalNotFound: string | null,
 *   metadataRoutes: MetadataRoute[],
 *   instrumentationClient: string | null,
 *   appDir: string
 * }} RouteTable
 */

/**
 * Scan `<appDir>/app` and build a route table.
 *
 * Supported file conventions (NextJs App Router–compatible):
 *   app/page.js                     → /
 *   app/about/page.js               → /about
 *   app/blog/[slug]/page.js         → /blog/:slug
 *   app/files/[...rest]/page.js     → /files/*
 *   app/(marketing)/about/page.js   → /about   (folders in parens are route groups; not in URL)
 *   app/_internal/page.js           → ignored  (folders starting with _ are private)
 *   app/api/hello/route.js          → /api/hello
 *   app/layout.js                   → wraps every page
 *   app/error.js                    → error boundary (nested)
 *   app/loading.js                  → loading UI (auto-wraps page in Suspense)
 *   app/not-found.js                → 404 fallback (nested: nearest wins)
 *   app/[[...slug]]/page.js         → optional catch-all (matches / AND /a/b)
 *   app/sitemap.js                  → serves /sitemap.xml
 *   app/robots.js                   → serves /robots.txt
 *   app/icon.js                     → serves /icon (dynamic)
 *   app/opengraph-image.js          → serves /opengraph-image (dynamic)
 *
 * @param {string} appDir
 * @returns {Promise<RouteTable>}
 */
export async function buildRouteTable(appDir) {
  const root = join(appDir, 'app');
  /** @type {PageRoute[]} */
  const pages = [];
  /** @type {ApiRoute[]} */
  const apis = [];
  /** @type {Map<string,string>} */
  const layouts = new Map();
  /** @type {Map<string,string>} */
  const errors = new Map();
  /** @type {Map<string,string>} */
  const loadings = new Map();
  /** @type {Map<string,string>} */
  const middlewares = new Map();
  /** @type {Map<string, string>} */
  const notFounds = new Map();
  let notFound = null;
  /** @type {Map<string,string>} */
  const forbiddens = new Map();
  /** @type {Map<string,string>} */
  const unauthorizeds = new Map();
  // Root-only boundaries (#848): the app-wide catch-all error and the
  // unmatched-anywhere 404, set only at dir '.'.
  let globalError = null;
  let globalNotFound = null;
  /** @type {MetadataRoute[]} */
  const metadataRoutes = [];

  /** @type {Set<string>} */
  const METADATA_STEMS = new Set(['sitemap', 'robots', 'manifest', 'icon', 'apple-icon', 'opengraph-image', 'twitter-image']);
  /** @type {Record<string,string>} */
  const METADATA_URL_MAP = {
    'sitemap': '/sitemap.xml',
    'robots': '/robots.txt',
    'manifest': '/manifest.json',
    'icon': '/icon',
    'apple-icon': '/apple-icon',
    'opengraph-image': '/opengraph-image',
    'twitter-image': '/twitter-image',
  };

  for await (const file of walk(root)) {
    const rel = relative(root, file).split(sep).join('/');
    const base = posix.basename(rel);
    const dir = posix.dirname(rel);

    // Private folders (any segment starting with _) are excluded from routing.
    if (dir !== '.' && dir.split('/').some((s) => s.startsWith('_'))) continue;

    // Match `<name>.<js|mjs|ts|mts>` conventions. Stem is the name without ext.
    const stem = stemOf(base);
    if (!stem) continue;

    if (stem === 'page') {
      const segs = dir === '.' ? [] : dir.split('/');
      const { pattern, paramNames, isCatchAll } = segmentsToPattern(segs);
      pages.push({
        pattern,
        paramNames,
        file,
        routeDir: dir,
        layouts: [],
        errors: [],
        loadings: [],
        forbiddens: [],
        unauthorizeds: [],
        metadataFiles: [],
        middlewares: [],
        isCatchAll,
      });
    } else if (stem === 'layout') {
      layouts.set(dir, file);
    } else if (stem === 'error') {
      errors.set(dir, file);
    } else if (stem === 'loading') {
      loadings.set(dir, file);
    } else if (stem === 'middleware') {
      middlewares.set(dir, file);
    } else if (stem === 'not-found') {
      notFounds.set(dir, file);
      if (dir === '.') notFound = file;
    } else if (stem === 'forbidden') {
      forbiddens.set(dir, file);
    } else if (stem === 'unauthorized') {
      unauthorizeds.set(dir, file);
    } else if (stem === 'global-error') {
      if (dir === '.') globalError = file;
    } else if (stem === 'global-not-found') {
      if (dir === '.') globalNotFound = file;
    } else if (METADATA_STEMS.has(stem) && (dir === '.' || dir.split('/').every(s => !s.startsWith('[')))) {
      // Metadata route: sitemap.ts, robots.ts, icon.ts, etc.
      // Only at root or static segments (no dynamic params in metadata routes).
      const urlPath = METADATA_URL_MAP[stem] || `/${stem}`;
      metadataRoutes.push({ stem, file, urlPath });
    } else if (stem === 'route') {
      // route.js / route.ts can live anywhere under app/ (matches NextJs).
      const segs = dir === '.' ? [] : dir.split('/');
      const { pattern, paramNames } = segmentsToPattern(segs);
      apis.push({ pattern, paramNames, file, routeDir: dir, middlewares: [] });
    }
  }

  // Attach nested layouts / error / loading / middleware files (outermost first).
  for (const page of pages) {
    const chainDirs = chainOf(page.routeDir);
    page.layouts = chainDirs.map((d) => layouts.get(d)).filter(Boolean);
    page.errors = chainDirs.map((d) => errors.get(d)).filter(Boolean);
    page.loadings = chainDirs.map((d) => loadings.get(d)).filter(Boolean);
    page.notFounds = chainDirs.map((d) => notFounds.get(d)).filter(Boolean);
    page.forbiddens = chainDirs.map((d) => forbiddens.get(d)).filter(Boolean);
    page.unauthorizeds = chainDirs.map((d) => unauthorizeds.get(d)).filter(Boolean);
    page.middlewares = chainDirs.map((d) => middlewares.get(d)).filter(Boolean);
    page.metadataFiles = [...page.layouts, page.file];
  }
  for (const api of apis) {
    /** @type any */
    const a = api;
    const chainDirs = chainOf(a.routeDir);
    a.middlewares = chainDirs.map((d) => middlewares.get(d)).filter(Boolean);
  }

  pages.sort(compareSpecificity);
  // `instrumentation-client.*` is an app-ROOT convention file, not a router
  // stem, but it is a browser-bound entry (the boot imports it first), so the
  // table is where every consumer already looks for one. Resolved HERE rather
  // than by each caller: it used to be attached by the dev server alone, and a
  // second consumer that built its own table (the vendor scan) silently lost
  // the entry, which inverted the pin-is-a-superset invariant. Deriving it in
  // the one place that builds the table makes that class of miss impossible.
  const instrumentationClient = await findInstrumentationClient(appDir);
  return { pages, apis, notFound, notFounds, globalError, globalNotFound, metadataRoutes, instrumentationClient, appDir };
}

/**
 * Return the bare name of a file without the accepted JS/TS extension.
 * `page.js` / `page.mjs` / `page.ts` / `page.mts` → `page`.
 * Returns null for anything else (images, CSS, etc. don't participate in routing).
 *
 * @param {string} base
 * @returns {string | null}
 */
function stemOf(base) {
  const m = /^([A-Za-z0-9_.-]+)\.(?:m?[jt]s)$/.exec(base);
  return m ? m[1] : null;
}

/** @param {string} routeDir */
function chainOf(routeDir) {
  const segs = routeDir === '.' ? [] : routeDir.split('/');
  /** @type {string[]} */
  const dirs = ['.'];
  for (let i = 1; i <= segs.length; i++) dirs.push(segs.slice(0, i).join('/'));
  return dirs;
}

/** @param {string} seg */
function isUrlSegment(seg) {
  if (seg.startsWith('(') && seg.endsWith(')')) return false; // route group
  if (seg.startsWith('_')) return false; // private
  return true;
}

/**
 * Per-URL-segment specificity kind: 0 = static literal, 1 = dynamic `[x]`,
 * 2 = catch-all `[...x]` / `[[...x]]`. Lower is MORE specific. Checks the
 * catch-all forms before the bare `[` (a `[[...x]]` also starts with `[`).
 * @param {string} seg
 * @returns {0 | 1 | 2}
 */
function segKind(seg) {
  if (seg.startsWith('[[...') || seg.startsWith('[...')) return 2;
  if (seg.startsWith('[') && seg.endsWith(']')) return 1;
  return 0;
}

/**
 * The ordered URL segments of a route (route groups + private folders removed),
 * which is the basis for positional specificity.
 * @param {string} routeDir
 * @returns {string[]}
 */
function urlSegmentsOf(routeDir) {
  return (routeDir === '.' ? [] : routeDir.split('/')).filter(isUrlSegment);
}

/**
 * Deterministic route specificity ordering (#750). Replaces the old coarse
 * 3-bucket score (static=1 / dynamic=2 / catch-all=3) whose same-bucket ties
 * resolved by filesystem walk order, so two overlapping dynamic routes
 * (`/[org]/[repo]` vs `/[user]/settings`) could match the WRONG page depending
 * on traversal order. Specificity is fully POSITIONAL, like Next.js's router:
 * compare segment by segment, and the catch-all kind is just the lowest-priority
 * kind AT ITS POSITION, NOT a global "always last" bucket. The contract, most
 * specific first:
 *   1. Compare segment by segment: at the same position a static literal (kind 0)
 *      outranks a dynamic `[x]` (kind 1), which outranks a catch-all
 *      `[...x]` / `[[...x]]` (kind 2). So `/[user]/settings` beats `/[org]/[repo]`
 *      (static tail wins), AND `/docs/[[...slug]]` beats `/[org]/[repo]` (a
 *      literal first segment outranks a dynamic one, even though the former ends
 *      in a catch-all). A global catch-all-last rule would wrongly shadow the
 *      literal-prefixed catch-all behind every all-dynamic route.
 *   2. With an identical kind prefix, the SHORTER (prefix) route ranks first, so
 *      an explicit `/docs` beats the optional-catch-all base `/docs/[[...slug]]`
 *      for `/docs` (the optional catch-all also matches zero trailing segments,
 *      so the shorter exact route is the more specific match). Standard
 *      lexicographic order on the kind arrays.
 *   3. A genuine tie (identical kinds + length, e.g. `/[a]/[b]` vs `/[c]/[d]`)
 *      resolves by an alphabetical `routeDir` key, NOT walk order, so the match
 *      is deterministic across environments.
 *
 * The result is a valid total order (lexicographic on kind arrays with a unique
 * final tiebreak), so `Array.sort` is correct and deterministic regardless of
 * the filesystem traversal order.
 * @param {PageRoute} a
 * @param {PageRoute} b
 * @returns {number}
 */
export function compareSpecificity(a, b) {
  const sa = urlSegmentsOf(a.routeDir).map(segKind);
  const sb = urlSegmentsOf(b.routeDir).map(segKind);
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
  if (sa.length !== sb.length) return sa.length - sb.length; // shorter (prefix) first
  return a.routeDir < b.routeDir ? -1 : a.routeDir > b.routeDir ? 1 : 0;
}

/**
 * @param {string[]} segments
 * @param {string} [prefix]
 */
function segmentsToPattern(segments, prefix = '') {
  const paramNames = [];
  let isCatchAll = false;
  let isOptionalCatchAll = false;
  const parts = segments
    .filter(isUrlSegment)
    .map((seg) => {
      // Optional catch-all: [[...slug]] matches with AND without params
      if (seg.startsWith('[[...') && seg.endsWith(']]')) {
        paramNames.push(seg.slice(5, -2));
        isCatchAll = true;
        isOptionalCatchAll = true;
        return '(.*)';
      }
      if (seg.startsWith('[...') && seg.endsWith(']')) {
        paramNames.push(seg.slice(4, -1));
        isCatchAll = true;
        return '(.*)';
      }
      if (seg.startsWith('[') && seg.endsWith(']')) {
        paramNames.push(seg.slice(1, -1));
        return '([^/]+)';
      }
      return escapeRe(seg);
    });
  const body = parts.length ? '/' + parts.join('/') : '';
  // Optional catch-all: also matches the base path without any trailing segments.
  // e.g., /docs/[[...slug]] matches both /docs and /docs/a/b/c
  const suffix = isOptionalCatchAll ? '(?:/(.*))?/?' : '/?';
  const regexBody = isOptionalCatchAll
    ? body.replace(/\/\(\.\*\)$/, '')  // remove the trailing (.*): we add it as optional
    : body;
  const pattern = new RegExp(`^${escapeRe(prefix)}${regexBody}${isOptionalCatchAll ? suffix : '/?$'}`);
  if (!isOptionalCatchAll) {
    // Standard pattern needs end anchor
    return { pattern: new RegExp(`^${escapeRe(prefix)}${body}/?$`), paramNames, isCatchAll };
  }
  return { pattern, paramNames, isCatchAll };
}

/** @param {string} s */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {RouteTable} table
 * @param {string} pathname
 */
export function matchPage(table, pathname) {
  for (const route of table.pages) {
    const m = route.pattern.exec(pathname);
    if (!m) continue;
    /** @type {Record<string,string>} */
    const params = {};
    route.paramNames.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1] || '')));
    return { route, params };
  }
  return null;
}

/**
 * @param {RouteTable} table
 * @param {string} pathname
 */
export function matchApi(table, pathname) {
  for (const route of table.apis) {
    const m = route.pattern.exec(pathname);
    if (!m) continue;
    /** @type {Record<string,string>} */
    const params = {};
    route.paramNames.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1] || '')));
    return { route, params };
  }
  return null;
}
