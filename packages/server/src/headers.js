/**
 * Secure-by-default response headers plus a small declarative per-path
 * header config (issue #232).
 *
 * WebJs sets a baseline of standard security headers on every document
 * and asset response, so a scaffolded app is not clickjackable or
 * MIME-sniffable out of the box (no reverse proxy required for the
 * baseline). The defaults are LITERAL HTTP headers, no abstraction.
 *
 * An app can ADD, OVERRIDE, or DISABLE any header per path via a
 * declarative config (`package.json` -> `webjs.headers`), shaped like
 * Next's: an array of `{ source, headers: [{ key, value }] }` where
 * `source` is a path pattern matched with the native URLPattern API.
 *
 * Precedence, lowest to highest:
 *   1. secure defaults
 *   2. path config (webjs.headers)        overrides/adds/removes a default
 *   3. app middleware (already on the Response when we merge)
 *
 * In other words middleware wins over the path config, which wins over
 * the defaults. We only ever ADD a header the response does not already
 * carry, so a header an app set (in middleware, a route handler, or via
 * `expose`) is never clobbered. A path-config entry with a null/empty
 * value REMOVES a header (e.g. drop a default on a public embed route).
 *
 * This is the connective tissue #233 (CSP) and #234 (CORS) plug into
 * later: the merge seam (applySecurityHeaders) is the single place a
 * future per-path policy layers onto a Response, so neither needs to
 * touch the response pipeline again.
 */

import { trustProxy } from './forwarded.js';

/**
 * Baseline security headers, as literal name -> value pairs. Set only
 * when absent, so an app override always wins. HSTS is NOT here: it is
 * conditional (production + HTTPS) and added separately.
 *
 * @type {ReadonlyArray<[string, string]>}
 */
const SECURE_DEFAULTS = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'SAMEORIGIN'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

/** The standard HSTS posture: two years, include subdomains. */
const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/**
 * Read the per-path header config from the app's package.json
 * (`webjs.headers`). Returns a normalized array of compiled rules, each
 * pairing a URLPattern against the configured header directives. A
 * malformed or absent config yields an empty array (no per-path rules),
 * never a throw: a broken config must not take the app down. Each malformed
 * rule or directive is DROPPED with a one-line warning, matching
 * `redirects.js`, so a single typo neither disables the valid rules around it
 * nor disappears without a word.
 *
 * Shape consumed:
 *   "webjs": { "headers": [ { "source": "/embed/:path*",
 *     "headers": [ { "key": "X-Frame-Options", "value": null } ] } ] }
 *
 * A `value` of null, undefined, or false REMOVES the header on a match
 * (the disable-a-default escape hatch). Any other value is stringified
 * and SET (override or add).
 *
 * @param {unknown} pkg parsed package.json (or any object)
 * @returns {Array<{ pattern: URLPattern, directives: Array<{ key: string, value: string | null }> }>}
 */
export function compileHeaderRules(pkg) {
  const raw =
    pkg &&
    typeof pkg === 'object' &&
    /** @type {any} */ (pkg).webjs &&
    /** @type {any} */ (pkg).webjs.headers;
  if (!Array.isArray(raw)) {
    // An ABSENT key is the default and says nothing. A PRESENT one of the
    // wrong type discards the whole config, so it says so: the schema types
    // this key `array` but the boot config check only inspects boolean /
    // integer / enum leaves, so `"headers": {…}` is caught by nothing else.
    if (raw !== undefined && raw !== null) warnDrop('headers must be an array', raw);
    return [];
  }
  /** @type {Array<{ pattern: URLPattern, directives: Array<{ key: string, value: string | null }> }>} */
  const rules = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      warnDrop('entry must be an object', entry);
      continue;
    }
    const source = /** @type {any} */ (entry).source;
    const list = /** @type {any} */ (entry).headers;
    if (typeof source !== 'string' || !source) {
      warnDrop('source must be a non-empty string', entry);
      continue;
    }
    if (!Array.isArray(list)) {
      warnDrop(`headers must be an array on "${source}"`, entry);
      continue;
    }
    let pattern;
    try {
      // Match on the pathname only. A bare path string is the common
      // Next-style usage; URLPattern treats it as the pathname component.
      pattern = new URLPattern({ pathname: source });
    } catch {
      // Skip an invalid pattern rather than crash the request.
      warnDrop(`invalid source pattern "${source}"`, entry);
      continue;
    }
    /** @type {Array<{ key: string, value: string | null }>} */
    const directives = [];
    for (const d of list) {
      if (!d || typeof d !== 'object') {
        warnDrop(`directive must be an object on "${source}"`, d);
        continue;
      }
      const key = /** @type {any} */ (d).key;
      if (typeof key !== 'string' || !key) {
        warnDrop(`directive key must be a non-empty string on "${source}"`, d);
        continue;
      }
      const v = /** @type {any} */ (d).value;
      // null / undefined / false means REMOVE the header on a match.
      const value = v === null || v === undefined || v === false ? null : String(v);
      // Validate the key/value against the real Headers parser at COMPILE
      // time (consistent with dropping a bad `source`). A name or value
      // that Headers rejects (an invalid header name, or a value carrying
      // CR/LF) would otherwise make `applySecurityHeaders` THROW on every
      // matching request, a self-inflicted 500, which breaks this file's
      // "a broken config must not take the app down" guarantee. Probe on a
      // throwaway Headers and DROP the directive if it throws. For a delete
      // (value null) only the key needs to be a valid header name, so probe
      // it with a placeholder value.
      try {
        new Headers().set(key, value === null ? 'x' : value);
      } catch {
        warnDrop(`invalid header name or value for key "${key}"`, d);
        continue;
      }
      directives.push({ key, value });
    }
    // A rule with nothing left to apply is dropped, and SAYS so. Two ways to
    // get here and both were silent: an authored `"headers": []`, which the
    // schema permits (no `minItems`) and the boot config check never sees
    // (it does not descend into `headers`), and a rule whose every directive
    // was just dropped, where the per-directive warnings above name the
    // directives but never say the rule itself went with them.
    if (!directives.length) {
      warnDrop(`no valid directives left on "${source}"`, entry);
      continue;
    }
    rules.push({ pattern, directives });
  }
  return rules;
}

