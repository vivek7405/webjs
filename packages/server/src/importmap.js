import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { digestHex } from './crypto-utils.js';
import { jsonForScriptTag } from './script-tag-json.js';
import { withBasePath } from './base-path.js';
import { withAssetHash } from './asset-hash.js';

// Local attribute escaper, byte-identical to the pair in `ssr/escape.js`,
// which is the source of truth for HTML attribute escaping in this package.
// Kept inline to avoid a cross-file dependency for one small helper, so the
// two must stay in step: this one escapes an attribute in the served head
// (the importmap script's nonce), so a divergence here moves served bytes
// exactly as a divergence there would.
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Build the import map JSON injected into every SSR HTML document.
 *
 * Additional vendor entries are added automatically when the bare-import
 * scanner discovers npm packages used by client code. The resolution
 * happens via `vendor.js`'s `resolveVendorImports`, which reads the
 * committed `.webjs/vendor/importmap.json` if present, else calls
 * `api.jspm.io/generate` once on the first request (memoized), never at
 * boot. Browser fetches vendor packages
 * directly from jspm.io's CDN (default) or from local `/__webjs/vendor/`
 * paths (after `webjs vendor pin --download`).
 */

/** @type {Record<string, string>} */
let _extraEntries = {};

/**
 * Browser importmap entries for the app's `package.json "imports"` subpath
 * aliases (#555), e.g. `{ "#lib/": "/lib/" }` for `"#lib/*": "./lib/*"`. Kept in lockstep
 * with the server-side resolver (`module-graph.js`'s `expandImportAlias`):
 * BOTH are derived from the one `"imports"` map, so an alias that resolves in
 * SSR never 404s in the browser (the #158/#159 preload-mismatch class). Set at
 * boot by `dev.js` via `setImportAliasEntries`.
 * @type {Record<string, string>}
 */
let _aliasEntries = {};

/**
 * The normalized `webjs.basePath` for a sub-path deployment (issue #256),
 * `''` (the default) for a root mount. When non-empty, every same-origin
 * absolute importmap TARGET (the `/__webjs/core/*` core entries and any
 * same-origin `/__webjs/vendor/*` local vendor target) is prefixed with it
 * so module resolution works under the prefix. A cross-origin `https://`
 * CDN vendor target is absolute and is left untouched. Set once at boot by
 * `setBasePath`, which recomputes the importmap hash so `importMapHash()`
 * stays synchronous on the hot path.
 *
 * @type {string}
 */
let _basePath = '';

/**
 * Bind the importmap to a sub-path deployment's base path (issue #256).
 * Called once at boot by `dev.js`. With the empty default the map is
 * byte-identical to a root mount. The importmap hash is recomputed eagerly
 * (like `setCoreInstall` / `setVendorEntries`) so `importMapHash()` stays
 * synchronous on the per-request SSR path.
 *
 * @param {string} basePath the normalized base path (`''` = root mount)
 * @returns {Promise<void>}
 */
export async function setBasePath(basePath) {
  _basePath = basePath || '';
  _importMapHash = await digestHex('SHA-256', JSON.stringify(buildImportMap({ fingerprint: false })));
}

/**
 * The active base path, for callers that prefix their own emitted URLs
 * against the same value (ssr.js's boot specifiers, preloads, reload src).
 *
 * @returns {string}
 */
export function basePath() {
  return _basePath;
}

