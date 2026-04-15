import { join, relative, sep, posix } from 'node:path';
import { walk } from './fs-walk.js';

/**
 * @typedef {{
 *   pattern: RegExp,
 *   paramNames: string[],
 *   file: string,
 *   routeDir: string,
 *   layouts: string[],
 *   errors: string[],
 *   loadings: string[],
 *   metadataFiles: string[],
 *   isCatchAll: boolean
 * }} PageRoute
 *
 * @typedef {{
 *   pattern: RegExp,
 *   paramNames: string[],
 *   file: string,
 * }} ApiRoute
 *
 * @typedef {{
 *   pages: PageRoute[],
 *   apis: ApiRoute[],
 *   notFound: string | null,
 *   appDir: string
 * }} RouteTable
 */

/**
 * Scan `<appDir>/app` and build a route table.
 *
 * Supported file conventions (Next.js App Router–compatible):
 *   app/page.js                     → /
 *   app/about/page.js               → /about
 *   app/blog/[slug]/page.js         → /blog/:slug
 *   app/files/[...rest]/page.js     → /files/*
 *   app/(marketing)/about/page.js   → /about   (folders in parens are route groups; not in URL)
 *   app/_internal/page.js           → ignored  (folders starting with _ are private)
 *   app/api/hello/route.js          → /api/hello
 *   app/layout.js                   → wraps every page
 *   app/error.js                    → error boundary (nested)
 *   app/loading.js                  → loading UI (reserved, v1 renders only)
 *   app/not-found.js                → 404 fallback
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
  let notFound = null;

  for await (const file of walk(root)) {
    const rel = relative(root, file).split(sep).join('/');
    const base = posix.basename(rel);
    const dir = posix.dirname(rel);

    // Private folders (any segment starting with _) are excluded from routing.
    if (dir !== '.' && dir.split('/').some((s) => s.startsWith('_'))) continue;

    if (base === 'page.js') {
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
        metadataFiles: [],
        isCatchAll,
      });
    } else if (base === 'layout.js') {
      layouts.set(dir, file);
    } else if (base === 'error.js') {
      errors.set(dir, file);
    } else if (base === 'loading.js') {
      loadings.set(dir, file);
    } else if (base === 'not-found.js' && dir === '.') {
      notFound = file;
    } else if (base === 'route.js') {
      // route.js can live anywhere under app/ (matches Next.js behaviour).
      const segs = dir === '.' ? [] : dir.split('/');
      const { pattern, paramNames } = segmentsToPattern(segs);
      apis.push({ pattern, paramNames, file });
    }
  }

  // Attach nested layouts / error / loading files (outermost first).
  for (const page of pages) {
    const segs = page.routeDir === '.' ? [] : page.routeDir.split('/');
    /** @type {string[]} */
    const chainDirs = ['.'];
    for (let i = 1; i <= segs.length; i++) chainDirs.push(segs.slice(0, i).join('/'));
    page.layouts = chainDirs.map((d) => layouts.get(d)).filter(Boolean);
    page.errors = chainDirs.map((d) => errors.get(d)).filter(Boolean);
    page.loadings = chainDirs.map((d) => loadings.get(d)).filter(Boolean);
    page.metadataFiles = [...page.layouts, page.file];
  }

  pages.sort((a, b) => dynScore(a) - dynScore(b));
  return { pages, apis, notFound, appDir };
}

/** @param {string} seg */
function isUrlSegment(seg) {
  if (seg.startsWith('(') && seg.endsWith(')')) return false; // route group
  if (seg.startsWith('_')) return false; // private
  return true;
}

/** @param {PageRoute} r */
function dynScore(r) {
  if (r.isCatchAll) return 3;
  if (r.paramNames.length) return 2;
  return 1;
}

/**
 * @param {string[]} segments
 * @param {string} [prefix]
 */
function segmentsToPattern(segments, prefix = '') {
  const paramNames = [];
  let isCatchAll = false;
  const parts = segments
    .filter(isUrlSegment)
    .map((seg) => {
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
  const pattern = new RegExp(`^${escapeRe(prefix)}${body}/?$`);
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
