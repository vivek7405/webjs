/**
 * Server-side scanner that walks the app tree and records the
 * browser-visible URL for every WebJs component module.
 *
 * Called once on the first request (lazily, via `ensureReady`), then memoized. Results are used to prime the core
 * registry (`primeModuleUrl`) BEFORE any SSR render: so when a page
 * renders a component tag, `lookupModuleUrl(tag)` already has the URL
 * ready for `<link rel="modulepreload">` hints.
 *
 * The idiomatic WebJs registration is `Class.register('my-counter')`; the
 * web-standard `customElements.define('my-counter', Counter)` is equally
 * supported. The scanner matches BOTH, as static text patterns that are cheap
 * to regex-match without a full TS parse. A full parse would be ~50× slower
 * for no payoff; we only need `{ tag, className, moduleUrl }` tuples. Either
 * way the tag must be a LITERAL (invariant 3): a computed one is invisible
 * here, which is what makes it an orphan (see `findOrphanComponents`).
 */

import { readFile, stat } from 'node:fs/promises';
import { sep } from 'node:path';
import { walk } from './fs-walk.js';
import { primeModuleUrl } from '@webjsdev/core';
import { redactToPlaceholders } from './js-scan.js';

/**
 * mtime-keyed cache of extracted components per file, so a rebuild re-reads
 * only files that changed (an unchanged file reuses its cached component list
 * after a single `stat`). Makes the component scan incremental for large apps.
 * Keyed by mtime AND size (a same-tick length-changing edit is caught even on
 * coarse-mtime filesystems).
 * @type {Map<string, { mtimeMs: number, size: number, comps: Array<{ tag: string, className: string }> }>}
 */
const SCAN_CACHE = new Map();

/** Introspection for tests/ops: is `file` currently in the scan cache? */
export function _scanCacheHas(file) { return SCAN_CACHE.has(file); }

/**
 * Recognise either registration pattern:
 *
 *     Counter.register('my-counter')           // idiomatic webjs
 *     customElements.define('my-counter', Counter)  // native DOM API
 *
 * Both single and double quotes; whitespace is flexible.
 *
 * @param {string} src
 * @returns {Array<{ className: string, tag: string }>}
 */