/**
 * Derive the BROWSER importmap entries for an app's `package.json "imports"`
 * subpath-alias map (#555). The scaffold ships a single root catch-all key
 * `"#*": "./*"` (one key, zero maintenance: a new top-level folder is aliased
 * with no config change, and `#*` resolves natively on Node AND Bun, unlike a
 * `#/`-prefixed key which Bun rejects). A browser importmap needs a
 * trailing-slash PREFIX key to match, and a bare `#` is not one, so a catch-all
 * is expanded into one prefix scope PER top-level directory (`topLevelDirs`):
 * `#lib/` -> `/lib/`, `#components/` -> `/components/`, etc. The dirs are scanned
 * by the caller (dev.js) so this stays pure; a new folder produces a new scope
 * on the next boot. A non-catch-all key is mapped directly: a per-dir wildcard
 * `"#lib/*": "./lib/*"` becomes `"#lib/": "/lib/"`, an exact `"#db": "./x.ts"`
 * becomes `"#db": "/x.ts"`. The leading `./` becomes a root-absolute `/` and the
 * `*` is dropped (the trailing slash carries the prefix match). A non-default
 * base (`"#*": "./src/*"`) folds into the emitted URL. Only string targets are
 * mappable (a conditional-export object is skipped). Derived from the SAME map
 * the server resolver reads, so SSR and the browser agree.
 *
 * @param {Record<string, unknown> | null | undefined} importsMap
 * @param {string[]} [topLevelDirs]  app top-level dir names, for expanding a `#*` catch-all
 * @returns {Record<string, string>}
 */
export function importAliasBrowserEntries(importsMap, topLevelDirs = []) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!importsMap || typeof importsMap !== 'object') return out;
  for (const [key, value] of Object.entries(importsMap)) {
    if (typeof value !== 'string') continue;
    if (!value.startsWith('./')) continue; // only app-root-relative targets map to a URL
    const star = key.indexOf('*');
    if (star !== -1 && key.slice(0, star) === '#') {
      // Root catch-all `#*` -> `./<base>*`: expand to a prefix scope per dir.
      // base is the part of the value between `.` and `*` (`'' ` for `./*`,
      // `/src/` for `./src/*`), so `#<dir>/` -> `/<base><dir>/`.
      const base = value.slice(1, value.lastIndexOf('*')); // './*' -> '/', './src/*' -> '/src/'
      for (const dir of topLevelDirs) out[`#${dir}/`] = `${base}${dir}/`;
      continue;
    }
    // Per-dir wildcard or exact key: map directly.
    out[key.replace('*', '')] = value.replace(/^\./, '').replace('*', '');
  }
  return out;
}

/**
 * Bind the browser importmap to the app's `package.json "imports"` aliases
 * (#555). Called once at boot by `dev.js`, derived from the SAME `"imports"`
 * map the server resolver reads, so SSR and the browser agree. The hash is
 * recomputed eagerly (like `setBasePath` / `setCoreInstall`) so
 * `importMapHash()` stays synchronous on the per-request path.
 *
 * @param {Record<string, string>} entries  browser entries from `importAliasBrowserEntries`
 * @returns {Promise<void>}
 */
export async function setImportAliasEntries(entries) {
  _aliasEntries = entries && typeof entries === 'object' ? entries : {};
  _importMapHash = await digestHex('SHA-256', JSON.stringify(buildImportMap({ fingerprint: false })));
}

/**
 * SRI integrity hashes keyed by FINAL URL (post-importmap-rewrite).
 * Populated only when a pin file with `integrity` is present;
 * live-API mode skips it.
 * @type {Record<string, string>}
 */
let _vendorIntegrity = {};

/**
 * Merge additional vendor entries into the import map and precompute
 * the importmap-hash so `importMapHash()` can stay synchronous on the
 * per-request SSR hot path. Called from `ensureReady()` on the first
 * request and on every vendor rebuild.
 *
 * @param {Record<string, string>} entries
 * @param {Record<string, string>} [integrity]  SRI hashes keyed by URL
 * @returns {Promise<void>}
 */
export async function setVendorEntries(entries, integrity) {
  _extraEntries = entries;
  _vendorIntegrity = integrity || {};
  _importMapHash = await digestHex('SHA-256', JSON.stringify(buildImportMap({ fingerprint: false })));
}

