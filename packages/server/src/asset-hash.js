/**
 * Content-hash asset URLs for immutable caching (issue #243, feature 1).
 *
 * The problem: every served app module (`.js` / `.ts`) and `public/` asset
 * ships `Cache-Control: public, max-age=3600` because its URL is
 * un-versioned. The framework cannot serve them `immutable` (1 year) without
 * a per-file fingerprint, because a deploy that changes a module's bytes
 * keeps the SAME url, so a year-long immutable copy at an edge CDN would
 * silently brick the next deploy (a real regression, see the core-serve note
 * in `dev.js`). The importmap build id (`publishedBuildId`) does NOT change
 * on an app-module byte change, so it cannot be the per-asset fingerprint.
 *
 * The fix: a PER-FILE content hash computed at serve time (no build step).
 *
 *   1. `withAssetHash(url)` appends `?v=<hash>` to a framework-emitted
 *      SAME-ORIGIN absolute url (the importmap targets, the modulepreload
 *      hrefs, the boot script specifiers). It is a NO-OP in DEV (so dev
 *      output is byte-identical to before), a NO-OP for a CROSS-ORIGIN url
 *      (a `https://` jspm vendor target, which jspm already versions and
 *      which carries SRI keyed by the un-hashed url), and for a same-origin
 *      `/`-rooted url it resolves the underlying file, looks up its hash, and
 *      appends `?v=<hash>`.
 *
 *   2. The serve path (`dev.js`) serves any request carrying a `?v` query
 *      `Cache-Control: public, max-age=31536000, immutable`. An un-fingerprinted
 *      request keeps the 1h fallback. Dev stays `no-cache` regardless.
 *
 * Deploy-busts invariant: a deploy that changes a module's bytes changes its
 * hash, so its emitted url changes, so a returning client fetches the new url
 * instead of serving the stale immutable copy.
 *
 * The hash is a short prefix of a sha-256 over the file BYTES, computed
 * synchronously (so the emit hot path stays sync) and memoized in a
 * `Map<absPath, hash>`. The cache is cleared on the fs.watch rebuild (dev) so
 * a changed file re-hashes, wired next to `clearVendorCache` in `dev.js`.
 *
 * @module asset-hash
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { redactStringsAndTemplates } from './js-scan.js';
import { resolveImport, expandImportAlias } from './module-graph.js';

/**
 * Length of the emitted hex hash. 12 hex chars (48 bits) is plenty to
 * distinguish builds of one file while keeping the url short. Collisions
 * across DIFFERENT bytes of the SAME url are the only failure mode, and at
 * 48 bits that is astronomically unlikely; a same-bytes-same-hash is exactly
 * the desired behaviour.
 *
 * @type {number}
 */
const HASH_LEN = 12;

/**
 * Whether fingerprinting is active. Off in dev (so dev output is
 * byte-identical to before this feature) and off until `setAssetRoots`
 * binds the app + core roots. Both gates make `withAssetHash` a pure
 * pass-through, which is what keeps the inert case byte-identical.
 *
 * @type {boolean}
 */
let _enabled = false;

/** @type {string} */
let _appDir = '';
/** @type {string} */
let _coreDir = '';

/**
 * A fingerprint of the current elision verdict (the elidable-component +
 * inert-route set), folded into an APP MODULE's hash. An app module's SERVED
 * body is not its raw source: `dev.js` runs `elideImportsFromSource` over it,
 * stripping a side-effect import of a display-only component. That strip is a
 * property of the IMPORTED component's verdict, not of the importer's own
 * bytes, so when a component flips display-only <-> interactive the importer's
 * served body changes while its source is byte-identical. Hashing the source
 * alone would keep the same `?v`, and a returning client would hold the stale
 * immutable copy (the now-interactive component never imported, so never
 * hydrated) for the full immutable TTL. Folding the verdict fingerprint into
 * the hash busts every app module's url on a verdict change, so the stale-copy
 * window cannot open. Empty when no module is elidable (then an app module's
 * hash is exactly `sha256(bytes)`), and only mixed for files under `_appDir`
 * (core / public assets are never elision-transformed). Set by `dev.js`'s
 * `ensureReady` after `analyzeElision`, re-set on every rebuild.
 *
 * @type {string}
 */
