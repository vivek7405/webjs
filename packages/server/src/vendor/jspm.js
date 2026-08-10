import { BUILTIN, FRAMEWORK_SERVER_ONLY, extractPackageName } from './scanner.js';
import { getPackageVersion } from './manifest.js';
import { normalizeProvider, SUPPORTED_PROVIDERS } from './providers.js';

/**
 * In-memory cache of resolved importmap fragments from api.jspm.io.
 * Two kinds of key share this map:
 *   - The UNIFIED key (`<provider>::unified::<sorted installs joined>`)
 *     caches the whole-set resolve produced by one `generate` call, the
 *     default path (issue #446).
 *   - The PER-INSTALL key (`<provider>::<install>`) caches a single
 *     install's isolated resolve, used only on the fallback path when the
 *     unified call fails because some install is unresolvable.
 * Per-process; cleared by `clearVendorCache` on file-watcher rebuild
 * so new versions get re-resolved.
 *
 * @type {Map<string, Record<string, string>>}
 */
const jspmCache = new Map();
// Set by jspmResolveOne whenever a LIVE resolution attempt fails (network
// error, timeout, or a non-ok jspm response). resolveVendorImports resets it
// before a scan and reads it after, so a caller can tell "resolved cleanly"
// from "served a partial map because the CDN was unreachable" and avoid
// memoizing the failure as done. Safe under the single-flighted ensureReady
// (one live resolve at a time); the vendor CLI does not run alongside a server.
let lastLiveResolveFailed = false;

export function isLastLiveResolveFailed() {
  return lastLiveResolveFailed;
}

export function setLastLiveResolveFailed(val) {
  lastLiveResolveFailed = val;
}

const JSPM_GENERATE_ENDPOINT = 'https://api.jspm.io/generate';
const JSPM_GENERATE_TIMEOUT_MS = 10_000;

/**
 * Make ONE api.jspm.io/generate POST for a list of installs and return a
 * structured result. The single point that talks to the network; both the
 * unified path and the per-install fallback funnel through it.
 *
 * jspm fails the WHOLE batch (401) when ANY one install is unresolvable, so
 * a multi-install POST is all-or-nothing: either the entire coherent graph
 * comes back, or nothing does. `jspmGenerate` uses that property to decide
 * when to fall back to per-install isolation.
 *
 * @param {Array<string>} installs  e.g. ['dayjs@1.11.13', '@codemirror/lint@6.9.6']
 * @param {string} provider  one of SUPPORTED_PROVIDERS
 * @param {number} [timeoutMs]  defaults to the SERVER budget; a CLI caller
 *   passes the longer one, since it is a command someone is waiting on rather
 *   than a request being held open.
 * @returns {Promise<JspmCallResult>}
 */
