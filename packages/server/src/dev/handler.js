import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildRouteTable, matchPage } from '../router.js';
import { generateRouteTypes } from '../route-types.js';
import { setClientRouterEnabled, setMetadataIconRoutes } from '../ssr.js';
import {
  buildActionIndex,
} from '../actions.js';
import { registerActionHooks } from '../action-seed.js';
import { readRegenerateRules, isRegenerateOutputPath } from '../dev-regenerate.js';
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
async function fileByteHash(abs) {
  try {
    const data = await readFile(abs);
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
  } catch {
    return '000000000000';
  }
}

/** @type {string | null} memoized `@webjsdev/server` version, folded into the app-source signal (#899). */
let cachedServerVersion = null;
/**
 * The installed `@webjsdev/server` version (this package). Folded into the
 * app-source deploy signal so a server-framework release (which alters SSR
 * output but ships no new browser module) turns over the client's stale caches.
 * @returns {string}
 */
function frameworkServerVersion() {
  if (cachedServerVersion) return cachedServerVersion;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    cachedServerVersion = pkg.version || '0.0.0';
  } catch {
    cachedServerVersion = '0.0.0';
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
 *   logger?: import('./logger.js').Logger,
 *   onError?: (error: unknown, ctx: { request: Request, requestId: string|null, phase: string }) => void,
 *   onReload?: () => void,
 *   onDevError?: (frame: object) => void,
 * }} opts
 */
