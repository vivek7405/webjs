import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isCommentedOut } from '../util.js';
import { collectRouteModules, readAppBasePath } from '../route-modules.js';

/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * One whole `<link …>` tag. QUOTE-AWARE (`(?:[^>"']|"[^"]*"|'[^']*')*`), the
 * same shape `ssr.js`'s hoist scanner uses, so a `>` inside a quoted attribute
 * value cannot terminate the tag early.
 * @type {RegExp}
 */
const LINK_TAG_RE = /<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

/**
 * One attribute inside a tag: a name, then optionally `=` and a double-quoted,
 * single-quoted, or unquoted value. Matching attributes as WHOLE units is what
 * makes the scan correct, because each quoted value is consumed in one step and
 * can therefore never be re-scanned as if it contained an attribute of its own.
 * @type {RegExp}
 */
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * Parse a tag's attributes into a lowercased-name map. The value is `null` for a
 * valueless attribute and carries a `quoted` flag, since this check treats an
 * UNQUOTED href (a template hole) as undecidable rather than as a path.
 * @param {string} tag
 * @returns {Map<string, { value: string | null, quoted: boolean }>}
 */
function parseTagAttrs(tag) {
  /** @type {Map<string, { value: string | null, quoted: boolean }>} */
  const attrs = new Map();
  // Skip the tag name itself so `link` is not read as an attribute.
  const body = tag.replace(/^<[a-zA-Z_:][-\w:.]*/, '');
  ATTR_RE.lastIndex = 0;
  for (const m of body.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (attrs.has(name)) continue; // first wins, as in HTML parsing
    const quoted = m[2] !== undefined || m[3] !== undefined;
    const value = m[2] ?? m[3] ?? m[4] ?? null;
    attrs.set(name, { value, quoted });
  }
  return attrs;
}

/**
 * Whether a parsed `<link>` is an unmarked stylesheet, and if so its href.
 *
 * Attribute PARSING rather than a lookahead over the raw tag is load-bearing,
 * not tidiness. A scan that merely looks ahead for `rel=…stylesheet` anywhere in
 * the tag matches the string inside ANOTHER attribute's value, which flags the
 * two shapes this check most needs to leave alone: the canonical async-CSS
 * `<link rel="preload" as="style" href="/public/app.css" onload="this.rel='stylesheet'">`
 * (where the advised `asset()` fix would actively BREAK the preload, since the
 * versioned hint could then never match the unversioned request), and a
 * `data-rel="stylesheet"` sitting on a `rel="icon"`. Reading real attributes
 * makes `rel` mean the `rel` attribute and nothing else.
 *
 * Returns the href only when every condition holds:
 *   - `rel` is a token list CONTAINING `stylesheet` (so `rel="preload"` with an
 *     onload swap, and `rel="icon"`, are both out).
 *   - `href` is QUOTED. An unquoted value is a template hole
 *     (`href=${asset('/public/app.css')}`), undecidable from source, and is
 *     exactly the shape the marked form uses.
 *   - the path is under `/public/` (after the app's `webjs.basePath` is
 *     stripped, since under a sub-path deploy the author writes the prefix
 *     themselves and `resolveAssetUrl` strips it before its own `public/` gate).
 *   - `resolveAssetUrl` would actually fingerprint it. It returns a path
 *     carrying a QUERY or a `..` unchanged, so wrapping one in `asset()` is a
 *     runtime NO-OP: the author does the work and the url they ship is
 *     byte-identical. Advising it would be advising a change that buys nothing.
 *     A hand-rolled `?v=` cache-buster is exactly what an author who has not
 *     adopted `asset()` is most likely to have written, so this is the common
 *     case, not a corner. (The warning itself would clear, since this check
 *     reads the SOURCE shape and a wrapped href is an unquoted hole. Clearing a
 *     warning without improving the caching is the outcome to avoid.)
 *
 * @param {string} tag
 * @param {string} basePath  the app's normalized `webjs.basePath` (`''` at root)
 * @returns {string | null}
 */
function unmarkedStylesheetHref(tag, basePath = '') {
  const attrs = parseTagAttrs(tag);
  const rel = attrs.get('rel');
  if (!rel || !rel.value) return null;
  if (!rel.value.toLowerCase().split(/\s+/).includes('stylesheet')) return null;
  const href = attrs.get('href');
  if (!href || !href.quoted || !href.value) return null;
  const url = href.value;
  if (url[0] !== '/' || url[1] === '/') return null;
  // Mirror `resolveAssetUrl`'s refusals IN ITS ORDER, so every flagged href is
  // one `asset()` can actually fingerprint. It strips the base path, cuts at
  // `?` / `#`, DECODES, and only then tests `..` and the `public/` prefix.
  // Testing the raw value instead disagrees at both ends: `/public/%2e%2e/x`
  // would be flagged although wrapping it changes nothing, and
  // `/%70ublic/app.css` would be skipped although `asset()` fingerprints it.
  let probe = url;
  if (basePath && probe.startsWith(basePath + '/')) probe = probe.slice(basePath.length);
  const cuts = [probe.indexOf('?'), probe.indexOf('#')].filter((i) => i !== -1);
  let decoded = probe.slice(0, cuts.length ? Math.min(...cuts) : probe.length);
  try { decoded = decodeURIComponent(decoded); } catch { /* keep raw */ }
  if (decoded.includes('..') || !decoded.startsWith('/public/')) return null;
  // A query is refused outright (an author query may carry meaning we do not
  // own, so `resolveAssetUrl` returns the url untouched); a `#fragment` is not,
  // since it is split off and preserved.
  const beforeFragment = url.indexOf('#') === -1 ? url : url.slice(0, url.indexOf('#'));
  if (beforeFragment.includes('?')) return null;
  return url;
}