/**
 * Stable SHA-256 of the current importmap JSON, used as the
 * `data-webjs-build` attribute on `<script type="importmap">` and
 * as the `X-Webjs-Build` response header on every SSR response.
 *
 * Purpose: the X-Webjs-Have partial-response optimization in ssr.js
 * short-circuits at the outermost cached layout and returns only the
 * inner body (no head, no importmap). Without the build header the
 * client router has no way to detect a deploy that bumped the
 * importmap. After a `webjs vendor pin` rerun the user's next
 * intra-shell nav would stay on the stale importmap and the new
 * vendor URLs would never load. The header lets applySwap detect
 * the change and hard-reload before applying the swap.
 *
 * Synchronous accessor. The hash is precomputed eagerly inside
 * `setVendorEntries` (which `ensureReady()` `await`s on the first request
 * and on every rebuild) so the per-request SSR hot path can return the
 * cached string without crossing a Promise boundary.
 *
 * Returns an empty string if `setVendorEntries` has never run; the
 * client router treats an empty `X-Webjs-Build` as "version unknown"
 * and skips the importmap drift check, which is the right behaviour
 * for tests / embedding contexts that never set vendor entries.
 *
 * @returns {string}  e.g. `abc123…` (hex, 64 chars)
 */
let _importMapHash = '';
export function importMapHash() {
  return _importMapHash;
}

/** The installed `@webjsdev/core` version, folded into the published build id (#899). */
let _coreVersion = '';

/**
 * The published, client-facing build id: the value stamped into the
 * `data-webjs-build` attribute and the `X-Webjs-Build` header that the
 * client router compares across navigations to detect a real deploy.
 *
 * Distinct from `importMapHash()` (the live hash of the current map).
 * The published id is advertised ONLY once the importmap is
 * authoritatively final, so the warmup window never advertises a value
 * that later changes. Runtime-first boot resolves an unpinned app's
 * vendor map over the first request; while that is in flight the live
 * hash mutates (empty, then partial, then complete), but the published
 * id stays `''` until the map is final. The router treats an empty
 * build id as "version unknown" and never hard-reloads against it, so a
 * not-yet-final response is reload-safe by construction and cannot wipe
 * a half-filled form.
 *
 * Promoted by `publishBuildId()`: at boot for a pinned app (the
 * committed map is deterministic), or after the first successful vendor
 * resolve for an unpinned app.
 *
 * @returns {string}  the advertised build id, or `''` until final
 */
let _publishedBuildId = '';
export function publishedBuildId() {
  return _publishedBuildId;
}

/**
 * Promote the current `importMapHash()` (folded with the installed
 * `@webjsdev/core` version, #899) to the advertised build id. Called by `dev.js`
 * when the importmap becomes authoritatively final. Idempotent; the value only
 * changes when the map OR the core version does, so re-publishing an unchanged
 * install is a no-op for the client. Within a single process the published id
 * therefore never changes after the first publish (a rebuild in dev re-publishes
 * the fresh map, but dev already forces a full reload via SSE).
 *
 * The empty-until-final guard holds: while `_importMapHash` is `''` (the warmup
 * window) the published id stays `''`, so the router never hard-reloads against
 * an unknown version even with the core version present.
 */
export function publishBuildId() {
  if (!_importMapHash) { _publishedBuildId = ''; return; }
  _publishedBuildId = _coreVersion ? `${_importMapHash}.c${_coreVersion}` : _importMapHash;
}

/**
 * The app-source deploy signal (#899): a short digest advertised as the
 * `data-webjs-src` attribute and the `X-Webjs-Src` header, distinct from the
 * build id above. The client compares it across navigations and, on a mismatch,
 * EVICTS its snapshot/prefetch caches (a soft re-fetch, NOT a hard reload):
 * an app-source or server-framework change alters the SSR output but ships no
 * new browser module the running page must swap, so a full reload would be an
 * over-correction. Set by `dev.js` from a content hash of ALL app source (the
 * module-graph `seen` set, including server-only `.server.ts`) folded with the
 * installed `@webjsdev/server` version, PROD only. Empty in dev / warmup, which
 * the client reads as "unknown" and never acts on (mirrors the build id guard).
 *
 * @type {string}
 */
let _appSourceId = '';

/** @returns {string} the advertised app-source id, or `''` when unknown. */
export function appSourceId() {
  return _appSourceId;
}

/**
 * Set the app-source id from a raw, deterministic input string (sorted
 * `relpath:contentHash` lines plus the server version). Digested to a short hex
 * so it stays a compact header/attribute value. An empty input clears it.
 * @param {string} raw
 * @returns {void}
 */
export function setAppSourceId(raw) {
  _appSourceId = raw ? createHash('sha256').update(raw).digest('hex').slice(0, 16) : '';
}

