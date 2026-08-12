/**
 * Resolve bare npm imports to browser-loadable URLs via jspm.io.
 *
 * WebJs follows the Rails 7 + importmap-rails posture exactly. When user
 * code imports a bare specifier (e.g. `import dayjs from 'dayjs'`), the
 * browser can't resolve it natively. The framework's job is to emit an
 * importmap that translates each bare specifier to a real URL.
 *
 * The URL points at **jspm.io**, the same CDN Rails uses by default:
 *
 *   importmap: { "dayjs": "https://ga.jspm.io/npm:dayjs@1.11.13/index.js" }
 *
 * The browser fetches the bundle directly from jspm.io. The WebJs server
 * does not proxy, cache, or bundle anything. jspm.io has done the work
 * server-side (CJS-to-ESM conversion, transitive bundling, browser
 * polyfills).
 *
 * Why jspm.io: institutional backing (37signals, CacheFly for CDN
 * infrastructure, Rails ecosystem dependency creates downstream pressure
 * for continued operation), status page at status.jspm.io, standards-
 * first maintenance by Guy Bedford (TC39 contributor on ESM and import
 * maps). Years of uptime track record.
 *
 * URL resolution: jspm.io's bare-package URL (without entry path)
 * returns metadata, not JavaScript. The correct entry file (e.g.,
 * `/dayjs.min.js`, `/index.js`) varies per package and must be
 * resolved from the JSPM Generator API. The Generator is called once
 * on the first request for the full set of bare imports; results are
 * cached in-memory for the process lifetime.
 *
 * Connectivity: the Generator API call happens on the first request,
 * inside `ensureReady` via `setVendorEntries`, never at boot. If
 * api.jspm.io is unreachable, the
 * importmap will be missing vendor entries and the browser will
 * report "unresolved bare specifier" errors. The server itself still
 * boots and serves user routes; only vendor-importing pages break
 * until api.jspm.io is reachable again. Failure is loud and clear.
 *
 * No local bundler. No disk cache. No memory cache of bundle bytes.
 * Matches Rails' "no build" posture literally.
 */

import { readFile, readdir, writeFile, mkdir, unlink, stat, rename } from 'node:fs/promises';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, basename, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { digestBase64 } from './crypto-utils.js';
import { BUFFERED_MARKER } from './conditional-get.js';
import { buildModuleGraph, reachableBareSpecifiers } from './module-graph.js';
import { browserEntryFiles } from './browser-entries.js';
import { scanComponents } from './component-scanner.js';
import { buildRouteTable } from './router.js';

/**
 * Set of package names whose importmap entries are populated by the
 * framework, not by the vendor scanner. The scanner skips these to
 * keep `@webjsdev/core` (and any future framework-internal package)
 * off the jspm.io path: their bytes are served by the dev server's
 * dedicated `/__webjs/core/*` route, and `buildCoreEntries()` in
 * `importmap.js` derives one importmap line per exported subpath
 * directly from the package's own `exports` field.
 *
 * The `'@webjsdev/core/'` prefix entry is here so that `extractPackageName`
 * returning the bare name is enough to recognise core-subpath imports
 * (`@webjsdev/core/directives`, `@webjsdev/core/task`, …) and skip
 * them; the prefix form catches anything whose extractPackageName
 * returns null but whose specifier starts with the prefix. Same
 * mechanism, no special casing per subpath.
 */
const BUILTIN = new Set(['@webjsdev/core', '@webjsdev/core/']);

/**
 * Server-only framework packages that must NEVER be vendored to the browser.
 * Unlike `@webjsdev/core` (browser-bound, served locally via `/__webjs/core/*`),
 * these are pure server packages: the CLI, the SSR runtime, the MCP server. A
 * stray browser-graph scan
 * that surfaces one of them must not push it onto the jspm path (#713). Matched
 * on the extracted package name, so subpaths (`@webjsdev/cli/bin/webjs.js`) are
 * covered. `@webjsdev/ui` is intentionally absent: its components ARE
 * browser-bound, so it stays vendorable.
 */
const FRAMEWORK_SERVER_ONLY = new Set(['@webjsdev/cli', '@webjsdev/server', '@webjsdev/mcp']);

/**
 * Bare npm specifiers that could reach the browser, filtered of the framework
 * packages that must never be vendored.
 *
 * The scan is ROOTED IN THE MODULE GRAPH, not in a filesystem walk. Only files
 * reachable from a browser-bound entry (page / layout / error / loading /
 * not-found / forbidden / unauthorized / instrumentation-client / any
 * component) contribute, which is the same authorization gate the dev server
 * uses to decide what it will serve at all. A file nothing imports contributes
 * nothing, so a build script under `scripts/`, a tooling config, a test helper
 * and an unreferenced module all drop out by reachability rather than by name
 * (there is no exclusion LIST any more, which is the point: the old one was
 * open-ended and went stale).
 *
 * Excluded on top of unreachability:
 *   - `.server.{js,ts,mjs,mts}` files. They are REACHED (the browser fetches an
 *     RPC or throw-at-load stub at that URL) but their source never ships, so
 *     their bare imports must not enter the importmap.
 *   - `@webjsdev/core` and its subpaths (BUILTIN, served locally).
 *   - `@webjsdev/cli` / `@webjsdev/server` / `@webjsdev/mcp` (#713).
 *   - `import type` statements and any `import` written inside a comment,
 *     string, template literal or regex body. Both come free from the module
 *     graph's blanked-mask scanner (#753 / #805); this function no longer has
 *     a scanner of its own.
 *
 * This is the OUT-OF-PROCESS entry point (`pinAll`, `webjs doctor`). It builds
 * its own graph, route table and component scan, roughly 70-200ms on the
 * in-repo apps, and applies NO elision pruning, so the result is a SUPERSET of
 * what the running server serves. That superset relation is what lets
 * `prunePinToReachable` intersect a committed pin down to the runtime answer
 * (#197). The dev server calls `reachedBareImports` instead, with the graph it
 * already has and its elision skip set.
 *
 * @param {string} appDir
 * @returns {Promise<Set<string>>}
 */
export async function scanBareImports(appDir) {
  let graph, components, routeTable;
  try {
    graph = await buildModuleGraph(appDir);
    components = await scanComponents(appDir);
    routeTable = await buildRouteTable(appDir);
  } catch {
    // An app the analysis cannot process yields no vendor specifiers rather
    // than a throw, matching how check.js and elision-report.js degrade. The
    // dev server surfaces the real problem.
    return new Set();
  }
  return reachedBareImports(graph, [...browserEntryFiles(routeTable, components)], appDir);
}

/**
 * The in-process form: the caller already has a module graph, the entry set,
 * and (on the runtime path) the elision skip set. Used by the dev server so a
 * vendor resolve does not rebuild analysis it just built.
 *
 * @param {import('./module-graph.js').ModuleGraph} graph
 * @param {string[]} entryFiles
 * @param {string} appDir
 * @param {Set<string>} [skip]  elided / inert / import-only modules
 * @returns {Set<string>}
 */
export function reachedBareImports(graph, entryFiles, appDir, skip) {
  const found = reachableBareSpecifiers(graph, entryFiles, appDir, skip);
  for (const b of BUILTIN) found.delete(b);
  // Drop core subpaths (served locally via `/__webjs/core/*`) and server-only
  // framework packages (#713) so neither reaches the importmap / jspm path.
  for (const spec of found) {
    const p = extractPackageName(spec);
    if (p && (BUILTIN.has(p) || FRAMEWORK_SERVER_ONLY.has(p))) found.delete(spec);
  }
  return found;
}

/**
 * Extract the package name from a bare specifier.
 * `'dayjs'`             → `'dayjs'`
 * `'dayjs/locale/en'`   → `'dayjs'`
 * `'@tanstack/query'`   → `'@tanstack/query'`
 * `'@tanstack/query/x'` → `'@tanstack/query'`
 * `'./foo'`, `'../bar'`, `'/baz'` → `null` (relative/absolute)
 * `'#components/x.ts'`, `'#lib/db'` → `null` (`#` path alias, #555: resolves to
 *   a LOCAL file via `package.json` "imports", never an npm package, so it must
 *   not be sent to the vendor resolver, #623)
 *
 * @param {string} spec
 * @returns {string | null}
 */
export function extractPackageName(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('__') || spec.startsWith('#')) return null;
  if (/^[a-z]+:/.test(spec)) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return spec.split('/')[0];
}

/**
 * Resolve a package's installed directory on disk, handling both direct
 * installation and npm workspace hoisting.
 *
 * @param {string} pkgName
 * @param {string} appDir
 * @returns {string | null}
 */