/**
 * One line per dropped config, rule, or directive, matching `redirects.js`'s
 * warnDrop verbatim in shape. Every drop in `compileHeaderRules` goes through
 * this, at all three levels: a wrong-typed `webjs.headers` key, a rule, and a
 * directive. A config typo that silently does nothing is the failure this whole
 * surface exists to end, and a `source` misspelled as `sources` used to vanish
 * here with no diagnostic at all.
 *
 * The one thing that does NOT warn is an ABSENT `webjs.headers`, which is the
 * default rather than a mistake.
 *
 * Defined BELOW `compileHeaderRules`, like the one in `redirects.js`. Putting
 * it above wedged this docblock between that function's JSDoc and its
 * declaration, so the JSDoc bound to the helper instead and the reader lost
 * its `@param` / `@returns` entirely.
 *
 * @param {string} reason @param {unknown} entry
 */
function warnDrop(reason, entry) {
  // eslint-disable-next-line no-console
  console.warn(`[webjs] dropping invalid webjs.headers entry (${reason}):`, entry);
}

/**
 * Apply the security defaults and the per-path config to a Response,
 * returning a Response carrying the merged headers. The input Response
 * is not mutated; a new Headers is derived from it so the body/status
 * are preserved by reference (no body copy).
 *
 * Headers already on the response (set by app middleware, a route
 * handler, or `expose`) are treated as authoritative and never
 * overwritten by a default. The per-path config runs AFTER the defaults
 * but BEFORE that "already present" rule is consulted for middleware:
 * the config can override a default freely (it is the app's own
 * declarative intent), while middleware still wins because its headers
 * are on the response before we are even called.
 *
 * @param {Response} res the response produced by the app pipeline
 * @param {{
 *   pathname: string,
 *   https: boolean,
 *   prod: boolean,
 *   rules?: Array<{ pattern: URLPattern, directives: Array<{ key: string, value: string | null }> }>,
 * }} ctx
 * @returns {Response}
 */
export function applySecurityHeaders(res, ctx) {
  const headers = new Headers(res.headers);
  // Snapshot the keys the app already set, so a default never clobbers
  // them. Captured BEFORE we add anything. Lowercased for compare;
  // Headers itself is case-insensitive.
  const appSet = new Set();
  headers.forEach((_v, k) => appSet.add(k.toLowerCase()));

  // 1. Secure defaults: set only if the app did not already set them.
  for (const [k, v] of SECURE_DEFAULTS) {
    if (!appSet.has(k.toLowerCase())) headers.set(k, v);
  }
  // HSTS only in production AND only over HTTPS (never on a plain-HTTP
  // hop). Same "do not clobber" rule.
  if (ctx.prod && ctx.https && !appSet.has('strict-transport-security')) {
    headers.set('Strict-Transport-Security', HSTS_VALUE);
  }

  // 2. Per-path config: override / add / remove. Runs over the merged
  // set so it can replace a default this same call just added. It does
  // NOT override a header the app set in middleware (appSet), preserving
  // the middleware-wins precedence.
  const rules = ctx.rules || [];
  for (const rule of rules) {
    if (!rule.pattern.test({ pathname: ctx.pathname })) continue;
    for (const { key, value } of rule.directives) {
      if (appSet.has(key.toLowerCase())) continue; // middleware wins
      // Belt and suspenders: compileHeaderRules already validated the
      // key/value, so this never throws in practice, but a surprise from a
      // directive constructed elsewhere must never throw the response
      // pipeline. Skip the bad directive instead.
      try {
        if (value === null) headers.delete(key);
        else headers.set(key, value);
      } catch {
        /* skip a directive the Headers parser rejects */
      }
    }
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Detect whether the original client request was HTTPS, from a web
 * `Request` (the shape `handle()` works with). Reads `X-Forwarded-Proto`
 * only when `trustProxy()` says a proxy speaks for the client; otherwise
 * falls back to the request URL's scheme. Never trusts the header blindly.
 *
 * The posture comes from `forwarded.js` rather than an inline `process.env`
 * read (#1104), so this gate cannot drift from the URL rewrite it shadows.
 *
 * @param {Request} req
 * @returns {boolean}
 */
export function webRequestIsHttps(req) {
  if (trustProxy()) {
    const proto = req.headers.get('x-forwarded-proto');
    if (proto) return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return false;
  }
}