/**
 * ADVISORY (#1095): a route module hand-writes a `<link rel="stylesheet"
 * href="/public/…">` without `asset()`, so the url is un-versioned and a deploy
 * cannot bust a CDN's copy of it.
 *
 * The failure this names was caught in production on webjs.dev: the edge served
 * a `public/tailwind.css` built BEFORE the deploy (`cf-cache-status: HIT`,
 * `max-age=14400`) against post-deploy HTML, so the new page rendered with its
 * content edge to edge and its grid collapsed, because the cached css was
 * missing the arbitrary-value utilities that page introduced. It is invisible
 * while a deploy only restyles existing classes and maximally visible the moment
 * one adds a page using new utilities.
 *
 * Why this is an ADVISORY over the author's SOURCE rather than a rewrite of the
 * framework's OUTPUT. The first attempt at the automatic form (#1196) matched
 * urls in the assembled HTML, and two deep-review rounds found six major
 * defects, five of them one bug: at that layer framework output and author data
 * are indistinguishable, so the matcher kept editing things it did not own. That
 * is why `asset()` (#1194) is opt-in, and it is what Rails (a
 * `stylesheet_link_tag` helper over a digest manifest) and Remix (a hashed url
 * from the build graph, surfaced through `links()`) both do: take the
 * fingerprint from an authoritative source at the point the url is PRODUCED, and
 * never rewrite a rendered document. The gap `asset()` leaves is purely
 * ergonomic. In Rails the helper is the only idiomatic way to write the tag, so
 * forgetting it is nearly impossible; in WebJs the `<link>` is hand-written HTML,
 * so it is easy to omit. This check closes exactly that gap, at authoring time,
 * where the author's meaning is unambiguous and nothing is rewritten.
 *
 * Scoped to `rel="stylesheet"` on purpose. An icon is a legitimate deliberate
 * NON-mark (the website leaves its favicons bare so the SEO repo-health tests
 * can parse the hrefs literally), and a `rel="preload"` must NOT be marked at
 * all, since its versioned hint could never match the unversioned request a CSS
 * `url()` actually makes. Flagging either would nag about a correct choice.
 *
 * WARN only: an un-versioned stylesheet still SERVES correctly, it just caches
 * badly, and an app fronted by no CDN may not care.
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
export async function checkUnmarkedAssetLinks(appDir) {
  const name = 'Asset urls (unmarked stylesheet links)';
  const routeDir = join(appDir, 'app');
  if (!existsSync(routeDir)) {
    return { name, status: 'pass', message: 'no app/ directory to analyse' };
  }
  const basePath = await readAppBasePath(appDir);
  const findings = [];
  for (const file of collectRouteModules(routeDir)) {
    let src;
    try { src = await readFile(file, 'utf8'); } catch { continue; }
    // Cheap bail before any tag scanning. Case-INSENSITIVE to match the tag
    // regex: a file whose only link tag is written `<LINK …>` must still be
    // scanned, or the scanner's own case-insensitivity is unreachable exactly
    // where it is needed.
    if (!/<link/i.test(src)) continue;
    LINK_TAG_RE.lastIndex = 0;
    for (const m of src.matchAll(LINK_TAG_RE)) {
      const href = unmarkedStylesheetHref(m[0], basePath);
      if (!href) continue;
      // A commented-out tag emits nothing, so advising on it is advice about
      // dead markup.
      if (isCommentedOut(src, /** @type {number} */ (m.index))) continue;
      // 1-indexed line of the match, for a jump-to reference.
      const line = src.slice(0, m.index).split('\n').length;
      findings.push({ file, line, href });
    }
  }
  if (findings.length === 0) {
    return { name, status: 'pass', message: 'every route-module stylesheet link is content-hashed (or has none)' };
  }
  const rel = (f) => relative(appDir, f) || f;
  return {
    name,
    status: 'warn',
    message:
      `${findings.length} stylesheet link(s) are served at an un-versioned url, so a deploy cannot bust a cached copy:\n` +
      findings.map((f) => `    ${rel(f.file)}:${f.line} href="${f.href}"`).join('\n'),
    fix:
      "Wrap the path in asset(): `import { asset } from '@webjsdev/core'` then "
      + '`<link rel="stylesheet" href=${asset(\'/public/app.css\')}>`. It appends a content hash in prod '
      + '(the framework then serves that url immutable for a year) and is a no-op in dev and in the browser. '
      + 'Call it inside the render function, not at module scope.',
  };
}