/**
 * Look up the SRI integrity hash for a vendor URL, or empty string if
 * none. Used by ssr.js to add `integrity="..."` to modulepreload tags
 * pointing at vendor URLs.
 *
 * @param {string} url
 * @returns {string}
 */
export function vendorIntegrityFor(url) {
  return _vendorIntegrity[url] || '';
}

/**
 * The `@webjsdev/core` install's importmap entries, derived from its
 * own `package.json` `exports` field. Populated by `setCoreInstall`
 * at boot.
 *
 * Initialized to the two minimum-safe defaults (the bare specifier
 * pointing at the browser source-mode entry and the catch-all prefix
 * pointing at `src/`) so any consumer that calls `buildImportMap()`
 * before `setCoreInstall` runs still gets a usable map. Pre-#118 the
 * legacy `coreMappings` were always derived from a boolean and so
 * could not be empty; this keeps that fail-open posture for embedded
 * SSR test helpers and one-shot tooling that imports `importmap.js`
 * without booting `dev.js`.
 *
 * @type {Record<string, string>}
 */
let _coreEntries = {
  '@webjsdev/core': '/__webjs/core/index-browser.js',
  '@webjsdev/core/': '/__webjs/core/src/',
};

/**
 * Bind the importmap to a specific `@webjsdev/core` install. The
 * builder reads the package's `package.json` exports field once and
 * derives one importmap entry per exported subpath, picking the
 * `default` (bundled `dist/`) condition when `distMode` is true and
 * the `source` (per-file `src/`) condition when it's false. The
 * derivation lets the framework drop the 9-line hardcoded mapping
 * table that used to live here, and means the importmap follows the
 * shipped package whenever subpaths are renamed or added.
 *
 * The bare `@webjsdev/core` specifier still hardcodes its target
 * (the browser-only entry shipped at `index-browser.js` /
 * `dist/webjs-core-browser.js`) because that file is not declared
 * in the exports field, by design: it is a server-stripped surface
 * meant for the importmap-driven browser route, not Node resolution.
 *
 * Called once by `dev.js` at boot. Not re-called on file-watcher
 * rebuilds today; if `@webjsdev/core/package.json` is edited in a
 * long-running dev session (e.g. workspace dev that runs a fresh
 * `npm run build:dist`), the derivation is refreshed on next server
 * restart, not on the watcher tick. Pre-#118 the legacy
 * `setCoreDistMode` had the same behaviour: only the dist-presence
 * boolean was watched, not the package.json itself.
 *
 * Like `setVendorEntries`, the importmap-hash is recomputed eagerly
 * so `importMapHash()` stays synchronous on the per-request SSR
 * hot path.
 *
 * @param {string} coreDir   absolute path to the resolved `@webjsdev/core` install
 * @param {boolean} distMode true when both `webjs-core.js` and `webjs-core-browser.js` exist in `dist/`
 * @returns {Promise<void>}
 */
export async function setCoreInstall(coreDir, distMode) {
  _coreEntries = buildCoreEntries(coreDir, !!distMode);
  // Capture the installed @webjsdev/core version (#899). The importmap targets
  // core at a version-independent URL, so a core RELEASE (new implementation,
  // same exports) does not move `_importMapHash`; folding the version into the
  // published build id makes such a release change the client's hard-reload
  // signal, since a running page cannot hot-swap the committed importmap core.
  try {
    const v = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8')).version;
    _coreVersion = typeof v === 'string' ? v.replace(/[^\w.-]/g, '').slice(0, 32) : '';
  } catch { _coreVersion = ''; }
  _importMapHash = await digestHex('SHA-256', JSON.stringify(buildImportMap({ fingerprint: false })));
}