export function extractComponents(src) {
  /** @type {Array<{ className: string, tag: string }>} */
  const results = [];
  const { redacted, literals } = redactToPlaceholders(src);

  // Pattern A: Class.register('tag') -> matches Class.register('__STR_idx__')
  const registerRe = /\b([A-Z][A-Za-z0-9_$]*)\.register\s*\(\s*['"`]__STR_(\d+)__['"`]\s*\)/g;
  let m;
  while ((m = registerRe.exec(redacted)) !== null) {
    const className = m[1];
    const idx = parseInt(m[2], 10);
    const tag = literals[idx];
    if (tag && tag.includes('-')) {
      results.push({ className, tag });
    }
  }
  // Pattern B: customElements.define('tag', Class) -> matches customElements.define('__STR_idx__', Class)
  const defineRe = /\bcustomElements\.define\s*\(\s*['"`]__STR_(\d+)__['"`]\s*,\s*([A-Z][A-Za-z0-9_$]*)\b/g;
  while ((m = defineRe.exec(redacted)) !== null) {
    const idx = parseInt(m[1], 10);
    const tag = literals[idx];
    const className = m[2];
    if (tag && tag.includes('-')) {
      results.push({ className, tag });
    }
  }
  return results;
}

/**
 * Walk an app directory, return every discovered component with its
 * browser-visible URL (rooted at `/`, matching how the dev server
 * serves module files).
 *
 * @param {string} appDir
 * @returns {Promise<Array<{ tag: string, className: string, moduleUrl: string, file: string }>>}
 */
export async function scanComponents(appDir) {
  /** @type {Array<{ tag: string, className: string, moduleUrl: string, file: string }>} */
  const components = [];
  /** @type {Set<string>} live component files this scan, for cache eviction */
  const seen = new Set();
  const filter = (p) =>
    /\.m?[jt]sx?$/.test(p) &&
    !/\.(test|spec)\.m?[jt]sx?$/.test(p) &&
    !/\.server\.m?[jt]s$/.test(p);

  for await (const file of walk(appDir, filter)) {
    let mtimeMs, size;
    try { const st = await stat(file); mtimeMs = st.mtimeMs; size = st.size; } catch { continue; }
    seen.add(file); // mark live (hit and miss) for cache eviction
    let comps;
    const cached = SCAN_CACHE.get(file);
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      comps = cached.comps;
    } else {
      let src;
      try { src = await readFile(file, 'utf8'); } catch { continue; }
      comps = extractComponents(src);
      SCAN_CACHE.set(file, { mtimeMs, size, comps });
    }
    if (!comps.length) continue;
    const moduleUrl = toUrlPath(file, appDir);
    for (const c of comps) {
      components.push({ ...c, moduleUrl, file });
    }
  }
  // Evict scan-cache entries for files no longer walked (renamed/deleted),
  // scoped to this app so a multi-app process keeps other apps' entries.
  const prefix = appDir.endsWith(sep) ? appDir : appDir + sep;
  for (const key of SCAN_CACHE.keys()) {
    if ((key === appDir || key.startsWith(prefix)) && !seen.has(key)) SCAN_CACHE.delete(key);
  }
  return components;
}

/**
 * Scan the app tree and push every component's (tag, moduleUrl) pair
 * into the core registry via `primeModuleUrl`. Idempotent: if called
 * again (e.g. on dev-server rebuild after a file add), new discoveries
 * are added and existing tags are updated.
 *
 * Pass `components` if you already have the scanned list (e.g. the
 * dev server scans once and reuses for both the registry and the
 * source-serving authorisation gate). Omitting it triggers a fresh
 * scan, matching the original single-arg signature.
 *
 * @param {string} appDir
 * @param {Awaited<ReturnType<typeof scanComponents>>} [components]
 * @returns {Promise<{ count: number }>}
 */
export async function primeComponentRegistry(appDir, components) {
  components = components ?? await scanComponents(appDir);
  for (const { tag, moduleUrl } of components) {
    primeModuleUrl(tag, moduleUrl);
  }
  return { count: components.length };
}

/**
 * Find ORPHAN components: a `class X extends WebComponent` that NOTHING in the
 * app registers with a LITERAL tag, via either `X.register('tag')` or
 * `customElements.define('tag', X)`. The declaration is per-file, the
 * registration cross-reference is app-wide.
 *
 * TWO shapes land here and they fail differently, so any message about this
 * must cover both:
 *
 *   - No registration call ANYWHERE in the app (the forgot-to-register case).
 *     Nothing ever registers the tag, so the element NEVER upgrades. The
 *     cross-reference is app-wide precisely so a class registered by a sibling
 *     module is not accused of this.
 *   - A registration whose tag is COMPUTED (`X.register(TAG)`). That call is
 *     ordinary code, so it runs IF the module reaches the browser, which
 *     requires the importing module to ship WHOLE. An inert, import-only, or
 *     elided importer is dropped from the boot and takes the import with it,
 *     and then the element does not upgrade either. Assume it does not. An
 *     orphan is not in `componentFiles`, so it never joins the frontier an
 *     import-only page emits in its place, and a page that renders a real
 *     component alongside the orphan is import-only unless it ALSO does its
 *     own client work (which ships it whole, #963). Shipping whole is the
 *     narrower case, so treat the upgrade as lost until proven otherwise.
 *
 * Lost in EVERY case, whichever shape: the elision verdict, the tag-to-module
 * registry entry, and the modulepreload hint. That, not the upgrade, is the
 * part that is always true, and it is what every message about this should
 * lead with.
 *
 * Matches the literal `extends WebComponent` only, so a class extending a
 * component SUBCLASS is not reported.
 *
 * @param {string} appDir
 * @returns {Promise<Array<{ className: string, file: string }>>}
 */
export async function findOrphanComponents(appDir) {
  /** @type {Array<{ className: string, file: string }>} */
  const orphans = [];
  const filter = (p) =>
    /\.m?[jt]sx?$/.test(p) &&
    !/\.(test|spec)\.m?[jt]sx?$/.test(p) &&
    !/\.server\.m?[jt]s$/.test(p);

  // TWO passes, because registration is an APP-WIDE fact while the declaration
  // is per-file. A class may legitimately be declared in one module and
  // registered by a sibling (`customElements.define('my-badge', Badge)` in a
  // separate file), which the scanner header calls equally supported and which
  // `extractComponents` already picks up as a real component. Reporting it as
  // an orphan is a FALSE positive, and a false warning on a legitimate pattern
  // is exactly what makes an author stop reading the warnings.
  //
  // Trade-off, deliberate: the cross-reference is by class NAME, so two
  // same-named classes in different files, one registered and one genuinely
  // orphaned, hide the real orphan. That is rarer than the sibling-registration
  // pattern and errs toward silence rather than toward a wrong accusation.
  /** @type {Array<{ file: string, declared: Set<string> }>} */
  const declaredPerFile = [];
  /** @type {Set<string>} every class name registered ANYWHERE in the app */
  const registeredAnywhere = new Set();

  for await (const file of walk(appDir, filter)) {
    let src;
    try { src = await readFile(file, 'utf8'); } catch { continue; }
    // Scan REDACTED source, the same way `extractComponents` above does. A
    // `class X extends WebComponent` written inside an `html` template or a
    // string is a CODE SAMPLE (every docs page is full of them), not a real
    // declaration, and reporting it as an unregistered component is a false
    // orphan. Redaction blanks comments and swaps each string / template body
    // for a `__STR_<idx>__` placeholder, so a genuine top-level declaration
    // still matches while a sample inside a template does not. It does NOT
    // preserve offsets (a placeholder is a different length than the body it
    // replaces), which is fine here because an orphan is reported by class
    // name and file, never by position. If this scan ever needs a line or
    // column, reach for `redactStringsAndTemplates(src, true)`, WITH the
    // blank-strings argument: the default form keeps plain-string bodies and
    // single-line untagged templates verbatim, so a sample written either way
    // would match again and the false orphan would be back.
    const { redacted } = redactToPlaceholders(src);
    // Find every class that extends WebComponent (exact name: we trust
    // the framework convention).
    const classRe = /\b(?:export\s+)?(?:default\s+)?class\s+([A-Z][A-Za-z0-9_$]*)\s+extends\s+WebComponent\b/g;
    // A class counts as "registered" if either Class.register('tag') or
    // customElements.define('tag', Class) appears in the file. The tag is a
    // placeholder after redaction; an orphan is about the CLASS, not the tag,
    // so the placeholder is matched rather than read.
    const registerRe = /\b([A-Z][A-Za-z0-9_$]*)\.register\s*\(\s*['"`][^'"`]+['"`]\s*\)/g;
    const defineRe = /\bcustomElements\.define\s*\(\s*['"`][^'"`]+['"`]\s*,\s*([A-Z][A-Za-z0-9_$]*)\b/g;

    const declared = new Set();
    let m;
    while ((m = classRe.exec(redacted)) !== null) declared.add(m[1]);
    while ((m = registerRe.exec(redacted)) !== null) registeredAnywhere.add(m[1]);
    while ((m = defineRe.exec(redacted)) !== null) registeredAnywhere.add(m[1]);
    if (declared.size) declaredPerFile.push({ file, declared });
  }

  for (const { file, declared } of declaredPerFile) {
    for (const cls of declared) {
      if (!registeredAnywhere.has(cls)) orphans.push({ className: cls, file });
    }
  }
  return orphans;
}

/**
 * @param {string} abs
 * @param {string} appDir
 * @returns {string}
 */
function toUrlPath(abs, appDir) {
  let rel = abs.startsWith(appDir) ? abs.slice(appDir.length) : abs;
  rel = rel.split(sep).join('/');
  if (!rel.startsWith('/')) rel = '/' + rel;
  return rel;
}
