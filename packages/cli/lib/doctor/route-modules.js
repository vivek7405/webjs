import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Directories the route-module walk never descends into (deps, VCS, framework
// and build caches). Mirrors FRESHNESS_IGNORE; kept separate so either walk can
// change its exclusions without silently moving the other.
export const ROUTE_WALK_IGNORE = new Set(['node_modules', '.git', '.webjs', 'dist', '.next', 'coverage']);

/**
 * A route module that renders markup on the server, which is where `asset()`
 * belongs. Page and layout are the common case, but the BOUNDARY modules matter
 * too and are easy to miss: `error` / `not-found` / `forbidden` / `unauthorized`
 * / `loading` are always shipped and never elided, and `global-error` renders
 * its OWN `<!doctype><html><head>` and is returned verbatim with no framework
 * head splice, which makes it the likeliest place outside the root layout for
 * an author to hand-write a stylesheet link.
 * @type {RegExp}
 */
export const ROUTE_MODULE_RE =
  /^(?:page|layout|error|not-found|forbidden|unauthorized|loading)\.(?:js|ts|mjs|mts)$/;

/**
 * The two boundary stems `router.js` registers ONLY at the app root (both are
 * guarded by `dir === '.'` there). A nested `app/admin/global-error.ts` is never
 * in the route table and never renders, so scanning one would advise on dead
 * code, the same defect the `_private` skip exists to avoid.
 * @type {RegExp}
 */
export const ROOT_ONLY_MODULE_RE = /^(?:global-error|global-not-found)\.(?:js|ts|mjs|mts)$/;

/**
 * The app's `webjs.basePath`, normalized to `''` (root mount) or `/segment…`.
 *
 * A faithful port of `normalizeBasePath` (`packages/server/src/base-path.js`),
 * which is the source of truth: it trims, PREPENDS the leading slash (so the
 * documented `"myapp"`, `"/myapp"` and `"/myapp/"` all normalize alike), and
 * fails safe to `''` on a value that is not a plain same-origin prefix. Reading
 * only `startsWith('/')` would leave this check inert for an app configured
 * `"myapp"`, which is exactly the silently-inert case it exists to close.
 *
 * Ported rather than imported because that helper is not on `@webjsdev/server`'s
 * public surface, and because doctor must stay usable when the framework does
 * not resolve from the app dir at all (the #954 fresh-worktree case this same
 * command exists to diagnose). The port is intentional and stays. What makes it
 * safe is that the drift is tested rather than trusted.
 *
 * `test/cli/base-path-parity.test.mjs` feeds one input table through BOTH this
 * function and the server's `readBasePath`, asserting they agree with each other
 * and with the expected value. Change either side without the other and it reds.
 * So edit this body only alongside `packages/server/src/base-path.js`, and run
 * that test. (`test/cli/doctor.test.mjs` covers the check that consumes this,
 * not the normalization forms themselves.)
 * @param {string} appDir
 * @returns {Promise<string>}
 */
export async function readAppBasePath(appDir) {
  let raw;
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    raw = pkg?.webjs?.basePath;
  } catch {
    return '';
  }
  if (typeof raw !== 'string') return '';
  let v = raw.trim();
  if (v === '' || v === '/') return '';
  // Not a plain same-origin path prefix: fail safe to no base path.
  if (v.includes('..') || v.includes('://') || v.includes('\\') || /\s/.test(v)) return '';
  // A network-path reference (`//host`) is rejected BEFORE leading slashes are
  // collapsed, since collapsing would turn an origin escape into `/host`.
  if (v.startsWith('//')) return '';
  v = ('/' + v.replace(/^\/+/, '')).replace(/\/+$/, '');
  return v === '' || v === '/' ? '' : v;
}

/**
 * Collect every `app/**` route module that renders markup, depth-first.
 * Best-effort: an unreadable directory contributes nothing rather than throwing.
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function collectRouteModules(dir, root = dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || ROUTE_WALK_IGNORE.has(e.name)) continue;
    if (e.isSymbolicLink()) continue; // never follow: can cycle or escape into deps
    // `_`-prefixed folders are PRIVATE: `router.js` drops any route whose
    // directory has such a segment, so markup under one is never routed and
    // never rendered. Advising on it would be advice about dead code.
    if (e.isDirectory() && e.name.startsWith('_')) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) collectRouteModules(abs, root, out);
    else if (ROUTE_MODULE_RE.test(e.name)) out.push(abs);
    else if (dir === root && ROOT_ONLY_MODULE_RE.test(e.name)) out.push(abs);
  }
  return out;
}
