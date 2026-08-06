/**
 * Content-Security-Policy: mint a per-request nonce and emit the matching
 * header (issue #233).
 *
 * webjs's CSP support used to be consume-only: `ssr.js` read a nonce out
 * of the INBOUND request's `Content-Security-Policy` header and applied it
 * to its inline boot script, the importmap, and modulepreload hints. That
 * only did anything if some upstream proxy already minted a nonce and set
 * the header, so the advertised "CSP via nonce" protection was off by
 * default and effectively dead.
 *
 * This module wires the GENERATING half. When CSP is enabled (opt-in, via
 * `package.json` -> `webjs.csp`), the request handler:
 *   1. mints a fresh CSPRNG nonce per request (`mintNonce`),
 *   2. makes it the value `cspNonce()` returns for that request (so the
 *      same nonce lands on every inline `<script>` / meta / modulepreload
 *      the SSR pipeline emits), and
 *   3. sets a literal `Content-Security-Policy` response header carrying
 *      that EXACT nonce (`buildCspHeader`).
 *
 * The header value and the nonce on the inline scripts are the same
 * minted string, so there is no drift: a single value flows
 * mint -> request store -> SSR (`cspNonce()`) -> header.
 *
 * The default policy when enabled is a strict-dynamic + nonce posture
 * that works with webjs's own inline boot script and importmap. CSP is
 * OFF by default: an unconfigured app is byte-for-byte unchanged (no
 * nonce minted, `cspNonce()` stays '', no CSP header).
 */

/**
 * @typedef {{
 *   enabled: boolean,
 *   directives: Record<string, string>,
 *   reportOnly: boolean,
 * }} CspConfig
 */

/**
 * Any C0/C1 control character, including CR and LF. A directive name or
 * value carrying one of these would make `Headers.set` throw, so such a
 * directive is dropped from the policy at config-read time (fail closed).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/;

/**
 * The strict-by-default directive set used when `webjs.csp` is `true`
 * (or an object that does not override a given directive). Tuned to work
 * with webjs's own output, which is: nonce-signed inline `<script>` tags
 * (the boot script, the public-env shim, the importmap), nonce-signed
 * `<link rel="modulepreload">`, ES modules fetched same-origin and from
 * the configured vendor CDN, and one inline `<style>` in the head. The
 * nonce covers scripts only, so that rule and every app-authored style
 * alike are admitted by `'unsafe-inline'` (see the `style-src` note).
 *
 * `script-src` uses `'strict-dynamic'` so a nonce-loaded module can pull
 * in its own dependencies (the importmap-driven per-file ESM graph)
 * without each fetched URL needing to be allow-listed. `'self'` and
 * `https:` are kept as a fallback for browsers that do not honor
 * `'strict-dynamic'` (they are ignored where it IS honored).
 *
 * The `__NONCE__` placeholder is substituted per request in
 * `buildCspHeader`.
 *
 * @type {Record<string, string>}
 */
const DEFAULT_DIRECTIVES = {
  'default-src': "'self'",
  'script-src': "'nonce-__NONCE__' 'strict-dynamic' 'self' https:",
  // NOTE this directive carries no nonce source, unlike `script-src`, so a
  // nonce attribute on a <style> is INERT here and every inline style is
  // admitted by 'unsafe-inline' alone. That includes WebJs's own head rule
  // (the @layer webjs-host block), which SSR does stamp with the nonce but
  // which this policy never checks it against. Dropping 'unsafe-inline'
  // would block that rule too, not only app style.
  //
  // What keeps the allowance necessary is inline style with no realistic
  // nonce path, and it arrives in four shapes. A page or layout may write
  // an inline <style>, which an author could nonce by hand but does not by
  // default. A light-DOM component's <style> and a shadow component's
  // `static styles`, serialized into its declarative shadow root, are both
  // emitted by the core renderer with no nonce and no way to supply one.
  // And every style="..." attribute is unfixable in principle, since a
  // nonce applies to elements and never to attributes. No styling library
  // is involved in any of them.
  //
  // Style elements are not a script-injection vector, so this does not
  // weaken the script protection.
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data: https:",
  'font-src': "'self' data: https:",
  'connect-src': "'self'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'frame-ancestors': "'self'",
  'object-src': "'none'",
};

