/**
 * Declarative permanent / temporary redirects (issue #254).
 *
 * WebJs already ships `redirect(url)` (a per-request throw sentinel) for
 * imperative, request-time redirects. This module adds the missing
 * DECLARATIVE surface: a config of old-path -> new-path rules an app
 * declares once and the framework applies at the very start of request
 * handling, before routing / SSR / asset serving. This is what SEO wants
 * for a moved URL, a permanent 308 (or legacy 301) so link equity
 * transfers and search engines update their index.
 *
 * Config lives in `package.json` -> `webjs.redirects`, an array of
 * `{ source, destination, permanent?, statusCode? }`, cohesive with the
 * #232 `webjs.headers` config (same `source` URLPattern matching, same
 * fail-safe "a malformed entry is dropped at config-load, never a
 * throw" posture, patterns compiled ONCE at boot):
 *
 *   "webjs": { "redirects": [
 *     { "source": "/old", "destination": "/new" },
 *     { "source": "/blog/:slug", "destination": "/posts/:slug" },
 *     { "source": "/legacy", "destination": "/", "permanent": false },
 *     { "source": "/docs", "destination": "https://docs.example.com" }
 *   ] }
 *
 * Status code. `permanent` defaults to true (308 Permanent Redirect);
 * `permanent: false` is 307 (Temporary Redirect). 308 / 307 are the
 * MODERN choice because they preserve the request method and body
 * (a redirected POST stays a POST). The legacy 301 / 302 do not
 * guarantee that. An app that needs a specific legacy code (e.g. a 301
 * for a tool that only understands it) can set `statusCode` explicitly,
 * which wins over `permanent`.
 *
 * Destination. A `destination` may be:
 *   - a path (`/new`), optionally referencing named groups captured by
 *     the source pattern (`/posts/:slug` filled from `/blog/:slug`),
 *   - an absolute URL (`https://docs.example.com`) for an external
 *     redirect (group substitution applies there too).
 *
 * Query string. The incoming query string is PRESERVED by default and
 * appended to the destination (a destination that carries its own query
 * is merged, the destination's keys winning). This matches Next.js's
 * default redirect behavior.
 */

/**
 * Trailing-slash canonicalization (issue #255).
 *
 * A page reachable at BOTH `/about` and `/about/` is duplicate content:
 * webjs's file router matches both (every route pattern ends with `/?$`,
 * so the slashed and unslashed forms render IDENTICAL HTML), but search
 * engines treat them as two URLs that split link equity, and the client
 * router caches them under two keys. The trailing-slash policy picks ONE
 * canonical form and 308-redirects the other to it, exactly like the
 * `webjs.redirects` config does for a moved URL.
 *
 * Config lives in `package.json` -> `webjs.trailingSlash`, cohesive with
 * `webjs.redirects` / `webjs.headers` / `webjs.csp`:
 *
 *   "webjs": { "trailingSlash": "never" }    // /about/ -> /about (recommended)
 *   "webjs": { "trailingSlash": "always" }   // /about  -> /about/
 *   "webjs": { "trailingSlash": "ignore" }   // no canonicalization (default)
 *
 * Default. Absent or `"ignore"` means NO redirect (current behavior, so an
 * existing app is unchanged). Most apps want `"never"`; it is the
 * recommendation, but it is opt-in so adding the feature never silently
 * starts 308-ing an app that was happy serving both forms.
 *
 * Rules (a redirect is a permanent 308, so the SEO equity transfers and a
 * redirected POST stays a POST):
 *   - `never`: a path ending in `/` (other than the root `/`) redirects to
 *     the same path without the trailing slash.
 *   - `always`: a path with NO trailing slash redirects to the same path
 *     WITH one, UNLESS the last segment looks like a file (has a dot in it,
 *     e.g. `/foo.js`, `/image.png`); a file path is left alone, since
 *     `/foo.js/` is not a sensible canonical form.
 *   - The ROOT path `/` is ALWAYS left alone under either policy.
 *   - The query string and hash are preserved on the redirect.
 *   - `/__webjs/*` framework paths are exempt (handled by the caller).
 */

/** Permanent (308) is the canonicalization status, like a moved URL. */
const CANONICAL_STATUS = 308;