/**
 * Read `<coreDir>/package.json` and derive importmap entries from
 * its `exports` field. The function is pure (no side effects) and
 * exported so tests can exercise the derivation directly.
 *
 * For each subpath in `exports` whose value is an object form, emit
 * one entry. Pick the `default` value in dist mode (a bundled
 * `dist/webjs-core-*.js`) and the `source` value in src mode (a
 * per-file `src/*.js`). When `source` is absent (e.g. `./component`,
 * whose shape is `{ types, default }` and whose `default` is itself
 * a `src/` path), fall back to `default` in src mode so the import
 * still resolves with a `.js` extension on the URL.
 *
 * Subpaths with a plain string value (`./client`, `./server`,
 * `./registry`, `./signals`, `./package.json`) are not mapped
 * explicitly; the catch-all `@webjsdev/core/` prefix routes them
 * through `/__webjs/core/src/`. Future-added subpaths added in
 * string form land on the catch-all the same way.
 *
 * Path-traversal guard: any `default` / `source` value that contains
 * `..` is skipped. The trust boundary today is the framework's own
 * `@webjsdev/core/package.json`, but the guard makes a future shift
 * to user-controlled `coreDir` (e.g. via a `--core-dir` flag) safe
 * by construction.
 *
 * @param {string} coreDir
 * @param {boolean} distMode
 * @returns {Record<string, string>}
 */
export function buildCoreEntries(coreDir, distMode) {
  /** @type {Record<string, string>} */
  const out = {
    // Bare specifier: browser-only entry, slim by design (drops
    // render-server, setCspNonceProvider). Node-side consumers
    // resolve via the package.json exports `default` condition and
    // land on `index.js` instead.
    '@webjsdev/core': distMode
      ? '/__webjs/core/dist/webjs-core-browser.js'
      : '/__webjs/core/index-browser.js',
    // Catch-all: source-only subpaths (`./client`, `./server`,
    // `./component`, `./registry`, `./signals`) and any future
    // subpath not yet enumerated by exports still resolve.
    '@webjsdev/core/': '/__webjs/core/src/',
  };
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8'));
  } catch {
    // Without a readable package.json the bare + catch-all entries
    // above are the minimum useful map. Per-subpath entries stay
    // missing; the catch-all picks them up at src/<name> (callers
    // would need to include the .js extension in their import).
    return out;
  }
  const exportsField = pkg && pkg.exports;
  if (!exportsField || typeof exportsField !== 'object') return out;
  for (const [subpath, entry] of Object.entries(exportsField)) {
    // Skip the bare `.` (handled above) and any non-subpath key.
    if (subpath === '.' || !subpath.startsWith('./') || subpath.endsWith('/')) continue;
    // Only object-form entries with both default and source carry
    // a dist mapping. String-form entries (`./client`,
    // `./component` once it loses its types, …) stay on the
    // catch-all.
    if (!entry || typeof entry !== 'object') continue;
    // Pick the condition for the requested mode. In src mode,
    // entries that lack a `source` (e.g. `./component`, whose
    // package.json shape is `{ types, default }`) fall back to
    // `entry.default`. The fallback URL is still a `src/` path on
    // those entries, so it resolves correctly without forcing users
    // to add a `.js` extension to subpath imports.
    let targetRel = distMode ? entry.default : entry.source;
    if (typeof targetRel !== 'string') targetRel = entry.default;
    if (typeof targetRel !== 'string' || !targetRel.startsWith('./')) continue;
    // Reject paths containing `..` to guard against a malformed or
    // adversarial `exports` field producing a path-traversal URL.
    // The check is deliberately broad: `..` substring catches both
    // `../etc/passwd` and `./foo/../bar`.
    if (targetRel.includes('..')) continue;
    // `./lazy-loader` → `@webjsdev/core/lazy-loader`,
    // `./dist/webjs-core-lazy-loader.js` → `/__webjs/core/dist/webjs-core-lazy-loader.js`.
    // The browser-surface subpaths (`./directives`, `./context`, `./task`,
    // `./client-router`) point their `default` at `webjs-core-browser.js`, so in
    // dist mode they all collapse onto that one URL (the bundle re-exports them).
    out['@webjsdev/core' + subpath.slice(1)] = '/__webjs/core/' + targetRel.slice(2);
  }
  return out;
}

