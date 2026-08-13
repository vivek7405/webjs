import { digestBase64 } from '../crypto-utils.js';

/**
 * Compute the SHA-384 SRI hash for a bundle body. Matches the format
 * the browser's importmap `integrity` field and the `integrity`
 * attribute on `<link rel="modulepreload">` expect. Accepts a string
 * or any ArrayBufferView / ArrayBuffer.
 *
 * @param {string | ArrayBufferView | ArrayBuffer} body
 * @returns {Promise<string>}  e.g. `sha384-<base64>`
 */
export async function sha384Integrity(body) {
  return `sha384-${await digestBase64('SHA-384', body)}`;
}

/**
 * Parse a version string to a `[major, minor, patch]` numeric triple, or null
 * when it has no parseable numeric core (a `latest`, a git URL, a `*`).
 *
 * KNOWN LIMITATION: a prerelease / build suffix (`-rc.1`, `+sha`) is dropped, so
 * a version is judged purely on its release line. A pinned prerelease is treated
 * as its stable tuple: `6.42.0-beta.1` is judged as `6.42.0`, so a stable range
 * like `^6.42.0` reports it as a MATCH even though npm semver excludes a
 * prerelease from a stable range. This is a deliberate fail-safe simplification
 * (we do not carry prerelease ordering): the only consequence is a MISSED
 * coherence warning when a prerelease is pinned, never a spurious one on a
 * coherent graph. Pinned prereleases are vanishingly rare in a vendored
 * importmap, so the missed-warning risk is negligible.
 *
 * @param {string} v
 * @returns {[number, number, number] | null}
 */
export function parseSemver(v) {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v == null ? '' : v));
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/**
 * Compare two `[major, minor, patch]` triples. Negative if a < b, 0 if equal,
 * positive if a > b.
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 * @returns {number}
 */
export function cmpSemver(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * @typedef {{
 *   pkg: string,
 *   version: string,
 *   dependsOn: string,
 *   kind: 'dependency' | 'peerDependency',
 *   requiredRange: string,
 *   pinnedVersion: string,
 * }} CoherenceConflict
 */

/**
 * @typedef {{
 *   conflicts: CoherenceConflict[],
 *   unverified: Array<{ pkg: string, reason: string }>,
 *   checked: number,
 * }} CoherenceReport
 * `checked` counts the pinned packages whose dependency metadata was actually
 * read (so a clean verdict is grounded in real data); a package whose manifest
 * was unavailable is in `unverified` and is NOT counted as checked. `checked
 * === 0` with a non-empty `unverified` therefore means "could not verify
 * anything", which the caller surfaces as a soft degrade rather than "coherent".
 */

/**
 * Does `version` satisfy the npm `range`? PRAGMATIC, no semver dependency
 * (vendor.js stays dependency-free). Supports the shapes that appear in real
 * `dependencies` / `peerDependencies`: `*` / `latest` / `x` / `''` (any),
 * `||` alternation, a leading `>=` / `>` / `<=` / `<` / `=`, caret `^`, tilde
 * `~`, an `x`/`*` wildcard segment (`6.x`, `6.39.x`), and an exact `1.2.3`.
 *
 * Returns `true` / `false` when the range can be evaluated, and `null` when
 * the shape is one we do NOT statically understand (a URL range, a git range,
 * a hyphen `1.2.3 - 1.4.0` range). `null` is the "could not verify" signal: the
 * caller degrades to a soft "unverified" note rather than warning on a shape it
 * cannot judge. Failing open here is deliberate, a coherence check must never
 * cry wolf on a range it misread.
 *
 * Prerelease note: both the version and the range are judged on their release
 * line only (the `-beta` / `-rc` tag is dropped, see `parseSemver`), so a
 * prerelease pin is treated as its stable tuple. The worst case is a MISSED
 * warning when a prerelease is pinned, never a spurious one.
 *
 * @param {string} version  e.g. `6.39.16`
 * @param {string} range    e.g. `^6.42.0`
 * @returns {boolean | null}
 */
export function satisfiesSemverRange(version, range) {
  const v = parseSemver(version);
  if (!v) return null;
  const r = String(range == null ? '' : range).trim();
  if (r === '' || r === '*' || r === 'x' || r === 'X' || r === 'latest') return true;
  if (r.startsWith('workspace:')) return true;
  // Alternation: satisfied if ANY clause is satisfied. A clause we cannot
  // evaluate (null) must not let a non-matching clause produce a false
  // negative, so an unknown clause makes the whole result unknown unless a
  // known clause already matched.
  if (r.includes('||')) {
    let sawUnknown = false;
    for (const clause of r.split('||')) {
      const res = satisfiesSemverRange(version, clause.trim());
      if (res === true) return true;
      if (res === null) sawUnknown = true;
    }
    return sawUnknown ? null : false;
  }
  // A space-joined comparator set (`>=6.0.0 <7.0.0`) must ALL be satisfied.
  if (/\s/.test(r)) {
    // A hyphen range (`1.2.3 - 1.4.0`) is not a comparator set; we do not
    // parse it, so degrade to unknown rather than mis-AND its halves.
    if (/\s-\s/.test(r)) return null;
    let result = true;
    for (const part of r.split(/\s+/)) {
      if (!part) continue;
      const res = satisfiesSemverRange(version, part);
      if (res === null) return null;
      if (res === false) result = false;
    }
    return result;
  }
  // Comparators: >= > <= < =.
  const cmpMatch = /^(>=|<=|>|<|=)\s*(.+)$/.exec(r);
  if (cmpMatch) {
    const op = cmpMatch[1];
    const bound = parseSemver(cmpMatch[2]);
    if (!bound) return null;
    const c = cmpSemver(v, bound);
    switch (op) {
      case '>=': return c >= 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '<': return c < 0;
      case '=': return c === 0;
    }
  }
  // Caret: same left-most non-zero segment. ^6.42.0 -> >=6.42.0 <7.0.0;
  // ^0.7.0 -> >=0.7.0 <0.8.0; ^0.0.3 -> >=0.0.3 <0.0.4.
  if (r.startsWith('^')) {
    const b = parseSemver(r.slice(1));
    if (!b) return null;
    if (cmpSemver(v, b) < 0) return false;
    if (b[0] > 0) return v[0] === b[0];
    if (b[1] > 0) return v[0] === 0 && v[1] === b[1];
    return v[0] === 0 && v[1] === 0 && v[2] === b[2];
  }
  // Tilde: ~6.42.0 -> >=6.42.0 <6.43.0; ~6 -> >=6.0.0 <7.0.0.
  if (r.startsWith('~')) {
    const raw = r.slice(1);
    const b = parseSemver(raw);
    if (!b) return null;
    if (cmpSemver(v, b) < 0) return false;
    // If the range named a minor (`~6.42` / `~6.42.0`), pin the minor; if it
    // named only a major (`~6`), pin the major.
    const namedMinor = /^\d+\.\d+/.test(raw);
    return namedMinor ? v[0] === b[0] && v[1] === b[1] : v[0] === b[0];
  }
  // x / * wildcard segment: 6.x, 6.39.x, 6.*.
  if (/^\d+(\.(\d+|[xX*])){0,2}$/.test(r) && /[xX*]/.test(r)) {
    const segs = r.split('.');
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s === 'x' || s === 'X' || s === '*') break; // any beyond here
      if (Number(s) !== v[i]) return false;
    }
    return true;
  }
  // Exact `1.2.3` (or shorter `1` / `1.2`, treated as that prefix pinned). A
  // leading `v` (`v1.2.3`) is tolerated so a `v`-prefixed exact pin evaluates
  // instead of degrading to unverified.
  const exact = r.startsWith('v') ? r.slice(1) : r;
  if (/^\d+(\.\d+){0,2}$/.test(exact)) {
    const b = parseSemver(exact);
    if (!b) return null;
    const segs = exact.split('.').length;
    for (let i = 0; i < segs; i++) if (v[i] !== b[i]) return false;
    return true;
  }
  return null;
}