/** The valid `webjs.trailingSlash` policy values. */
const TRAILING_SLASH_POLICIES = new Set(['never', 'always', 'ignore']);

/**
 * Read the trailing-slash policy from the app's package.json
 * (`webjs.trailingSlash`). Returns `'never'` / `'always'` / `'ignore'`,
 * defaulting to `'ignore'` (no canonicalization) for an absent, malformed,
 * or unrecognized value, so a missing or typo'd config is a no-op rather
 * than a throw or an accidental redirect.
 *
 * @param {unknown} pkg parsed package.json (or any object)
 * @returns {'never' | 'always' | 'ignore'}
 */
export function readTrailingSlashPolicy(pkg) {
  const raw =
    pkg &&
    typeof pkg === 'object' &&
    /** @type {any} */ (pkg).webjs &&
    /** @type {any} */ (pkg).webjs.trailingSlash;
  if (typeof raw === 'string' && TRAILING_SLASH_POLICIES.has(raw)) {
    return /** @type {'never' | 'always' | 'ignore'} */ (raw);
  }
  return 'ignore';
}

/**
 * Apply the trailing-slash canonicalization policy to an incoming request.
 * Returns a 308 redirect Response to the canonical form when the request
 * path is non-canonical under the policy, else null so the request falls
 * through to normal routing (or to the declarative redirects). Runs AFTER
 * `applyRedirects` (see the wiring in `dev.js`): an explicit `webjs.redirects`
 * rule wins first, then the survivor is slash-canonicalized. This does NOT
 * guarantee loop-freedom. A redirect whose `destination` CONTRADICTS the slash
 * policy (e.g. policy `never` with `{ destination: '/x/' }`) ping-pongs forever
 * (`/x` -> 308 `/x/` -> 308 `/x` -> ...). There is no server-side loop guard
 * (matching `applyRedirects`), so keeping a redirect destination consistent with
 * the policy is the app author's responsibility.
 *
 * Framework-internal `/__webjs/*` paths are never canonicalized (the caller
 * also guards this, defense in depth here).
 *
 * SECURITY: the canonical path is built from `url.pathname` and emitted as the
 * `Location`, so a request whose path is a NETWORK-PATH REFERENCE (begins with
 * `//`, or `/\` which the URL parser normalizes to `//`) would otherwise emit a
 * protocol-relative `Location` (`//attacker.com`) that the browser resolves to a
 * FOREIGN origin, an open redirect. Such a path is not a normal route, so we
 * REFUSE to canonicalize it (return null) and let the router 404 it, rather than
 * emit a cross-origin redirect. The sibling `applyRedirects` avoids this by only
 * ever emitting app-authored `destination` literals (and keeping user-controlled
 * `:slug` captures percent-encoded so they cannot escape the origin); here the
 * Location is derived from the request path, so the guard is on the path itself.
 *
 * @param {Request} req
 * @param {'never' | 'always' | 'ignore'} policy
 * @returns {Response | null}
 */
export function applyTrailingSlash(req, policy) {
  if (policy !== 'never' && policy !== 'always') return null;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  const path = url.pathname;
  // The root path is always canonical under either policy.
  if (path === '/') return null;
  if (path.startsWith('/__webjs/')) return null;
  // Refuse a network-path reference (`//host`, or `/\host` normalized to
  // `//host`): canonicalizing it would emit a protocol-relative, cross-origin
  // Location (an open redirect). Let the router handle the weird path instead.
  if (!isSameOriginPath(path)) return null;

  /** @type {string | null} */
  let canonical = null;
  if (policy === 'never') {
    // Strip a single trailing slash. (A multi-slash path like `/about//`
    // collapses one slash per redirect; the next request re-canonicalizes,
    // and the common single-slash case settles in one hop.)
    if (path.endsWith('/')) canonical = path.replace(/\/+$/, '') || '/';
  } else {
    // policy === 'always'
    if (!path.endsWith('/') && !lastSegmentLooksLikeFile(path)) {
      canonical = path + '/';
    }
  }
  if (canonical === null || canonical === path) return null;

  // Preserve the query string and hash on the canonical URL.
  const location = canonical + url.search + url.hash;
  return new Response(null, {
    status: CANONICAL_STATUS,
    headers: { location: location },
  });
}