let _elisionFp = '';

/**
 * Memoized per-file content hash. Keyed by absolute path. Cleared on the
 * fs.watch rebuild so a changed file re-hashes.
 *
 * @type {Map<string, string>}
 */
const _hashCache = new Map();

/**
 * Bind the asset-hash module to the app + core install roots and enable
 * fingerprinting. Called once at boot by `dev.js` for a PROD server only
 * (`dev === false`); a dev server never calls this, so `_enabled` stays
 * false and `withAssetHash` is a pure no-op.
 *
 * @param {{ appDir: string, coreDir: string, enabled: boolean }} opts
 * @returns {void}
 */
export function setAssetRoots(opts) {
  _appDir = opts.appDir || '';
  _coreDir = opts.coreDir || '';
  _enabled = !!opts.enabled && !!_appDir && !!_coreDir;
}

/**
 * Set the elision-verdict fingerprint folded into app-module hashes (see
 * `_elisionFp`). A no-op when the value is unchanged; on a change it clears the
 * hash cache so every app module re-hashes against the new verdict. `dev.js`
 * calls this from `ensureReady` after `analyzeElision` (and again on each
 * rebuild), passing a stable digest of the elidable-component + inert-route set
 * (or `''` when nothing is elidable).
 *
 * @param {string} fp
 * @returns {void}
 */
export function setElisionFingerprint(fp) {
  const next = fp || '';
  if (next === _elisionFp) return;
  _elisionFp = next;
  _hashCache.clear();
}

/**
 * Clear the per-file hash cache. Wired into the dev rebuild path next to
 * `clearVendorCache` so a changed file re-hashes (dev never fingerprints,
 * but a future serve that re-derives the map after a rebuild stays correct,
 * and tests rely on the clear to observe a re-hash after a byte change).
 *
 * @returns {void}
 */
export function clearAssetHashCache() {
  _hashCache.clear();
}

/**
 * Compute (and memoize) the short content hash for an absolute file path.
 * Returns `''` when the file cannot be read, so the caller emits the url
 * UNCHANGED (no `?v`), failing safe to the 1h fallback rather than breaking
 * the url.
 *
 * @param {string} absPath
 * @returns {string} the short hex hash, or `''` on a read failure
 */
export function assetHashFor(absPath) {
  const cached = _hashCache.get(absPath);
  if (cached !== undefined) return cached;
  try {
    const bytes = readFileSync(absPath);
    const h = createHash('sha256').update(bytes);
    // An app module's served body is elision-transformed, so fold the verdict
    // fingerprint in (see `_elisionFp`). Core / public files are never
    // transformed, so they hash over their bytes alone. Empty fp leaves an app
    // module's hash at exactly `sha256(bytes)`.
    if (_elisionFp && _appDir && absPath.startsWith(_appDir + sep)) {
      h.update('\0');
      h.update(_elisionFp);
    }
    const hash = h.digest('hex').slice(0, HASH_LEN);
    _hashCache.set(absPath, hash);
    return hash;
  } catch {
    // A transient read failure is NOT memoized (returning '' fails safe to the
    // 1h fallback), so a later emit re-attempts instead of pinning the file to
    // the fallback for the process lifetime.
    return '';
  }
}

/**
 * Resolve a framework-emitted same-origin absolute url to the absolute file
 * path it serves, or `null` when the url does not map to a fingerprintable
 * same-origin file. Mirrors the serve-path resolution in `dev.js`:
 *   - `/__webjs/core/<rel>`  -> `<coreDir>/<rel>`  (the core runtime)
 *   - any other `/<rel>`     -> `<appDir>/<rel>`   (app modules + public/)
 *
 * Containment-checked against the respective root (the same trailing-separator
 * boundary guard the serve path uses), so a `..`-laden url that escapes the
 * root resolves to `null` and is emitted unchanged.
 *
 * The `?v` query / `#hash` are stripped before resolution (a freshly-emitted
 * url never carries one, but stay robust). A cross-origin / protocol-relative
 * / relative url is NOT a `/`-rooted same-origin path and returns `null`.
 *
 * @param {string} url
 * @returns {string | null}
 */