/**
 * Build the import map object.
 *
 * @param {{ fingerprint?: boolean }} [opts]  When `fingerprint` is true (the
 *   default, used by the SERVED map in `importMapTag`), same-origin targets
 *   get a `?v=<content-hash>` suffix for immutable caching (issue #243); a
 *   cross-origin CDN target is left untouched (`withAssetHash` skips it, so
 *   its SRI key is unchanged). When false (used by the internal
 *   `importMapHash()` computation), no `?v` is appended, so the published
 *   build id stays a STABLE deploy fingerprint independent of per-file
 *   content hashes (the build id only needs to be stable within a deploy).
 *   In dev, `withAssetHash` is a no-op regardless, so both forms are equal.
 */
export function buildImportMap(opts = {}) {
  const fingerprint = opts.fingerprint !== false;
  const merged = {
    ..._coreEntries,
    ..._extraEntries,
    ..._aliasEntries,
  };
  // Sort keys so logically-identical importmaps serialize byte-for-byte
  // identically. The client router compares textContent to detect
  // post-deploy importmap mismatches; without a stable order the
  // scanner's filesystem-iteration order could change between deploys
  // (e.g. after a file rename) and trigger a spurious hard reload
  // even though the content didn't actually change.
  /** @type {Record<string, string>} */
  const imports = {};
  // Prefix every same-origin absolute target with the sub-path base
  // (issue #256), THEN (issue #243) append `?v=<content-hash>` to a
  // same-origin target for immutable caching. The order is basePath then
  // `?v`, so a sub-path app emits `<basePath>/app/foo.js?v=hash`.
  // `withBasePath` is a no-op when the base path is empty and leaves a
  // cross-origin `https://` CDN vendor target untouched; `withAssetHash`
  // is a no-op in dev / when disabled and also leaves a cross-origin target
  // untouched (only the framework's own `/__webjs/*` core + same-origin
  // app/public targets get a `?v`).
  for (const k of Object.keys(merged).sort()) {
    const based = withBasePath(merged[k], _basePath);
    imports[k] = fingerprint ? withAssetHash(based, _basePath) : based;
  }

  // Emit `integrity` per the importmap-integrity spec (Chrome 132+,
  // Safari 18.4+, Firefox flagged). Browsers without support ignore
  // the field; per-tag SRI on modulepreload covers them.
  //
  // Filter orphan integrity entries (URLs that aren't actually in
  // imports). The browser only consults integrity for URLs that
  // resolve through the importmap, so orphans are harmless but bloat
  // the JSON, defeat the importMapHash stability invariant on
  // unrelated pin file edits, and leak removed URLs to the wire.
  const out = { imports };
  const usedUrls = new Set(Object.values(imports));
  // Integrity keys are the FINAL post-rewrite URLs, so prefix a same-origin
  // local vendor key with the base path to match its (now prefixed) imports
  // value. A cross-origin CDN key is untouched by `withBasePath` and lines
  // up with its unprefixed imports value.
  const intKeys = Object.keys(_vendorIntegrity)
    .filter(k => usedUrls.has(withBasePath(k, _basePath)))
    .sort();
  if (intKeys.length) {
    /** @type {Record<string, string>} */
    const integrity = {};
    for (const k of intKeys) integrity[withBasePath(k, _basePath)] = _vendorIntegrity[k];
    out.integrity = integrity;
  }
  return out;
}

/**
 * Resolve a set of bare vendor specifiers to `modulepreload` targets (#754), so
 * SSR can flatten the vendor CDN waterfall: instead of discovering each vendor
 * module level by level (fetch app module -> parse -> fetch vendor -> parse ...),
 * the reached vendor URLs are hinted up front and fetched in parallel.
 *
 * The href is taken DIRECTLY from `buildImportMap().imports[spec]`, so it is
 * BYTE-IDENTICAL to the importmap target (same base-path + `?v` rewrite): a
 * differing href would make the browser treat the preload and the import as two
 * resources and double-fetch. The matching `integrity` comes from the same map.
 * A specifier NOT in the importmap (an unpinned / unreached / elided vendor)
 * yields nothing, so this never over-fetches. Duplicate hrefs are collapsed.
 *
 * Framework runtime specifiers (`@webjsdev/core`...) are excluded: core is
 * served same-origin and already on the boot path, not a CDN-waterfall vendor.
 *
 * @param {Iterable<string>} specifiers  bare specifiers reached by the page
 * @returns {Array<{ href: string, integrity?: string }>}
 */
