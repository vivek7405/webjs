import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha384Integrity } from './integrity.js';
import { vendorImportMapEntries, isLastLiveResolveFailed, setLastLiveResolveFailed } from './jspm.js';
import { readPinFile } from './pins.js';
import { BUFFERED_MARKER } from '../conditional-get.js';

/**
 * Per-process cache of SHA-384 integrity hashes for live-resolved vendor
 * URLs, keyed by the FINAL cross-origin URL. A vendor bundle at a given
 * versioned URL is immutable, so once hashed it never needs re-fetching
 * within the process: a re-resolve (e.g. after a file-watcher rebuild
 * that did not change the dep) reuses the hash instead of re-downloading.
 * Cleared by `clearVendorCache` alongside the jspm fragment cache so a
 * version bump re-hashes. This is NOT a persistent cache (that is the pin
 * file's job); it only avoids redundant fetches in one running process.
 *
 * @type {Map<string, string>}
 */
const liveIntegrityCache = new Map();

export function clearLiveIntegrityCache() {
  liveIntegrityCache.clear();
}

// Bounds a single bundle GET during the SERVER's warmup live-integrity pass
// (`fetchLiveIntegrity`). Short on purpose: that pass gates readiness, so a
// stalled CDN must not hold the first request, and it is additionally capped
// by INTEGRITY_TOTAL_BUDGET_MS across all URLs.
const INTEGRITY_FETCH_TIMEOUT_MS = 10_000;
// Cap concurrent bundle fetches so a large dep set does not open dozens of
// sockets at once during warmup. Matches the bounded posture of the rest of
// vendor.js (the jspm resolve is per-package but the network is the shared
// constraint).
const INTEGRITY_FETCH_CONCURRENCY = 6;
// Total wall-clock budget for the whole live-integrity hashing phase. It runs
// inside the readiness-gating warmup, so even a CDN that serves the importmap
// then hangs on every bundle GET must not stall the first request for the sum
// of per-fetch timeouts. Once the budget passes, the remaining URLs are left
// without integrity (the same fail-open fallback as a fetch failure) instead of
// waiting out a 10s timeout each. A healthy CDN finishes in well under this.
const INTEGRITY_TOTAL_BUDGET_MS = 15_000;

function pinDir(appDir) {
  return join(appDir, '.webjs', 'vendor');
}

/**
 * Fetch a single cross-origin URL with a bounded timeout and return its
 * SHA-384 SRI hash, or null on any failure (network, timeout, non-ok).
 * Fail-OPEN by design: a CDN hiccup must never break warmup, so a failure
 * is a skipped hash (the URL serves without `integrity`, the pre-#235
 * behavior for that one URL), not a thrown error.
 *
 * @param {string} url
 * @returns {Promise<string | null>}
 */