export async function createRequestHandler(opts) {
  assertNodeVersion({ onFail: 'throw' });
  await ensureStripper();
  const appDir = resolve(opts.appDir);
  loadAppEnv(appDir);
  await applyEnvValidation(appDir, { dev: !!opts.dev });
  const dev = !!opts.dev;
  const logger = opts.logger || defaultLogger({ dev });
  await warnOnInvalidWebjsConfig(appDir, logger);
  const { onError: instrumentationOnError } = await runInstrumentation(appDir, { dev, logger });
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

  const basePathValue = await readBasePathFromApp(appDir);
  await setBasePath(basePathValue);

  const allowedOriginsValue = await readAllowedOriginsFromApp(appDir);

  setClientRouterEnabled(await readClientRouterEnabled(appDir));

  const coreDir = locateCoreDir(appDir);
  const distDir = join(coreDir, 'dist');
  const distComplete =
    existsSync(join(distDir, 'webjs-core.js')) &&
    existsSync(join(distDir, 'webjs-core-browser.js'));
  await setCoreInstall(coreDir, distComplete);

  await setImportAliasEntries(importAliasBrowserEntries(appImportsMap(appDir), appTopLevelDirs(appDir)));

  setAssetRoots({ appDir, coreDir, enabled: !dev });

  setAssetUrlProvider((p) => resolveAssetUrl(p, basePath()));

  await registerActionHooks({ seed: await readSeedEnabled(appDir), dev });

  let bootVendorPinned = false;
  if (hasVendorPin(appDir) && (await readPinFile(appDir))) {
    try {
      const v = await resolveVendorImports(appDir, () => new Set());
      await setVendorEntries(v.imports, v.integrity);
      publishBuildId();
      bootVendorPinned = true;
    } catch (e) {
      logger.error?.(`[webjs] applying the committed vendor pin at boot failed (will retry on the first request):`, e);
    }
  }

  const routeTable = await buildRouteTable(appDir);
  // Auto-linked favicons: tell the head builder which icon metadata routes
  // exist, so `app/icon.*` is linked when the app declares no metadata.icons.
  // Bound here rather than threaded through ssrOpts, matching
  // setClientRouterEnabled; re-bound in doRebuild so adding or deleting the
  // file takes effect without a restart.
  setMetadataIconRoutes(routeTable.metadataRoutes);

  /** @returns {Promise<void>} */
  async function emitRouteTypes() {
    try {
      const { mkdir, writeFile, rename } = await import('node:fs/promises');
      const text = await generateRouteTypes(appDir);
      const outDir = join(appDir, '.webjs');
      await mkdir(outDir, { recursive: true });
      const dest = join(outDir, 'routes.d.ts');
      const tmp = join(outDir, `routes.d.ts.${process.pid}.tmp`);
      await writeFile(tmp, text);
      await rename(tmp, dest);
    } catch (e) {
      logger.warn?.(`[webjs] could not write .webjs/routes.d.ts (route types): ${e?.message || e}`);
    }
  }
  if (dev) void emitRouteTypes();

  const headerRules = await readHeaderRules(appDir);
  const redirectRules = await readRedirectRules(appDir);
  const trailingSlashPolicy = await readTrailingSlashFromApp(appDir);
  const cspConfig = await readCspConfigFromApp(appDir);
  const bodyLimits = await readBodyLimitsFromApp(appDir);

  const state = {
    routeTable,
    actionIndex: null,
    middleware: null,
    bodyLimits,
    logger,
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
    tsCache: new Map(),
    lastDevError: null,
    regenerateRules: dev ? await readRegenerateRules(appDir) : [],
  };

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

  let analysisDone = false;
  let vendorResolved = false;
  let vendorAttemptedOnce = false;
  let vendorGen = 0;
  let readyDone = false;
  /** @type {unknown} */
  let readyError = null;
  /** @type {Promise<void> | null} */
  let readyInFlight = null;

  async function ensureReady() {
    if (analysisDone && vendorResolved) return;
    if (readyInFlight) { await readyInFlight; return; }
    if (analysisDone && vendorAttemptedOnce) {
      const gen = vendorGen;
      resolveAndApplyVendor().then((ok) => { if (ok && gen === vendorGen) { vendorResolved = true; if (!bootVendorPinned) publishBuildId(); } }).catch(() => {});
      return;
    }
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
            setClientRouterEnabled(await readClientRouterEnabled(appDir));
            const elideOn = await readElideEnabled(appDir);
            const r = elideOn
              ? await analyzeElision(components, collectRouteModules(state.routeTable),
                  state.moduleGraph, (f) => readFile(f, 'utf8'), appDir)
              : { elidableComponents: new Set(), inertRouteModules: new Set(), importOnlyRouteModules: new Map(),
                  shippedRouteModules: new Map(), componentVerdicts: new Map() };
            state.elidableComponents = r.elidableComponents;
            state.inertRouteModules = r.inertRouteModules;
            state.importOnlyRouteModules = r.importOnlyRouteModules;
            {
              const rel = (p) => (p.startsWith(appDir + sep) ? p.slice(appDir.length) : p);
              const elidedPaths = [
                ...state.elidableComponents,
                ...state.inertRouteModules,
                ...state.importOnlyRouteModules.keys(),
              ].map(rel).sort();
              setElisionFingerprint(elidedPaths.length ? elidedPaths.join('\n') : '');
            }
            if (!dev && state.browserBoundFiles) {
              const relApp = (p) => (p.startsWith(appDir + sep) ? p.slice(appDir.length) : p);
              const lines = [...state.browserBoundFiles]
                .map((abs) => `${relApp(abs)}:${assetHashFor(abs)}`)
                .sort();
              setAppSourceFingerprint(lines.join('\n'));
            } else {
              setAppSourceFingerprint('');
            }
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
              logger.info?.(
                elideOn
                  ? `[webjs] elision: ${r.elidableComponents.size}/${new Set(components.map((c) => c.file)).size} components elided, ` +
                    `${r.inertRouteModules.size} route modules inert, ${r.importOnlyRouteModules.size} import-only, ` +
                    `${r.shippedRouteModules.size} ship whole. Run \`webjs elision\` for the per-module verdict.`
                  : `[webjs] elision: disabled (WEBJS_ELIDE / webjs.elide), every module ships.`,
              );
            }
            analysisDone = true;
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
            if (ok && gen === vendorGen) { vendorResolved = true; if (!bootVendorPinned) publishBuildId(); }
          }
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

  let rebuildInFlight = Promise.resolve();

  async function rebuild() {
    rebuildInFlight = rebuildInFlight.then(() => doRebuild()).catch((e) => {
      logger.error?.(`[webjs] rebuild failed:`, e);
      reportDevError(e, { kind: 'rebuild' });
    });
    return rebuildInFlight;
  }

  async function doRebuild() {
    state.routeTable = await buildRouteTable(appDir);
    // Adding or deleting app/icon.* changes whether the head auto-links it.
    setMetadataIconRoutes(state.routeTable.metadataRoutes);
    if (dev) void emitRouteTypes();
    clearVendorCache();
    clearAssetHashCache();
    state.tsCache.clear();
    if (readyInFlight) { try { await readyInFlight; } catch {} }
    vendorGen++;
    analysisDone = false;
    vendorResolved = false;
    vendorAttemptedOnce = false;
    readyDone = false;
    readyError = null;
    readinessFn = undefined;
    if (dev) state.regenerateRules = await readRegenerateRules(appDir);
    state.lastDevError = null;
    opts.onReload?.();
  }

  /** @param {Request} req */
  function handle(req) {
    return withRequest(req, async () => {
      const reqId = resolveRequestId(req);
      setRequestId(reqId);

      const nonce = cspConfig.enabled ? mintNonce() : '';
      if (nonce) setCspNonce(nonce);

      setBodyLimits(state.bodyLimits);

      let pathname = '/';
      try { pathname = new URL(req.url).pathname; } catch { /* keep default */ }
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
        reportError(e, req, 'handle');
        logger.error?.('[webjs] request pipeline threw', {
          requestId: reqId,
          method: req.method,
          path: pathname,
          err: e instanceof Error ? e.stack : String(e),
        });
        res = new Response('Server error', { status: 500 });
      }

      let merged = applySecurityHeaders(res, {
        pathname: headerPathname,
        https: webRequestIsHttps(req),
        prod: !dev,
        rules: headerRules,
      });

      if (!merged.headers.has('x-request-id')) merged.headers.set('x-request-id', reqId);

      if (nonce && !merged.headers.has('content-security-policy') &&
          !merged.headers.has('content-security-policy-report-only')) {
        try {
          merged.headers.set(cspHeaderName(cspConfig), buildCspHeader(cspConfig, nonce));
        } catch {
          /* ignore */
        }
      }

      try {
        const reqUrl = new URL(req.url);
        if (basePathValue) {
          const s = stripBasePath(reqUrl.pathname, basePathValue);
          if (s !== null) reqUrl.pathname = s;
        }
        merged = await commitHtmlCache(req, merged, reqUrl);
      } catch { /* ignore */ }

      let conditioned = merged;
      try {
        conditioned = await applyConditionalGet(req, merged);
      } catch { /* ignore */ }

      if (shouldAccessLog(headerPathname)) {
        try {
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

    if (basePathValue) {
      const stripped = stripBasePath(rawUrl.pathname, basePathValue);
      if (stripped === null) {
        return new Response('Not found', { status: 404 });
      }
      const newUrl = new URL(req.url);
      newUrl.pathname = stripped;
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
      const redir = applyRedirects(req, redirectRules);
      if (redir) return redir;
    }

    if (trailingSlashPolicy !== 'ignore') {
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

    if (dev && path === '/__webjs/reload.js') {
      const script = reloadClientJs(basePathValue);
      return new Response(script, {
        headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' },
      });
    }

    if (dev && path === '/__webjs/reload-worker.js') {
      const script = reloadWorkerJs(basePathValue);
      return new Response(script, {
        headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' },
      });
    }

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
    appDir,
    dev,
    logger,
    state,
  };
}