export function vendorPreloadTargets(specifiers) {
  const specs = [...(specifiers || [])];
  if (!specs.length) return [];
  const map = buildImportMap();
  /** @type {Array<{ href: string, integrity?: string }>} */
  const out = [];
  const seen = new Set();
  for (const spec of specs) {
    if (spec === '@webjsdev/core' || spec.startsWith('@webjsdev/core/')) continue;
    const href = map.imports[spec];
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, integrity: map.integrity ? map.integrity[href] : undefined });
  }
  return out;
}

/**
 * Derive the cross-origin vendor CDN origins from the resolved vendor
 * importmap, most-common first (issue #243, auto vendor preconnect). For an
 * UNPINNED app resolving vendors live from a cross-origin CDN (ga.jspm.io,
 * or jsdelivr / unpkg / skypack with `--from`), this returns that origin so
 * the head can warm DNS + TLS + TCP before the importmap resolves. A
 * same-origin PINNED app (vendors served from `/__webjs/vendor/*` on the
 * app's own origin), or an app with no cross-origin vendors, returns `[]`.
 *
 * Derived from the resolved targets (`_extraEntries`, the vendor map), NOT a
 * hardcoded string, so a `--from jsdelivr` app preconnects to jsdelivr. The
 * origins are deduped + sorted by frequency (the primary CDN first) and the
 * list is bounded so a map spanning several CDNs cannot emit an unbounded
 * preconnect set.
 *
 * @param {number} [max]  cap on the number of origins returned (default 2)
 * @returns {string[]}  e.g. `['https://ga.jspm.io']`
 */
export function vendorPreconnectOrigins(max = 2) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const target of Object.values(_extraEntries)) {
    if (typeof target !== 'string') continue;
    // Only an absolute `scheme://host` cross-origin url has an origin to
    // preconnect. A same-origin `/__webjs/vendor/*` (downloaded-pin) target
    // is `/`-rooted and skipped (no cross-origin to warm).
    if (!/^https?:\/\//i.test(target)) continue;
    let origin;
    try { origin = new URL(target).origin; } catch { continue; }
    counts.set(origin, (counts.get(origin) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, max))
    .map(([origin]) => origin);
}

/**
 * Serialise the import map to an HTML script tag string.
 *
 * When `nonce` is provided (extracted from the incoming
 * Content-Security-Policy header by ssr.js), it's emitted as
 * `nonce="..."` on the script tag. Strict-CSP apps using
 * `script-src 'nonce-...'` require this; without it the browser
 * blocks the importmap and every bare-specifier import fails.
 *
 * Defense-in-depth: JSON content is run through `jsonForScriptTag`
 * so a string value containing `</script>` (e.g. a maliciously
 * crafted vendor URL that somehow slipped past the jspm.io filter)
 * cannot close the importmap tag early and inject script content.
 *
 * @param {{ nonce?: string }} [opts]
 */
export function importMapTag(opts = {}) {
  // Full attribute escape, not just `"` to `&quot;`. The nonce arrives
  // from the request's CSP header (parsed by ssr.js), which we treat
  // as untrusted input even though CSP spec restricts nonce charset to
  // base64-ish. A misconfigured upstream emitting `nonce-<bad>` should
  // not get its `<` rendered raw into our HTML.
  const n = opts.nonce ? ` nonce="${escapeAttr(opts.nonce)}"` : '';
  // Stamp the published build id so the client router can detect
  // post-deploy importmap changes on intra-shell partial-response
  // navigations. Uses publishedBuildId() (empty until the map is
  // authoritatively final), NOT the live importMapHash(), so the warmup
  // window never advertises an id that later changes. See
  // publishedBuildId() above for the rationale.
  const b = ` data-webjs-build="${publishedBuildId()}"`;
  // The app-source deploy signal (#899), stamped alongside the build id. A
  // change here evicts the client caches softly (see appSourceId()); empty until
  // the analysis is ready, which the client reads as "unknown".
  const s = ` data-webjs-src="${appSourceId()}"`;
  return `<script type="importmap"${n}${b}${s}>${jsonForScriptTag(buildImportMap())}</script>`;
}
