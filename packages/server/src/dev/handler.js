import { stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildRouteTable, matchPage, matchApi } from '../router.js';
import { generateRouteTypes } from '../route-types.js';
import { ssrPage, ssrNotFound, setClientRouterEnabled, setMetadataIconRoutes } from '../ssr.js';
import { runFormAction, reportFormSubmittedAsGet } from '../form-dispatch.js';
import { handleApi } from '../api.js';
import {
  buildActionIndex,
  serveActionStub,
  serveServerOnlyStub,
  invokeAction,
  isServerFile,
  hasUseServerDirective,
  hashFile,
} from '../actions.js';
import { registerActionHooks } from '../action-seed.js';
import { readRegenerateRules, maybeRegenerate } from '../dev-regenerate.js';
import { stripTypeScript, ensureStripper } from '../ts-strip.js';
import { defaultLogger } from '../logger.js';
import { assertNodeVersion } from '../node-version.js';
import { applyEnvValidation } from '../env-schema.js';
import { runInstrumentation, findInstrumentationClient } from '../instrumentation.js';
import { withRequest, setCspNonce, setBodyLimits, setRequestId, requestId as getRequestId } from '../context.js';
import { buildInfoResponse } from '../build-info.js';
import { mintNonce, buildCspHeader, cspHeaderName } from '../csp.js';
import { propagateTrustedRemoteIp } from '../rate-limit.js';
import {
  isCompressible,
} from '../listener-core.js';
import { scanBareImports, resolveVendorImports, serveDownloadedBundle, clearVendorCache, hasVendorPin, readPinFile, prunePinToReachable } from '../vendor.js';
import { buildModuleGraph, seenFilesFor, resolveImport, appImportsMap } from '../module-graph.js';
import { primeComponentRegistry, findOrphanComponents, scanComponents } from '../component-scanner.js';
import { analyzeElision, elideImportsFromSource } from '../component-elision.js';

import { setVendorEntries, setCoreInstall, publishBuildId, setAppSourceId, setBasePath, basePath, setImportAliasEntries, importAliasBrowserEntries } from '../importmap.js';
import { stripBasePath, withBasePath } from '../base-path.js';
import { setAssetUrlProvider, setFormActionResolver } from '@webjsdev/core';
import { resolveActionIdentity } from '../form-action-identity.js';
import { setAssetRoots, clearAssetHashCache, setElisionFingerprint, withAssetHash, assetHashFor, versionModuleImports, resolveAssetUrl } from '../asset-hash.js';
import { applySecurityHeaders, webRequestIsHttps } from '../headers.js';
import {
  applyRedirects,
  applyTrailingSlash,
} from '../redirects.js';
import { applyConditionalGet, BUFFERED_MARKER } from '../conditional-get.js';
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
  MIME,
  TS_CACHE_MAX,
  kebab,
  resolveRequestId,
  shouldAccessLog,
  loadAppEnv,
  collectRouteModules,
  computeBrowserBoundFiles,
  appTopLevelDirs,
  locateCoreDir,
  reloadClientJs,
  reloadWorkerJs,
} from './helpers.js';

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function fileByteHash(abs) {
  try {
    const data = await readFile(abs);
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
  } catch {
    return '000000000000';
  }
}