/**
 * Read and normalize the CSP config from the app's package.json
 * (`webjs.csp`). Never throws: a malformed config disables CSP rather
 * than taking the app down (a broken security knob must fail closed and
 * visible, not crash every request).
 *
 * Accepted shapes:
 *   "csp": false | undefined    -> disabled (the default)
 *   "csp": true                 -> enabled, default strict policy
 *   "csp": { ...overrides }     -> enabled, custom directives
 *
 * Object shape:
 *   {
 *     "directives": { "connect-src": "'self' https://api.example.com" },
 *     "reportOnly": true
 *   }
 * `directives` is merged OVER the strict defaults (per-directive
 * override), so an app customizes one directive without restating the
 * rest. A directive whose value is null/false/'' is DROPPED from the
 * emitted policy (the escape hatch to remove a default directive).
 * `reportOnly: true` emits `Content-Security-Policy-Report-Only` instead
 * of the enforcing header (the standard staged-rollout path).
 *
 * A bare object with no `directives` key is also accepted and treated as
 * the directive map directly, so `{ "connect-src": "..." }` works as a
 * terse form. `reportOnly` is always recognized at the top level, so the
 * terse form never mistakes it for a directive.
 *
 * @param {unknown} pkg parsed package.json (or any object)
 * @returns {CspConfig}
 */
export function readCspConfig(pkg) {
  const off = { enabled: false, directives: {}, reportOnly: false };
  const raw =
    pkg &&
    typeof pkg === 'object' &&
    /** @type {any} */ (pkg).webjs &&
    /** @type {any} */ (pkg).webjs.csp;
  if (raw === undefined || raw === null || raw === false) return off;
  if (raw === true) {
    return { enabled: true, directives: { ...DEFAULT_DIRECTIVES }, reportOnly: false };
  }
  if (typeof raw !== 'object') return off; // a string/number is malformed: fail closed

  // `reportOnly` is a reserved top-level key in BOTH shapes, so the terse
  // bare-directive-map form never treats it as a directive. The wrapped
  // shape ({ directives, reportOnly }) is distinguished by a `directives`
  // key; otherwise the object IS the directive map (minus reportOnly).
  const obj = /** @type {any} */ (raw);
  const reportOnly = Boolean(obj.reportOnly);
  let overrides;
  if (Object.prototype.hasOwnProperty.call(obj, 'directives')) {
    overrides = obj.directives;
  } else {
    overrides = { ...obj };
    delete overrides.reportOnly;
  }

  const directives = { ...DEFAULT_DIRECTIVES };
  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides)) {
      if (typeof k !== 'string' || !k) continue;
      // null / false / '' removes a default directive.
      if (v === null || v === false || v === '') {
        delete directives[k];
        continue;
      }
      const value = String(v);
      // Reject a directive NAME or VALUE carrying CR/LF or other control
      // chars. Author-controlled config (no injection vector, the only
      // request-derived input is the safe base64 nonce), but a CRLF in a
      // value would make `Headers.set` THROW in `buildCspHeader`'s caller,
      // a self-inflicted 500 on every request that breaks this file's
      // "never a throw, fail closed" promise. Drop the bad directive with a
      // one-line warning, consistent with how headers.js drops a bad
      // header directive. `__NONCE__` is substituted later with a base64
      // nonce, so the post-substitution value stays control-char-free.
      if (CONTROL_CHARS.test(k) || CONTROL_CHARS.test(value)) {
        // eslint-disable-next-line no-console
        console.warn(`[webjs] dropping invalid webjs.csp directive "${k}" (control character in name or value)`);
        delete directives[k];
        continue;
      }
      directives[k] = value;
    }
  }
  return { enabled: true, directives, reportOnly };
}

/**
 * Mint a fresh per-request nonce with native crypto (CSPRNG). 16 random
 * bytes, base64-encoded, which clears the CSP spec's 128-bit-entropy
 * recommendation and is in the nonce charset (`[A-Za-z0-9+/=]`). Changes
 * every call, so every request gets a distinct value.
 *
 * @returns {string}
 */
export function mintNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Buffer is available in every WebJs server runtime (Node 24+). Avoids a
  // hand-rolled base64 of a binary string.
  return Buffer.from(bytes).toString('base64');
}

/**
 * Build the literal `Content-Security-Policy` header VALUE from a config
 * and a minted nonce, substituting the `__NONCE__` placeholder so the
 * header carries the exact nonce the SSR pipeline put on the inline
 * scripts. Returns the policy string (directives joined by `; `).
 *
 * @param {CspConfig} config
 * @param {string} nonce
 * @returns {string}
 */
export function buildCspHeader(config, nonce) {
  const parts = [];
  for (const [name, value] of Object.entries(config.directives)) {
    const v = String(value).replaceAll('__NONCE__', nonce);
    parts.push(v ? `${name} ${v}` : name);
  }
  return parts.join('; ');
}

/**
 * The header NAME to emit for a config (enforcing vs report-only).
 *
 * @param {CspConfig} config
 * @returns {string}
 */
export function cspHeaderName(config) {
  return config.reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
}