function resolveUrlToFile(url) {
  // Only a single-leading-slash same-origin path. A protocol-relative
  // `//host` or an absolute `scheme://` url (a vendor CDN target) is not ours.
  if (typeof url !== 'string' || url[0] !== '/' || url[1] === '/') return null;
  // Strip any query / hash before mapping to a file.
  let pathname = url;
  const q = pathname.indexOf('?');
  if (q !== -1) pathname = pathname.slice(0, q);
  const h = pathname.indexOf('#');
  if (h !== -1) pathname = pathname.slice(0, h);
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* keep raw */ }

  const CORE_PREFIX = '/__webjs/core/';
  if (decoded.startsWith(CORE_PREFIX)) {
    const rel = decoded.slice(CORE_PREFIX.length);
    const abs = resolve(_coreDir, rel);
    if (abs !== _coreDir && !abs.startsWith(_coreDir + sep)) return null;
    return abs;
  }
  // A `/__webjs/*` path that is not a core module (e.g. a downloaded
  // `/__webjs/vendor/<pkg>@<ver>.js` bundle) is already version-named, so it
  // does not need fingerprinting and is left unchanged.
  if (decoded.startsWith('/__webjs/')) return null;

  const abs = join(_appDir, decoded);
  if (abs !== _appDir && !abs.startsWith(_appDir + sep)) return null;
  return abs;
}

/**
 * Append `?v=<content-hash>` to a framework-emitted same-origin absolute url
 * for immutable caching. Composes with `withBasePath`: call ORDER is basePath
 * then `withAssetHash` (the `?v` is a query the ingress base-path strip never
 * touches, and the file resolution here works on the post-basePath url because
 * a `<basePath>/app/foo.js` still resolves under `_appDir` only after the
 * basePath is stripped, so callers apply `withAssetHash` to the ALREADY
 * base-path-prefixed url and pass the base path so we strip it for resolution).
 *
 * No-op when:
 *   - fingerprinting is disabled (dev, or roots unset) -> byte-identical output;
 *   - the url is cross-origin / protocol-relative / relative (a vendor CDN
 *     target keeps its exact url, so its SRI key, computed over the un-hashed
 *     url in #235, still matches, and jspm already versions it);
 *   - the url does not resolve to a readable same-origin file (fail-safe to the
 *     1h fallback).
 *
 * @param {string} url   the (possibly base-path-prefixed) same-origin url
 * @param {string} [basePath]  the active base path, stripped before file resolution
 * @returns {string}
 */
export function withAssetHash(url, basePath = '') {
  if (!_enabled) return url;
  if (typeof url !== 'string' || url[0] !== '/' || url[1] === '/') return url;
  // Resolve against the file system using the base-path-stripped url, so a
  // sub-path-deployed `<basePath>/app/foo.js` maps to `<appDir>/app/foo.js`.
  let forResolve = url;
  if (basePath && url.startsWith(basePath + '/')) {
    forResolve = url.slice(basePath.length);
  } else if (basePath && url === basePath) {
    forResolve = '/';
  }
  const abs = resolveUrlToFile(forResolve);
  if (!abs) return url;
  const hash = assetHashFor(abs);
  if (!hash) return url;
  // The freshly-emitted url never already carries a query, but stay robust:
  // merge with `&` if one is somehow present.
  const sepChar = url.includes('?') ? '&' : '?';
  return `${url}${sepChar}v=${hash}`;
}

/**
 * Static `import` specifier with positional indices. Mirrors module-graph.js's
 * `IMPORT_RE` (side-effect / default / namespace / named imports), but captures
 * the quote (group 1) and specifier (group 2) so the `/d` flag yields the
 * specifier's start/end for an in-place splice. Excludes dynamic `import(...)`
 * (no whitespace after `import`) and `import.meta` (no quote), exactly like the
 * graph scanner, so the rewrite set is the static-import set the modulepreload
 * hints cover.
 *
 * @type {RegExp}
 */