// Bounds a single bundle GET made by the pin command, which either writes the
// bytes to disk (`downloadBundle`) or fetches them to hash
// (`fetchIntegrity`). Deliberately six times the warmup budget, because the
// two are not the same situation: a pin is a one-shot command a person ran and
// is waiting on, with a whole multi-megabyte package to transfer, while the
// warmup is a server holding a request. Ten seconds is generous for the
// latter and tight for the former on a slow link.
//
// 60s matches what importmap-rails effectively allows. It sets no timeout at
// all, but Ruby's Net::HTTP defaults open_timeout and read_timeout to 60s, so
// a Rails pin is bounded at a minute without asking. JavaScript's fetch() has
// no default whatsoever, which is why this has to be explicit: without it a
// CDN that accepts the connection and then stalls hangs the pin forever, with
// no ambient deadline on a CLI run to cut it short.
export const PIN_BUNDLE_TIMEOUT_MS = 60_000;

/**
 * Fetch a jspm.io URL just to compute its SHA-384 hash, without
 * writing anything to disk. Used by `webjs vendor pin` (default mode)
 * so the importmap can carry SRI hashes even when bundles aren't
 * locally vendored.
 *
 * Bounded by PIN_BUNDLE_TIMEOUT_MS, the same budget `downloadBundle`
 * gets, since it transfers the same bytes and differs only in whether
 * they are written to disk. Default-mode `pinAll` runs this once per
 * resolved URL, so a CDN that accepts the connection and then stalls
 * would otherwise hang the pin with nothing to interrupt it: there is
 * no ambient deadline on a CLI run (#1150).
 *
 * @param {string} url
 * @returns {Promise<string | null>}  the integrity string, or null on failure
 */
export async function fetchIntegrity(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIN_BUNDLE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.error(`[webjs] hash ${url} returned ${response.status}`);
      return null;
    }
    // Hash raw response bytes so the integrity matches what the
    // browser computes when fetching the same URL. See the
    // matching comment in downloadBundle.
    const buf = new Uint8Array(await response.arrayBuffer());
    return await sha384Integrity(buf);
  } catch (e) {
    const why = e && e.name === 'AbortError'
      ? `timed out after ${PIN_BUNDLE_TIMEOUT_MS}ms`
      : e && e.message;
    console.error(`[webjs] hash ${url} failed: ${why}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
