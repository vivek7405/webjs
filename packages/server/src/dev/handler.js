import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Server-side `.ts` imports are handled natively by Node 24+'s default
// type-stripping (`process.features.typescript === 'strip'`) or by Bun. The
// BROWSER-bound `.ts` request handler erases types via the pluggable stripper in
// `./ts-strip.js` (Node's built-in `module.stripTypeScriptTypes`, or `amaro` on
// Bun), so SSR and hydration produce identical JS on either runtime (#508).
import { buildRouteTable, matchPage } from '../router.js';
import { generateRouteTypes } from '../route-types.js';
import { setClientRouterEnabled, setMetadataIconRoutes } from '../ssr.js';
import {
  buildActionIndex,
} from '../actions.js';
import { registerActionHooks } from '../action-seed.js';
import { readRegenerateRules, isRegenerateOutputPath } from '../dev-regenerate.js';
import { classifyChangedPath } from '../dev-classify.js';
import { ensureStripper } from '../ts-strip.js';
import { defaultLogger } from '../logger.js';
import { assertNodeVersion } from '../node-version.js';
import { applyEnvValidation } from '../env-schema.js';
import { runInstrumentation } from '../instrumentation.js';
import { withRequest, setCspNonce, setBodyLimits, setRequestId, requestId as getRequestId } from '../context.js';
import { buildInfoResponse } from '../build-info.js';
import { mintNonce, buildCspHeader, cspHeaderName } from '../csp.js';
import { propagateTrustedRemoteIp } from '../rate-limit.js';
import { reachedBareImports, resolveVendorImports, clearVendorCache, hasVendorPin, readPinFile, prunePinToReachable } from '../vendor.js';
import { browserEntryFiles } from '../browser-entries.js';
import { buildModuleGraph, seenFilesFor, appImportsMap, reachableFromEntries } from '../module-graph.js';
import { primeComponentRegistry, findOrphanComponents, scanComponents } from '../component-scanner.js';
import { analyzeElision } from '../component-elision.js';

import { setVendorEntries, setCoreInstall, publishBuildId, setAppSourceId, setBasePath, basePath, setImportAliasEntries, importAliasBrowserEntries } from '../importmap.js';
import { stripBasePath, withBasePath } from '../base-path.js';
import { setAssetUrlProvider, setFormActionResolver } from '@webjsdev/core';
import { resolveActionIdentity } from '../form-action-identity.js';
import { setAssetRoots, clearAssetHashCache, setElisionFingerprint, withAssetHash, assetHashFor, resolveAssetUrl } from '../asset-hash.js';
import { applySecurityHeaders, webRequestIsHttps } from '../headers.js';
import {
  applyRedirects,
  applyTrailingSlash,
} from '../redirects.js';
import { applyConditionalGet } from '../conditional-get.js';
import { commitHtmlCache, setAppSourceFingerprint } from '../html-cache.js';
import { buildDevErrorFrame } from '../dev-error.js';

import {
  readElideEnabled,
  readSeedEnabled,
  readClientRouterEnabled,
  readHeaderRules,
  readRedirectRules,
  readTrailingSlashFromApp,
  readBasePathFromApp,
  warnOnInvalidWebjsConfig,
  readAllowedOriginsFromApp,
  readCspConfigFromApp,
  readBodyLimitsFromApp,
} from './config.js';
import {
  exists, kebab, resolveRequestId, shouldAccessLog, loadAppEnv, collectRouteModules,
  appTopLevelDirs, locateCoreDir, reloadClientJs, reloadWorkerJs,
} from './helpers.js';
import {
  handleCore, loadMiddleware, tryServeFrameworkStatic, tryServePublicAsset,
} from './serve.js';

/**
 * A short content digest of a single file's bytes for the app-source deploy
 * signal (#899). Raw `sha256(bytes)`, deliberately independent of `assetHashFor`
 * (which folds the elision fingerprint and memoizes for `?v` emission): the
 * signal only needs "did the source bytes change", and server-only files never
 * enter the asset-hash memo anyway. Returns `''` on a read failure, so a
 * transient error degrades the id rather than throwing during analysis.
 * @param {string} abs
 * @returns {string}
 */
function fileByteHash(abs) {
  try { return createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 16); }
  catch { return ''; }
}

/** @type {string | undefined} memoized `@webjsdev/server` version, folded into the app-source signal (#899). */
let cachedServerVersion;
/**
 * The installed `@webjsdev/server` version (this package). Folded into the
 * app-source deploy signal so a server-framework release (which alters SSR
 * output but ships no new browser module) turns over the client's stale caches.
 * @returns {string}
 */
function frameworkServerVersion() {
  if (cachedServerVersion !== undefined) return cachedServerVersion;
  try {
    const v = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
    cachedServerVersion = typeof v === 'string' ? v.replace(/[^\w.-]/g, '').slice(0, 32) : '';
  } catch {
    cachedServerVersion = '';
  }
  return cachedServerVersion;
}

/**
 * Create a reusable, framework-agnostic request handler for a WebJs app.
 * The returned `handle(req)` takes a standard `Request` and resolves to a
 * standard `Response`: suitable for Node http, Deno, Bun, Cloudflare Workers,
 * or embedding inside an Express/Fastify app.
 *
 * @param {{
 *   appDir: string,
 *   dev?: boolean,
 *   logger?: import('../logger.js').Logger,
 *   onError?: (error: unknown, ctx: { request: Request, requestId: string|null, phase: string }) => void,
 *   onReload?: (verdict?: import('../dev-classify.js').ReloadVerdict) => void,
 *   onDevError?: (frame: object) => void,
 * }} opts
 */
