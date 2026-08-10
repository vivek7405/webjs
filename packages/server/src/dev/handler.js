import { stat, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildRouteTable, matchPage, matchApi } from '../router.js';
import { generateRouteTypes } from '../route-types.js';
import { ssrPage, ssrNotFound, setClientRouterEnabled } from '../ssr.js';
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
import { setAssetRoots, clearAssetHashCache, setElisionFingerprint, assetHashFor, versionModuleImports, resolveAssetUrl } from '../asset-hash.js';
import { applySecurityHeaders, webRequestIsHttps } from '../headers.js';
import {
  applyRedirects,
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
            ms: Math.round(performance.now() - startedAt),
            ...(seed ? { seed } : {}),
          });
        } catch { /* ignore */ }
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

    if (path === '/__webjs/health') {
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    }

    if (path === '/__webjs/ready') {
      if (!readyDone) {
        return Response.json({ ready: false, reason: 'warmup in progress' }, { status: 503 });
      }
      if (readyError) {
        return Response.json({ ready: false, reason: String(readyError) }, { status: 503 });
      }
      const customCheck = await getReadinessCheck();
      if (customCheck) {
        try {
          const ok = await customCheck();
          if (!ok) return Response.json({ ready: false, reason: 'readiness.js returned false' }, { status: 503 });
        } catch (e) {
          return Response.json({ ready: false, reason: String(e) }, { status: 503 });
        }
      }
      return Response.json({ ready: true }, { status: 200 });
    }

    if (path === '/__webjs/version') {
      return buildInfoResponse();
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

    await ensureReady();

    return handleCore(req, {
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
  }

  return {
    handle,
    rebuild,
    state,
    appDir,
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
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }
  const method = req.method.toUpperCase();
  const versioned = url.searchParams.has('v');

  const frameworkStatic = await tryServeFrameworkStatic(path, method, { coreDir, appDir, dev, versioned });
  if (frameworkStatic) return frameworkStatic;

  const actMatch = /^\/__webjs\/action\/([a-f0-9]+)\/([A-Za-z0-9_$]+)$/.exec(path);
  if (actMatch) {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return new Response('method not allowed', { status: 405 });
    }
    const onActionError = reportError ? (e) => reportError(e, req, 'action') : undefined;
    return invokeAction(state.actionIndex, actMatch[1], actMatch[2], req, onActionError, allowedOrigins);
  }

  const ROOT_ASSETS = { '/sw.js': '/public/sw.js', '/offline.html': '/public/offline.html' };
  if (path.startsWith('/public/') || path === '/favicon.ico' || path in ROOT_ASSETS) {
    const p = path === '/favicon.ico' ? '/public/favicon.ico' : (ROOT_ASSETS[path] || path);
    const abs = join(appDir, p);
    const publicRoot = join(appDir, 'public') + sep;
    if (!abs.startsWith(publicRoot)) {
      return new Response(null, { status: 404 });
    }
    if (dev && state.regenerateRules.length) {
      await maybeRegenerate(appDir, p.replace(/^\/+/, ''), state.regenerateRules);
    }
    if (await exists(abs)) {
      const res = await fileResponse(abs, { dev, immutable: versioned });
      if (path === '/sw.js') res.headers.set('Service-Worker-Allowed', '/');
      return res;
    }
  }

  if (method === 'GET' && /\.(js|mjs|ts|mts|css|svg|png|jpg|jpeg|gif|webp|json|ico|txt)$/.test(path)) {
    let abs = join(appDir, path);
    if (!(await exists(abs)) && /\.js$/.test(abs)) {
      const tsAbs = abs.replace(/\.js$/, '.ts');
      if (await exists(tsAbs)) abs = tsAbs;
      else {
        const mtsAbs = abs.replace(/\.js$/, '.mts');
        if (await exists(mtsAbs)) abs = mtsAbs;
      }
    }
    const inGraph = state.testMode || (state.browserBoundFiles && state.browserBoundFiles.has(abs));
    const underAppDir = abs === appDir || abs.startsWith(appDir + sep);
    if (underAppDir && inGraph && (await exists(abs))) {
      if (isServerFile(abs)) {
        if (await hasUseServerDirective(abs)) {
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
      const elideOpts = {
        moduleGraph: state.moduleGraph,
        elidableComponents: state.elidableComponents,
        appDir,
      };
      if (/\.m?ts$/.test(abs)) {
        return tsResponse(abs, dev, elideOpts, state.tsCache, versioned, reportDevError);
      }
      if (/\.m?js$/.test(abs)) {
        return jsModuleResponse(abs, dev, elideOpts, versioned);
      }
      return fileResponse(abs, { dev, immutable: versioned });
    }
    if (dev && abs.startsWith(appDir) && /\.m?[jt]s$/.test(abs) && (await exists(abs))) {
      const rel = relative(appDir, abs);
      const hint = `[webjs] 404: ${rel} exists but is not reachable from any browser-bound entry, so it is not servable. If you load it via a dynamic import(), use a STRING-LITERAL specifier (e.g. import('./x.ts')) so the scanner can track it; a computed import(expr) cannot be resolved statically and will 404. Otherwise this module is simply unreferenced by client code.`;
      console.warn(hint);
      return new Response(hint, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  }

  if (method === 'GET' && state.routeTable.metadataRoutes) {
    const meta = state.routeTable.metadataRoutes.find((r) => r.urlPath === path);
    if (meta) {
      try {
        const mod = await import(pathToFileURL(meta.file).toString() + (dev ? `?t=${Date.now()}` : ''));
        if (mod.default) {
          const result = await mod.default();
          if (result instanceof Response) return result;
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

  const api = matchApi(state.routeTable, path);
  if (api) {
    const handler = () => handleApi(api.route, api.params, req, dev);
    return runWithSegmentMiddleware(req, api.route.middlewares, handler, dev);
  }

  {
    const page = matchPage(state.routeTable, path);
    if (page) {
      const devErrorUrl = withBasePath(url.pathname, basePath()) + url.search;
      const isPrefetch = req.headers.get('x-webjs-prefetch') === '1';
      const ssrOpts = {
        dev, appDir, moduleGraph: state.moduleGraph,
        serverFiles: state.actionIndex.fileToHash,
        elidableComponents: state.elidableComponents,
        inertRouteModules: state.inertRouteModules,
        importOnlyRouteModules: state.importOnlyRouteModules,
        notFoundFile: state.routeTable.notFound,
        globalError: state.routeTable.globalError,
        globalNotFound: state.routeTable.globalNotFound,
        instrumentationClient: state.routeTable.instrumentationClient,
        cspEnabled,
        onError: reportError ? (e) => reportError(e, req, 'ssr') : undefined,
        onDevError: dev && !isPrefetch
          ? (e) => reportDevError(e, { kind: 'render', url: devErrorUrl })
          : undefined,
      };
      if (method === 'GET' || method === 'HEAD') {
        reportFormSubmittedAsGet(
          url, req,
          hasOnError ? (e) => reportError(e, req, 'action') : undefined,
          logger, dev, page.route,
        );
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

  if (wantsJson(req, path)) {
    return Response.json({ error: 'Not found', path }, { status: 404 });
  }
  return ssrNotFound(state.routeTable.notFound || state.routeTable.globalNotFound, { dev, appDir, req, url });
}

function wantsJson(req, path) {
  const accept = req.headers.get('accept') || '';
  if (accept.includes('application/json') && !accept.includes('text/html')) return true;
  if (path.startsWith('/api/') || path.startsWith('/__webjs/')) return true;
  return false;
}

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
      // Ignore bad middleware
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

const ROOT_MIDDLEWARE_FILES = ['middleware.ts', 'middleware.js', 'middleware.mts', 'middleware.mjs'];

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

async function fileResponse(abs, opts) {
  try {
    let data = await readFile(abs);
    if (opts.dev && data.length === 0) {
      let midRewrite = false;
      try { midRewrite = Date.now() - (await stat(abs)).mtimeMs < 500; } catch { /* gone */ }
      for (let i = 0; midRewrite && i < 12 && data.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
        try { data = await readFile(abs); } catch { break; }
      }
    }
    const type = MIME[extname(abs).toLowerCase()] || 'application/octet-stream';
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

async function jsModuleResponse(abs, dev, elideOpts, immutable) {
  let source;
  try { source = await readFile(abs, 'utf8'); }
  catch { return new Response('Not found', { status: 404 }); }
  let code = elideImportsFromSource(
    source, abs, elideOpts.moduleGraph, elideOpts.elidableComponents, resolveImport, elideOpts.appDir,
  );
  code = versionModuleImports(code, abs);
  const headers = {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': dev ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    [BUFFERED_MARKER]: '1',
  };
  return new Response(code, { status: 200, headers });
}

async function stripTs(source, _abs) {
  return stripTypeScript(source);
}

async function tsResponse(abs, dev, elideOpts, cache, immutable, reportDevError) {
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
    if (err && err.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
      console.error(`[webjs] non-erasable TypeScript in ${abs}: ${err.message}`);
      reportDevError?.(err, {
        kind: 'ts-strip',
        file: abs,
        hint: 'webjs is buildless: only erasable TypeScript is supported. Replace enum / namespace-with-values / parameter-property / legacy-decorator / import = require with their erasable equivalents. Run `webjs check` (no-non-erasable-typescript rule).',
      });
      const msg = dev
        ? `[webjs] non-erasable TypeScript in ${abs}: ${err.message}\n\n` +
          `webjs is buildless: only erasable TS syntax is supported. ` +
          `Replace enum / namespace / parameter-property / legacy-decorator / ` +
          `import = require constructs with their erasable equivalents. ` +
          `Run \`webjs check\` for guidance (no-non-erasable-typescript rule). ` +
          `Docs: https://webjs.dev/docs/typescript`
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
  code = versionModuleImports(code, abs);
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