/**
 * Whether the LAST path segment looks like a file (contains a dot), e.g.
 * `/foo.js` or `/assets/logo.png`. Such a path must NOT get a trailing
 * slash added under the `always` policy: a file is a leaf, not a "page"
 * directory, so `/foo.js/` is never a sensible canonical form.
 *
 * @param {string} path a pathname (no query / hash)
 * @returns {boolean}
 */
function lastSegmentLooksLikeFile(path) {
  const lastSlash = path.lastIndexOf('/');
  const segment = path.slice(lastSlash + 1);
  return segment.includes('.');
}

/**
 * Whether a pathname is a SAFE same-origin path (a single leading slash, not a
 * network-path reference). A path beginning with `//` or `/\` resolves to a
 * foreign origin when emitted as a `Location`, so it is rejected. The URL parser
 * normalizes a backslash to a forward slash in the pathname, so `/\evil.com` is
 * seen here as `//evil.com`; the explicit backslash check is belt-and-braces in
 * case a caller passes a raw, unparsed path.
 *
 * @param {string} path a pathname
 * @returns {boolean}
 */
function isSameOriginPath(path) {
  if (path[0] !== '/') return false;
  const second = path[1];
  return second !== '/' && second !== '\\';
}

/** Default status for `permanent: true` (the SEO permanent redirect). */
const PERMANENT_STATUS = 308;
/** Default status for `permanent: false` (a temporary redirect). */
const TEMPORARY_STATUS = 307;

/** Redirect status codes a `statusCode` override may legitimately set. */
const ALLOWED_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Read the redirect config from the app's package.json
 * (`webjs.redirects`) and compile it to a cached array of rules, each
 * pairing a URLPattern (matched on the pathname) against a destination
 * template + resolved status. A malformed or absent config yields an
 * empty array (no redirects), never a throw: a broken redirect config
 * must not take the request pipeline down. Each malformed entry is
 * DROPPED with a one-line warning, so a single typo never disables the
 * valid rules around it.
 *
 * @param {unknown} pkg parsed package.json (or any object)
 * @returns {Array<{ pattern: URLPattern, destination: string, status: number }>}
 */
export function compileRedirectRules(pkg) {
  const raw =
    pkg &&
    typeof pkg === 'object' &&
    /** @type {any} */ (pkg).webjs &&
    /** @type {any} */ (pkg).webjs.redirects;
  if (!Array.isArray(raw)) {
    // An ABSENT key is the default and says nothing. A PRESENT one of the
    // wrong type discards the whole config, so it says so, matching
    // `headers.js`. Nothing else reports it: the schema types this key
    // `array` and the boot config check inspects only scalar leaves.
    if (raw !== undefined && raw !== null) warnDrop('redirects must be an array', raw);
    return [];
  }
  /** @type {Array<{ pattern: URLPattern, destination: string, status: number }>} */
  const rules = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      warnDrop('entry must be an object', entry);
      continue;
    }
    const source = /** @type {any} */ (entry).source;
    const destination = /** @type {any} */ (entry).destination;
    if (typeof source !== 'string' || !source) {
      warnDrop('source must be a non-empty string', entry);
      continue;
    }
    if (typeof destination !== 'string' || !destination) {
      warnDrop('destination must be a non-empty string', entry);
      continue;
    }
    let pattern;
    try {
      // Match on the pathname only, like the #232 header config. A bare
      // path string is the common Next-style usage; URLPattern treats it
      // as the pathname component, so `:slug` / `:rest*` syntax works.
      pattern = new URLPattern({ pathname: source });
    } catch {
      warnDrop(`invalid source pattern "${source}"`, entry);
      continue;
    }
    const status = resolveStatus(entry);
    if (status === null) {
      warnDrop(`invalid statusCode on "${source}"`, entry);
      continue;
    }
    rules.push({ pattern, destination, status });
  }
  return rules;
}

/**
 * Resolve the redirect status for one entry. `statusCode` wins when set
 * (must be one of the allowed redirect codes), else `permanent` chooses
 * 308 (default true) vs 307.
 *
 * @param {any} entry
 * @returns {number | null} the status, or null if `statusCode` is invalid
 */