async function jspmCall(installs, provider, timeoutMs = JSPM_GENERATE_TIMEOUT_MS) {
  const label = installs.length === 1 ? `'${installs[0]}'` : `${installs.length} packages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(JSPM_GENERATE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        install: installs,
        // flattenScope:true merges transitive ESM deps into the flat
        // `imports` map instead of a separate `scopes` field. Webjs only
        // consumes `imports`, so without this any package with an
        // unbundled ESM transitive (e.g. react-dom imports `scheduler`,
        // @codemirror/lint imports @codemirror/state) would break in the
        // browser with an unresolved-bare-specifier error. With the
        // WHOLE-set call (issue #446) the flattened transitives are now
        // ALSO mutually consistent: one `@codemirror/view` URL shared by
        // the direct import and lint's transitive need, instead of two
        // skewed versions from independent per-package calls.
        flattenScope: true,
        env: ['browser', 'production', 'module'],
        provider: normalizeProvider(provider),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // jspm.io returns the error reason in the body with a 401 (its
      // quirk: 401 is what it sends for unresolvable installs, not auth
      // failures). Surface it so the user sees WHAT failed and why.
      let detail = '';
      try {
        const body = await response.json();
        if (body && typeof body.error === 'string') detail = `: ${body.error}`;
      } catch { /* non-JSON body */ }
      console.error(
        `[webjs] could not vendor ${label} via ${provider} (status ${response.status})${detail}`,
      );
      // A 5xx/429 is a transient jspm problem worth retrying. A 401/4xx
      // means at least one install is genuinely unresolvable (jspm uses
      // 401 for that): a private / workspace / server-only package (e.g.
      // @webjsdev/server, pg) the browser never fetches
      // anyway. Permanent failures must NOT block readiness.
      const transient = response.status >= 500 || response.status === 429;
      return { ok: false, imports: {}, transient };
    }
    const result = await response.json();
    const imports = (result && result.map && result.map.imports) || {};
    return { ok: true, imports, transient: false };
  } catch (e) {
    const msg = e && e.name === 'AbortError'
      ? `timed out after ${timeoutMs}ms`
      : `${e && e.message}`;
    console.error(`[webjs] could not vendor ${label} via ${provider}: ${msg}`);
    return { ok: false, imports: {}, transient: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a SINGLE install in isolation, cached per install + provider.
 * This is the FALLBACK path: it only runs when the unified whole-set call
 * fails because some install is unresolvable. Isolating each install means
 * one bad dep (a 401) drops out on its own instead of collapsing the map
 * for its legitimate neighbours. The cross-package coherence the unified
 * call provides is lost for this degraded set, which is acceptable: it is
 * exactly the pre-#446 behaviour, reached only when the app already has an
 * unresolvable dep.
 *
 * Sets `lastLiveResolveFailed` on a TRANSIENT failure (so the caller
 * retries), never on a permanent 401 (tolerated).
 *
 * @param {string} install  e.g. 'dayjs@1.11.13' or 'dayjs@1.11.13/plugin/utc'
 * @param {string} [provider]  one of SUPPORTED_PROVIDERS; defaults to 'jspm'
 * @returns {Promise<Record<string, string>>}
 */
async function jspmResolveOne(install, provider = 'jspm', timeoutMs) {
  const { ok, imports, transient } = await jspmProbeOne(install, provider, timeoutMs);
  // Preserve the public contract: an empty map on any failure, and the
  // module-global retry flag set ONLY on a transient one (a permanent 401
  // for an unresolvable private/server-only dep is tolerated).
  if (!ok && transient) lastLiveResolveFailed = true;
  return imports;
}

/**
 * Probe a SINGLE install and return the FULL classification, not just the
 * imports. Unlike `jspmResolveOne` this does NOT collapse a transient
 * failure into the same empty map a permanent one yields, and does NOT
 * touch `lastLiveResolveFailed`: the caller (the 401 fallback in
 * `jspmGenerate`) needs to tell "genuinely unresolvable, safe to drop"
 * (`ok:false, transient:false`) from "a network blip mid-probe, do NOT
 * drop" (`ok:false, transient:true`), and owns the retry flag itself.
 *
 * Cached per install + provider; a successful probe's `{imports}` is the
 * same value `jspmResolveOne` returns, so the two share the cache and the
 * later unified re-run reuses it.
 *
 * @param {string} install
 * @param {string} provider
 * @returns {Promise<JspmCallResult>}
 */
function jspmProbeOne(install, provider, timeoutMs) {
  const cacheKey = `${provider}::probe::${install}`;
  const existing = jspmCache.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const result = await jspmCall([install], provider, timeoutMs);
    // Do not cache a failure: a transient one must be re-attempted on the
    // next resolve, and a permanent one is cheap to re-confirm and must not
    // pin a stale "unresolvable" verdict across a dependency change.
    if (!result.ok) jspmCache.delete(cacheKey);
    return result;
  })();

  jspmCache.set(cacheKey, promise);
  return promise;
}

/**
 * Last-write-wins merge of per-install import fragments. Subpath installs
 * never collide (their keys include the subpath); a shared base package
 * resolves to the same root URL across fragments, so the merge is stable.
 *
 * @param {Array<Record<string, string>>} fragments
 * @returns {Record<string, string>}
 */
function mergePerInstall(fragments) {
  const merged = {};
  for (const fragment of fragments) Object.assign(merged, fragment);
  return merged;
}

/**
 * Resolve a list of `pkg@version` installs to importmap entries.
 *
 * Issue #446: the WHOLE set is resolved in ONE api.jspm.io/generate call
 * (a single `install[]` array) so jspm computes one mutually-consistent
 * dependency graph. A directly-imported package and a transitive that
 * needs a newer version of the same package now agree on one URL, instead
 * of the old per-package-in-isolation merge that pinned the direct dep to
 * its local version while the transitive floated to jspm-latest, producing
 * a missing-export crash in the browser.
 *
 * The per-package-isolation property is PRESERVED as a fallback only: if
 * the unified call fails because some install is unresolvable (a 401 for a
 * private / server-only dep), one bad install must not collapse the map
 * for the rest. So:
 *   1. Try the unified call. On success, return its coherent graph.
 *   2. On a PERMANENT failure (401/4xx), probe each install in isolation
 *      to learn which ones resolve, then RE-RUN the unified call over only
 *      the resolvable subset so the survivors stay mutually consistent.
 *      Only installs whose probe fails PERMANENTLY drop out (genuinely
 *      unresolvable, the browser never fetched them anyway); if any probe
 *      fails TRANSIENTLY, no one is dropped and the resolve is flagged for
 *      retry, so a network blip mid-probe cannot evict a good package. If
 *      the re-run itself fails, fall back to the merged per-install
 *      fragments so the app is no worse off than pre-#446.
 *   3. On a TRANSIENT failure (network / timeout / 5xx / 429), set the
 *      retry flag and serve whatever the per-install probe produced.
 *
 * The unified result is cached per sorted-install-set + provider; the
 * per-install fallback reuses the per-install cache entries.
 *
 * @param {Array<string>} installs  e.g. ['dayjs@1.11.13', 'clsx@2.1.1']
 * @param {string} [provider]  one of SUPPORTED_PROVIDERS; defaults to 'jspm'
 * @param {number} [timeoutMs]  per-call budget. Defaults to the SERVER one,
 *   because this runs on a cold first request as well as from the CLI; the two
 *   pin commands pass PIN_BUNDLE_TIMEOUT_MS instead. importmap-rails only ever
 *   resolves from the CLI, so its flat 60s has no request path to slow down.
 * @returns {Promise<Record<string, string>>}
 */
export async function jspmGenerate(installs, provider = 'jspm', timeoutMs) {
  if (installs.length === 0) return {};

  // A single install has no cross-package graph to reconcile, so the
  // isolated path IS the coherent path; reuse the per-install cache.
  if (installs.length === 1) return jspmResolveOne(installs[0], provider, timeoutMs);

  // Stable key regardless of scan order so the same dep set hits cache.
  const unifiedKey = `${provider}::unified::${[...installs].sort().join('\n')}`;
  const cached = jspmCache.get(unifiedKey);
  if (cached) return cached;

  const promise = (async () => {
    const unified = await jspmCall(installs, provider, timeoutMs);
    if (unified.ok) return unified.imports;

    // The unified call failed. Drop the cached failure so a later retry
    // re-attempts; the per-install fallback owns the retry flag.
    jspmCache.delete(unifiedKey);

    if (unified.transient) {
      // Network / 5xx: nothing resolved coherently. Fall back to merged
      // per-install fragments (each may still be cached / reachable) so we
      // serve whatever we can, and flag the transient failure for retry.
      lastLiveResolveFailed = true;
      return mergePerInstall(await Promise.all(installs.map(i => jspmResolveOne(i, provider, timeoutMs))));
    }

    // Permanent failure: at least one install is unresolvable. Probe each
    // in isolation to learn which ones jspm can resolve, then re-run the
    // unified call over only those so the survivors form one consistent
    // graph (restores #446 coherence for the resolvable subset).
    const probes = await Promise.all(installs.map(i => jspmProbeOne(i, provider, timeoutMs)));

    // A GOOD package whose isolated probe failed TRANSIENTLY (a network blip
    // mid-probe) must NOT be classified as unresolvable and dropped. Only a
    // PERMANENT probe failure (401/404) means the install is genuinely
    // unresolvable. If any probe failed transiently, we cannot safely decide
    // the resolvable set this pass, so flag the whole resolve transient-
    // failed and serve the merged fragments WITHOUT dropping anyone; the next
    // ensureReady retry re-resolves once the blip clears. Conflating the two
    // here is exactly the bug this guard prevents.
    const transientProbe = probes.some(p => !p.ok && p.transient);
    if (transientProbe) {
      lastLiveResolveFailed = true;
      return mergePerInstall(probes.map(p => p.imports));
    }

    // From here every failed probe is PERMANENT, so dropping it is safe.
    const resolvable = installs.filter((_, idx) => probes[idx].ok);

    if (resolvable.length === installs.length) {
      // Every install resolved alone but the batch 401'd: a genuine
      // cross-package CONFLICT jspm could not satisfy as one graph (rare).
      // The coherent graph is unavailable, so serve the merged fragments
      // (pre-#446 behaviour) rather than nothing. NOTE: this degraded path
      // can REINTRODUCE the #446 skew, because last-write-wins on a shared
      // transitive across independent fragments is exactly the merge the
      // unified call exists to avoid. It is a deliberate degrade-not-crash
      // fallback for an unsatisfiable graph: no coherent graph exists, so a
      // possibly-skewed map beats no map. The common conflicting-deps case
      // (one shared transitive needing a newer version, issue #446's repro)
      // IS satisfiable and resolves coherently on the unified path above;
      // only a genuinely unsatisfiable set reaches here.
      return mergePerInstall(probes.map(p => p.imports));
    }
    if (resolvable.length === 0) return {};
    if (resolvable.length === 1) return jspmResolveOne(resolvable[0], provider, timeoutMs);

    // Re-run unified over the resolvable subset. If even that fails (a
    // conflict among the survivors), fall back to their merged fragments.
    const retry = await jspmCall(resolvable, provider, timeoutMs);
    if (retry.ok) return retry.imports;
    return mergePerInstall(resolvable.map(i => probes[installs.indexOf(i)].imports));
  })();

  jspmCache.set(unifiedKey, promise);
  return promise;
}

/**
 * Build importmap entries for discovered bare imports. For each scanned
 * package, resolve its installed version from node_modules, then ask
 * api.jspm.io/generate for the full importmap fragment.
 *
 * Async because the Generator API call is networked. Called from
 * `resolveVendorImports` on the first request (and after a rebuild),
 * inside `ensureReady`; never at boot, and not on every request.
 *
 * @param {Set<string>} bareImports  from scanBareImports()
 * @param {string} appDir
 * @returns {Promise<Record<string, string>>}
 */
export async function vendorImportMapEntries(bareImports, appDir) {
  const installs = [];
  for (const spec of bareImports) {
    if (BUILTIN.has(spec)) continue;
    const pkg = extractPackageName(spec);
    if (!pkg || BUILTIN.has(pkg) || FRAMEWORK_SERVER_ONLY.has(pkg)) continue;
    const version = getPackageVersion(pkg, appDir);
    if (!version) continue;
    // Splice the version into the specifier: 'dayjs/plugin/utc' with
    // version 1.11.13 becomes 'dayjs@1.11.13/plugin/utc'. jspm.io's
    // Generator API resolves subpaths individually via the package's
    // `exports` field. Root imports stay as `<pkg>@<version>` with no
    // trailing subpath.
    const subpath = spec.slice(pkg.length);
    installs.push(`${pkg}@${version}${subpath}`);
  }
  return jspmGenerate(installs);
}

/**
 * Clear in-memory JSPM generator cache.
 */
export function clearJspmCache() {
  jspmCache.clear();
}