const IMPORT_SPEC_RE = /\bimport\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?(['"])([^'"]+)\1/dg;

/** Match `export … from '…'` re-exports (mirrors module-graph's EXPORT_FROM_RE). @type {RegExp} */
const EXPORT_SPEC_RE = /\bexport\b[^'";]+?\sfrom\s+(['"])([^'"]+)\1/dg;

/** A server-file specifier: served as a stub at a bare URL, never preloaded. @type {RegExp} */
const SERVER_FILE_RE = /\.server\.(?:js|ts|mjs|mts)$/;

/** JS-ish specifier extensions that map to a `.ts`/`.mts` sibling on disk. @type {Set<string>} */
const JS_SPEC_EXTS = new Set(['.js', '.mjs', '.jsx', '.cjs']);

/**
 * Normalize a relative import specifier's extension to the RESOLVED file's, so
 * the URL the browser fetches equals the modulepreload href (which `ssr.js`
 * derives from the resolved absolute path via `toUrlPath`, after `resolveImport`
 * rewrites a `.js` specifier to its `.ts` sibling and resolves an extensionless
 * one). Without this, an `import './x.js'` whose file is `x.ts` would be served
 * `./x.js?v=H` (fetched as `/x.js?v=H`) while the preload is `/x.ts?v=H`: same
 * hash, different path, so the preload is wasted and the file double-fetched.
 *
 * Conservative: only swaps a known JS-ish extension or appends to a genuinely
 * extensionless basename; a directory specifier (`.` / `..` / trailing-slash)
 * or an unrecognized extension is left untouched.
 *
 * @param {string} spec  the author's relative specifier (no query)
 * @param {string} abs   the resolved absolute file path
 * @returns {string}
 */
/**
 * A base-path-safe relative specifier from the importing module to a resolved
 * target file, used to rewrite a `#`-alias import in served source (#555). The
 * browser resolves a relative specifier against the importer's own URL (already
 * base-path-prefixed), so the result needs no importmap and no basePath fix-up,
 * and it carries the `?v` the caller appends. Uses the resolved file's actual
 * extension (so no `normalizeSpecToResolved` pass is needed).
 *
 * @param {string} importerAbs  absolute path of the module being served
 * @param {string} abs          resolved absolute path of the import target
 * @returns {string}
 */
function relativeSpecifier(importerAbs, abs) {
  let rel = relative(dirname(importerAbs), abs).split(sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function normalizeSpecToResolved(spec, abs) {
  const absExt = extname(abs);
  if (!absExt) return spec;
  const specExt = extname(spec);
  if (specExt === absExt) return spec;
  const base = spec.slice(spec.lastIndexOf('/') + 1);
  if (base === '' || base === '.' || base === '..') return spec; // directory import
  if (specExt) return JS_SPEC_EXTS.has(specExt) ? spec.slice(0, -specExt.length) + absExt : spec;
  return spec + absExt; // extensionless
}

/**
 * Append `?v=<content-hash>` to every SAME-ORIGIN relative / root-absolute
 * static-import specifier in a served module's source, so the URL the browser
 * actually fetches matches the `?v=`-versioned `modulepreload` hint and boot
 * specifier the framework emits for that file.
 *
 * The bug this fixes (#369): the boot script imports the entry modules with
 * `?v=<hash>` and the head emits `<link rel=modulepreload href=".../x.ts?v=hash">`
 * for every transitive module, but a layout/page imports its components with a
 * BARE relative specifier (`import '../components/x.ts'`). The browser resolves
 * a relative specifier against the importer's URL and a `?v` query is NOT
 * inherited across that resolution, so it fetches the UN-versioned URL: a
 * different cache key from the preload. Result: the preload is wasted, the
 * module is downloaded a second time, and the served copy gets the 1h fallback
 * cache header instead of `immutable`. Rewriting the specifier in the served
 * source to carry the same `?v=<hash>` collapses both to one cache key (one
 * fetch, preload used, immutable cached).
 *
 * The appended hash is `assetHashFor(resolvedTarget)`, the exact value
 * `withAssetHash` computes for the modulepreload href of the same file (same
 * absolute path -> same hash, elision-fingerprint fold included), so the two
 * URLs are byte-identical by construction.
 *
 * The fetched URL is made to equal the preload href even when the specifier's
 * extension differs from the file on disk: `normalizeSpecToResolved` rewrites a
 * `.js`/extensionless specifier to the resolved `.ts` sibling (the form the
 * preload, derived from the resolved path, uses), then `?v` is appended.
 *
 * Scope, mirroring the modulepreload set so the rewrite never diverges from it:
 *   - Only `.`-relative specifiers (`./`, `../`). The browser resolves these
 *     against the importer's own URL, which is already base-path-prefixed, so
 *     the rewrite is base-path-correct by construction. A `/`-root-absolute
 *     specifier is deliberately NOT versioned: it would miss the `webjs.basePath`
 *     prefix under a sub-path deploy (a pre-existing author-import limitation),
 *     and apps use relative imports. A BARE specifier (`@webjsdev/core`) is
 *     importmap-resolved and versioned at its importmap TARGET; rewriting it here
 *     would break the importmap key.
 *   - Only targets that resolve to a readable file UNDER `_appDir` (the servable
 *     same-origin root). A `.server.*` target is excluded: it serves as a stub
 *     at a bare URL and is never in the preload set, and its served bytes are
 *     generated (not the file bytes the hash covers).
 *   - A specifier already carrying a query is left as-is.
 *
 * Matching runs over a redaction mask with `blankStrings` on (NO literal body
 * survives), so an `import`/`export … from` printed inside an `html\`\`` template
 * OR a plain string literal is never rewritten (a plain-string body is NOT
 * blanked by the default mask, so the stricter mask is required here to avoid
 * splicing `?v` into the served string's value).
 *
 * A pure pass-through when fingerprinting is disabled (dev, or roots unset), so
 * dev output stays byte-identical. Runs AFTER `elideImportsFromSource` in the
 * serve path, so an elided side-effect import (already replaced by a comment)
 * is not matched.
 *
 * @param {string} source       the served module source (post-elision, type-stripped if TS)
 * @param {string} importerAbs  absolute path of the module being served
 * @returns {string}
 */
export function versionModuleImports(source, importerAbs) {
  if (!_enabled || !_appDir) return source;
  if (typeof source !== 'string') return source;
  // Cheap bail before any regex/redaction work for a module with no imports.
  if (!source.includes('import') && !source.includes('export')) return source;

  const masked = redactStringsAndTemplates(source, true);
  /** @type {Array<{ start: number, end: number, text: string }>} */
  const edits = [];
  for (const re of [IMPORT_SPEC_RE, EXPORT_SPEC_RE]) {
    re.lastIndex = 0;
    for (const m of source.matchAll(re)) {
      // The keyword must sit in code position; if blanked in the mask it lives
      // inside a string / template / comment and is not a real import edge.
      if (masked[/** @type {number} */ (m.index)] === ' ') continue;
      const spec = m[2];
      const isRelative = spec[0] === '.';
      // A `#`-style subpath alias (#555) is rewritten to a base-path-safe
      // RELATIVE specifier below (so it carries `?v` and matches the preload,
      // exactly like a relative import). Only `./`/`../` relatives and
      // app-imports aliases qualify: a bare specifier is importmap-resolved and
      // versioned at its target; a `/`-root-absolute specifier would miss the
      // basePath prefix.
      const isAlias = !isRelative && expandImportAlias(spec, _appDir) !== null;
      if (!isRelative && !isAlias) continue;
      if (spec.includes('?')) continue;
      const abs = resolveImport(spec, importerAbs, _appDir);
      if (!abs || SERVER_FILE_RE.test(abs)) continue;
      if (!abs.startsWith(_appDir + sep)) continue;
      const hash = assetHashFor(abs);
      if (!hash) continue;
      // `/d` flag: indices[2] is [start, end] of the specifier CONTENT (no
      // quotes). Replace it with the resolved-extension form + `?v` so the
      // fetched URL is byte-identical to the preload href. An alias is emitted
      // as a relative specifier to the resolved file (the browser resolves it
      // against the importer's already-prefixed URL, so it stays base-path-safe
      // without the importmap, and the `?v` collapses fetch + preload to one
      // immutable cache key).
      const [start, end] = /** @type {[number, number]} */ (m.indices[2]);
      const versioned = isAlias ? relativeSpecifier(importerAbs, abs) : normalizeSpecToResolved(spec, abs);
      edits.push({ start, end, text: `${versioned}?v=${hash}` });
    }
  }
  if (edits.length === 0) return source;

  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let last = 0;
  for (const e of edits) {
    out += source.slice(last, e.start) + e.text;
    last = e.end;
  }
  return out + source.slice(last);
}

/**
 * An asset-bearing element in the SSR'd document. Anchored on the literal tag
 * name, which is what keeps a RENDERED CODE SAMPLE safe: the highlighter
 * escapes `<` to `&lt;` (and splits the token across spans), so a sample that
 * displays `<img src="/public/x.png">` never contains a literal `<img` and can
 * never be matched here. That is the whole reason this matches tags rather
 * than bare `src="…"` occurrences.
 *
 * @type {RegExp}
 */
const ASSET_TAG_RE = /<(?:link|script|img|source)\b[^>]*>/gi;

/**
 * `href` / `src` inside an already-matched tag, either quote style. `srcset`
 * is deliberately excluded: it is a comma-separated candidate list with
 * descriptors, so it needs its own parse rather than a whole-value rewrite.
 *
 * @type {RegExp}
 */
const ASSET_ATTR_RE = /(\s(?:href|src)\s*=\s*)(["'])([^"']*)\2/gi;

/**
 * Append `?v=<content-hash>` to same-origin asset urls an APP AUTHOR wrote by
 * hand in a template, so they cannot serve stale bytes at a live url.
 *
 * The framework already fingerprints every url it emits itself (module
 * specifiers, importmap targets, modulepreload hints), and `versionModuleImports`
 * does the same for author-written module specifiers in served source. This
 * closes the last gap: a `<link rel="stylesheet" href="/public/app.css">` or an
 * `<img src="/public/logo.svg">` written in a layout.
 *
 * Why it matters beyond cache-busting: `dev.js` already serves a `?v=`-carrying
 * `/public/*` request `immutable` for a year, while an un-versioned one gets the
 * 1h fallback. So fingerprinting these urls both makes staleness structurally
 * impossible (new bytes mean a new url) and upgrades them from a 1 hour cache to
 * an immutable one. Without it, a CDN keeps serving the previous copy after a
 * deploy until something purges it, which is exactly what shipped two visible
 * regressions on webjs.dev in one day (#1179 then #1185).
 *
 * Per-url behaviour is `withAssetHash`, so every existing guard applies
 * unchanged: a no-op when fingerprinting is disabled (dev, so dev output stays
 * byte-identical), and for a cross-origin, protocol-relative, relative, or
 * unresolvable url. A url that already carries a query is skipped here too,
 * since it is author-controlled and may be meaningful.
 *
 * The base path is a parameter rather than module state on purpose: a setter
 * that a call site forgets fails silently and only on a sub-path deploy, which
 * is the hardest place to notice it. Same signature shape as `withAssetHash`.
 *
 * @param {string} html   the assembled document (or a fragment of it)
 * @param {string} [basePath]  the active base path, already applied to the urls
 * @returns {string}
 */
export function versionAssetUrls(html, basePath = '') {
  if (!_enabled || !_appDir) return html;
  if (typeof html !== 'string' || html.indexOf('<') === -1) return html;
  return html.replace(ASSET_TAG_RE, (tag) => (
    tag.replace(ASSET_ATTR_RE, (whole, lead, quote, url) => {
      // Leave an author-supplied query alone: appending to it risks changing
      // a meaning we do not own, and `withAssetHash` would merge with `&`.
      if (!url || url.indexOf('?') !== -1) return whole;
      const versioned = withAssetHash(url, basePath);
      return versioned === url ? whole : `${lead}${quote}${versioned}${quote}`;
    })
  ));
}