export async function createRequestHandler(opts) {
  // Preflight: WebJs needs Node 24+ (built-in TS strip + recursive fs.watch).
  // Throw a clear Error here so an embedded host (Express/Fastify/Bun/Deno)
  // gets the actionable message at boot, not a cryptic API failure mid-request.
  assertNodeVersion({ onFail: 'throw' });
  // Resolve the TS stripper backend at boot (#508): the Node built-in, or amaro
  // on Bun. Doing it here pays the (one-time) amaro import up front and surfaces
  // a missing-amaro error at boot rather than on the first `.ts` request.
  await ensureStripper();
  const appDir = resolve(opts.appDir);
  // Load <appDir>/.env into process.env BEFORE anything else.
  // buildActionIndex below imports server-only files (lib/*.server.ts,
  // modules/**/*.server.ts), some of which read process.env at module
  // init (e.g. createAuth reads AUTH_SECRET). Without this call,
  // scaffolded apps with a committed .env.example + .env would fail
  // to boot until the user discovered the missing env-load. See
  // tracker #37.
  loadAppEnv(appDir);
  // Optional boot-time env validation (#236). If <appDir>/env.{js,ts} exists it
  // default-exports a typed schema or a custom validator function; we run it
  // against process.env (now populated by loadAppEnv) BEFORE buildActionIndex
  // imports any server-only module. A failure throws a clear aggregated Error
  // here, so an embedded host rejects at boot and the CLI exits non-zero,
  // failing fast instead of crashing cryptically mid-request. Absent file is a
  // no-op (opt-in). Coerced + defaulted values are written back to process.env.
  await applyEnvValidation(appDir, { dev: !!opts.dev });
  const dev = !!opts.dev;
  const logger = opts.logger || defaultLogger({ dev });
  // Boot-time `webjs` config validation (#1300). The published JSON Schema used
  // to reach users only through the scaffold's .vscode `$ref`, so a typo'd key
  // was caught in an editor and nowhere else: the key was dropped, the feature
  // stayed at its default, and nothing said so. This runs it once per boot, from
  // the one entry point dev, prod, and an embedded host all share.
  //
  // It WARNS and continues, never throws. A typo costs one feature sitting at
  // its default; a hard boot failure over a schema quibble costs the whole app.
  // A missing / unreadable / unparseable package.json is a silent no-op, like
  // every other `webjs.*` reader in this file.
  await warnOnInvalidWebjsConfig(appDir, logger);
  // Boot-time instrumentation hook (#848): run the optional app-root
  // instrumentation.{js,ts} register() ONCE, after env validation and before
  // the route table / action index are built, so observability plumbing starts
  // before traffic. Any error sink it registers via setOnError composes with
  // the programmatic opts.onError (both fire). Fail-open (a throwing hook is
  // logged, not fatal).
  const { onError: instrumentationOnError } = await runInstrumentation(appDir, { dev, logger });
  // APM / Sentry integration point (issue #239). Called whenever the request
  // pipeline catches an unhandled error: the top-level handle() catch (the
  // last-resort 500), an unexpected throw inside the produce() funnel, or a
  // middleware that threw. BEST-EFFORT by contract: a throwing onError is
  // caught here so it can never crash the response, and the framework's own
  // sanitized 500 / existing error behavior is unchanged (the hook is purely
  // additive). The sink receives the error plus the correlation id so it can
  // tie the report to the same id the access log and X-Request-Id carry.
  // Both the programmatic opts.onError AND any sink an instrumentation.{js,ts}
  // register() installed via setOnError fire (they compose, #848).
  const onErrorSinks = [opts.onError, instrumentationOnError].filter((f) => typeof f === 'function');
  const hasOnError = onErrorSinks.length > 0;

  /**
   * Invoke every registered onError sink defensively. The phase is a coarse
   * label of where the pipeline caught the error, for the sink's own grouping.
   * @param {unknown} error
   * @param {Request} request
   * @param {string} phase
   */
  function reportError(error, request, phase) {
    if (!hasOnError) return;
    const ctx = { request, requestId: getRequestId(), phase };
    for (const sink of onErrorSinks) {
      try {
        sink(error, ctx);
      } catch (e) {
        logger.error?.('[webjs] onError hook threw (ignored)', { err: String(e) });
      }
    }
  }

  // Sub-path deployment base path (issue #256), read once from the app's
  // package.json `webjs.basePath` and bound into the importmap builder BEFORE
  // setCoreInstall / setVendorEntries so every importmap target (and the
  // recomputed hash) reflects the prefix. Empty (the default) makes both the
  // ingress strip and the emit-side prefix pure no-ops, so an unconfigured app
  // is byte-identical to before this feature.
  const basePathValue = await readBasePathFromApp(appDir);
  await setBasePath(basePathValue);

  // Cross-origin allowlist for the action CSRF check (#659), read once.
  const allowedOriginsValue = await readAllowedOriginsFromApp(appDir);

  // Client-router opt-out (#629): bind it eagerly at handler construction (the
  // same timing as setBasePath above), so a handler's module-global is set
  // before any render even if a request arrives before the first warm. The
  // analysis pass re-reads it each rebuild so a dev toggle takes effect live.
  setClientRouterEnabled(await readClientRouterEnabled(appDir));

  const coreDir = locateCoreDir(appDir);
  // Switch the importmap between dist/ bundles and src/ per-file
  // URLs depending on whether the resolved @webjsdev/core install
  // has built bundles on disk. npm-installed copies always do;
  // workspace dev does only after `npm run build:dist`. Without
  // a built dist the server falls back to the historical per-file
  // src/ URLs so dev iteration does not require a build step.
  //
  // Both required bundles must exist. An older @webjsdev/core
  // install built BEFORE the browser-entry split (#119/#128) has
  // `webjs-core.js` but no `webjs-core-browser.js`. Enabling dist
  // mode in that case would route the bare `@webjsdev/core`
  // specifier at a 404 on every page. Require both so a partial
  // dist transparently degrades to src/ mode instead.
  const distDir = join(coreDir, 'dist');
  const distComplete =
    existsSync(join(distDir, 'webjs-core.js')) &&
    existsSync(join(distDir, 'webjs-core-browser.js'));
  await setCoreInstall(coreDir, distComplete);

  // Path-alias imports (#555). Emit the browser importmap scopes for the app's
  // `package.json "imports"` aliases, derived from the SAME map the server
  // resolver (`expandImportAlias`) reads, so SSR and the browser agree. The
  // scaffold ships the single catch-all `"#*": "./*"` (one key, zero
  // maintenance, Bun-safe), which expands to one browser prefix scope per
  // top-level dir (`#lib/` -> `/lib/`, ...); the dir scan is here so a new
  // folder is picked up on boot. An app with no `"imports"` block yields {}
  // (a no-op, byte-identical to before this feature).
  await setImportAliasEntries(importAliasBrowserEntries(appImportsMap(appDir), appTopLevelDirs(appDir)));

  // Content-hash asset URLs for immutable caching (issue #243). Bind the
  // asset-hash module to the app + core roots and enable fingerprinting in
  // PROD only. In dev `withAssetHash` stays a pure no-op (never enabled), so
  // the dev importmap / boot / preload output is byte-identical to before.
  // This runs AFTER setBasePath / setCoreInstall, but those recompute the
  // importmap hash with `{ fingerprint: false }`, so the boot-published build
  // id is a stable deploy fingerprint independent of per-file content hashes.
  setAssetRoots({ appDir, coreDir, enabled: !dev });

  // Install the resolver behind the isomorphic `asset()` helper (#1194), the
  // same provider seam `cspNonce()` uses. An author writes
  // `href=${asset('/public/app.css')}` and gets the fingerprinted url on the
  // server; the browser has no provider and returns the path unchanged.
  //
  // The `public/` gate is defensive rather than decorative. `resolveUrlToFile`
  // maps any same-origin path under the PROJECT ROOT, so an app that passed
  // request- or user-derived data here (`asset(user.avatarPath)`) would
  // otherwise read and publish a content hash for `/.env`, `/db/app.db`, or a
  // `.server.ts`, leaking both existence and a fingerprint of the bytes for
  // files the serve path deliberately 404s. Mirror the static-asset route:
  // under `public/`, no traversal. Everything else returns unchanged, having
  // never touched the disk.
  setAssetUrlProvider((p) => resolveAssetUrl(p, basePath()));

  // The `'use server'` load hook. Install it NOW, at boot, before any action
  // module is imported (ESM caches by URL, so a module loaded before the hook
  // would never be wrapped). Read once (not per-rebuild): the hook is global
  // and cannot be cleanly un-installed, so toggling needs a restart.
  //
  // It installs UNCONDITIONALLY, and only seed collection (#472) follows the
  // `webjs.seed` switch. Action identity (#1155) rides the same hook, and it is
  // what a bound `<form action=${action}>` resolves through, so gating the hook
  // on seeding would mean `webjs.seed: false` silently broke every no-JS form.
  await registerActionHooks({ seed: await readSeedEnabled(appDir), dev });

  // When an app commits a vendor pin (.webjs/vendor/importmap.json) it carries a
  // deterministic vendor map that is cheap to read (one file, no analysis, no
  // network). Resolve it AT BOOT and publish the build id immediately so the
  // process advertises a stable, non-empty id from its very first response: a
  // freshly-deployed pinned process is detected as a new deploy by old-deploy
  // clients with zero warmup window. Mirrors Rails importmap (committed pins
  // rendered deterministically at runtime). Pinning stays optional; an unpinned
  // app does no vendor work at boot and publishes its id after the first
  // successful resolve instead. Either way the EXPENSIVE analysis (graph, scan,
  // gate, elision) and the UNPINNED jspm resolve stay deferred to the first
  // request, so #143's win is intact; only the cheap committed-file read moves
  // back to boot, and only when a VALID pin exists. A committed pin file is
  // served as-is (elision never prunes it), so the boot-resolved map equals the
  // final served map and the published id is authoritative.
  //
  // Validate the pin with readPinFile BEFORE treating the app as pinned-at-boot.
  // hasVendorPin is a cheap existence check; a malformed pin (exists but
  // unparseable) must NOT short-circuit here, because resolveVendorImports would
  // then fall through to its bare-import scan thunk, and the boot-time thunk is
  // empty (the real scan is part of the deferred analysis). A broken pin instead
  // falls through to the normal deferred resolve, which carries the real scan
  // thunk and degrades gracefully, exactly as an unpinned app does.
  let bootVendorPinned = false;
  if (hasVendorPin(appDir) && (await readPinFile(appDir))) {
    try {
      const v = await resolveVendorImports(appDir, () => new Set());
      await setVendorEntries(v.imports, v.integrity);
      publishBuildId();
      bootVendorPinned = true;
    } catch (e) {
      // An unexpected failure applying a VALID pin (e.g. setVendorEntries
      // throwing) is non-fatal: leave bootVendorPinned false so the deferred
      // resolve re-attempts on the first request. Boot stays resilient.
      logger.error?.(`[webjs] applying the committed vendor pin at boot failed (will retry on the first request):`, e);
    }
  }

  // Whole-app analysis (module graph, component scan, browser-bound gate,
  // action index, middleware, elision, vendor) is NOT run at boot. It is
  // computed on the first request via ensureReady() below and memoized, so the
  // server starts without walking or reading the app's source, executing any
  // server module, or hitting the network. Only the route table is built
  // eagerly: it is a cheap directory scan (no code reads), and routing, Early
  // Hints, and WebSocket lookups need it available before the first request.
  const routeTable = await buildRouteTable(appDir);
  // Auto-linked favicons: tell the head builder which icon metadata routes
  // exist, so `app/icon.*` is linked when the app declares no metadata.icons.
  // Bound here rather than threaded through ssrOpts, matching
  // setClientRouterEnabled; re-bound in doRebuild so adding or deleting the
  // file takes effect without a restart.
  setMetadataIconRoutes(routeTable.metadataRoutes);

  // Emit `.webjs/routes.d.ts` (typed Route union + per-route params, #258) in
  // dev so an editor's tsserver always has up-to-date route types without the
  // developer remembering to run `webjs types`. Best-effort and fire-and-
  // forget: a failure logs and never blocks boot. Re-emitted after each route
  // rebuild (see doRebuild) so adding/removing a route refreshes the types.
  /** @returns {Promise<void>} */
  async function emitRouteTypes() {
    try {
      const { mkdir, writeFile, rename } = await import('node:fs/promises');
      const text = await generateRouteTypes(appDir);
      const outDir = join(appDir, '.webjs');
      await mkdir(outDir, { recursive: true });
      // Write to a temp sibling then rename, so tsserver (which reads this
      // file) never observes a half-written body if two rebuilds race. rename
      // is atomic within the same dir. Both paths sit under the watcher-ignored
      // .webjs/, so neither the temp write nor the rename re-triggers a rebuild.
      const dest = join(outDir, 'routes.d.ts');
      const tmp = join(outDir, `routes.d.ts.${process.pid}.tmp`);
      await writeFile(tmp, text);
      await rename(tmp, dest);
    } catch (e) {
      logger.warn?.(`[webjs] could not write .webjs/routes.d.ts (route types): ${e?.message || e}`);
    }
  }
  if (dev) void emitRouteTypes();

  // Per-path response-header rules (issue #232), read once from the
  // app's package.json `webjs.headers`. Static config, so no rebuild
  // re-read; the secure defaults need no config and apply regardless.
  const headerRules = await readHeaderRules(appDir);
  // Declarative redirect rules (issue #254), read once from the app's
  // package.json `webjs.redirects` and compiled to URLPattern rules at
  // boot (never per request). Empty when unconfigured, so an app with no
  // redirects is unchanged. Applied at the very start of request handling,
  // before routing / SSR / asset serving, so a moved URL returns a 308/307
  // immediately.
  const redirectRules = await readRedirectRules(appDir);
  // Trailing-slash policy (issue #255), read once from the app's package.json
  // `webjs.trailingSlash`. Default `'ignore'` (no canonicalization), so an
  // unconfigured app is unchanged; `'never'` (recommended) strips a trailing
  // slash and `'always'` adds one, each via a 308 to the canonical form.
  // Applied in produce() AFTER the declarative redirects, so an explicit
  // redirect rule wins first and the two never loop.
  const trailingSlashPolicy = await readTrailingSlashFromApp(appDir);
  // CSP config (issue #233), read once from the app's package.json
  // `webjs.csp`. OFF by default: when disabled no nonce is minted and no
  // Content-Security-Policy header is set, so an unconfigured app is
  // unchanged. When enabled, `handle()` mints a fresh per-request nonce,
  // makes it the value `cspNonce()` returns (so the SSR'd inline scripts
  // carry it), and sets the matching header carrying the same nonce.
  const cspConfig = await readCspConfigFromApp(appDir);
  // Request body-size limits (issue #237), read once from the app's
  // package.json `webjs.maxBodyBytes` / `webjs.maxMultipartBytes` plus the env
  // overrides. The secure defaults (1 MiB JSON/RPC, 10 MiB form) apply when
  // unconfigured. Stamped on every request via `setBodyLimits` so `readBody`
  // (used inside route handlers) enforces the same cap the RPC and form-dispatch
  // paths do.
  const bodyLimits = await readBodyLimitsFromApp(appDir);

  const state = {
    routeTable,
    actionIndex: null,
    middleware: null,
    bodyLimits,
    logger,
    // Test-mode serve gate (#806). Set ONLY by the browser-test harness
    // (`@webjsdev/server/testing`'s `createBrowserTestHandler`), NEVER by
    // `webjs dev` / `webjs start`. When true the source-serve gate is relaxed
    // so ANY app file under appDir is servable (a component a browser test
    // imports is not route-reachable, so it is absent from `browserBoundFiles`
    // and would 404). The `.server.*` guardrail (source -> RPC/throw stub) and
    // the core / vendor serving are unchanged, so no server source is exposed.
    testMode: opts.testMode === true,
    moduleGraph: null,
    elidableComponents: new Set(),
    inertRouteModules: new Set(),
    importOnlyRouteModules: new Map(),
    // The browser-bound ENTRY files (pages / layouts / boundaries / components),
    // kept alongside the expanded gate set because the vendor scan roots at the
    // entries rather than at the closure.
    browserEntryFiles: new Set(),
    browserBoundFiles: null,
    // Dev live-reload classification (#1398). `shippedFiles` is the transitive
    // closure of what the browser can ACTUALLY load (the gate set minus every
    // module elision drops), `graphFiles` is every app source the graph walked,
    // and `pageFiles` is the route table's pages. Together they are the whole
    // input to `classifyChangedPath`, so a watch event can be answered without
    // reaching into the rest of this state. Dev-only; left empty in prod.
    /** @type {Set<string>} */
    shippedFiles: new Set(),
    /** @type {Set<string>} */
    graphFiles: new Set(),
    /** @type {Set<string>} */
    pageFiles: new Set(),
    // Transformed-source cache (stripped TS + applied elision). Per-handler,
    // NOT module-global: the cached bytes bake in THIS handler's elision
    // verdict, so two handlers for the same app with different elision
    // settings (a multi-tenant embedder, or the differential elision test)
    // must not share it, or the second would serve the first's elided source.
    tsCache: new Map(),
    // The most recent unresolved dev error frame (#264), or null. Pushed to the
    // SSE channel for the live overlay and replayed to a freshly-connected tab.
    // Dev-only (never populated when !dev); cleared on a successful rebuild.
    lastDevError: null,
    // On-request regeneration rules (#967): `webjs.dev.regenerate` from the app's
    // package.json. Dev-only (prod builds its outputs via `start.before`). Loaded
    // now and refreshed on each rebuild so a config edit takes effect without a
    // restart; empty for a plain app, so the serving path is unaffected.
    regenerateRules: dev ? await readRegenerateRules(appDir) : [],
  };

  // Teach the renderers how to turn a real server-action function into the
  // `<hash>/<fn>` identity a form submits (#1155). The hook path is
  // process-global and needs no index; `state.actionIndex` is consulted only as
  // a hash memo, and by the scan fallback for a runtime with no hook. In a
  // process running several handlers the fallback therefore resolves against
  // the most recently booted one, which is the same scope the asset-url
  // provider already has.
  setFormActionResolver((fn) => (state.actionIndex ? resolveActionIdentity(state.actionIndex, fn) : null));

  /**
   * Report a dev error (#264): build a frame and push it to the open tab via
   * the SSE overlay channel. DEV-ONLY and best-effort, so it can never affect a
   * response or crash the server (a frame-build failure is swallowed). No file
   * path or source is ever built in prod (the early return), so nothing leaks.
   *
   * `info.url` stamps a `render` frame with the URL that produced it (#1047), so
   * the browser overlay can refuse a frame for a page the tab is not viewing.
   * A `ts-strip` / `rebuild` frame passes none and stays unscoped.
   *
   * @param {unknown} error
   * @param {{ kind?: 'render'|'ts-strip'|'rebuild', file?: string, line?: number, column?: number, hint?: string, url?: string }} [info]
   */
  function reportDevError(error, info = {}) {
    if (!dev) return;
    try {
      const frame = buildDevErrorFrame(error, { ...info, appDir });
      state.lastDevError = frame;
      opts.onDevError?.(frame);
    } catch { /* ignore */ }
  }

  // All whole-app analysis is built lazily on the first request, memoized so
  // boot does none of it. It runs in two stages. The deterministic analysis
  // (module graph, component scan + prime, browser-bound gate, action index,
  // middleware, elision) is network-free and, once built, never re-runs unless
  // a rebuild invalidates it; readiness gates on it. Vendor resolution is a
  // SEPARATE, best-effort stage: a pinned app reads a committed importmap file,
  // an unpinned app auto-fetches from jspm. It does NOT gate readiness, so an
  // offline or partially-unresolvable app still boots. A transient vendor
  // failure is re-attempted on the NEXT ensureReady call (driven by an incoming
  // request, a readiness probe, or the warm-up), with no background timer: the
  // platform's traffic and probes are the retry loop. `readyError` holds a
  // propagating analysis failure so /__webjs/ready can report it.
  let analysisDone = false;
  // Whether the analysis has EVER completed (#1398). Distinct from
  // `analysisDone`, which `doRebuild` flips false on every edit: the live-reload
  // classifier needs to know the derived sets are POPULATED, not that they are
  // current, because it deliberately classifies against the previous build's
  // graph (see the note in `doRebuild`). Gating it on `analysisDone` turned the
  // feature off for every edit after the first in a burst, since nothing
  // re-warms the analysis until an HTTP request arrives and the relay defers
  // that request by its 2000ms quiet window (#1397), which is longer than the
  // measured inter-save gap. Never reset.
  let analysisEverDone = false;
  // A pinned app applied its FULL vendor map and published the build id at boot
  // (above). The deferred vendor stage still runs once (and after every rebuild)
  // to PRUNE that map to the elision-reachable specifiers, so a pinned app serves
  // the same map an unpinned one does (#197); it does not re-publish the build id
  // (the boot hash stays the deploy fingerprint). An unpinned app starts false and
  // resolves live on the first request.
  let vendorResolved = false;
  let vendorAttemptedOnce = false;
  let vendorGen = 0;
  let readyDone = false;
  /** @type {unknown} */
  let readyError = null;
  /** @type {Promise<void> | null} */
  let readyInFlight = null;

  async function ensureReady() {
    // Fully warm: analysis done and vendor resolved. Nothing to do.
    if (analysisDone && vendorResolved) return;
    // A warm pass is in flight (the analysis and/or the FIRST vendor attempt).
    // Await it rather than serving past it: a concurrent early request must get
    // the FINAL importmap, never a half-resolved one. This is what makes the
    // unpinned warmup flawless. The first attempt's jspm resolve is
    // timeout-bounded (vendor.js), so an offline app cannot hang here: on
    // timeout the resolve returns and the response is served with an empty,
    // reload-safe build id, then the retry below completes it. Without this
    // wait, a request arriving mid-resolve would serve a partial map and an
    // empty-then-changing build id, the exact warmup drift that hard-reloads
    // and wipes a half-filled form.
    if (readyInFlight) { await readyInFlight; return; }
    // Analysis warm but the first vendor attempt already completed and failed:
    // re-attempt WITHOUT blocking this request. The single-flight dedupes
    // concurrent attempts; success flips the flag AND publishes the build id.
    // This is the request/probe-driven retry (no timer). Until it succeeds the
    // served build id stays empty (reload-safe), so no navigation hard-reloads.
    if (analysisDone && vendorAttemptedOnce) {
      const gen = vendorGen;
      resolveAndApplyVendor().then((ok) => { if (ok && gen === vendorGen) { vendorResolved = true; if (!bootVendorPinned) publishBuildId(); } }).catch(() => {});
      return;
    }
    // Otherwise run the (single-flighted) full warm: the analysis, then the
    // first vendor attempt, awaited so the first response carries the import map.
    if (!readyInFlight) {
      readyInFlight = (async () => {
        /** @type {Record<string, number>} */
        const t = {};
        let ranAnalysis = false, ranVendor = false;
        const now = () => performance.now();
        try {
          if (!analysisDone) {
            let m = now();
            state.moduleGraph = await buildModuleGraph(appDir);
            t.graph = now() - m; m = now();
            const components = await scanComponents(appDir);
            await primeComponentRegistry(appDir, components);
            t.scan = now() - m; m = now();
            state.browserEntryFiles = browserEntryFiles(state.routeTable, components);
            state.browserBoundFiles = reachableFromEntries(state.moduleGraph, [...state.browserEntryFiles], appDir);
            t.gate = now() - m; m = now();
            state.actionIndex = await buildActionIndex(appDir, dev);
            t.actions = now() - m; m = now();
            state.middleware = await loadMiddleware(appDir, dev, logger);
            t.middleware = now() - m; m = now();
            // Client-router opt-out (#629): re-read each pass so toggling
            // `webjs.clientRouter` takes effect on rebuild without a restart.
            setClientRouterEnabled(await readClientRouterEnabled(appDir));
            // Read the switch ONCE: the dev summary below reports it too, and
            // calling readElideEnabled twice per warm re-reads package.json.
            const elideOn = await readElideEnabled(appDir);
            const r = elideOn
              ? await analyzeElision(components, collectRouteModules(state.routeTable),
                  state.moduleGraph, (f) => readFile(f, 'utf8'), appDir)
              : { elidableComponents: new Set(), inertRouteModules: new Set(), importOnlyRouteModules: new Map(),
                  shippedRouteModules: new Map(), componentVerdicts: new Map() };
            state.elidableComponents = r.elidableComponents;
            state.inertRouteModules = r.inertRouteModules;
            state.importOnlyRouteModules = r.importOnlyRouteModules;
            // Dev live-reload classification (#1398): derive the three sets the
            // watch-event classifier reads. `browserBoundFiles` above is the
            // AUTHORIZATION gate (it walks from every entry, elided ones
            // included, because an elided module's URL must still 404 rather
            // than leak), so it is the wrong input here: the question is what
            // the browser actually HOLDS. Re-walk from the entries elision
            // keeps, and an edit to anything reachable from those is a reload.
            // An import-only page's substituted components are themselves
            // entries, so dropping the page loses none of its reach.
            if (dev) {
              const shippedEntries = [...state.browserEntryFiles].filter((f) =>
                !state.elidableComponents.has(f)
                && !state.inertRouteModules.has(f)
                && !state.importOnlyRouteModules.has(f));
              state.shippedFiles = reachableFromEntries(state.moduleGraph, shippedEntries, appDir);
              state.graphFiles = seenFilesFor(state.moduleGraph);
              state.pageFiles = new Set((state.routeTable.pages || []).map((p) => p.file).filter(Boolean));
            }
            // Fold the elision verdict into app-module content hashes (#243): an
            // app module's served body is elision-transformed, so a verdict flip
            // must bust its `?v` even when its source is byte-identical. A stable
            // string of the sorted elidable + inert paths, RELATIVIZED to appDir
            // so the fingerprint is a property of the app's STRUCTURE, not its
            // filesystem location (two deploys at different absolute paths, or
            // two identical apps, produce the same fingerprint). asset-hash
            // digests it into each app-module hash; '' when nothing is elidable,
            // so a no-elision app's hash stays exactly `sha256(bytes)`.
            {
              // `appDir + sep` boundary (matches asset-hash's containment guard)
              // so a sibling-prefix dir cannot be mis-relativized.
              const rel = (p) => (p.startsWith(appDir + sep) ? p.slice(appDir.length) : p);
              const elidedPaths = [
                ...state.elidableComponents,
                ...state.inertRouteModules,
                // An import-only module is dropped from the boot (replaced by its
                // component imports), so a flip in / out of that class must bust
                // the importer's `?v` too.
                ...state.importOnlyRouteModules.keys(),
              ].map(rel).sort();
              setElisionFingerprint(elidedPaths.length ? elidedPaths.join('\n') : '');
            }
            // App-source fingerprint for the HTML cache key (#318): a
            // deterministic, location-independent digest of the browser-bound
            // file set's content hashes, so a deploy that changes ONLY an app
            // module's bytes (which the importmap-only build id misses) re-keys
            // the cache instead of serving a body with stale `?v` boot URLs.
            // PROD only (asset-hash is enabled there); '' in dev, where fs.watch
            // handles staleness. Computed AFTER the elision fingerprint, so each
            // per-file hash already reflects the elision verdict (an elision
            // flip changes the served output, so it moves this fingerprint too).
            // This eagerly hashes the WHOLE browser-bound set once (not just the
            // first route's files), but `assetHashFor` is memoized and already
            // runs for `?v` emission in prod, so it stays a one-time bounded cost
            // inside the lazy analysis (never at boot).
            if (!dev && state.browserBoundFiles) {
              const relApp = (p) => (p.startsWith(appDir + sep) ? p.slice(appDir.length) : p);
              const lines = [...state.browserBoundFiles]
                .map((abs) => `${relApp(abs)}:${assetHashFor(abs)}`)
                .sort();
              setAppSourceFingerprint(lines.join('\n'));
            } else {
              setAppSourceFingerprint('');
            }
            // App-source deploy SIGNAL (#899), distinct from the #318 html-cache
            // fingerprint above: hashes ALL app source (the module-graph `seen`
            // set, INCLUDING server-only `.server.ts` that `browserBoundFiles`
            // omits) with a raw per-file byte digest (decoupled from the
            // asset-hash memo/elision machinery), plus the installed
            // `@webjsdev/server` version, so an app-source OR a server-framework
            // deploy moves it. Sorted + appDir-relative for determinism across
            // instances. Drives the client's soft cache-evict (not a reload).
            // PROD only; empty in dev (fs.watch + SSE handle staleness there).
            if (!dev && state.moduleGraph) {
              const relApp = (p) => (p.startsWith(appDir + sep) ? p.slice(appDir.length) : p);
              const srcLines = [...seenFilesFor(state.moduleGraph)]
                .map((abs) => `${relApp(abs)}:${fileByteHash(abs)}`)
                .sort();
              srcLines.push(`@webjsdev/server:${frameworkServerVersion()}`);
              setAppSourceId(srcLines.join('\n'));
            } else {
              setAppSourceId('');
            }
            t.elision = now() - m;
            if (dev) {
              // An orphan is EITHER shape `findOrphanComponents` reports: no
              // registration call at all, or one whose tag is computed. The
              // scanner matches only a literal tag, so it sees neither, and
              // what is ALWAYS lost is the verdict, the registry entry, and the
              // preload hint. The upgrade is the part that differs, and a
              // computed tag only survives when its importer ships WHOLE (see
              // findOrphanComponents for why that is the exception). The doctor
              // check and `webjs elision` say the same thing.
              for (const { className, file } of await findOrphanComponents(appDir)) {
                logger.warn?.(
                  `[webjs] ${className} extends WebComponent but is never registered with a literal tag in ${file} ` +
                    `(either there is no registration call, or its tag is computed), so the scanner cannot see it: ` +
                    `no elision verdict, no registry entry, no preload hint. ` +
                    `<${kebab(className)}> tags never upgrade with no registration call, and a computed tag ` +
                    `upgrades only while its importing module ships whole. ` +
                    `Add \`${className}.register('<tag-name>');\` with a literal tag.`,
                );
              }
              // The elision summary (#1308), one server-console line. NOT a
              // browser push: an inert route ships zero application JS, and the
              // most useful manual check an author has is opening the network
              // tab on that route and seeing nothing, which a dev-only boot
              // script would corrupt on exactly the pages this proves. The fact
              // is also app-wide while a browser channel is per-tab, and the
              // per-page detail already has a home in `webjs elision`.
              // Re-emitted after each fs.watch rebuild, because doRebuild sets
              // analysisDone = false and this sits inside that stage.
              logger.info?.(
                elideOn
                  ? `[webjs] elision: ${r.elidableComponents.size}/${new Set(components.map((c) => c.file)).size} components elided, ` +
                    `${r.inertRouteModules.size} route modules inert, ${r.importOnlyRouteModules.size} import-only, ` +
                    `${r.shippedRouteModules.size} ship whole. Run \`webjs elision\` for the per-module verdict.`
                  : `[webjs] elision: disabled (WEBJS_ELIDE / webjs.elide), every module ships.`,
              );
            }
            analysisDone = true;
            analysisEverDone = true;
            ranAnalysis = true;
          }
          readyError = null;
          if (!vendorResolved) {
            const m = now();
            const gen = vendorGen;
            vendorAttemptedOnce = true;
            const ok = await resolveAndApplyVendor();
            t.vendor = now() - m;
            ranVendor = true;
            // Only memoize success (and only if a rebuild didn't intervene). A
            // transient failure leaves vendorResolved false; the next ensureReady
            // call re-attempts it non-blocking. A permanent unresolvable (jspm
            // 401) reports ok and is tolerated, so it does not loop. On success
            // the importmap is now authoritatively final, so publish the build
            // id: from here every response advertises the same stable value and
            // the client router's deploy detection works without warmup drift.
            // A pinned app published the build id at boot (hash of the committed
            // pin) and the prune only shrinks the served map, so do NOT re-publish
            // (that would drift the id mid-process). An unpinned app publishes its
            // now-final live map here.
            if (ok && gen === vendorGen) { vendorResolved = true; if (!bootVendorPinned) publishBuildId(); }
          }
          // Readiness reflects a FULLY warm instance: the deterministic analysis
          // AND the first vendor attempt have both completed (note: completed,
          // not necessarily succeeded). A readiness-gated platform (Railway
          // healthcheckPath, k8s readinessProbe) therefore admits traffic only
          // AFTER the build id is published (vendor resolved) or definitively
          // empty (a bounded vendor failure), never DURING the vendor-resolution
          // window. This is what makes warm-up actually protect users: the prior
          // instance keeps serving until the new one is fully warm, so a real
          // request lands on a warm instance with a stable build id instead of
          // racing the resolve. The first vendor attempt is bounded (the jspm
          // fetch timeout in vendor.js), so an offline / CDN-degraded app still
          // becomes ready shortly after that timeout, degraded but reload-safe,
          // which preserves the boot resilience #143 introduced. The gate is the
          // FIRST attempt only: a transient failure still flips readyDone here,
          // so a later non-blocking retry never has to re-open the readiness gate.
          readyDone = true;
          if (ranAnalysis) {
            const ms = (x) => Math.round(x || 0);
            const total = ms(t.graph) + ms(t.scan) + ms(t.gate) + ms(t.actions) + ms(t.middleware) + ms(t.elision) + ms(t.vendor);
            logger.info?.(
              `[webjs] analysis warm in ${total}ms (graph ${ms(t.graph)}, scan ${ms(t.scan)}, ` +
                `gate ${ms(t.gate)}, actions ${ms(t.actions)}, middleware ${ms(t.middleware)}, ` +
                `elision ${ms(t.elision)}, vendor ${ms(t.vendor)})`,
            );
          } else if (ranVendor && vendorResolved) {
            logger.info?.(`[webjs] vendor resolved in ${Math.round(t.vendor || 0)}ms`);
          }
        } catch (e) {
          readyError = e;
          throw e;
        } finally {
          readyInFlight = null;
        }
      })();
    }
    await readyInFlight;
  }

  // All vendor resolves funnel through one single-flight so two never overlap
  // (resolveVendorImports reports a transient failure via a module-global flag
  // that only one in-flight resolve may safely touch). Never rejects; returns
  // the resolve's ok flag (false on a transient failure, applying whatever
  // partial map resolved so the app is no worse off).
  /** @type {Promise<boolean> | null} */
  let vendorResolveInFlight = null;
  function resolveAndApplyVendor() {
    if (vendorResolveInFlight) return vendorResolveInFlight;
    vendorResolveInFlight = (async () => {
      try {
        const scan = async () => {
          const skip = new Set([...state.elidableComponents, ...state.inertRouteModules, ...state.importOnlyRouteModules.keys()]);
          return reachedBareImports(state.moduleGraph, [...state.browserEntryFiles], appDir, skip);
        };
        const v = await resolveVendorImports(appDir, scan);
        let { imports, integrity } = v;
        if (bootVendorPinned) {
          // resolveVendorImports returns a committed pin VERBATIM (it never runs
          // the scan for a pinned app). Prune it to the elision-reachable
          // specifiers so a pinned app serves the same map an unpinned one does
          // (#197): an elided-only dep like dayjs is dropped. One scan; the pin
          // path skipped it. This runs on the first warm AND after every rebuild,
          // so the pruned map is the single source of truth.
          const reachable = await scan();
          ({ imports, integrity } = prunePinToReachable(imports, integrity, reachable));
        }
        await setVendorEntries(imports, integrity);
        return v.ok;
      } catch (e) {
        logger.error?.(`[webjs] vendor resolve failed (will retry on the next request):`, e);
        return false;
      }
    })().finally(() => { vendorResolveInFlight = null; });
    return vendorResolveInFlight;
  }

  // Optional app-level readiness check. A `readiness.{js,ts}` file at the app
  // root may default-export an async function; /__webjs/ready runs it once the
  // analysis is warm, so readiness can reflect LIVE dependency health (a DB
  // ping, a queue connection) that the static analysis cannot see. Returning
  // false or throwing reports the instance not ready (503), so a readinessProbe
  // holds traffic off an instance whose deps are down. Absent file => analysis-
  // warm is the only gate. The module is cached per build (cleared on rebuild);
  // the function itself runs on every probe so it reflects current state.
  let readinessFn;
  async function getReadinessCheck() {
    if (readinessFn !== undefined) return readinessFn;
    let file = null;
    for (const name of ['readiness.ts', 'readiness.js', 'readiness.mts', 'readiness.mjs']) {
      const p = join(appDir, name);
      if (await exists(p)) { file = p; break; }
    }
    if (!file) { readinessFn = null; return null; }
    try {
      const url = pathToFileURL(file).toString();
      const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
      const mod = await import(url + bust);
      readinessFn = typeof mod.default === 'function' ? mod.default : null;
    } catch (e) {
      logger.error?.(`[webjs] failed to load readiness.{js,ts}`, { err: String(e) });
      readinessFn = null;
    }
    return readinessFn;
  }

  // Rebuilds are serialized so a slow rebuild #1 cannot overwrite a fresher
  // rebuild #2's route table when it finally finishes. Without this, two file
  // edits inside one fs.watch debounce window could produce a permanently
  // stale state until the next rebuild.
  let rebuildInFlight = Promise.resolve();

  /**
   * @param {import('../dev-classify.js').ReloadVerdict} [verdict] the live-reload
   *   classification of the change that triggered this rebuild (#1398). Absent
   *   (an embedded host calling `rebuild()`, or any caller with no filename to
   *   classify) means a full reload, which is the fail-safe default.
   */
  async function rebuild(verdict) {
    rebuildInFlight = rebuildInFlight.then(() => doRebuild(verdict)).catch((e) => {
      logger.error?.(`[webjs] rebuild failed:`, e);
      // Push the failure to the open tab so the overlay appears live after a
      // breaking edit, not only on the next manual navigation (#264).
      reportDevError(e, { kind: 'rebuild' });
    });
    return rebuildInFlight;
  }

  /** @param {import('../dev-classify.js').ReloadVerdict} [verdict] */
  async function doRebuild(verdict) {
    // The route table is the only eager artifact (cheap directory scan); rebuild
    // it so routing reflects added/removed route files immediately.
    state.routeTable = await buildRouteTable(appDir);
    // Adding or deleting app/icon.* changes whether the head auto-links it.
    setMetadataIconRoutes(state.routeTable.metadataRoutes);
    // Refresh the generated route types (#258) so adding/removing a route file
    // updates `.webjs/routes.d.ts` without a manual `webjs types`. Dev only,
    // best-effort (see emitRouteTypes).
    if (dev) void emitRouteTypes();
    clearVendorCache();
    // Content-hash asset cache (#243): clear so a changed file re-hashes and
    // its emitted `?v` busts the stale immutable copy. A no-op in dev (the
    // module is never enabled there), kept for correctness + the deploy-busts
    // regression test, which clears + re-hashes to observe a changed `?v`.
    clearAssetHashCache();
    state.tsCache.clear();
    // Invalidate the lazy analysis; the next request rebuilds the graph,
    // component scan, gate, action index, middleware, elision, and vendor map.
    // Wait out any in-flight build first so it cannot commit stale results
    // after the reset. A dependency edit can flip an elision verdict without
    // changing an importer's mtime, hence the state.tsCache.clear above.
    if (readyInFlight) { try { await readyInFlight; } catch {} }
    // Bump the vendor generation so a vendor resolve still in flight from the
    // previous build cannot flip vendorResolved against the fresh state.
    vendorGen++;
    analysisDone = false;
    vendorResolved = false;
    vendorAttemptedOnce = false;
    readyDone = false;
    readyError = null;
    readinessFn = undefined;
    // Refresh the on-request regenerate rules (#967) so a `webjs.dev.regenerate`
    // config edit takes effect without a restart, mirroring the elide/router
    // re-reads above. Dev-only; a no-op array in prod.
    if (dev) state.regenerateRules = await readRegenerateRules(appDir);
    // Optimistically clear the dev error (#264): the rebuild itself only
    // re-scans the route table and INVALIDATES the lazy analysis (the real
    // re-parse / re-strip / re-render happens on the next request), so we do
    // not yet know the edit fixed the error. Clearing it here means a tab that
    // connects now is not replayed a possibly-stale overlay; `onReload` then
    // reloads every open tab, and if the underlying error is still present the
    // reloaded request re-pushes a fresh frame (a brief dismiss-then-reappear
    // flicker on an unrelated edit, self-correcting to the right end state).
    state.lastDevError = null;
    // The verdict was computed against the PREVIOUS build's graph, because this
    // rebuild only INVALIDATES the lazy analysis (`analysisDone = false` above)
    // and the fresh graph is not built until the next request. Awaiting
    // `ensureReady()` here to classify against the new one would push the SSE
    // frame roughly 1900ms later on a large app and stack that in front of the
    // relay's quiet window, so it is not worth it. The one case that could
    // exploit the staleness, an edit that adds a brand-new component import to
    // an otherwise morphable page, is closed on the CLIENT: `addNewHeadElements`
    // runs on both boundary tiers and swaps in the changed boot script, which
    // executes and registers the new component.
    opts.onReload?.(verdict || { v: 'reload', by: '', why: 'no-verdict' });
  }

  /** @param {Request} req */
  function handle(req) {
    return withRequest(req, async () => {
      // Correlation id (issue #239): honor an inbound X-Request-Id from a
      // trusted upstream proxy, else mint a fresh UUID. Stored on the request
      // scope FIRST so everything downstream (the SSR, server actions, the
      // access / error log, the onError sink, the response header) reads the
      // same id, threading one trace id across services.
      const reqId = resolveRequestId(req);
      setRequestId(reqId);

      // CSP (issue #233): when enabled, mint a fresh CSPRNG nonce and store
      // it on the request scope BEFORE producing the response, so the SSR
      // pipeline's `cspNonce()` reads this exact value and stamps it on the
      // inline boot script, the importmap, and the modulepreload hints.
      // Disabled by default, so no nonce is minted and the response is
      // unchanged. One minted value flows mint -> store -> SSR -> header.
      const nonce = cspConfig.enabled ? mintNonce() : '';
      if (nonce) setCspNonce(nonce);

      // Make the resolved body-size limits (issue #237) readable from the
      // request scope, so `readBody` inside a route handler enforces the same
      // cap the framework's own RPC / form-dispatch body reads do.
      setBodyLimits(state.bodyLimits);

      let pathname = '/';
      try { pathname = new URL(req.url).pathname; } catch { /* keep default */ }
      // Sub-path deployment (issue #256): the per-path response-header rules
      // (`webjs.headers`) author their `source` patterns app-root-relative,
      // exactly like `webjs.redirects` / `webjs.trailingSlash` (which the
      // ingress strip in produce() already sees root-relative). So match the
      // header rules against the STRIPPED path too, keeping the whole config
      // surface consistent under a base path. `pathname` itself (used for the
      // access log) stays the RAW path the client hit. No-op when basePath is
      // empty or the request is not under it.
      let headerPathname = pathname;
      if (basePathValue) {
        const s = stripBasePath(pathname, basePathValue);
        if (s !== null) headerPathname = s;
      }
      const startedAt = performance.now();

      let res;
      try {
        res = await produce(req);
      } catch (e) {
        // A throw escaping produce() is the last-resort 500 (every interior
        // path catches its own errors, but a surprise still must not crash the
        // host). Fire the onError sink (best-effort) and emit a sanitized 500,
        // preserving the prior behavior plus the new APM hook.
        reportError(e, req, 'handle');
        logger.error?.('[webjs] request pipeline threw', {
          requestId: reqId,
          method: req.method,
          path: pathname,
          err: e instanceof Error ? e.stack : String(e),
        });
        res = new Response('Server error', { status: 500 });
      }

      // Merge in the secure-by-default headers plus the per-path config
      // (issue #232) as the final step, so app middleware, route
      // handlers, and `expose` headers (already on `res`) always win.
      // Applied to every served response (documents, assets, the core
      // runtime, probes), since the defaults are universally safe.
      let merged = applySecurityHeaders(res, {
        pathname: headerPathname,
        https: webRequestIsHttps(req),
        prod: !dev,
        rules: headerRules,
      });

      // Expose the correlation id on the response (issue #239) so a client /
      // proxy can read it from the X-Request-Id header. Never clobber an id an
      // upstream / the app already set on the response.
      if (!merged.headers.has('x-request-id')) merged.headers.set('x-request-id', reqId);

      // Emit the Content-Security-Policy header carrying the SAME minted
      // nonce the SSR'd scripts got (no drift). Set only when CSP is
      // enabled; never clobber a CSP header the app already set (in
      // middleware, a route handler, or via the webjs.headers config), so
      // an explicit app policy still wins.
      if (nonce && !merged.headers.has('content-security-policy') &&
          !merged.headers.has('content-security-policy-report-only')) {
        try {
          // readCspConfig already drops a directive whose name/value carries a
          // control char, so buildCspHeader produces a Headers-safe value. The
          // try/catch is a belt-and-suspenders backstop: a surprise value must
          // never throw the response pipeline (fail closed to no CSP header
          // rather than a self-inflicted 500 on every request).
          merged.headers.set(cspHeaderName(cspConfig), buildCspHeader(cspConfig, nonce));
        } catch {
          /* ignore */
        }
      }

      // Server HTML cache write (#241): if the SSR marked this response as a
      // cache candidate (an opted-in `revalidate` page), store the FINAL body
      // now, after segment middleware has added any per-user Set-Cookie (which
      // the funnel's guard re-checks, so a per-user response is not cached) and
      // before conditional-GET can swap it for a bodiless 304. The marker is
      // stripped here regardless. Best-effort: a store failure is swallowed.
      try {
        const reqUrl = new URL(req.url);
        // Sub-path deployment (issue #256): the HTML cache READ (in ssrPage)
        // and `revalidatePath` both key on the app-root-relative path, so key
        // the WRITE on the stripped path too, or a cached page would never
        // hit. No-op when basePath is empty / the path is not under it.
        if (basePathValue) {
          const s = stripBasePath(reqUrl.pathname, basePathValue);
          if (s !== null) reqUrl.pathname = s;
        }
        merged = await commitHtmlCache(req, merged, reqUrl);
      } catch { /* ignore */ }

      // Conditional GET (RFC 7232, issue #240): attach a content-hash ETag to
      // a cacheable response missing one, and turn a matching If-None-Match
      // into a 304 Not Modified with no body. Applied LAST, after every header
      // (X-Webjs-Build, X-Request-Id, Set-Cookie, CSP) is on the response, so a
      // 304 carries the validators a shared cache and the client router need.
      // A no-store response, a non-GET/HEAD, and a streaming Suspense body are
      // all skipped (see conditional-get.js). A `private` response is NOT
      // skipped: private forbids shared storage, not validation (#1140). Logged with the final
      // (possibly 304) status. Best-effort: a failure leaves the 200 untouched.
      let conditioned = merged;
      try {
        conditioned = await applyConditionalGet(req, merged);
      } catch { /* ignore */ }

      // Structured access log (issue #239): ONE info line per handled request
      // at the single response funnel, carrying only method / path / status /
      // duration / requestId (no bodies, no secrets). Suppressed for the
      // framework's own /__webjs/* probe + static traffic so it does not spam.
      // Best-effort: a logger that throws must not take the response down.
      // Use the STRIPPED path for the suppression check (issue #256) so a
      // framework probe at `<basePath>/__webjs/*` is suppressed just like the
      // root-mounted `/__webjs/*`. The logged `path` stays the RAW client URL.
      if (shouldAccessLog(headerPathname)) {
        try {
          // #1309: fold the dev-only seeding counters into the ONE access-log
          // line rather than adding a second one. Present only on a response
          // that carried the header, so only page renders gain the field and
          // production is unchanged.
          const seed = dev ? conditioned.headers.get('x-webjs-seed') : null;
          logger.info?.('request', {
            requestId: reqId,
            method: req.method,
            path: pathname,
            status: conditioned.status,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            ...(seed ? { seed } : {}),
          });
        } catch { /* never let logging crash the response */ }
      }
      return conditioned;
    });
  }

  /** @param {Request} req */
  async function produce(req) {
    const rawUrl = new URL(req.url);

    // Sub-path deployment ingress strip (issue #256). When `webjs.basePath`
    // is set and the request path is under it, STRIP the prefix and rewrite
    // the Request so EVERYTHING downstream (redirects, trailing-slash, the
    // probes, the `/__webjs/*` checks, the source-file gate, route matching,
    // SSR) sees a ROOT-relative path and works UNCHANGED. This single strip
    // is why the rest of the framework needs no per-site changes. A request
    // whose path is NOT under the base path is not for this mounted app, so
    // return a 404 (the safe default for a mounted app). Empty basePath (the
    // default) is a pure pass-through, so an unconfigured app is unchanged.
    if (basePathValue) {
      const stripped = stripBasePath(rawUrl.pathname, basePathValue);
      if (stripped === null) {
        return new Response('Not found', { status: 404 });
      }
      const newUrl = new URL(req.url);
      newUrl.pathname = stripped;
      // Rewrite the Request with the stripped URL, preserving method,
      // headers, and body. `duplex: 'half'` is required by the spec when
      // a body stream is present on a non-GET/HEAD request.
      //
      // SECURITY (#756): this is a fresh Request object, so it is NOT in the
      // listener's out-of-band trusted-IP WeakMap (the Bun shell stamps the IP
      // there instead of cloning the Request to set the header). Without
      // carrying it forward, `clientIp` would fall back to the inbound
      // `x-webjs-remote-ip` header that the copied `req.headers` still carries,
      // which a client can spoof. So strip that header on the rebuild and
      // propagate the framework-trusted IP across the new object, the same
      // pattern form-dispatch.js uses.
      const headers = new Headers(req.headers);
      headers.delete('x-webjs-remote-ip');
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const next = new Request(newUrl, /** @type {any} */ ({
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: req.redirect,
        signal: req.signal,
      }));
      propagateTrustedRemoteIp(req, next);
      req = next;
    }

    if (redirectRules.length) {
      // Declarative redirects (issue #254): apply the configured old-path ->
      // new-path rules at the VERY START of request handling, before the
      // probes, routing, SSR, or asset serving. A matched source returns a
      // 308 (permanent, the SEO default) / 307 (temporary) / configured
      // status immediately, so a moved URL never reaches the router.
      // `applyRedirects` skips /__webjs/* itself, so the framework probes /
      // runtime below are never redirected. The secure-header + conditional-GET
      // funnel in handle() still wraps this Response, like any other.
      const redir = applyRedirects(req, redirectRules);
      if (redir) return redir;
    }

    if (trailingSlashPolicy !== 'ignore') {
      // Trailing-slash canonicalization (issue #255): after the explicit
      // redirects above (so an explicit rule wins first and the two never
      // form a loop), 308-redirect a non-canonical path to the policy's
      // canonical form (`never` strips a trailing slash, `always` adds one).
      // Default `'ignore'` is a no-op. The root `/` and file paths are
      // exempt; `/__webjs/*` is exempt too (defense in depth, the redirects
      // above already skip it). The funnel in handle() still wraps this.
      const canonical = applyTrailingSlash(req, trailingSlashPolicy);
      if (canonical) return canonical;
    }

    const url = new URL(req.url);
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }

    // Health and readiness probes are answered BEFORE ensureReady so a probe
    // never blocks on the analysis. `/__webjs/health` is liveness (the
    // process is up and accepting connections). `/__webjs/ready` is 503 until
    // the instance is FULLY warm (the deterministic analysis AND the first
    // vendor attempt have both completed, so the importmap build id is
    // settled), then 200 unless an optional app readiness check
    // (readiness.{js,ts}) reports a dependency down. So a readinessProbe holds
    // traffic off a not-yet-warm or dependency-unhealthy instance, and admits
    // it only once the build id is stable, never mid vendor-resolution.
    // Probing `/__webjs/ready` also kicks off the warm in the background, so
    // an embedder that never called warmup() still warms. The first vendor
    // attempt is bounded (the jspm fetch timeout), so a vendor CDN failure
    // delays readiness only briefly and then admits the instance (degraded but
    // reload-safe); a transient failure is re-attempted on the next request.
    if (path === '/__webjs/health') {
      return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
    }

    // Build-info probe (issue #239): which build is live? Answered before
    // ensureReady like the other probes (it depends only on the package
    // version + already-published build id + process info, never the app
    // analysis). No secrets.
    if (path === '/__webjs/version') {
      return buildInfoResponse();
    }

    if (path === '/__webjs/ready') {
      const noStore = { 'cache-control': 'no-store' };
      if (!readyDone) {
        ensureReady().catch(() => {}); // drive the warm; never block the probe
        const body = readyError
          ? { status: 'error', error: String((readyError && readyError.message) || readyError) }
          : { status: 'pending' };
        return Response.json(body, { status: 503, headers: noStore });
      }
      // Analysis is warm. Consult the optional app readiness check (live
      // dependency health, e.g. a DB ping) if the app provides one.
      const check = await getReadinessCheck();
      if (check) {
        try {
          if ((await check()) === false) {
            return Response.json({ status: 'unready' }, { status: 503, headers: noStore });
          }
        } catch (e) {
          return Response.json(
            { status: 'unready', error: String((e && e.message) || e) },
            { status: 503, headers: noStore },
          );
        }
      }
      return Response.json({ status: 'ok' }, { headers: noStore });
    }

    // Dev live-reload client.
    if (dev && path === '/__webjs/reload.js') {
      const script = reloadClientJs(basePathValue);
      return new Response(script, {
        headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' },
      });
    }

    // Dev live-reload SharedWorker: one shared connection for all tabs (#887).
    if (dev && path === '/__webjs/reload-worker.js') {
      const script = reloadWorkerJs(basePathValue);
      return new Response(script, {
        headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' },
      });
    }

    // Framework-internal static assets (the @webjsdev/core runtime, the dev
    // reload client, downloaded vendor bundles) depend on neither the analysis
    // nor the vendor importmap, so serve them BEFORE ensureReady(). Otherwise a
    // cold instance blocks them behind the first vendor resolve (issue #190),
    // and the core bundle is on every page's boot path, so that stalled first
    // interactivity site-wide. Matched on the decoded path, like handleCore.
    const earlyStatic = await tryServeFrameworkStatic(path, req.method.toUpperCase(), { coreDir, appDir, dev, versioned: url.searchParams.has('v') });
    if (earlyStatic) return earlyStatic;

    // `/public/*` needs neither the module graph nor the vendor importmap, so
    // in DEV serve it here rather than behind the analysis (#1397). A cold
    // `/public/tailwind.css` measured 1907ms at 4a335549, of which 1900ms was
    // `ensureReady()`, which is why the stylesheet is the request most exposed
    // to the next `node --watch` restart. DEV ONLY on purpose: in prod
    // `/__webjs/ready` already holds traffic off a cold instance until the
    // analysis and the first vendor attempt have both completed, and hoisting
    // there would silently un-gate a `/public/*` file that an app middleware
    // protects. The consequence in dev is that root middleware does not run
    // for these paths, the same trade the framework statics above already make
    // in both modes. `state.regenerateRules` is loaded at boot inside
    // createRequestHandler, so the #967 on-request rebuild is available here,
    // ahead of ensureReady.
    if (dev) {
      const publicResp = await tryServePublicAsset(path, {
        appDir, dev, versioned: url.searchParams.has('v'), regenerateRules: state.regenerateRules,
      });
      if (publicResp) return publicResp;
    }

    // Build all whole-app analysis on the first request (memoized), before
    // any SSR, module serve, gate check, action dispatch, or middleware runs.
    await ensureReady();

    const next = () => handleCore(req, {
      state,
      appDir,
      coreDir,
      dev,
      reportError,
      reportDevError,
      hasOnError,
      logger,
      cspEnabled: cspConfig.enabled,
      allowedOrigins: allowedOriginsValue,
    });

    if (state.middleware) {
      try {
        return await state.middleware(req, next);
      } catch (e) {
        reportError(e, req, 'middleware');
        logger.error('middleware threw', { err: String(e), requestId: getRequestId() });
        return new Response('Server error', { status: 500 });
      }
    }
    return next();
  }

  /**
   * Lightweight lookup used by the HTTP layer to emit 103 Early Hints
   * BEFORE running SSR: resolves a pathname to its page-route module URLs
   * without loading them. Returns null for non-page paths.
   *
   * Sub-path deployment (issue #256): the HTTP layer passes the RAW request
   * pathname (still carrying the base path, since the ingress strip happens
   * inside `produce`, not here), so strip it for route matching and prefix
   * the emitted module URLs so the early-hint preloads resolve under the
   * prefix. A path not under the base path yields null (no hints).
   *
   * @param {string} pathname
   */
  function routeFor(pathname) {
    const matchPathname = basePathValue
      ? stripBasePath(pathname, basePathValue)
      : pathname;
    if (matchPathname === null) return null;
    const page = matchPage(state.routeTable, matchPathname);
    if (!page) return null;
    // Mirror ssr.js's boot assembly EXACTLY: drop inert route modules, and
    // splice an import-only module's component imports in place of the module
    // (#605). Otherwise the 103 Early Hints would preload the page / layout
    // modules the body no longer imports (a wasted hint) and miss the component
    // modules it actually fetches (a double-fetch on the real module).
    const inert = state.inertRouteModules;
    const importOnly = state.importOnlyRouteModules;
    const files = [];
    const seenFiles = new Set();
    for (const f of [page.route.file, ...page.route.layouts]) {
      if (inert && inert.has(f)) continue;
      const emit = importOnly && importOnly.get(f);
      for (const t of emit || [f]) if (!seenFiles.has(t)) { seenFiles.add(t); files.push(t); }
    }
    const moduleUrls = files.map((f) => {
      let rel = f.startsWith(appDir) ? f.slice(appDir.length) : f;
      const url = rel.split('\\').join('/').replace(/^\/?/, '/');
      // Mirror ssr.js's emit (basePath THEN `?v`) so the 103 Early Hints preload
      // the SAME url the body's modulepreload + boot specifiers request (#243).
      // A bare url would warm a different url and waste the hint. No-op in dev.
      // Best-effort: a request landing in the narrow pre-warm window (before the
      // elision verdict is set) hashes against an empty fingerprint, so the hint
      // can mismatch the post-warm body for that one request, only a wasted
      // speculative preload, never a stale body (the body url is authoritative).
      return withAssetHash(withBasePath(url, basePathValue), basePathValue);
    });
    return { moduleUrls };
  }

  return {
    handle,
    rebuild,
    routeFor,
    /**
     * Proactively run the first-request analysis (module graph, component
     * scan, gate, action index, middleware, elision, vendor map) in the
     * background, so a real first request finds it already memoized. Safe to
     * call any number of times and concurrently: the work is single-flighted,
     * so this never duplicates it or races a real request. It is a single
     * best-effort kick: errors are caught and logged rather than thrown (a
     * background warm-up must not crash the process), and whatever failed simply
     * re-runs on the next request or readiness probe (the platform's traffic and
     * probes are the retry loop, so there is no internal backoff). `startServer`
     * calls this once the HTTP server is listening; embedders can call it after
     * their own listen.
     * @returns {Promise<void>}
     */
    warmup: () => ensureReady().catch((e) => logger.error?.(`[webjs] background warm-up failed (will retry on the next request):`, e)),
    /** current route table getter: used by the WebSocket subsystem */
    getRouteTable: () => state.routeTable,
    /** Current unresolved dev error frame (#264), or null. Replayed by
     * startServer to a freshly-connected SSE client so the overlay shows even
     * after a navigation, not only on the breaking edit. Always null in prod. */
    getLastDevError: () => state.lastDevError,
    /** Whether a dev-watcher filename is a `webjs.dev.regenerate` OUTPUT (#967),
     * so `startServer`'s file watcher (a different scope, with no access to
     * `state`) can skip a build product the server itself writes and avoid a
     * spurious reload. Reads the live, rebuild-refreshed rules. */
    isRegenerateOutput: (filename) => isRegenerateOutputPath(filename, state.regenerateRules),
    /**
     * Classify a dev-watcher event into a live-reload verdict (#1398).
     * `startServer`'s watcher is a different scope with no access to `state`,
     * exactly like `isRegenerateOutput` above, so the lookup is exposed rather
     * than the sets.
     *
     * `root` is the WATCHED root the event came from, not `appDir`: `fs.watch`
     * reports a path relative to whatever root it was given, and an extra
     * `webjs.dev.watch` root (#894) is usually OUTSIDE the app. Resolving those
     * against `appDir` would manufacture a nonexistent in-app path and lose the
     * one fact the classifier needs about them.
     *
     * Returns the fail-safe `reload` verdict until the first analysis completes.
     *
     * @param {string} filename  `event.filename`, relative to `root`
     * @param {string} [root]  the watched root, defaulting to the app dir
     * @returns {import('../dev-classify.js').ReloadVerdict}
     */
    classifyWatchPath: (filename, root) => classifyChangedPath(resolve(root || appDir, filename), {
      appDir,
      shippedFiles: state.shippedFiles,
      graphFiles: state.graphFiles,
      pageFiles: state.pageFiles,
      analysisReady: analysisEverDone,
      sep,
    }),
    appDir,
    dev,
    logger,
    state,
  };
}
