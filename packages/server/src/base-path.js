/**
 * Sub-path deployment support: `webjs.basePath` (issue #256).
 *
 * An app deployed under a sub-path (example.com/app/) behind a proxy that
 * does NOT strip the prefix is broken without this: every
 * framework-emitted absolute URL (the importmap targets, the modulepreload
 * hints, the boot script's `/__webjs/core/*` specifiers and per-route
 * module URLs, the dev reload `src`) assumes the app sits at the origin
 * root, so they point at `/__webjs/core/*` instead of
 * `/app/__webjs/core/*`, module resolution 404s, and the page never
 * hydrates. `createRequestHandler` explicitly targets embedding, where a
 * sub-path mount is the norm.
 *
 * The model is strip-at-ingress + prefix-on-emit. Two seams carry it, plus two
 * further `stripBasePath` consumers on the CACHE path (`dev.js`'s HTML-cache
 * write and `html-cache.js`'s `revalidatePath`), which key on the
 * app-root-relative path so a mounted app hits its own cache:
 *
 *   1. STRIP AT INGRESS. At the very start of request handling, when the
 *      request pathname starts with the basePath, strip it so all
 *      downstream logic (route matching, the `/__webjs/*` checks, the
 *      source-file gate, redirects, trailing-slash) sees a ROOT-relative
 *      path and works UNCHANGED. This single strip is why the rest of the
 *      framework needs no per-site changes. `stripBasePath` does the path
 *      computation; `dev.js` rewrites the Request URL with it.
 *
 *   2. PREFIX ON EMIT. Every framework-emitted same-origin absolute URL
 *      (begins with a single `/`) gets the basePath prepended via the one
 *      `withBasePath` helper. Applied to the importmap targets
 *      (`importmap.js`), the modulepreload hrefs + boot module specifiers +
 *      dev reload `src` (`ssr.js`). A cross-origin URL (a `https://` CDN
 *      vendor target) is absolute and is left untouched.
 *
 * Empty basePath (the default) makes both seams pure no-ops, so an
 * unconfigured app is byte-identical to before this feature. That
 * invariant is the #1 risk and is guarded differentially in the tests.
 *
 * OUT OF SCOPE (a documented follow-up, the same boundary Next draws):
 * rewriting AUTHOR-written `<a href="/about">` links and client-router
 * navigation prefixing. This module covers framework-emitted URLs and the
 * ingress match only.
 */

/**
 * Normalize a raw `webjs.basePath` value to the canonical internal form:
 * either `''` (the no-op default) or a string with exactly one leading
 * `/` and no trailing `/`. So `'app'`, `'/app'`, and `'/app/'` all map to
 * `'/app'`, and a nested `'/foo/bar'` is preserved.
 *
 * Empty / undefined / non-string / `'/'` all map to `''` (no base path).
 * A value that cannot be a safe, single-origin path prefix is rejected to
 * `''`: anything containing `..` (path traversal), a protocol (`://`), a
 * backslash, whitespace, or a network-path `//host` reference. So a typo
 * or a hostile value fails safe to "no base path" rather than poisoning
 * every emitted URL.
 *
 * This function is PORTED into the CLI, as `readAppBasePath`
 * (`packages/cli/lib/doctor.js`), because doctor must run when
 * `@webjsdev/server` does not resolve from the app dir at all (#954). The port
 * is deliberate, so the two are kept honest by
 * `test/cli/base-path-parity.test.mjs`, which runs one input table through both
 * and asserts they agree. Edit this body and that test reds until the port
 * follows. The ordering below matters most: the `//host` rejection sits BEFORE
 * the leading-slash collapse, and reordering it on either side is an origin
 * escape the parity table catches.
 *
 * @param {unknown} raw the configured value
 * @returns {string} `''` or `/segment[/segment...]`
 */
export function normalizeBasePath(raw) {
  if (typeof raw !== 'string') return '';
  let v = raw.trim();
  if (v === '' || v === '/') return '';
  // Reject anything that is not a plain same-origin path prefix.
  if (v.includes('..')) return '';
  if (v.includes('://')) return '';
  if (v.includes('\\')) return '';
  if (/\s/.test(v)) return '';
  // Reject a network-path reference (`//host`) BEFORE collapsing leading
  // slashes: such a value would emit a protocol-relative, cross-origin URL
  // once prefixed (an open redirect / origin escape), so it fails safe to
  // "no base path" rather than being collapsed to `/host`.
  if (v.startsWith('//')) return '';
  // Ensure exactly one leading slash.
  v = '/' + v.replace(/^\/+/, '');
  // Strip any trailing slash(es).
  v = v.replace(/\/+$/, '');
  // A leading-slash-only value collapses to '' here (already handled as
  // '/' above, but guard a value like '//' that slipped a different path).
  if (v === '' || v === '/') return '';
  return v;
}

/**
 * Read and normalize the `webjs.basePath` config from a parsed
 * package.json (or any object). Pure; `dev.js` wraps it with the
 * package.json read like the other `webjs.*` readers.
 *
 * @param {unknown} pkg parsed package.json (or any object)
 * @returns {string} the normalized base path (`''` when unset)
 */
export function readBasePath(pkg) {
  const raw =
    pkg &&
    typeof pkg === 'object' &&
    /** @type {any} */ (pkg).webjs &&
    /** @type {any} */ (pkg).webjs.basePath;
  return normalizeBasePath(raw);
}

/**
 * Prefix a framework-emitted same-origin absolute URL with the base path.
 * Returns the URL unchanged when basePath is empty (the no-op default) or
 * when the URL is not a same-origin absolute path (a cross-origin
 * `https://` CDN target, a protocol-relative `//host` reference, or a
 * relative URL), so only the framework's own `/`-rooted paths are moved.
 *
 * @param {string} url the URL to (maybe) prefix
 * @param {string} basePath the normalized base path (`''` = no-op)
 * @returns {string}
 */
export function withBasePath(url, basePath) {
  if (!basePath) return url;
  if (typeof url !== 'string') return url;
  // Only a single-leading-slash same-origin path is prefixed. A
  // protocol-relative `//host` or an absolute `scheme://` URL is left
  // alone (a vendor CDN target), as is a relative URL.
  if (url[0] !== '/' || url[1] === '/') return url;
  return basePath + url;
}

/**
 * Compute the root-relative pathname for an incoming request pathname
 * under the base path (the ingress strip). Returns:
 *   - the stripped, root-relative pathname (always begins with `/`) when
 *     the request is for this app, OR
 *   - `null` when the request path is NOT under the base path, so the
 *     caller can 404 it (the request is not for this mounted app).
 *
 * Mapping: `<basePath>` and `<basePath>/` both map to the root `/`.
 * `<basePath>/foo` maps to `/foo`. A path that merely shares a prefix but
 * is not a real segment boundary (e.g. `/application` under basePath
 * `/app`) is NOT under the base path and returns null. When basePath is
 * empty this is a pure pass-through (returns the input unchanged).
 *
 * @param {string} pathname the incoming request pathname (begins with `/`)
 * @param {string} basePath the normalized base path (`''` = no-op)
 * @returns {string | null}
 */
export function stripBasePath(pathname, basePath) {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  const withSlash = basePath + '/';
  if (pathname.startsWith(withSlash)) {
    // Slice off the base path; keep the leading slash of the remainder.
    const rest = pathname.slice(basePath.length);
    return rest || '/';
  }
  // Not under the base path (`/application` vs basePath `/app`, or an
  // unrelated path): not this app.
  return null;
}