function resolvePackageDir(pkgName, appDir) {
  try {
    const require = createRequire(join(appDir, 'package.json'));
    const entry = require.resolve(pkgName);
    const parts = entry.split(sep);
    const nmIdx = parts.lastIndexOf('node_modules');
    if (nmIdx < 0) {
      let dir = dirname(entry);
      for (let i = 0; i < 8; i++) {
        if (existsSync(join(dir, 'package.json'))) return realpathSync(dir);
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return null;
    }
    const segmentsAfterNm = pkgName.startsWith('@') ? 2 : 1;
    const root = parts.slice(0, nmIdx + 1 + segmentsAfterNm).join(sep);
    return realpathSync(root);
  } catch {
    return null;
  }
}

/**
 * Read the installed version of a package from `node_modules/<pkg>/
 * package.json`. Handles workspace hoisting and packages that lock
 * down `./package.json` in their exports field.
 *
 * @param {string} pkgName
 * @param {string} appDir
 * @returns {string | null}
 */
export function getPackageVersion(pkgName, appDir) {
  const real = resolvePackageDir(pkgName, appDir);
  if (!real) return null;
  try {
    const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Read the installed package's declared `dependencies` + `peerDependencies`
 * from its `package.json`, hoist-aware (same resolution as `getPackageVersion`,
 * so a monorepo-hoisted dep resolves from the workspace root). Returns null
 * when the package is not installed / unreadable, which the importmap-coherence
 * check (#450) treats as "could not verify" rather than a conflict.
 *
 * This is the "already-resolved metadata, no network" source the coherence
 * check prefers: the package is on disk because the importmap pinned it, so its
 * manifest is a local read.
 *
 * @param {string} pkgName
 * @param {string} appDir
 * @returns {{ dependencies: Record<string,string>, peerDependencies: Record<string,string> } | null}
 */
export function getPackageManifest(pkgName, appDir) {
  const real = resolvePackageDir(pkgName, appDir);
  if (!real) return null;
  try {
    const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    return {
      dependencies: pkg.dependencies || {},
      peerDependencies: pkg.peerDependencies || {},
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JSPM Generator API client
// ---------------------------------------------------------------------------

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

const JSPM_GENERATE_ENDPOINT = 'https://api.jspm.io/generate';
const JSPM_GENERATE_TIMEOUT_MS = 10_000;
// Bounds a single bundle GET during the SERVER's warmup live-integrity pass
// (`fetchLiveIntegrity`). Short on purpose: that pass gates readiness, so a
// stalled CDN must not hold the first request, and it is additionally capped
// by INTEGRITY_TOTAL_BUDGET_MS across all URLs.
const INTEGRITY_FETCH_TIMEOUT_MS = 10_000;

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
const PIN_BUNDLE_TIMEOUT_MS = 60_000;

/**
 * Provider names accepted by `webjs vendor pin --from <provider>`.
 * Default `jspm` resolves to jspm.io. Same set Rails's importmap-rails
 * accepts (`packager.rb:normalize_provider`).
 *
 * jspm.io's Generator API itself supports multiple providers via the
 * `provider` field in the request body. We surface the same choice as
 * a CLI flag.
 *
 * @type {Set<string>}
 */
export const SUPPORTED_PROVIDERS = new Set(['jspm', 'jsdelivr', 'unpkg', 'skypack']);

/**
 * Normalize the user-facing provider name to what the jspm.io API
 * expects in its `provider` field. Mirrors importmap-rails's
 * `normalize_provider`: `jspm` is shorthand for `jspm.io`; the rest
 * pass through verbatim.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeProvider(name) {
  return name === 'jspm' ? 'jspm.io' : name;
}

/**
 * Outcome of one api.jspm.io/generate POST.
 * @typedef {Object} JspmCallResult
 * @property {boolean} ok        true when jspm returned a 2xx with a usable map
 * @property {Record<string, string>} imports  the resolved imports (empty on failure)
 * @property {boolean} transient true when the failure is worth retrying
 *           (network / timeout / 5xx / 429), false for a permanent 4xx
 *           (jspm uses 401 for "this install is unresolvable")
 */

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
 * Clear the resolved-importmap cache. Called on file-watcher rebuild
 * so newly-added bare imports trigger a fresh api.jspm.io/generate
 * call on the next request to populate the in-memory cache.
 */
export function clearVendorCache() {
  jspmCache.clear();
  liveIntegrityCache.clear();
  // Deliberately does NOT touch `lastLiveResolveFailed`, which looks like an
  // omission and is not. `resolveVendorImports` is the flag's only reader and
  // it resets the flag on entry, while the pinned short-circuit above that
  // returns `ok: true` outright, so a value left behind by an earlier
  // `pinAll` or `vendorImportMapEntries` can never be observed. Clearing it
  // here would be a change nothing could write a failing test for (#1150).
}

/**
 * Recover `{ pkg, version, subpath }` for a resolved import spec that was
 * NOT in the directly-scanned set, i.e. a flattened transitive the unified
 * resolve added (issue #446). The bare package name and subpath come from
 * the spec; the version is read out of the resolved CDN URL by locating
 * `<bare>@<version>` in it (same logic `listPinned` uses, which handles
 * every supported provider's URL shape). Returns null when the version
 * can't be parsed, in which case the caller pins the entry by URL anyway
 * but cannot derive a `--download` filename for it.
 *
 * @param {string} spec  e.g. '@codemirror/state' or 'dayjs/plugin/utc'
 * @param {string} url   the resolved CDN URL for that spec
 * @returns {{ pkg: string, version: string, subpath: string } | null}
 */
function derivePinParts(spec, url) {
  const pkg = extractPackageName(spec);
  if (!pkg) return null;
  const subpath = spec.slice(pkg.length);
  const escapedBare = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[^a-zA-Z0-9_.-])${escapedBare}@([^/]+)`).exec(url);
  if (!match) return null;
  return { pkg, version: match[1], subpath };
}

// ---------------------------------------------------------------------------
// File-based pin (.webjs/vendor/importmap.json, optional --download bundles)
// ---------------------------------------------------------------------------

const PIN_DIR_REL = ['.webjs', 'vendor'];
const PIN_FILE = 'importmap.json';

/** Compute the absolute path of the pin directory for an app. */
function pinDir(appDir) {
  return join(appDir, ...PIN_DIR_REL);
}

/** Compute the absolute path of the importmap config file for an app. */
function pinFilePath(appDir) {
  return join(pinDir(appDir), PIN_FILE);
}

/**
 * The three-line `.gitignore` pattern that ignores the transient
 * `.webjs` caches at any depth while re-including the committed
 * `.webjs/vendor/` pin output. This mirrors the scaffold template
 * (`packages/cli/templates/gitignore`, shipped dotless so npm cannot
 * strip it, renamed to `.gitignore` on copy) and the `vendor-gitignore`
 * check in `doctor.js` verbatim, so a self-healed `.gitignore`
 * ends up byte-identical to a freshly scaffolded one.
 */
const VENDOR_GITIGNORE_LINES = [
  '**/.webjs/*',
  '!**/.webjs/vendor/',
  '!**/.webjs/vendor/**',
];

/**
 * Probe whether `appDir`'s `.gitignore` would swallow the vendor pin
 * output, via `git check-ignore`. Best-effort: returns false when the
 * directory is not a git repo, git is absent, or the spawn fails.
 *
 * The inherited GIT_* env vars are stripped so `cwd` is the sole
 * authority on which repo + `.gitignore` stack is consulted. Git
 * exports GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_PREFIX into
 * hook processes (a pre-commit hook from a linked worktree exports
 * GIT_WORK_TREE), and those OVERRIDE cwd-based discovery; without the
 * strip the probe would consult the outer repo instead of `appDir`.
 * Same reasoning as the `vendor-gitignore` doctor check.
 *
 * @param {string} appDir
 * @returns {boolean} true when `.webjs/vendor/importmap.json` is ignored
 */
function vendorPinIsIgnored(appDir) {
  try {
    const {
      GIT_DIR: _gd, GIT_WORK_TREE: _gwt, GIT_INDEX_FILE: _gif, GIT_PREFIX: _gp,
      ...gitEnv
    } = process.env;
    const probe = `.webjs/vendor/${PIN_FILE}`;
    // `git check-ignore -q` exits 0 when ignored, 1 when not ignored,
    // 128 on error (not a git repo, etc.). Treat anything but 0 as
    // "not ignored" so a non-git project never gets its .gitignore
    // touched.
    const result = spawnSync('git', ['check-ignore', '-q', probe], {
      cwd: appDir,
      stdio: 'pipe',
      env: gitEnv,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Make the `webjs vendor pin` output committable, idempotently.
 *
 * Vendoring is an OPTIONAL opt-in: the no-build default resolves bare
 * specifiers at runtime via jspm.io and needs nothing committed. But a
 * user who runs `webjs vendor pin` deliberately creates pins they want
 * in source control, and a `.gitignore` that excludes `.webjs/` (the
 * older scaffold pattern, or one an editor/agent "simplified") silently
 * swallows that output. Fresh scaffolds already carry the vendor
 * exception (a glob exclusion plus a re-include negation), so for them
 * this is a no-op.
 *
 * Behaviour (only ever called from the opt-in `vendor pin` path):
 *   - The pin output is NOT ignored (the common, already-correct case):
 *     return `{ ignored: false, patched: false }`. Nothing is written.
 *   - The pin output IS ignored AND a `.gitignore` exists: heal it (see
 *     below), then re-probe. If the pin is committable afterwards return
 *     `{ ignored: true, patched: true, gitignorePath }`; if a broader
 *     unrelated rule still swallows it (e.g. a root `*.json`), the heal
 *     cannot help, so revert the edit and return `patched: false` so the
 *     caller prints a notice rather than claiming a fix that did not take.
 *   - The pin output IS ignored but there is NO `.gitignore` to patch
 *     (e.g. the ignore comes from a parent repo's `.gitignore`, or from
 *     `.git/info/exclude`): leave the tree untouched and return
 *     `{ ignored: true, patched: false, gitignorePath: null }` so the
 *     caller can print a notice instead of writing a file the user did
 *     not create.
 *
 * Healing has two parts, because a plain append is NOT enough. A bare
 * directory exclusion (`.webjs/`, `/.webjs/`, `.webjs`, with or without a
 * leading glob) excludes the directory itself, and git CANNOT re-include
 * a child of an excluded directory, so any later negation is silently
 * dead. So: (1) rewrite each such line IN PLACE to the glob form
 * (`**` + `/.webjs/*`), which ignores the directory's CONTENTS at any
 * depth while leaving the directory re-includable; (2) append whichever
 * of the three exception lines are still missing. The heal is idempotent:
 * a re-run finds the pin already committable and short-circuits.
 *
 * @param {string} appDir
 * @returns {Promise<{ ignored: boolean, patched: boolean, gitignorePath: string | null }>}
 */
export async function ensureVendorCommittable(appDir) {
  if (!vendorPinIsIgnored(appDir)) {
    return { ignored: false, patched: false, gitignorePath: null };
  }
  const gitignorePath = join(appDir, '.gitignore');
  let original;
  try {
    original = await readFile(gitignorePath, 'utf8');
  } catch {
    // No app-level .gitignore to patch. The ignore is coming from a
    // parent repo or from .git/info/exclude; do not fabricate a
    // .gitignore the user never had. Let the caller print a notice.
    return { ignored: true, patched: false, gitignorePath: null };
  }

  // The exclusion glob, assembled so the literal `*` + `/` sequence never
  // appears in this file's source comments above.
  const exclude = VENDOR_GITIGNORE_LINES[0]; // **/.webjs/*

  // Preserve the file's line ending so a CRLF .gitignore stays all-CRLF
  // (and an LF one all-LF). Splitting on bare `\n` keeps each existing
  // line's trailing `\r`; the lines we WRITE (the rewritten exclusion and
  // the appended block) must use the same ending or the file goes mixed.
  // A file with any CRLF is treated as CRLF; otherwise LF.
  const eol = /\r\n/.test(original) ? '\r\n' : '\n';

  // 1. Rewrite any bare `.webjs` DIRECTORY exclusion to the glob form. A
  //    directory exclusion blocks all child negations, so it must become
  //    `**/.webjs/*` (ignore contents, keep the dir re-includable).
  const lines = original.split('\n');
  let rewroteDir = false;
  const rewritten = lines.map((line) => {
    // Trim CR too, so a CRLF file's `.webjs/\r` still matches.
    const t = line.replace(/\r$/, '').trim();
    // Match the bare-directory shapes only (no `/*` suffix, not already a
    // negation): `.webjs`, `.webjs/`, `/.webjs`, `/.webjs/`, `**/.webjs`,
    // `**/.webjs/`. These all exclude the directory itself. Emit the
    // replacement with the file's own ending if the original line carried
    // one (every line but a no-trailing-newline last line does).
    if (/^(\*\*\/|\/)?\.webjs\/?$/.test(t)) {
      rewroteDir = true;
      return line.endsWith('\r') ? exclude + '\r' : exclude;
    }
    return line;
  });

  // 2. Append whichever exception lines are still missing.
  const present = new Set(rewritten.map((l) => l.replace(/\r$/, '').trim()));
  const missing = VENDOR_GITIGNORE_LINES.filter((l) => !present.has(l));

  let next = rewritten.join('\n');
  if (missing.length > 0) {
    const block =
      [
        '# webjs: keep the committed vendor pin (`webjs vendor pin`) out of',
        '# the `.webjs` cache exclusion so the pinned importmap is committable.',
        ...missing,
      ].join(eol) + eol;
    const sep = next.endsWith('\n') || next === '' ? '' : eol;
    next = next + sep + block;
  }

  if (!rewroteDir && missing.length === 0) {
    // Nothing to change, yet git still ignores the pin: a broader,
    // unrelated rule is the cause and the vendor exception cannot fix it.
    return { ignored: true, patched: false, gitignorePath };
  }

  await writeFile(gitignorePath, next);

  // 3. Re-probe. If a broader unrelated rule still swallows the pin, the
  //    edit did not achieve the goal, so revert it and report not-patched
  //    so the caller prints a notice instead of an inaccurate success.
  if (vendorPinIsIgnored(appDir)) {
    await writeFile(gitignorePath, original);
    return { ignored: true, patched: false, gitignorePath };
  }
  return { ignored: true, patched: true, gitignorePath };
}

/**
 * True when the app commits a vendor pin file (`.webjs/vendor/importmap.json`).
 * A pinned app's importmap is deterministic and cheap to read, so `dev.js`
 * resolves it AT BOOT (no analysis, no network) and publishes the build id
 * immediately, giving the recommended posture a stable id from the first
 * response with zero warmup exposure. An unpinned app returns false and keeps
 * its vendor resolution deferred to the first request.
 *
 * @param {string} appDir
 * @returns {boolean}
 */
export function hasVendorPin(appDir) {
  return existsSync(pinFilePath(appDir));
}

/**
 * Filesystem-safe filename for a downloaded bundle. Encodes the full
 * specifier (which may include a subpath) into a flat filename:
 *
 *   bundleFilenameWithSubpath('dayjs', '1.11.13', '')             returns 'dayjs@1.11.13.js'
 *   bundleFilenameWithSubpath('dayjs', '1.11.13', '/plugin/utc')  returns 'dayjs@1.11.13__plugin__utc.js'
 *   bundleFilenameWithSubpath('@hotwired/turbo', '8.0.0', '')     returns '@hotwired--turbo@8.0.0.js'
 *
 * Scoped names use `--` to encode `/`; subpath separators use `__`.
 * Both are reversible round-trip so unpin / list can parse the
 * package + version + subpath back from the filename.
 */
function bundleFilenameWithSubpath(pkgName, version, subpath) {
  const safeName = pkgName.replace(/\//g, '--');
  const safeSubpath = subpath.replace(/\//g, '__');
  return `${safeName}@${version}${safeSubpath}.js`;
}

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
 * Read the committed pin importmap if one exists. Returns the parsed
 * `{ imports, integrity?, provider? }` shape or null if no pin file.
 * The `integrity` and `provider` fields are optional: pin files
 * written before SRI / multi-CDN support lack them; pin files written
 * by current `webjs vendor pin` include them (provider only when
 * non-default).
 *
 * @param {string} appDir
 * @returns {Promise<{ imports: Record<string, string>, integrity?: Record<string, string>, provider?: string } | null>}
 */
export async function readPinFile(appDir) {
  try {
    const raw = await readFile(pinFilePath(appDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.imports !== 'object' || Array.isArray(parsed.imports)) {
      return null;
    }
    // Validate every imports entry. Drop:
    // - non-string keys/values (numbers, nulls, objects from malformed
    //   hand-edits would otherwise land structurally-invalid entries in
    //   the served importmap and break the browser parser);
    // - keys containing newlines or other control chars (they would
    //   serialize to escape sequences in JSON and confuse downstream
    //   diffing logic);
    // - values whose URL scheme isn't `http(s)://` or a path starting
    //   with `/` (relative to the app's origin). `javascript:` and
    //   `data:` URLs in a malicious pin file would otherwise be
    //   accepted by the browser's importmap parser and let an attacker
    //   ship code via a single-line pin diff. Tightest acceptable
    //   set: matches what `webjs vendor pin` itself produces
    //   (`https://ga.jspm.io/...` or `/__webjs/vendor/...`).
    /** @type {Record<string, string>} */
    const cleanImports = {};
    for (const [k, v] of Object.entries(parsed.imports)) {
      if (typeof k !== 'string' || typeof v !== 'string') continue;
      if (/[\x00-\x1f\x7f]/.test(k)) continue;
      // Require a non-slash byte after the scheme prefix so a
      // hand-edited or tampered pin file cannot smuggle a
      // protocol-relative URL like `//attacker.tld/x.js` past the
      // filter. Browsers resolve `//host/path` against the document
      // origin and would happily fetch attacker-controlled code if
      // the importmap accepted it. The framework itself only writes
      // `https://ga.jspm.io/...` or `/__webjs/vendor/...`, which both
      // satisfy the tighter form.
      if (!/^(?:https?:\/\/[^/]|\/[^/])/.test(v)) continue;
      cleanImports[k] = v;
    }
    if (Object.keys(cleanImports).length === 0) return null;

    /** @type {Record<string, string>} */
    const cleanIntegrity = {};
    if (parsed.integrity && typeof parsed.integrity === 'object' && !Array.isArray(parsed.integrity)) {
      for (const [k, v] of Object.entries(parsed.integrity)) {
        // Integrity values must look like SRI hashes end-to-end
        // (`sha(256|384|512)-<base64>`). Anchor the regex on both
        // ends and constrain the body to the base64 alphabet so a
        // hand-edited or tampered pin file can't slip an attribute
        // injection (e.g. `sha384-x"><script>`) past the prefix
        // check and through to `integrity="..."` emission in ssr.js
        // unescaped.
        if (typeof k === 'string' && typeof v === 'string' && /^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(v)) {
          cleanIntegrity[k] = v;
        }
      }
    }
    /** @type {{ imports: Record<string,string>, integrity?: Record<string,string>, provider?: string }} */
    const out = { imports: cleanImports };
    if (Object.keys(cleanIntegrity).length) out.integrity = cleanIntegrity;
    // Provider is optional in the pin file. Validate against the
    // supported set so a tampered file can't smuggle an arbitrary
    // string into downstream code paths.
    if (typeof parsed.provider === 'string' && SUPPORTED_PROVIDERS.has(parsed.provider)) {
      out.provider = parsed.provider;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Write the pin importmap to `.webjs/vendor/importmap.json`. Ensures
 * the directory exists. Pretty-printed for human-reviewable diffs.
 *
 * When `integrity` is provided and non-empty, it's included alongside
 * `imports` as a sibling key (matching the browser importmap-integrity
 * spec: a flat `{url: 'sha384-...'}` map). Omitted entirely when empty
 * so older WebJs versions read the file as before.
 *
 * `provider` is persisted alongside imports when non-default. It lets
 * `webjs vendor update` know which CDN to re-resolve against, and
 * makes the pin file self-describing for incident response: if jspm.io
 * has an outage you can read the file and know which alternate CDN
 * the deploy targets. Omitted for the default jspm provider so the
 * pin file shape stays stable for the 99% case.
 *
 * @param {string} appDir
 * @param {Record<string, string>} imports
 * @param {Record<string, string>} [integrity]
 * @param {string} [provider]
 */
async function writePinFile(appDir, imports, integrity, provider) {
  await mkdir(pinDir(appDir), { recursive: true });
  /** @type {Record<string, any>} */
  const payload = { imports };
  if (integrity && Object.keys(integrity).length) payload.integrity = integrity;
  if (provider && provider !== 'jspm') payload.provider = provider;
  const body = JSON.stringify(payload, null, 2) + '\n';
  // Atomic write: stage into a sibling tmp file, then rename onto the
  // final path. Rename within the same directory is atomic on POSIX
  // and on Windows since Node 14+, so a crash mid-write can leave the
  // tmp file as garbage but cannot corrupt the live pin file. Without
  // this, a partially-written importmap.json round-trips through
  // readPinFile as null (fail-closed) but still requires the user to
  // notice and rerun pin; the rename keeps the live file intact across
  // every failure mode.
  const finalPath = pinFilePath(appDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, body, 'utf8');
  await rename(tmpPath, finalPath);
}

/**
 * Download a single jspm.io URL and write the body to
 * `.webjs/vendor/<filename>`. Returns `{ bytes, integrity }` on
 * success or null on failure. The integrity hash is computed from the
 * downloaded bytes so it's always consistent with what's on disk.
 *
 * Bounded by PIN_BUNDLE_TIMEOUT_MS. `pinAll(dir, { download: true })`
 * runs this once per resolved URL on a CLI run with no ambient
 * deadline, so a CDN that accepts the connection and then stalls would
 * otherwise hang the pin with nothing to interrupt it (#1150).
 *
 * @param {string} url
 * @param {string} appDir
 * @param {string} filename
 * @returns {Promise<{ bytes: number, integrity: string } | null>}
 */
async function downloadBundle(url, appDir, filename) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIN_BUNDLE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.error(`[webjs] download ${url} returned ${response.status}`);
      return null;
    }
    // Hash raw response bytes, not the UTF-8 decoded string. The
    // browser's SRI implementation hashes the raw body bytes; if we
    // hashed `.text()` here we'd risk encoding round-trip drift on
    // any byte sequence the decode-then-re-encode pipeline doesn't
    // round-trip exactly. arrayBuffer + Uint8Array gives us the
    // same primitive the browser uses.
    const buf = new Uint8Array(await response.arrayBuffer());
    await mkdir(pinDir(appDir), { recursive: true });
    await writeFile(join(pinDir(appDir), filename), buf);
    return { bytes: buf.byteLength, integrity: await sha384Integrity(buf) };
  } catch (e) {
    const why = e && e.name === 'AbortError'
      ? `timed out after ${PIN_BUNDLE_TIMEOUT_MS}ms`
      : e && e.message;
    console.error(`[webjs] download ${url} failed: ${why}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
async function fetchIntegrity(url) {
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

/**
 * After writing the new pin output, delete any file in the pin
 * directory that doesn't belong. Handles three orphan scenarios
 * uniformly: version-bump leftovers, removed packages, and mode
 * switches (default <-> download).
 *
 * @param {string} appDir
 * @param {Set<string>} expected  filenames that should remain
 * @returns {Promise<string[]>}   list of pruned filenames
 */
async function pruneOrphans(appDir, expected) {
  const dir = pinDir(appDir);
  let files;
  try { files = await readdir(dir); } catch { return []; }
  const pruned = [];
  for (const f of files) {
    if (expected.has(f)) continue;
    try {
      await unlink(join(dir, f));
      pruned.push(f);
    } catch { /* race or permission; ignore */ }
  }
  return pruned;
}

/**
 * Pin all currently-imported npm packages to `.webjs/vendor/
 * importmap.json`. Two modes:
 *
 *   - Default: importmap URLs point at jspm.io (browser fetches from
 *     CDN directly at runtime). Only `importmap.json` is committed.
 *   - `download: true`: also fetches each bundle from jspm.io and
 *     writes it to `.webjs/vendor/<pkg>@<version>.js`. importmap URLs
 *     become local paths (`/__webjs/vendor/<filename>`), and the
 *     server handler serves them from disk. Both `importmap.json` and
 *     the bundle files are committed to source control.
 *
 * After pinning, prunes any orphan file in `.webjs/vendor/` not
 * produced by the current run. Pin is idempotent with respect to the
 * current source + node_modules: removed packages, bumped versions,
 * and mode switches all leave a clean directory.
 *
 * On success (at least one install resolved), returns
 * `{ pins, pruned, downloaded, provider }`. On total failure (one or
 * more installs were attempted but every jspm.io resolution failed),
 * the pin file is NOT written and the function returns
 * `{ pins: [], pruned: [], downloaded: 0, failed: true, attemptedInstalls }`
 * instead. When the app has zero bare-specifier imports at all
 * (scanned source produced nothing), returns
 * `{ pins: [], pruned: [], downloaded: 0, noBareImports: true }`
 * WITHOUT writing the pin file. When the scan DID find specifiers but
 * every one was dropped because no local version resolved (the package
 * is not installed under `node_modules`), returns
 * `{ pins: [], pruned: [], downloaded: 0, droppedUnresolvable: [...] }`
 * (also WITHOUT a pin file), so the caller can name the found-but-
 * uninstalled specifiers instead of claiming there were none. A
 * partial pin (some resolved, some dropped) still writes the file and
 * carries `droppedUnresolvable` alongside `pins`. Callers that need to
 * surface a non-zero exit code key off `failed`, `noBareImports`, or an
 * all-dropped `droppedUnresolvable`; all are absent on a clean success.
 *
 * The `from` option mirrors importmap-rails's `bin/importmap pin foo
 * --from jsdelivr`. Default `jspm` resolves to jspm.io; other values
 * (jsdelivr, unpkg, skypack) are passed through to jspm.io's
 * Generator API which returns URLs from the chosen CDN. The provider
 * is persisted in the pin file so `vendor update` and incident
 * response know which CDN to re-resolve against.
 *
 * @param {string} appDir
 * @param {{ download?: boolean, from?: string }} [opts]
 * @returns {Promise<{
 *   pins: Array<{ pkg: string, version: string, url: string, bytes?: number, integrity?: string }>,
 *   pruned: string[],
 *   downloaded: number,
 *   provider?: string,
 *   failed?: boolean,
 *   noBareImports?: boolean,
 *   droppedUnresolvable?: string[],
 *   attemptedInstalls?: string[],
 * }>}
 */
export async function pinAll(appDir, opts = {}) {
  const download = !!opts.download;
  // Provider precedence (same as updatePinned for consistency):
  //   1. explicit opts.from (CLI --from flag wins)
  //   2. existing pin file's persisted provider (stickiness: user
  //      who pinned via jsdelivr stays on jsdelivr until they
  //      explicitly switch back)
  //   3. default 'jspm'
  // Pre-read the file once to access its provider.
  const existing = await readPinFile(appDir);
  const from = opts.from || existing?.provider || 'jspm';
  if (!SUPPORTED_PROVIDERS.has(from)) {
    throw new Error(
      `[webjs] unknown provider '${from}'. Supported: ${[...SUPPORTED_PROVIDERS].join(', ')}.`,
    );
  }
  const bare = await scanBareImports(appDir);
  const installs = [];
  /**
   * Map from install spec (`pkg@version<subpath>`) to its components,
   * so we can recover the pkg + version + subpath when iterating jspm.io's
   * resolved imports.
   * @type {Map<string, { pkg: string, version: string, subpath: string }>}
   */
  const partsByInstall = new Map();
  /**
   * Bare specifiers the scan FOUND but that were dropped because no local
   * version could be resolved (the package is not installed under the app's
   * `node_modules`). Kept distinct from "scan found nothing" so the CLI can
   * name them and point at the remedy instead of claiming there were none.
   * @type {string[]}
   */
  const droppedUnresolvable = [];
  for (const spec of bare) {
    if (BUILTIN.has(spec)) continue;
    const pkg = extractPackageName(spec);
    if (!pkg || BUILTIN.has(pkg) || FRAMEWORK_SERVER_ONLY.has(pkg)) continue;
    const version = getPackageVersion(pkg, appDir);
    if (!version) {
      droppedUnresolvable.push(spec);
      continue;
    }
    const subpath = spec.slice(pkg.length);
    const install = `${pkg}@${version}${subpath}`;
    installs.push(install);
    partsByInstall.set(spec, { pkg, version, subpath });
  }
  const resolved = await jspmGenerate(installs, from, PIN_BUNDLE_TIMEOUT_MS);

  /** @type {Record<string, string>} */
  const importmap = {};
  /**
   * SRI integrity by FINAL URL (post-rewrite). The browser's
   * importmap-integrity spec keys on the URL that appears in the
   * importmap, not the source jspm.io URL. For default mode the two
   * are identical; for --download mode the URL is the local
   * /__webjs/vendor/<filename> path.
   * @type {Record<string, string>}
   */
  const integrity = {};
  /** @type {Array<{ pkg: string, version: string, url: string, bytes?: number, integrity?: string }>} */
  const pins = [];
  const expected = new Set([PIN_FILE]);
  let downloaded = 0;

  // Specs that were directly scanned (`partsByInstall`) AND the flattened
  // transitive specs the unified resolve returns (issue #446) must BOTH be
  // pinned, or a pinned app's importmap would be missing the transitive
  // entries the runtime live-resolve serves (e.g. `@codemirror/state` pulled
  // in by `@codemirror/lint`), breaking parity: the browser would hit an
  // unresolved-bare-specifier error for the transitive. For a transitive we
  // recover pkg + version + subpath by parsing the spec against the resolved
  // jspm URL (`derivePinParts`), since it has no `partsByInstall` entry.
  /** @type {Set<string>} */
  const pinnedDirectSpecs = new Set();
  for (const [spec, jspmUrl] of Object.entries(resolved)) {
    const parts = partsByInstall.get(spec) || derivePinParts(spec, jspmUrl);
    if (!parts) continue;
    const direct = partsByInstall.has(spec);
    const { pkg, version, subpath } = parts;
    if (download) {
      const filename = bundleFilenameWithSubpath(pkg, version, subpath);
      const result = await downloadBundle(jspmUrl, appDir, filename);
      if (result == null) continue;
      const localUrl = `/__webjs/vendor/${filename}`;
      importmap[spec] = localUrl;
      integrity[localUrl] = result.integrity;
      expected.add(filename);
      pins.push({ pkg: spec, version, url: localUrl, bytes: result.bytes, integrity: result.integrity });
      downloaded++;
    } else {
      importmap[spec] = jspmUrl;
      // Fetch the bundle just to hash it. Bytes aren't written to
      // disk; only the SHA-384 reaches the pin file. CDN compromise
      // defense for default mode: if jspm.io serves different bytes
      // later, the browser refuses to execute (integrity mismatch).
      const sri = await fetchIntegrity(jspmUrl);
      if (sri) integrity[jspmUrl] = sri;
      else console.warn(
        `[webjs] could not compute SRI for ${jspmUrl}; pinning without ` +
        `integrity (browser will accept any bytes from this URL on ` +
        `next load). Rerun \`webjs vendor pin\` when jspm.io is healthy ` +
        `to lock in the integrity hash.`,
      );
      pins.push({ pkg: spec, version, url: jspmUrl, integrity: sri || undefined });
    }
    if (direct) pinnedDirectSpecs.add(spec);
  }

  // If pin was attempted (installs non-empty) but resolved zero, do
  // NOT write the pin file. Writing `{ imports: {} }` would shadow
  // the live-API fallback (which reads when no pin file exists) and
  // leave the browser with an empty importmap, silently breaking
  // every bare-specifier import. Better: surface the failure so the
  // user knows pin didn't take, and let the next boot fall back to
  // live API resolution (which may have recovered by then).
  //
  // Account on DIRECT specs only: pins also carries flattened transitive
  // entries (#446), so `pins.length === 0` would no longer mean "every
  // direct install failed". A resolve that returned only transitives but
  // no direct spec is still a total failure for the user's deps.
  if (installs.length > 0 && pinnedDirectSpecs.size === 0) {
    return { pins, pruned: [], downloaded, failed: true, attemptedInstalls: installs, provider: from };
  }

  // Partial-failure surface. Some DIRECT installs were attempted but not
  // every one made it into pins (jspm.io returned the package OK,
  // but downloadBundle failed mid-stream in --download mode, or the
  // resolver response was missing the package entirely). Write the
  // pin file anyway so the working packages get committed, but warn
  // so the user knows the next runtime fetch for the missing
  // packages will fall through to a live jspm.io call (or 404 in
  // --download mode).
  //
  // Derive the missing set from partsByInstall (the bare-spec keys)
  // rather than from `installs` (the versioned strings). Compare against
  // the DIRECT specs that pinned, NOT pins[].pkg (which now includes
  // transitives), so a transitive can't mask a missing direct dep.
  if (pinnedDirectSpecs.size < partsByInstall.size) {
    /** @type {string[]} */
    const missing = [];
    for (const [spec, parts] of partsByInstall.entries()) {
      if (!pinnedDirectSpecs.has(spec)) {
        missing.push(`${parts.pkg}@${parts.version}${parts.subpath}`);
      }
    }
    console.warn(
      `[webjs] pin: partial success. The following installs did NOT ` +
      `make it into the pin file and will fall back to live ` +
      `resolution on next boot:`,
    );
    for (const m of missing) console.warn(`  ${m}`);
  }

  // The app legitimately has zero bare-specifier imports (or the
  // scanner is running outside a WebJs project). Don't create an
  // empty `.webjs/vendor/importmap.json`. Without this guard the file
  // gets written as `{ imports: {} }` in whatever cwd the CLI was
  // invoked from, then immediately rejected by readPinFile's empty
  // -imports filter, so the file exists but does nothing. The CLI
  // surfaces this as a clearer "no bare imports found" message.
  if (installs.length === 0) {
    // Distinguish the two empty-set causes the CLI must report differently:
    // the scan genuinely found nothing (noBareImports) vs it found specifiers
    // that were all dropped for a missing local version (droppedUnresolvable).
    if (droppedUnresolvable.length > 0) {
      return { pins, pruned: [], downloaded, droppedUnresolvable, provider: from };
    }
    return { pins, pruned: [], downloaded, noBareImports: true, provider: from };
  }

  await writePinFile(appDir, importmap, integrity, from);
  const pruned = await pruneOrphans(appDir, expected);
  // Some specifiers may have pinned while others were dropped for a missing
  // version; surface the dropped ones so a partial pin is not silent.
  return droppedUnresolvable.length > 0
    ? { pins, pruned, downloaded, provider: from, droppedUnresolvable }
    : { pins, pruned, downloaded, provider: from };
}

/**
 * Remove a single package from the committed pin output. Deletes the
 * package's entry from `importmap.json`, and (if a bundle file
 * exists for it) deletes that file too.
 *
 * @param {string} appDir
 * @param {string} pkg
 * @returns {Promise<{ removed: boolean, deletedFile?: string }>}
 */
export async function unpinPackage(appDir, pkg) {
  const file = await readPinFile(appDir);
  if (!file || !(pkg in file.imports)) return { removed: false };
  const url = file.imports[pkg];
  delete file.imports[pkg];
  // Also strip the integrity entry for this URL, if present.
  const newIntegrity = { ...(file.integrity || {}) };
  delete newIntegrity[url];
  if (Object.keys(file.imports).length === 0) {
    // The pin file would now be empty. Delete it so the next boot
    // falls back to live API resolution rather than seeing an empty
    // importmap. Same reasoning as pinAll's "don't write empty pin"
    // guard.
    try { await unlink(pinFilePath(appDir)); } catch { /* race or never existed */ }
  } else {
    // Preserve the pin file's persisted provider (jsdelivr, unpkg,
    // etc.). Without this, `webjs vendor unpin <pkg>` would silently
    // revert the file to the default jspm provider, defeating
    // pinAll's stickiness for the remaining packages.
    await writePinFile(appDir, file.imports, newIntegrity, file.provider);
  }

  let deletedFile;
  if (url.startsWith('/__webjs/vendor/')) {
    const filename = url.slice('/__webjs/vendor/'.length);
    try {
      await unlink(join(pinDir(appDir), filename));
      deletedFile = filename;
    } catch { /* file already gone; ignore */ }
  }
  return { removed: true, deletedFile };
}

/**
 * List entries from the committed pin file. Parses the package
 * version from the URL (jspm.io URL or the local file's @version).
 *
 * @param {string} appDir
 * @returns {Promise<Array<{ pkg: string, version: string, url: string, bytes?: number }>>}
 */
export async function listPinned(appDir) {
  const file = await readPinFile(appDir);
  if (!file) return [];
  const entries = [];
  for (const [pkg, url] of Object.entries(file.imports)) {
    let version = '(unknown)';
    let bytes;
    // Order matters: try the local `/__webjs/vendor/` filename
    // parser first, then the CDN bare-name search. The local
    // filename embeds the subpath as `__plugin__utc.js`, which the
    // bare-name regex would match as part of the version (greedy
    // `[^/]+` swallows the encoded subpath). Handling the local
    // case explicitly preserves the cleaner version output for
    // `--download` mode pins.
    if (url.startsWith('/__webjs/vendor/')) {
      const filename = url.slice('/__webjs/vendor/'.length);
      const atIdx = filename.lastIndexOf('@');
      if (atIdx > 0) {
        // Strip trailing `.js`, split off any `__subpath` segment, keep
        // only the version. `dayjs@1.11.13__plugin__utc.js` parses as
        // version `1.11.13` (not `1.11.13__plugin__utc`).
        const afterAt = filename.slice(atIdx + 1, -3);
        const subIdx = afterAt.indexOf('__');
        version = subIdx < 0 ? afterAt : afterAt.slice(0, subIdx);
      }
      try {
        const st = await stat(join(pinDir(appDir), filename));
        bytes = st.size;
      } catch { /* file missing; bytes stays undefined */ }
    } else {
      // Derive the version from the URL by searching for the spec's
      // bare package name followed by `@<version>`. Works across
      // every CDN we support (jspm.io's `npm:dayjs@1.11.13`,
      // jsdelivr's `npm/dayjs@1.11.13`, unpkg's bare
      // `dayjs@1.11.13/`, skypack's `dayjs@1.11.13`). The bare name
      // lives in entries[].pkg (the import-map key), so we know it
      // exactly and just need to find the `<bare>@<version>`
      // substring. Stop at the first `/` after the version so we
      // don't include the entry-point path.
      //
      // Anchor the match against a non-pkg-name char (or string
      // start) so a short package name like `ms` doesn't false-
      // match inside another package's URL like `npm/terms@1.0.0/`.
      // npm package names use `[a-zA-Z0-9._-]` (plus `@` and `/`
      // for scoped names), so anything else is a safe boundary.
      const bare = extractPackageName(pkg) || pkg;
      const escapedBare = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bareMatch = new RegExp(`(?:^|[^a-zA-Z0-9_.-])${escapedBare}@([^/]+)`).exec(url);
      if (bareMatch) version = bareMatch[1];
    }
    entries.push({ pkg, version, url, bytes });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// npm registry queries: audit + outdated + update
// ---------------------------------------------------------------------------

const NPM_REGISTRY = 'https://registry.npmjs.org';
// The npm registry is reached only by `audit`, `outdated`, and `update`,
// all CLI commands, so it takes the same generous budget the pin bundle
// fetch does rather than the server's. importmap-rails makes these same two
// calls with Ruby's 60s Net::HTTP default.
const NPM_TIMEOUT_MS = 60_000;

/**
 * Fetch one URL from registry.npmjs.org with a small timeout. Returns
 * the parsed JSON body on 2xx, or null on any non-2xx / network /
 * timeout. Used by audit + outdated.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<any | null>}
 */
async function fetchNpmJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NPM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

/**
 * Group the pin file's entries by package name + the set of versions
 * actually pinned (a single package can be pinned at multiple versions
 * via subpath imports). Used by audit (npm advisories want
 * `{ pkgName: [versions] }`) and outdated (one query per package).
 *
 * @param {Array<{ pkg: string, version: string }>} entries
 * @returns {Map<string, Set<string>>}
 */
function groupPinnedByPackage(entries) {
  const out = new Map();
  for (const e of entries) {
    if (!e.version || e.version === '(unknown)') continue;
    // entries[].pkg can include a subpath (e.g. `dayjs/plugin/utc`).
    // Extract the bare package name (`dayjs` or `@scope/name`).
    const bare = extractPackageName(e.pkg) || e.pkg;
    if (!out.has(bare)) out.set(bare, new Set());
    out.get(bare).add(e.version);
  }
  return out;
}

/**
 * Run a security audit against the pinned versions in the committed
 * pin file. POSTs to npm's bulk-advisory endpoint, the same one
 * `npm audit` uses internally.
 *
 * Returns `{ errored: true }` when the registry call failed (network
 * down, timeout, 5xx) so the CLI can surface the failure clearly
 * instead of misleading the user with "no vulnerabilities found".
 *
 * Mirrors importmap-rails's `bin/importmap audit`.
 *
 * @param {string} appDir
 * @returns {Promise<{
 *   vulnerable: Array<{ name: string, severity: string, vulnerableVersions: string, title: string }>,
 *   totalChecked: number,
 *   errored?: boolean,
 * }>}
 */
export async function auditPinned(appDir) {
  const entries = await listPinned(appDir);
  if (!entries.length) return { vulnerable: [], totalChecked: 0 };
  const grouped = groupPinnedByPackage(entries);
  const body = {};
  for (const [pkg, versions] of grouped) body[pkg] = [...versions];
  const result = await fetchNpmJson(`${NPM_REGISTRY}/-/npm/v1/security/advisories/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const totalChecked = grouped.size;
  if (result === null) {
    // Distinguish "registry returned no advisories" (success, empty
    // object) from "couldn't reach registry" (null). The latter is
    // user-visible because a silent "no vulnerabilities" on a failed
    // call would falsely reassure the user.
    return { vulnerable: [], totalChecked, errored: true };
  }
  if (typeof result !== 'object') return { vulnerable: [], totalChecked };
  /** @type {Array<{ name: string, severity: string, vulnerableVersions: string, title: string }>} */
  const vulnerable = [];
  for (const [name, advisories] of Object.entries(result)) {
    if (!Array.isArray(advisories)) continue;
    for (const a of advisories) {
      vulnerable.push({
        name,
        severity: String(a?.severity || 'unknown'),
        vulnerableVersions: String(a?.vulnerable_versions || a?.range || ''),
        title: String(a?.title || a?.overview || ''),
      });
    }
  }
  return { vulnerable, totalChecked };
}

/**
 * Find pinned packages that have a newer version available on npm.
 * Queries `registry.npmjs.org/<pkg>` per pinned package, compares the
 * pinned version against `dist-tags.latest` with semver-shaped string
 * ordering (regex parse, then numeric compare per segment).
 *
 * Mirrors importmap-rails's `bin/importmap outdated`.
 *
 * @param {string} appDir
 * @returns {Promise<Array<{ pkg: string, current: string, latest: string }>>}
 */
export async function findOutdated(appDir) {
  const entries = await listPinned(appDir);
  if (!entries.length) return [];
  const grouped = groupPinnedByPackage(entries);
  // Fetch in parallel. With sequential awaits a 50-package project
  // could take 50 × 10s = 500s in the worst case (one npm registry
  // timeout each). Parallel `Promise.all` collapses this to one
  // round-trip's wall-clock, while staying well below npm registry's
  // unauthenticated-client soft rate limit (registry-side concern,
  // not ours to throttle).
  //
  // Scoped packages: the `/` between `@scope` and `name` is part of
  // the URL path, NOT a path separator that should be encoded.
  // `encodeURIComponent` would emit `%2F`, which the npm registry
  // accepts but other npm-compatible registries (Verdaccio, JFrog,
  // GitHub Packages) sometimes reject. The npm-cli uses the literal
  // form. npm package-name rules disallow URL-unsafe chars so this
  // is safe.
  const queries = [...grouped].map(async ([pkg, versions]) => {
    const meta = await fetchNpmJson(`${NPM_REGISTRY}/${pkg}`);
    const latest = meta?.['dist-tags']?.latest;
    if (typeof latest !== 'string') return null;
    // A package can be pinned at multiple versions (subpath imports).
    // Take the max pinned version as the "current" for the comparison
    // so we only report it as outdated when EVERY pinned version
    // trails latest.
    const current = maxSemverVersion([...versions]);
    if (compareSemver(current, latest) >= 0) return null;
    return { pkg, current, latest };
  });
  const results = await Promise.all(queries);
  // `return` followed by a newline triggers ASI: `return; (expr);`
  // returns undefined and drops the value. Keep the filter on the
  // same line as `return` (or pull the result into a variable
  // first) to avoid the trap.
  /** @type {Array<{ pkg: string, current: string, latest: string }>} */
  const out = results.filter((x) => x !== null);
  return out;
}

/**
 * Re-pin every package returned by findOutdated to its latest version.
 * Calls jspm.io's Generator API with `<pkg>@<latest>` for each
 * outdated entry, then writes the new pin file.
 *
 * Mirrors importmap-rails's `bin/importmap update`, with the same
 * caveat: this updates the pin file but does NOT update the user's
 * `package.json` / `node_modules`. The user should run `npm install
 * <pkg>@<latest>` afterward to keep package.json in sync.
 *
 * When `opts.from` is not passed, the existing pin file's `provider`
 * field is used (so a user who pinned `--from jsdelivr` originally
 * stays on jsdelivr after update). When the file has no provider
 * field, defaults to `jspm`.
 *
 * @param {string} appDir
 * @param {{ from?: string }} [opts]
 * @returns {Promise<{ updated: Array<{ pkg: string, from: string, to: string }>, noOutdated?: boolean, provider?: string }>}
 */
export async function updatePinned(appDir, opts = {}) {
  const file = await readPinFile(appDir);
  // Provider precedence:
  //   1. explicit opts.from (CLI flag wins)
  //   2. pin file's persisted provider
  //   3. default 'jspm'
  // Validate AFTER resolving so a stale pin file with a previously-
  // valid-but-now-removed provider still errors clearly.
  const from = opts.from || file?.provider || 'jspm';
  if (!SUPPORTED_PROVIDERS.has(from)) {
    throw new Error(
      `[webjs] unknown provider '${from}'. Supported: ${[...SUPPORTED_PROVIDERS].join(', ')}.`,
    );
  }
  const outdated = await findOutdated(appDir);
  if (!outdated.length) return { updated: [], noOutdated: true, provider: from };
  if (!file) return { updated: [], provider: from };
  const newImports = { ...file.imports };
  const newIntegrity = { ...(file.integrity || {}) };
  /** @type {Array<{ pkg: string, from: string, to: string }>} */
  const updated = [];
  for (const { pkg, current, latest } of outdated) {
    // Resolve the new version via jspm.io. The Generator API
    // returns URLs for `<pkg>@<latest>` (and any subpath we ask
    // for, but for update we just refresh the bare root pin and
    // any subpaths that were already pinned).
    let anySpecUpdated = false;
    for (const [spec, oldUrl] of Object.entries(file.imports)) {
      const specPkg = extractPackageName(spec) || spec;
      if (specPkg !== pkg) continue;
      const subpath = spec.slice(specPkg.length);
      const install = `${pkg}@${latest}${subpath}`;
      const resolved = await jspmGenerate([install], from, PIN_BUNDLE_TIMEOUT_MS);
      const newUrl = resolved[spec];
      if (!newUrl) continue;
      newImports[spec] = newUrl;
      // Recompute integrity for the new URL. Drop the stale entry
      // even on fetch failure so the new pin doesn't carry the
      // wrong hash silently.
      delete newIntegrity[oldUrl];
      const sri = await fetchIntegrity(newUrl);
      if (sri) newIntegrity[newUrl] = sri;
      anySpecUpdated = true;
    }
    // Only report `pkg` as updated when at least one spec actually
    // got a new URL. If every subpath failed to resolve via
    // jspm.io (transient outage, the new version not yet indexed),
    // the CLI must not lie about having updated it.
    if (anySpecUpdated) updated.push({ pkg, from: current, to: latest });
  }
  await writePinFile(appDir, newImports, newIntegrity, from);
  return { updated, provider: from };
}

/**
 * Lightweight semver-aware comparison (no prerelease tags). Returns
 * negative if a < b, zero if equal, positive if a > b. Used by
 * findOutdated to decide if `current` lags `latest`. Non-numeric
 * segments fall back to string compare so prerelease-ish strings
 * still sort somewhere.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareSemver(a, b) {
  const aParts = a.split(/[.+-]/).map((p) => /^\d+$/.test(p) ? Number(p) : p);
  const bParts = b.split(/[.+-]/).map((p) => /^\d+$/.test(p) ? Number(p) : p);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const ai = aParts[i] ?? 0;
    const bi = bParts[i] ?? 0;
    if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai !== bi) return ai - bi;
    } else if (ai !== bi) {
      return String(ai) < String(bi) ? -1 : 1;
    }
  }
  return 0;
}

/** @param {string[]} versions */
function maxSemverVersion(versions) {
  return versions.reduce((max, v) => compareSemver(v, max) > 0 ? v : max, versions[0]);
}

/**
 * Resolve the vendor importmap fragment for runtime use. Prefers the
 * committed pin file over a live api.jspm.io call. Called from
 * `ensureReady()` in dev.js on the first request, never at boot.
 *
 * Order of preference:
 *   1. `.webjs/vendor/importmap.json` (committed; no network needed)
 *   2. Live api.jspm.io/generate (fallback when no pin file exists)
 *
 * Returns both `imports` (the URL map) and `integrity` (SRI hashes
 * keyed by the FINAL URL). Integrity is populated on BOTH paths (#235):
 * the pin file supplies it directly, and the live-API path now hashes
 * each cross-origin bundle after resolving (bounded + fail-open, see
 * `computeLiveIntegrity`), so an unpinned app also serves SRI. A fetch
 * failure for one URL degrades to a missing hash for that URL plus a
 * one-time warning, never a broken resolve.
 *
 * @param {string} appDir
 * @param {() => Promise<Set<string>>} getBareImports lazy scan, invoked ONLY
 *   on the unpinned path (so a pinned app never pays the whole-app walk).
 * @returns {Promise<{ imports: Record<string, string>, integrity: Record<string, string> }>}
 */
/**
 * Base package of a bare specifier: `dayjs` -> `dayjs`,
 * `dayjs/plugin/utc` -> `dayjs`, `@scope/pkg/sub` -> `@scope/pkg`.
 *
 * @param {string} spec
 * @returns {string}
 */
function basePackage(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Prune a pinned import map to the vendor specifiers still reachable from
 * NON-elided modules. A committed pin is the whole map, but elision can make
 * a pinned package unreachable (its only importer is a display-only component
 * that ships no JS, e.g. dayjs via the blog's vendor-badge). The live-resolve
 * path prunes such a package by excluding elided components from the bare-
 * import scan; this brings the pinned path to the same result, so a pinned app
 * and an unpinned app serve the same import map (issue #197).
 *
 * Keeps an entry when its specifier is reachable, OR when its base package is
 * the base of any reachable specifier (so a pinned base entry `dayjs` survives
 * when code imports `dayjs/plugin/utc`, and vice versa). Integrity hashes for
 * dropped URLs are pruned too.
 *
 * @param {Record<string, string>} imports  pin entries (specifier -> URL)
 * @param {Record<string, string>} integrity  SRI hashes keyed by URL
 * @param {Set<string>} reachable  bare specifiers used by non-elided modules
 * @returns {{ imports: Record<string, string>, integrity: Record<string, string> }}
 */
export function prunePinToReachable(imports, integrity, reachable) {
  const reachableBases = new Set([...reachable].map(basePackage));
  /** @type {Record<string, string>} */
  const keptImports = {};
  for (const [spec, url] of Object.entries(imports || {})) {
    if (reachable.has(spec) || reachableBases.has(basePackage(spec))) {
      keptImports[spec] = url;
    }
  }
  const keptUrls = new Set(Object.values(keptImports));
  /** @type {Record<string, string>} */
  const keptIntegrity = {};
  for (const [url, hash] of Object.entries(integrity || {})) {
    if (keptUrls.has(url)) keptIntegrity[url] = hash;
  }
  return { imports: keptImports, integrity: keptIntegrity };
}

// ---------------------------------------------------------------------------
// Importmap coherence check (issue #450)
// ---------------------------------------------------------------------------
//
// A produced importmap pins one URL per resolved package, each URL carrying an
// `@<version>`. That pinned graph is INCOHERENT when one resolved package
// declares a dependency or peer range on ANOTHER resolved package and the
// version actually pinned for that other package falls OUTSIDE the range. The
// motivating crash (#446): `@codemirror/view@6.39.16` pinned while
// `@codemirror/lint@6.9.6` (also pinned) needs `view@^6.42.0`, so a symbol
// `lint` expects is missing from the older `view` bundle at runtime.
//
// This is a VALIDATION over a produced importmap, NOT a re-resolution (that is
// #446's job) and NOT bundling. It emits warnings; it never mutates the map.
//
// PARITY: `checkImportmapCoherence` is a pure function of the EXTRACTED
// `{ package -> pinned version }` set plus the dependency metadata. It does not
// know or care whether the importmap came from a live jspm.io resolve or from a
// committed `.webjs/vendor/importmap.json`. Two importmaps that pin the same
// versions for the same packages therefore always produce the same verdict,
// which is exactly the runtime-vs-vendored parity the maintainer requires.

/**
 * Extract `{ basePackage -> pinned version }` from an importmap's `imports`
 * map. Each value is a CDN URL (jspm.io's `npm:dayjs@1.11.13/...`, jsdelivr's
 * `npm/dayjs@1.11.13/...`, unpkg's bare `dayjs@1.11.13/...`, skypack's
 * `dayjs@1.11.13`) or a local `/__webjs/vendor/<pkg>@<version>...js` path. The
 * key is the bare package name parsed from the importmap KEY (the specifier),
 * which is authoritative; the version is parsed from the URL.
 *
 * A specifier that resolves to a version we cannot parse from its URL is
 * skipped (it contributes nothing to the dep graph rather than a wrong pin).
 * When the same base package appears at several versions (subpath imports),
 * the LAST parsed wins; in practice every subpath of a package resolves to the
 * one installed version, so they agree.
 *
 * @param {Record<string, string>} imports  importmap `imports` map (specifier -> URL)
 * @returns {Map<string, string>}  base package name -> pinned version
 */
export function extractPinnedVersions(imports) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [spec, url] of Object.entries(imports || {})) {
    if (typeof url !== 'string') continue;
    const bare = extractPackageName(spec);
    if (!bare) continue;
    let version = null;
    if (url.startsWith('/__webjs/vendor/')) {
      // Local downloaded-pin path: `<name>@<version>[__subpath].js`. The name
      // is `--`-encoded for scoped packages; we only need the version, which
      // sits after the LAST `@` and before any `__subpath` / `.js` suffix.
      const filename = url.slice('/__webjs/vendor/'.length);
      const atIdx = filename.lastIndexOf('@');
      if (atIdx > 0) {
        const afterAt = filename.slice(atIdx + 1, filename.endsWith('.js') ? -3 : undefined);
        const subIdx = afterAt.indexOf('__');
        version = subIdx < 0 ? afterAt : afterAt.slice(0, subIdx);
      }
    } else {
      // CDN URL: find `<bare>@<version>` anchored on a non-name char (or the
      // string start) so a short name like `ms` does not false-match inside
      // another package's URL. Mirrors listPinned's parser.
      const escapedBare = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`(?:^|[^a-zA-Z0-9_.-])${escapedBare}@([^/]+)`).exec(url);
      if (m) version = m[1];
    }
    if (version && /\d/.test(version)) out.set(bare, version);
  }
  return out;
}

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
function parseSemver(v) {
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
function cmpSemver(a, b) {
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
 * Validate that a produced importmap's pinned dependency graph is COHERENT
 * (issue #450). For each resolved package, read its declared `dependencies`
 * and `peerDependencies` (via the injected `getManifest`) and, for every
 * declared range that targets ANOTHER package ALSO pinned in this importmap,
 * check the pinned version satisfies the range. A miss is a conflict naming
 * both packages, the required range, and the pinned version.
 *
 * This is the SAME function the doctor runs over the live importmap and over
 * `.webjs/vendor/importmap.json`. It is pure in `(imports, getManifest)`, so
 * the same pinned dep set yields the same verdict regardless of which input it
 * came from (the runtime-vs-vendored parity invariant).
 *
 * Degrades gracefully: a package whose manifest `getManifest` cannot supply
 * (not installed, unreadable, network unavailable) is recorded under
 * `unverified` and contributes NO conflict, so the check reports "could not
 * verify" rather than failing closed. A declared range in a shape we cannot
 * statically evaluate (see `satisfiesSemverRange` -> null) is likewise skipped,
 * never warned on.
 *
 * @param {Record<string, string>} imports  importmap `imports` map
 * @param {{
 *   getManifest: (pkg: string, version: string) =>
 *     ({ dependencies?: Record<string,string>, peerDependencies?: Record<string,string> } | null
 *      | Promise<{ dependencies?: Record<string,string>, peerDependencies?: Record<string,string> } | null>),
 * }} opts  `getManifest` returns the declared dep ranges for a resolved
 *   `pkg@version`, or null when unavailable (degrade to "unverified").
 * @returns {Promise<CoherenceReport>}
 */
export async function checkImportmapCoherence(imports, opts) {
  const pinned = extractPinnedVersions(imports);
  /** @type {CoherenceConflict[]} */
  const conflicts = [];
  /** @type {Array<{ pkg: string, reason: string }>} */
  const unverified = [];
  // Sort for deterministic output: the same dep set always yields the same
  // ordering, which keeps the verdict (and any test asserting it) stable and
  // strengthens the parity guarantee end to end.
  const packages = [...pinned.keys()].sort();
  // Count of packages whose metadata we could actually read (so a conflict
  // verdict is grounded). A package whose manifest is unavailable lands in
  // `unverified` instead and does NOT count as checked, which lets the caller
  // distinguish "verified coherent" from "could not verify anything".
  let checked = 0;
  for (const pkg of packages) {
    const version = pinned.get(pkg);
    let manifest;
    try {
      manifest = await opts.getManifest(pkg, version);
    } catch {
      manifest = null;
    }
    if (!manifest || typeof manifest !== 'object') {
      unverified.push({ pkg, reason: `could not read dependency metadata for ${pkg}@${version}` });
      continue;
    }
    checked++;
    const groups = /** @type {const} */ ([
      ['dependency', manifest.dependencies],
      ['peerDependency', manifest.peerDependencies],
    ]);
    for (const [kind, deps] of groups) {
      if (!deps || typeof deps !== 'object') continue;
      for (const [depName, range] of Object.entries(deps)) {
        // Only edges INTO the pinned graph matter: a dep on a package that is
        // not in this importmap is not the importmap's coherence problem (it
        // is either bundled into a CDN megabundle or simply unused on the
        // client). Self-edges cannot conflict.
        if (depName === pkg) continue;
        const depPinned = pinned.get(depName);
        if (!depPinned) continue;
        const ok = satisfiesSemverRange(depPinned, String(range));
        if (ok === false) {
          conflicts.push({
            pkg,
            version: String(version),
            dependsOn: depName,
            kind,
            requiredRange: String(range),
            pinnedVersion: depPinned,
          });
        }
        // ok === null (range shape not understood) is silently skipped: the
        // check never warns on a range it could not evaluate.
      }
    }
  }
  return { conflicts, unverified, checked };
}

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
  lastLiveResolveFailed = false;
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
  // ok=false means at least one install could not be resolved (CDN unreachable
  // / timeout / non-ok), so `imports` is partial. The caller must not memoize
  // this as done; it should retry once the CDN recovers.
  return { imports, integrity, ok: !lastLiveResolveFailed };
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