let cachedServerVersion = null;
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
  routeTable.instrumentationClient = await findInstrumentationClient(appDir);
  // Auto-linked favicons: tell the head builder which icon metadata routes
  // exist, so `app/icon.*` is linked when the app declares no metadata.icons.
  // Bound here rather than threaded through ssrOpts, matching
  // setClientRouterEnabled; re-bound in doRebuild so adding or deleting the
  // file takes effect without a restart.
  setMetadataIconRoutes(routeTable.metadataRoutes);

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
    browserBoundFiles: null,
    tsCache: new Map(),
    lastDevError: null,
    regenerateRules: dev ? await readRegenerateRules(appDir) : [],
  };

  setFormActionResolver((fn) => (state.actionIndex ? resolveActionIdentity(state.actionIndex, fn) : null));

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
  let readyError = null;
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
            state.browserBoundFiles = computeBrowserBoundFiles(state.routeTable, state.moduleGraph, components, appDir);
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

  let vendorResolveInFlight = null;
  function resolveAndApplyVendor() {
    if (vendorResolveInFlight) return vendorResolveInFlight;
    vendorResolveInFlight = (async () => {
      try {
        const scan = () => scanBareImports(appDir, new Set([...state.elidableComponents, ...state.inertRouteModules, ...state.importOnlyRouteModules.keys()]));
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
    state.routeTable.instrumentationClient = await findInstrumentationClient(appDir);
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

  async function produce(req) {
    const rawUrl = new URL(req.url);

    if (basePathValue) {
      const stripped = stripBasePath(rawUrl.pathname, basePathValue);
      if (stripped === null) {
        return new Response('Not found', { status: 404 });
      }
      const newUrl = new URL(req.url);
      newUrl.pathname = stripped;
      const headers = new Headers(req.headers);
      propagateTrustedRemoteIp(req, headers);
      req = new Request(newUrl, {
        method: req.method,
        headers,
        body: req.body,
        duplex: 'half',
      });
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
    warmup: () => ensureReady().catch((e) => logger.error?.(`[webjs] background warm-up failed (will retry on the next request):`, e)),
    getRouteTable: () => state.routeTable,
    getLastDevError: () => state.lastDevError,
    isRegenerateOutput: (filename) => isRegenerateOutputPath(filename, state.regenerateRules),
    appDir,
    dev,
    logger,
    state,
  };
}

async function tryServeFrameworkStatic(path, method, { coreDir, appDir, dev, versioned }) {
  if (path.startsWith('/__webjs/core/')) {
    const rel = path.slice('/__webjs/core/'.length);
    const abs = resolve(coreDir, rel);
    if (abs !== coreDir && !abs.startsWith(coreDir + sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return fileResponse(abs, { dev, immutable: !!versioned });
  }

  if (path.startsWith('/__webjs/vendor/') && path.endsWith('.js')) {
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { allow: 'GET, HEAD, OPTIONS' } });
    }
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, OPTIONS' } });
    }
    const filename = path.slice('/__webjs/vendor/'.length);
    const resp = await serveDownloadedBundle(filename, appDir, dev);
    if (method === 'HEAD') {
      return new Response(null, { status: resp.status, headers: resp.headers });
    }
    return resp;
  }

  return null;
}

async function handleCore(req, ctx) {
  const { state, appDir, coreDir, dev, reportError, reportDevError, hasOnError, logger, cspEnabled, allowedOrigins } = ctx;
  const url = new URL(req.url);
  // Decode percent-encoded characters so filesystem lookups match real
  // filenames. Dynamic route segments like `[slug]` and route groups like
  // `(marketing)` contain chars that browsers percent-encode in URLs
  // (`%5B`, `%5D`, `%28`, `%29`). Without decoding, the server joins the
  // encoded path with the app directory → file not found → 404 → no JS
  // loads → no interactivity.
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }
  const method = req.method.toUpperCase();
  // Content-hash fingerprint (#243): a `?v=` query marks a content-addressed
  // asset url that may be served `immutable` (the hash busts the cache on a
  // byte change). The pathname (query stripped by `url.pathname`) resolves the
  // file as today; only the cache header changes when `?v` is present.
  const versioned = url.searchParams.has('v');

  // Health / readiness probes (`/__webjs/health`, `/__webjs/ready`) and the
  // framework-internal static assets (`/__webjs/core/*`, `/__webjs/reload.js`,
  // `/__webjs/reload-worker.js`, downloaded `/__webjs/vendor/*`) are served in
  // `handle()` BEFORE ensureReady,
  // so they are not repeated here. This fallback covers the (currently
  // unreachable) case of handleCore being entered for one of those assets, so
  // the routing stays correct if a future caller bypasses the early path.
  const frameworkStatic = await tryServeFrameworkStatic(path, method, { coreDir, appDir, dev, versioned });
  if (frameworkStatic) return frameworkStatic;

  // Internal server-action RPC endpoint
  const actMatch = /^\/__webjs\/action\/([a-f0-9]+)\/([A-Za-z0-9_$]+)$/.exec(path);
  if (actMatch) {
    // HTTP-verb actions (#488): any RPC verb may hit the endpoint; invokeAction
    // enforces the action's DECLARED method (405 + Allow on a mismatch) and
    // reads args from the URL (GET/DELETE) or the body (POST/PUT/PATCH).
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return new Response('method not allowed', { status: 405 });
    }
    // Pass the onError sink (issue #239): a server action that throws
    // unexpectedly is reported to the APM hook before the sanitized 500.
    const onActionError = reportError ? (e) => reportError(e, req, 'action') : undefined;
    return invokeAction(state.actionIndex, actMatch[1], actMatch[2], req, onActionError, allowedOrigins);
  }

  // Static: /public/*, plus a small set of ROOT assets that must serve at the
  // site root even though they live under public/. A service worker registered
  // at /sw.js scopes to the origin root, so it MUST serve at / (not
  // /public/sw.js), and so must its offline fallback. Same remap shape as the
  // /favicon.ico special-case below. (#830)
  const ROOT_ASSETS = { '/sw.js': '/public/sw.js', '/offline.html': '/public/offline.html' };
  if (path.startsWith('/public/') || path === '/favicon.ico' || path in ROOT_ASSETS) {
    const p = path === '/favicon.ico' ? '/public/favicon.ico' : (ROOT_ASSETS[path] || path);
    const abs = join(appDir, p);
    // Containment check. `join` normalises `..` segments, so a path
    // like `/public/%2E%2E/secret/x.svg` decodes (after URL parsing,
    // which doesn't touch `%2E`) to `/public/../secret/x.svg` and
    // `join(appDir, ...)` resolves it to `appDir/secret/x.svg`. The
    // resulting `abs` could be inside `appDir` but OUTSIDE `appDir/
    // public/`, exposing files the user reasonably thought were
    // private under their non-public directories. Reject anything
    // that doesn't stay under `appDir/public/` (and the favicon
    // exception, which is already validated above).
    const publicRoot = join(appDir, 'public') + sep;
    if (!abs.startsWith(publicRoot)) {
      return new Response(null, { status: 404 });
    }
    // On-request regeneration (#967): in dev, if a `webjs.dev.regenerate` rule
    // matches this output and it is stale (a source is newer, or it is missing),
    // rebuild it to completion BEFORE serving, so a newly added utility class is
    // never served stale. No-op when no rule matches or the output is fresh, and
    // never runs in prod (rules are empty there). This replaces the fragile
    // `tailwindcss --watch` that could die mid-session and serve stale CSS.
    if (dev && state.regenerateRules.length) {
      await maybeRegenerate(appDir, p.replace(/^\/+/, ''), state.regenerateRules);
    }
    // A `?v=<hash>` public asset is content-addressed -> immutable (#243).
    if (await exists(abs)) {
      const res = await fileResponse(abs, { dev, immutable: versioned });
      // A worker served below its registration path only controls that subtree
      // unless the response opts it up to the root scope. (#830)
      if (path === '/sw.js') res.headers.set('Service-Worker-Allowed', '/');
      return res;
    }
  }

  // User source modules (served as ES modules, with action-file rewriting).
  //
  // Authorization gate: only files reachable from a browser-bound entry
  // (page, layout, error, loading, not-found, component) via the module
  // graph are servable. Same posture as Next.js, where the bundler's
  // manifest is the source of truth for what the browser may fetch.
  // Anything not in the set (node_modules/, top-level package.json,
  // scripts/, etc.) 404s here regardless of whether the file exists on
  // disk. The `.server.{js,ts}` stub guardrail runs below as a
  // defense-in-depth layer.
  if (method === 'GET' && /\.(js|mjs|ts|mts|css|svg|png|jpg|jpeg|gif|webp|json|ico|txt)$/.test(path)) {
    let abs = join(appDir, path);
    // When the browser asks for `.js`, allow falling through to a sibling
    // `.ts` (the TypeScript-with-"allowImportingTsExtensions: false" pattern).
    if (!(await exists(abs)) && /\.js$/.test(abs)) {
      const tsAbs = abs.replace(/\.js$/, '.ts');
      if (await exists(tsAbs)) abs = tsAbs;
      else {
        const mtsAbs = abs.replace(/\.js$/, '.mts');
        if (await exists(mtsAbs)) abs = mtsAbs;
      }
    }
    // Gate: must be in the browser-bound module graph. Server-action
    // files (.server.{js,ts}) get a stub via the guardrail below; they
    // ARE included in browserBoundFiles because client code imports
    // them by path (the import rewrites to an RPC stub at request time).
    // In test mode any app file is servable (see the `state.testMode` note
    // above); otherwise the file must be in the browser-bound module graph.
    const inGraph = state.testMode || (state.browserBoundFiles && state.browserBoundFiles.has(abs));
    // Containment: `abs` must be appDir itself or genuinely UNDER it. The
    // trailing `sep` (matching the public-asset branch) stops a `..` path that
    // resolves to a sibling sharing the appDir name-prefix (`/x/app` ->
    // `/x/app-secrets/...`) from passing in test mode, where graph membership
    // is not the gate.
    const underAppDir = abs === appDir || abs.startsWith(appDir + sep);
    if (underAppDir && inGraph && (await exists(abs))) {
      // Server-file guardrail: a file matching `.server.{js,ts,mjs,mts}`
      // MUST NEVER be served as source to the browser. The extension is
      // the path-level boundary; we re-verify it on every request (not
      // just rely on the action-index snapshot, which is built on the first
      // request and refreshed on rebuild) so files created later, FS races,
      // or developer error never punch through.
      //
      // What the browser gets depends on the file's `'use server'` status:
      //   - With `'use server'` => server action: a generated RPC stub
      //     whose exports POST to /__webjs/action/:hash/:fn.
      //   - Without `'use server'` => server-only utility: a stub that
      //     throws at module load with a clear error. The file's source
      //     never reaches the browser either way.
      if (isServerFile(abs)) {
        if (await hasUseServerDirective(abs)) {
          // Lazily ensure the index knows about this file so serveActionStub
          // can mint a stable hash and function list.
          if (!state.actionIndex.fileToHash.has(abs)) {
            const h = await hashFile(abs);
            state.actionIndex.fileToHash.set(abs, h);
            state.actionIndex.hashToFile.set(h, abs);
          }
          const stub = await serveActionStub(state.actionIndex, abs);
          return new Response(stub, {
            headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
          });
        }
        const relPath = relative(appDir, abs);
        const stub = serveServerOnlyStub(relPath);
        return new Response(stub, {
          headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      // TypeScript source: strip types via Node 24+'s built-in, cache by mtime.
      // Both module paths also strip side-effect imports of display-only
      // components so the browser never downloads their JS.
      const elideOpts = {
        moduleGraph: state.moduleGraph,
        elidableComponents: state.elidableComponents,
        appDir,
      };
      // A `?v=<hash>` app-module request is content-addressed -> immutable
      // (#243); an un-fingerprinted request keeps the 1h fallback.
      if (/\.m?ts$/.test(abs)) {
        return tsResponse(abs, dev, elideOpts, state.tsCache, versioned, reportDevError);
      }
      if (/\.m?js$/.test(abs)) {
        return jsModuleResponse(abs, dev, elideOpts, versioned);
      }
      return fileResponse(abs, { dev, immutable: versioned });
    }
    // Dev hint (#751): the request is for a real app source module that EXISTS
    // on disk but is NOT in the browser-bound graph, so the gate 404s it. The
    // most common cause is a dynamic `import()` the static scanner cannot
    // track: a string-literal `import('./x.ts')` IS tracked and servable, but a
    // computed `import(expr)` / `import('./' + name)` cannot be resolved
    // statically and falls through here. Surface the likely cause instead of a
    // bare 404 so the author is not left guessing. Dev-only and diagnostic; it
    // does not change the 404 status, only the body + a server log line.
    if (dev && abs.startsWith(appDir) && /\.m?[jt]s$/.test(abs) && (await exists(abs))) {
      const rel = relative(appDir, abs);
      const hint = `[webjs] 404: ${rel} exists but is not reachable from any browser-bound entry, so it is not servable. If you load it via a dynamic import(), use a STRING-LITERAL specifier (e.g. import('./x.ts')) so the scanner can track it; a computed import(expr) cannot be resolved statically and will 404. Otherwise this module is simply unreferenced by client code.`;
      console.warn(hint);
      return new Response(hint, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  }

  // Metadata routes: /sitemap.xml, /robots.txt, /icon, /opengraph-image, etc.
  if (method === 'GET' && state.routeTable.metadataRoutes) {
    const meta = state.routeTable.metadataRoutes.find((r) => r.urlPath === path);
    if (meta) {
      try {
        const mod = await import(pathToFileURL(meta.file).toString() + (dev ? `?t=${Date.now()}` : ''));
        if (mod.default) {
          const result = await mod.default();
          // If the function returns a Response, use it directly.
          if (result instanceof Response) return result;
          // If it returns a string, determine content type from the URL path.
          const ct = path.endsWith('.xml') ? 'application/xml; charset=utf-8'
            : path.endsWith('.txt') ? 'text/plain; charset=utf-8'
            : path.endsWith('.json') ? 'application/json; charset=utf-8'
            : 'application/octet-stream';
          return new Response(typeof result === 'string' ? result : JSON.stringify(result), {
            headers: { 'content-type': ct, 'cache-control': dev ? 'no-cache' : 'public, max-age=3600' },
          });
        }
      } catch (e) {
        if (reportError) reportError(e, req, 'metadata');
        if (dev) console.error(`[webjs] metadata route error (${meta.stem}):`, e);
        return new Response('Internal error', { status: 500 });
      }
    }
  }

  // API route (route.js handler)
  const api = matchApi(state.routeTable, path);
  if (api) {
    const handler = () => handleApi(api.route, api.params, req, dev);
    return runWithSegmentMiddleware(req, api.route.middlewares, handler, dev);
  }

  // Page route. GET/HEAD render the page. A NON-GET/HEAD method (POST/PUT/…)
  // is a form submission (#1155): the `__webjs_action` hidden field names the
  // server action to run, it runs inside the page's segment middleware, and the
  // result either PRG-redirects (303), re-renders the same page (422) with
  // field errors, or honors a thrown redirect()/notFound(). A non-GET carrying
  // no action identity is a 405 on a path that exists but only renders.
  {
    const page = matchPage(state.routeTable, path);
    if (page) {
      // The URL this render is FOR, in the form the browser sees it (#1047), so
      // the overlay's scope gate can compare it against `location.pathname +
      // location.search`. Two details are load-bearing: the RAW `url.pathname`
      // (not the decoded `path`) is used, because `location.pathname` is
      // percent-encoded too; and the base path is put back, because the ingress
      // strip already removed it from `url` while the browser's location still
      // carries it, so without this the gate would suppress every overlay on a
      // sub-path deploy.
      const devErrorUrl = withBasePath(url.pathname, basePath()) + url.search;
      // A speculative link prefetch must never raise an overlay (#1047): the
      // user is only hovering a link to a page that throws, and the page they
      // are actually looking at is fine. Dropping the hook also keeps the throw
      // out of `state.lastDevError`, so the SSE replay cannot hand it to a
      // freshly-connected tab either. The APM `onError` sink below still fires,
      // because the render really did throw.
      const isPrefetch = req.headers.get('x-webjs-prefetch') === '1';
      const ssrOpts = {
        dev, appDir, moduleGraph: state.moduleGraph,
        serverFiles: state.actionIndex.fileToHash,
        elidableComponents: state.elidableComponents,
        inertRouteModules: state.inertRouteModules,
        importOnlyRouteModules: state.importOnlyRouteModules,
        notFoundFile: state.routeTable.notFound,
        // Root-only boundaries (#848): the app-wide catch-all error page and the
        // unmatched-anywhere 404, rendered by ssr.js when a nested boundary is
        // absent.
        globalError: state.routeTable.globalError,
        globalNotFound: state.routeTable.globalNotFound,
        // instrumentation-client.{js,ts} (#848): imported first in the client
        // boot so it runs before app modules.
        instrumentationClient: state.routeTable.instrumentationClient,
        // Server HTML cache (#241): a CSP-enabled page emits a fresh
        // per-request nonce into its body, so its bytes vary per request and
        // it must never be HTML-cached. Pass the flag so the cache guard skips
        // it. CSP is off by default, so the common case stays cacheable.
        cspEnabled,
        // onError sink (issue #239): a page render error that becomes a 500 is
        // reported to the APM hook with the active request's correlation id.
        onError: reportError ? (e) => reportError(e, req, 'ssr') : undefined,
        // Dev error overlay (#264): a render crash pushes a frame to the open
        // tab. Dev-only (reportDevError early-returns in prod), so no source
        // leaks. Distinct from onError (the APM sink), which always fires.
        onDevError: dev && !isPrefetch
          ? (e) => reportDevError(e, { kind: 'render', url: devErrorUrl })
          : undefined,
      };
      if (method === 'GET' || method === 'HEAD') {
        // #1307: `__webjs_action` in the QUERY STRING means a submission
        // carrying a bound action's identity went out as a GET, so the action
        // never ran. Nothing else in the framework puts that reserved field in
        // a url. Detect only, so the render below is unchanged: answering a GET
        // differently because of a query parameter would hand any visitor a way
        // to turn any page into an error.
        reportFormSubmittedAsGet(
          url, req,
          // Gated on hasOnError, not on `reportError`: that is always a
          // function here and no-ops internally, so passing it would spend a
          // dedupe slot on a report nobody receives.
          hasOnError ? (e) => reportError(e, req, 'action') : undefined,
          logger, dev, page.route,
        );
        // A successful render of URL U supersedes a RETAINED render error for
        // that same URL (#1047), so a reconnecting tab is not handed a frame the
        // page has since recovered from. Keyed on BOTH frame identity and url:
        // identity so a frame this very render just reported is never wiped, url
        // so a good render of an unrelated page cannot erase an error that is
        // still current for the page the user is looking at (the #893 gap the
        // retention exists to close). Dev-only, and skipped for a prefetch,
        // which is not the user's view of anything.
        const handler = dev && !isPrefetch
          ? async () => {
            const before = state.lastDevError;
            const resp = await ssrPage(page.route, page.params, url, { ...ssrOpts, req });
            if (
              before && state.lastDevError === before
              && before.kind === 'render' && before.url === devErrorUrl
            ) state.lastDevError = null;
            return resp;
          }
          : () => ssrPage(page.route, page.params, url, { ...ssrOpts, req });
        return runWithSegmentMiddleware(req, page.route.middlewares, handler, dev);
      }
      // Every non-GET/HEAD to a page runs the page's segment middleware, and
      // the dispatcher always answers with a Response (a 405 when there is no
      // action to run), so a middleware that post-processes `await next()`
      // never has to handle an absent one.
      const deps = {
        actionIndex: state.actionIndex,
        allowedOrigins,
        onError: hasOnError ? (e) => reportError(e, req, 'action') : undefined,
        logger,
      };
      const handler = () => runFormAction(page.route, page.params, url, req, ssrOpts, deps);
      return runWithSegmentMiddleware(req, page.route.middlewares, handler, dev);
    }
  }

  // Fallback: content-negotiated 404
  if (wantsJson(req, path)) {
    return Response.json({ error: 'Not found', path }, { status: 404 });
  }
  // Unmatched anywhere: prefer the root not-found.{js,ts}, then a
  // global-not-found.{js,ts} (#848), else the default 404 page.
  return ssrNotFound(state.routeTable.notFound || state.routeTable.globalNotFound, { dev, appDir, req, url });
}

/** @param {Request} req @param {string} path */
function wantsJson(req, path) {
  const accept = req.headers.get('accept') || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) return true;
  if (path.startsWith('/api/') || path.startsWith('/__webjs/')) return true;
  return false;
}

/**
 * Chain segment-level middleware.js (outermost first) around a handler.
 * Each middleware is `(req, next) => Response`. If any throws, log and 500.
 *
 * @param {Request} req
 * @param {string[]} files   absolute paths of middleware.js files, outermost → innermost
 * @param {() => Promise<Response>} terminal
 * @param {boolean} dev
 */
async function runWithSegmentMiddleware(req, files, terminal, dev) {
  if (!files || !files.length) return terminal();
  const handlers = [];
  for (const f of files) {
    try {
      const url = pathToFileURL(f).toString();
      const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
      const mod = await import(url + bust);
      if (typeof mod.default === 'function') handlers.push(mod.default);
    } catch {
      // Bad middleware file: skip; top-level error handler will catch real problems.
    }
  }
  let i = 0;
  const next = () => {
    if (i >= handlers.length) return terminal();
    const fn = handlers[i++];
    return fn(req, next);
  };
  return next();
}

/**
 * Root-middleware filename candidates, in resolution order.
 *
 * Every other routing convention accepts all four extensions (the router
 * matches on the STEM, so `app/<segment>/middleware.ts` has always worked),
 * and both the scaffold and the dev supervisor write / watch `middleware.ts`.
 * This lookup used to be the single literal `middleware.js`, so a root
 * `middleware.ts` was silently never loaded: no error, no warning, the app
 * just ran with no global middleware. TypeScript is the documented default
 * for an app, so that was the common case, and it went unnoticed because the
 * failure is invisible (a missing middleware looks exactly like an app that
 * has none). `.ts` is tried first to match the dev supervisor's order.
 */
const ROOT_MIDDLEWARE_FILES = ['middleware.ts', 'middleware.js', 'middleware.mts', 'middleware.mjs'];

/**
 * Load the optional top-level `middleware.{ts,js,mts,mjs}`.
 * @param {string} appDir
 * @param {boolean} dev
 * @param {import('./logger.js').Logger} logger
 */
async function loadMiddleware(appDir, dev, logger) {
  let file = null;
  for (const name of ROOT_MIDDLEWARE_FILES) {
    const candidate = join(appDir, name);
    if (await exists(candidate)) { file = candidate; break; }
  }
  if (!file) return null;
  const url = pathToFileURL(file).toString();
  const bust = dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  try {
    const mod = await import(url + bust);
    return typeof mod.default === 'function' ? mod.default : null;
  } catch (e) {
    logger.error('failed to load root middleware', { file, err: String(e) });
    return null;
  }
}

/**
 * Read a file and return a Response with appropriate caching.
 * Dev: no-cache (always revalidate).
 * Prod: ETag + ~1h max-age for user files; `immutable` bumps to 1 year.
 *
 * @param {string} abs
 * @param {{ dev: boolean, immutable: boolean }} opts
 */
async function fileResponse(abs, opts) {
  try {
    let data = await readFile(abs);
    // In dev an external watcher (tailwindcss --watch, esbuild, ...) rewrites a
    // public asset with truncate-then-write, so the file is 0 bytes for a short
    // window during a rebuild. A hot reload that lands in that window would
    // serve empty CSS / JS and the page paints unstyled (#891). Close that
    // 0-byte window: when an empty read comes from a file that was JUST modified
    // (the mid-rewrite signal), re-read a few times so the truncated read does
    // not reach the browser. A genuinely empty, untouched asset is served
    // immediately (no delay), and a non-zero-but-partial write is a smaller
    // residual gap this does not cover. Prod has no such watcher and is
    // left untouched.
    if (opts.dev && data.length === 0) {
      let midRewrite = false;
      try { midRewrite = Date.now() - (await stat(abs)).mtimeMs < 500; } catch { /* gone */ }
      for (let i = 0; midRewrite && i < 12 && data.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
        try { data = await readFile(abs); } catch { break; }
      }
    }
    const type = MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
    // The body is fully buffered (read into `data`), so opt it into the
    // conditional-GET funnel, which is the single place that hashes the bytes
    // into a weak ETag and honors If-None-Match -> 304 (dev + prod alike).
    const headers = { 'content-type': type, [BUFFERED_MARKER]: '1' };
    headers['cache-control'] = opts.dev
      ? 'no-cache'
      : opts.immutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
    return new Response(data, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/**
 * Serve a plain `.js` / `.mjs` browser module, stripping side-effect
 * imports of display-only components. Mirrors {@link fileResponse}'s
 * headers but reads as text so the source can be transformed. Used only
 * for files that exist as `.js` on disk (TS apps usually hit
 * {@link tsResponse} via the .js to .ts sibling rewrite instead).
 *
 * @param {string} abs
 * @param {boolean} dev
 * @param {{ moduleGraph: any, elidableComponents: Set<string>|undefined, appDir: string }} elideOpts
 * @param {boolean} [immutable]  true for a `?v=<hash>` content-addressed request (#243):
 *   serve `immutable` (1 year) instead of the 1h fallback. Dev stays `no-cache`.
 */
async function jsModuleResponse(abs, dev, elideOpts, immutable) {
  let source;
  try { source = await readFile(abs, 'utf8'); }
  catch { return new Response('Not found', { status: 404 }); }
  let code = elideImportsFromSource(
    source, abs, elideOpts.moduleGraph, elideOpts.elidableComponents, resolveImport, elideOpts.appDir,
  );
  // Version same-origin relative import specifiers so the URL the browser
  // fetches matches the `?v=`-versioned modulepreload + boot specifier (#369).
  // A no-op in dev (fingerprinting disabled).
  code = versionModuleImports(code, abs);
  // Buffered (string) body, so opt into the conditional-GET funnel for the
  // weak ETag + 304 (see fileResponse).
  const headers = {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': dev ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    [BUFFERED_MARKER]: '1',
  };
  return new Response(code, { status: 200, headers });
}

/**
 * Strip TypeScript types from `source` via Node's built-in
 * `module.stripTypeScriptTypes`. Position-preserving whitespace
 * replacement: no sourcemap is needed because every (line, column)
 * maps to itself in the source.
 *
 * Only erasable TypeScript is supported. Non-erasable syntax
 * (`enum`, `namespace` with values, parameter properties, legacy
 * decorators with `emitDecoratorMetadata`, `import = require`)
 * throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` from Node and the
 * dev server returns the error to the caller. The
 * `erasable-typescript-only` and `no-non-erasable-typescript` lint
 * rules catch these at edit time. There is no bundler fallback;
 * WebJs is buildless end-to-end.
 *
 * The backend is the runtime-appropriate stripper (#508): Node 24+'s built-in
 * `module.stripTypeScriptTypes`, or `amaro` on Bun (byte-identical, equally
 * position-preserving), resolved once via `./ts-strip.js`.
 *
 * @param {string} source
 * @param {string} _abs  (unused; preserved for symmetry with prior signature)
 * @returns {Promise<string>}
 */
async function stripTs(source, _abs) {
  return stripTypeScript(source);
}

/**
 * Serve a `.ts` / `.mts` source file as JavaScript via {@link stripTs}.
 * Result is cached by mtime in the handler's own `cache` so subsequent
 * requests are instant; a file edit invalidates naturally. `elideOpts`
 * additionally strips side-effect imports of display-only components from
 * the served code, which is exactly why `cache` is the per-handler
 * `state.tsCache` and not a module-global: the cached bytes bake in this
 * handler's elision verdict.
 *
 * @param {string} abs
 * @param {boolean} dev
 * @param {{ moduleGraph: any, elidableComponents: Set<string>|undefined, appDir: string }} [elideOpts]
 * @param {Map<string, { mtimeMs: number, code: string, map: string | null }>} cache the handler's `state.tsCache`
 * @param {boolean} [immutable]  true for a `?v=<hash>` content-addressed request (#243):
 *   serve `immutable` (1 year) instead of the 1h fallback. The cached BODY is
 *   the same bytes regardless; only the cache header varies. Dev stays `no-cache`.
 */
async function tsResponse(abs, dev, elideOpts, cache, immutable, reportDevError) {
  // The body bytes are identical with or without `?v`; only the cache header
  // changes, so the per-mtime cache stays a single entry.
  const cacheControl = dev ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  const st = await stat(abs);
  const cached = cache.get(abs);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return new Response(cached.code, {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': cacheControl,
        [BUFFERED_MARKER]: '1',
      },
    });
  }
  const source = await readFile(abs, 'utf8');
  let code;
  try {
    code = await stripTs(source, abs);
  } catch (err) {
    // Node's stripTypeScriptTypes throws ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
    // for enum, namespace with values, parameter properties, legacy
    // decorators with emitDecoratorMetadata, and import = require.
    // Return a clean 500 with the file path and a pointer at the
    // erasable-typescript-only lint rule rather than letting the
    // error bubble up unstyled.
    if (err && err.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
      // Log full detail server-side regardless of mode so operators
      // see what went wrong in their logs.
      // eslint-disable-next-line no-console
      console.error(`[webjs] non-erasable TypeScript in ${abs}: ${err.message}`);
      // Dev error overlay (#264): a TS strip failure breaks only the CLIENT
      // module fetch (the page still SSRs, so hydration is silently dead and
      // the hint below is buried in a JS comment). Push a frame so the open tab
      // shows the overlay with the offending file + the no-non-erasable hint.
      reportDevError?.(err, {
        kind: 'ts-strip',
        file: abs,
        hint: 'webjs is buildless: only erasable TypeScript is supported. Replace enum / namespace-with-values / parameter-property / legacy-decorator / import = require with their erasable equivalents. Run `webjs check` (no-non-erasable-typescript rule).',
      });
      const msg = dev
        // Dev: include the file path and Node's error message so the
        // developer's browser tooling can point them at the offending
        // construct. Replace `*` + `/` with `*\\/` so a path or
        // message containing the comment-close sequence cannot
        // terminate the wrapper comment early.
        ? `[webjs] non-erasable TypeScript in ${abs}: ${err.message}\n\n` +
          `webjs is buildless: only erasable TS syntax is supported. ` +
          `Replace enum / namespace / parameter-property / legacy-decorator / ` +
          `import = require constructs with their erasable equivalents. ` +
          `Run \`webjs check\` for guidance (no-non-erasable-typescript rule). ` +
          `Docs: https://webjs.dev/docs/typescript`
        // Prod: terse, no path leak, no Node-message leak (Node's
        // message can include source snippets). Operators get the
        // detail in server logs above.
        : `[webjs] server error transforming a .ts response. Check server logs.`;
      return new Response(`/* ${msg.replace(/\*\//g, '*\\/')} */`, {
        status: 500,
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      });
    }
    throw err;
  }
  if (elideOpts) {
    code = elideImportsFromSource(
      code, abs, elideOpts.moduleGraph, elideOpts.elidableComponents, resolveImport, elideOpts.appDir,
    );
  }
  // Version same-origin relative import specifiers so the URL the browser
  // fetches matches the `?v=`-versioned modulepreload + boot specifier (#369).
  // A no-op in dev (fingerprinting disabled). Cached with the elision result:
  // PROD files are static within a deploy, so the baked `?v` stays correct.
  code = versionModuleImports(code, abs);
  // Evict oldest entry if cache is full (simple FIFO: Map preserves insertion order).
  if (cache.size >= TS_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(abs, { mtimeMs: st.mtimeMs, code, map: null });
  return new Response(code, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': cacheControl,
      [BUFFERED_MARKER]: '1',
    },
  });
}