function resolveStatus(entry) {
  const raw = entry.statusCode;
  if (raw !== undefined && raw !== null) {
    const n = Number(raw);
    if (!Number.isInteger(n) || !ALLOWED_STATUS.has(n)) return null;
    return n;
  }
  // `permanent` defaults to TRUE (the SEO permanent redirect). Only an
  // explicit `false` opts into the temporary 307.
  return entry.permanent === false ? TEMPORARY_STATUS : PERMANENT_STATUS;
}

/** @param {string} reason @param {unknown} entry */
function warnDrop(reason, entry) {
  // eslint-disable-next-line no-console
  console.warn(`[webjs] dropping invalid webjs.redirects entry (${reason}):`, entry);
}

/**
 * Substitute named groups captured by the source pattern into the
 * destination template. A `:name` token in the destination is replaced
 * by the matching group's value (URL-pathname-encoded by URLPattern's
 * own capture). An undefined group leaves the literal token in place
 * (a misconfigured destination, not a crash).
 *
 * @param {string} destination the destination template
 * @param {Record<string, string | undefined>} groups URLPattern exec groups
 * @returns {string}
 */
function fillGroups(destination, groups) {
  if (!groups) return destination;
  // Replace `:name` tokens. The name charset matches URLPattern's
  // (letters, digits, underscore). A token with no matching group is
  // left untouched.
  return destination.replace(/:([A-Za-z0-9_]+)/g, (whole, name) => {
    const v = groups[name];
    return v === undefined ? whole : v;
  });
}

/**
 * Build the final redirect Location for a matched rule: fill named
 * groups, then merge the incoming query string onto the destination
 * (preserved by default, the destination's own query keys winning).
 *
 * @param {{ destination: string, status: number }} rule
 * @param {Record<string, string | undefined>} groups
 * @param {URL} url the incoming request URL
 * @returns {string} the Location header value
 */
function buildLocation(rule, groups, url) {
  let dest = fillGroups(rule.destination, groups);
  const incoming = url.search; // includes the leading '?', or '' when absent
  if (!incoming) return dest;
  // Preserve the incoming query string. If the destination already
  // carries its own query, merge, with the destination's keys winning
  // (an explicit redirect target is intentional).
  const hashIdx = dest.indexOf('#');
  const hash = hashIdx === -1 ? '' : dest.slice(hashIdx);
  const noHash = hashIdx === -1 ? dest : dest.slice(0, hashIdx);
  const qIdx = noHash.indexOf('?');
  const base = qIdx === -1 ? noHash : noHash.slice(0, qIdx);
  const destQuery = qIdx === -1 ? '' : noHash.slice(qIdx + 1);
  const merged = new URLSearchParams(incoming.slice(1));
  for (const [k, v] of new URLSearchParams(destQuery)) merged.set(k, v);
  const qs = merged.toString();
  return base + (qs ? '?' + qs : '') + hash;
}

/**
 * Apply the declarative redirect rules to an incoming request. Returns a
 * redirect Response (308 / 307 / the configured status, with the
 * computed `Location`) on the FIRST matching rule, else null so the
 * request falls through to normal routing. Framework-internal paths
 * (`/__webjs/*`) are never redirected.
 *
 * Compiled rules are passed in (built once at boot), so this is O(rules)
 * per request with no per-request pattern compilation.
 *
 * @param {Request} req
 * @param {Array<{ pattern: URLPattern, destination: string, status: number }>} rules
 * @returns {Response | null}
 */
export function applyRedirects(req, rules) {
  if (!rules || !rules.length) return null;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  // Never redirect framework-internal paths (probes, the core runtime,
  // the action endpoint, the dev reload stream). They are infrastructure,
  // not app URLs.
  if (url.pathname.startsWith('/__webjs/')) return null;

  for (const rule of rules) {
    const match = rule.pattern.exec({ pathname: url.pathname });
    if (!match) continue;
    const groups = (match.pathname && match.pathname.groups) || {};
    const location = buildLocation(rule, groups, url);
    return new Response(null, {
      status: rule.status,
      headers: { location: location },
    });
  }
  return null;
}