async function fetchLiveIntegrity(url) {
  const cached = liveIntegrityCache.get(url);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTEGRITY_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    // Hash the raw response bytes (arrayBuffer -> Uint8Array), the same
    // primitive the browser's SRI implementation hashes. Decoding to a
    // string first would risk encoding round-trip drift. See the matching
    // comment in downloadBundle / fetchIntegrity.
    const buf = new Uint8Array(await response.arrayBuffer());
    const sri = await sha384Integrity(buf);
    liveIntegrityCache.set(url, sri);
    return sri;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compute SRI integrity for the CROSS-ORIGIN targets of a live-resolved
 * import map. Same-origin targets (the `@webjsdev/core/*` runtime under
 * `/__webjs/core/...` and any local `/__webjs/vendor/...` bundle) are
 * skipped: they are served by the framework and already trusted, and SRI
 * is a cross-origin defense.
 *
 * The returned map is keyed by the FINAL URL (the import-map target
 * value), matching `vendorIntegrityFor(url)`'s lookup key so ssr.js emits
 * the `integrity` sibling for free.
 *
 * Bounded and fail-open: cross-origin bundles are fetched in parallel with
 * a small concurrency cap and a per-fetch timeout, and a failed fetch is
 * skipped (no integrity for that one URL) rather than breaking the resolve.
 * A single one-time `console.warn` reports the count of URLs that could not
 * be hashed (no per-URL spam).
 *
 * @param {Record<string, string>} imports  specifier -> final URL
 * @returns {Promise<Record<string, string>>}  integrity keyed by final URL
 */
async function computeLiveIntegrity(imports) {
  // De-duplicate by URL: two specifiers can resolve to the same bundle URL
  // (a bare import and one of its subpaths), so hash each URL once.
  const urls = [...new Set(Object.values(imports))].filter((u) => /^https:\/\//.test(u));
  /** @type {Record<string, string>} */
  const integrity = {};
  if (urls.length === 0) return integrity;

  const failed = [];
  let next = 0;
  const deadline = Date.now() + INTEGRITY_TOTAL_BUDGET_MS;
  async function worker() {
    // Stop claiming new URLs once the total budget passes; a URL already
    // in flight still settles under its own per-fetch timeout.
    while (next < urls.length && Date.now() < deadline) {
      const url = urls[next++];
      const sri = await fetchLiveIntegrity(url);
      if (sri) integrity[url] = sri;
      else failed.push(url);
    }
  }
  const workerCount = Math.min(INTEGRITY_FETCH_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  // Any URL never claimed because the budget passed also fails open (served
  // without integrity), the same outcome as a fetch failure.
  while (next < urls.length) failed.push(urls[next++]);

  if (failed.length) {
    // One-time, count-based warning. The app still boots and the imports
    // still work; only these URLs lack SRI (served as before #235). Run
    // `webjs vendor pin` to lock in integrity, or retry once the CDN is
    // healthy. Naming one example URL aids diagnosis without per-URL spam.
    console.warn(
      `[webjs] could not compute SRI for ${failed.length} live-resolved ` +
      `vendor URL(s) (e.g. ${failed[0]}); they will load WITHOUT integrity. ` +
      `This is a fail-open fallback for a CDN fetch failure or the warmup ` +
      `time budget; the app still works. Run \`webjs vendor pin\` to lock in ` +
      `SRI hashes.`,
    );
  }
  return integrity;
}

export async function resolveVendorImports(appDir, getBareImports) {
  const file = await readPinFile(appDir);
  // A committed pin file IS the import map. The whole-app bare-import scan is
  // discarded in that case, so it must never run (runtime-first boot: no
  // static analysis when pinned). The scan is supplied as a thunk and invoked
  // solely here, only when there is no pin file.
  if (file) {
    // A pin file is a deterministic disk read: always "ok" (no live CDN call
    // that could partially fail). This is the recommended prod posture. The
    // pin's own integrity is used verbatim; the live-hash path below is NOT
    // taken for a pinned app.
    return { imports: file.imports, integrity: file.integrity || {}, ok: true };
  }
  setLastLiveResolveFailed(false);
  const bareImports = await getBareImports();
  const imports = await vendorImportMapEntries(bareImports, appDir);
  // Fill the SRI gap for live-resolved (unpinned) apps (#235): hash each
  // cross-origin bundle and key the integrity by its final URL, the same
  // shape the pin path uses and `vendorIntegrityFor` looks up. Bounded +
  // fail-open, so a CDN fetch failure degrades to a missing hash for that
  // URL (a warning), never a broken resolve. This runs only AFTER a live
  // resolve produced URLs; if the resolve itself failed there is nothing to
  // hash.
  const integrity = await computeLiveIntegrity(imports);
  return { imports, integrity, ok: !isLastLiveResolveFailed() };
}

/**
 * Serve a downloaded vendor bundle from `.webjs/vendor/<filename>`.
 * Called by dev.js when the importmap contains `/__webjs/vendor/`
 * paths (i.e. user ran `webjs vendor pin --download`).
 *
 * @param {string} filename  e.g. `'dayjs@1.11.13.js'`
 * @param {string} appDir
 * @param {boolean} dev
 * @returns {Promise<Response>}
 */
export async function serveDownloadedBundle(filename, appDir, dev) {
  // Strict allowlist. Vendor filenames are framework-generated:
  // `<pkg>@<version>.js` or `<pkg>@<version>__<subpath>.js` plus the
  // `@scope__name` form for scoped packages. The legal charset is
  // alphanumeric plus `@`, `.`, `_`, `-`, `+` (`+` covers semver
  // build metadata like `1.0.0+build.42`). Reject anything else
  // (slashes / backslashes / dots-dots / null bytes / Unicode
  // separators / glob chars) without echoing the input.
  if (!/^[A-Za-z0-9@._+-]+\.js$/.test(filename) || filename.includes('..')) {
    return new Response(`/* invalid vendor filename */`, {
      status: 400,
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    });
  }
  try {
    // Read as raw bytes (no encoding arg). downloadBundle writes the
    // file from the response arrayBuffer (the same primitive the
    // browser's SRI implementation hashes), so the bytes on disk are
    // byte-identical to what jspm.io originally served. Reading with
    // utf8 here would decode-then-re-encode and risk dropping the SRI
    // match if any byte didn't round-trip exactly (e.g. invalid
    // surrogate replacement). Keep the I/O binary end-to-end.
    const body = await readFile(join(pinDir(appDir), filename));
    // Buffered (bytes) body, so opt into the conditional-GET funnel, which
    // hashes the bytes into a weak ETag (for downstream caches that strip the
    // `immutable` directive) and honors If-None-Match -> 304. A WEAK validator
    // is correct here because compression may re-encode the bytes per request
    // (RFC 7232 2.3.3); the funnel is the single source for that. See
    // conditional-get.js.
    return new Response(body, {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': dev ? 'no-cache' : 'public, max-age=31536000, immutable',
        [BUFFERED_MARKER]: '1',
      },
    });
  } catch {
    // Don't echo `filename` (already validated by the regex above so
    // safe to echo, but keep the body fixed for grep-ability and to
    // discourage anyone copying this pattern with untrusted input).
    return new Response(`/* vendor bundle not found. Run webjs vendor pin --download to (re-)download. */`, {
      status: 404,
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    });
  }
}
