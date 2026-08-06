import { createServer as createHttp1Server } from 'node:http';
import { stat, readFile, watch as fsWatch } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, resolve, dirname, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Server-side `.ts` imports are handled natively by Node 24+'s default
// type-stripping (`process.features.typescript === 'strip'`) or by Bun. The
// BROWSER-bound `.ts` request handler erases types via the pluggable stripper in
// `./ts-strip.js` (Node's built-in `module.stripTypeScriptTypes`, or `amaro` on
// Bun), so SSR and hydration produce identical JS on either runtime (#508).

import { buildRouteTable, matchPage, matchApi } from './router.js';
import { generateRouteTypes } from './route-types.js';
import { ssrPage, ssrNotFound, setClientRouterEnabled } from './ssr.js';
import { runFormAction } from './form-dispatch.js';
import { handleApi } from './api.js';
import {
  buildActionIndex,
  serveActionStub,
  serveServerOnlyStub,
  invokeAction,
  isServerFile,
  hasUseServerDirective,
  hashFile,
} from './actions.js';
import { registerActionHooks } from './action-seed.js';
import { readRegenerateRules, maybeRegenerate, isRegenerateOutputPath } from './dev-regenerate.js';
import { stripTypeScript, ensureStripper } from './ts-strip.js';
import { defaultLogger } from './logger.js';
import { assertNodeVersion } from './node-version.js';
import { applyEnvValidation } from './env-schema.js';
import { runInstrumentation, findInstrumentationClient } from './instrumentation.js';
import { withRequest, setCspNonce, setBodyLimits, setRequestId, requestId as getRequestId } from './context.js';
import { buildInfoResponse } from './build-info.js';
import { readCspConfig, mintNonce, buildCspHeader, cspHeaderName } from './csp.js';
import { attachWebSocket } from './websocket.js';
import {
  SseHub,
  serverRuntime,
  isCompressible,
  installProcessHandlers,
  makeShutdown,
  negotiateEncoding,
  createCompressor,
  varyWithAcceptEncoding,
  DEV_BOOT_ID,
} from './listener-core.js';
import { scanBareImports, resolveVendorImports, serveDownloadedBundle, clearVendorCache, hasVendorPin, readPinFile, prunePinToReachable } from './vendor.js';
import { buildModuleGraph, transitiveDeps, reachableFromEntries, resolveImport, appImportsMap, seenFilesFor } from './module-graph.js';
import { primeComponentRegistry, findOrphanComponents, scanComponents } from './component-scanner.js';
import { analyzeElision, elideImportsFromSource } from './component-elision.js';

/** PascalCase → kebab-case for a helpful diagnostic example tag name. */
function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Per-request correlation id (issue #239). Honor an inbound `X-Request-Id`
 * from a trusted upstream proxy so a trace id propagates across services; mint
 * a fresh `crypto.randomUUID()` otherwise. The inbound value is length-capped
 * and validated against a conservative token charset so a hostile client
 * cannot inject control chars / a header-splitting payload (the value is
 * echoed back in the `X-Request-Id` response header). On any mismatch we fall
 * back to a minted id rather than trust the junk.
 *
 * @param {Request} req
 * @returns {string}
 */
function resolveRequestId(req) {
  const inbound = req.headers.get('x-request-id');
  if (inbound && inbound.length <= 200 && /^[A-Za-z0-9._-]+$/.test(inbound)) return inbound;
  return crypto.randomUUID();
}

/**
 * Whether a path should be access-logged (issue #239). The framework's own
 * `/__webjs/*` probes, static runtime assets, and the dev SSE reload stream
 * are high-frequency infrastructure traffic, not app requests, so logging them
 * would just spam the access log. App routes (including app-authored
 * `/api/*`) are logged.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
function shouldAccessLog(pathname) {
  return !pathname.startsWith('/__webjs/');
}
import { setVendorEntries, setCoreInstall, publishBuildId, setAppSourceId, setBasePath, basePath, setImportAliasEntries, importAliasBrowserEntries } from './importmap.js';
import { readBasePath, stripBasePath, withBasePath } from './base-path.js';
import { propagateTrustedRemoteIp } from './rate-limit.js';
import { readAllowedOrigins } from './csrf.js';
import { setAssetUrlProvider, setFormActionResolver } from '@webjsdev/core';
import { resolveActionIdentity } from './form-action-identity.js';
import { setAssetRoots, clearAssetHashCache, setElisionFingerprint, withAssetHash, assetHashFor, versionModuleImports, resolveAssetUrl } from './asset-hash.js';
import { urlFromRequest } from './forwarded.js';
import { compileHeaderRules, applySecurityHeaders, webRequestIsHttps } from './headers.js';
import {
  compileRedirectRules,
  applyRedirects,
  readTrailingSlashPolicy,
  applyTrailingSlash,
} from './redirects.js';
import { readBodyLimits, computeServerTimeouts } from './body-limit.js';
import { applyConditionalGet, BUFFERED_MARKER } from './conditional-get.js';
import { commitHtmlCache, setAppSourceFingerprint } from './html-cache.js';
import { buildDevErrorFrame } from './dev-error.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.mts': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Cache of stripped `.ts` / `.mts` source.
 * Keyed by absolute file path. Entries expire when mtime changes.
 * Capped at 500 entries to prevent unbounded memory growth in
 * long-running production servers.
 *
 * Stripper: `module.stripTypeScriptTypes` (Node 24+ built-in).
 * Position-preserving whitespace replacement. No sourcemap is
 * emitted because every (line, column) maps to itself in the source.
 *
 * Only erasable TypeScript is supported. Non-erasable syntax (`enum`,
 * `namespace` with values, parameter properties, legacy decorators
 * with `emitDecoratorMetadata`, `import = require`) throws at strip
 * time. The `erasable-typescript-only` and `no-non-erasable-typescript`
 * lint rules catch these at edit time. WebJs is buildless end-to-end:
 * there is no bundler fallback.
 *
 * The transformed bytes are cached per request handler in `state.tsCache`
 * (a `Map<string, { mtimeMs, code, map }>`), bounded to `TS_CACHE_MAX`
 * entries. The cache is per-handler rather than module-global because the
 * cached code bakes in that handler's elision verdict, so two handlers for
 * the same app with different elision settings must not share it.
 */
const TS_CACHE_MAX = 500;

/**
 * Auto-load `<appDir>/.env` into `process.env` once at boot. Mirrors
 * what Rails / Next / Astro do out of the box: a scaffolded app with
 * a committed `.env.example` and a developer-copied `.env` should
 * "just work" without the user having to add a dotenv import or set
 * the file path on the CLI.
 *
 * Uses Node 24+'s built-in `process.loadEnvFile`, which is dotenv-
 * compatible and DOES NOT override pre-existing `process.env` values.
 * Calls that hit a missing file or parse error are silenced; the
 * server should still come up cleanly when there's no `.env`.
 *
 * Idempotent: re-running is a no-op for any env var the user already
 * exported (e.g. via the host shell or a process manager). That
 * keeps the "shell-set wins over file" precedence Rails users
 * expect.
 *
 * Must run before any server-only module is loaded by
 * buildActionIndex, since module-init code in `lib/*.server.ts`
 * (e.g. `createAuth({ secret: process.env.AUTH_SECRET })`) reads
 * process.env at import time. createRequestHandler is the
 * single entry point where this is guaranteed.
 *
 * @param {string} appDir
 */
function loadAppEnv(appDir) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(join(appDir, '.env'));
    }
  } catch {
    // No .env file, malformed file, or Node version without
    // loadEnvFile. Either way, fall through silently: the user
    // may not need any env vars, or they may set them via shell.
  }
}

/**
 * Read the `WEBJS_ELIDE` environment override, if set.
 * `0` / `false` / `off` / `no` (case-insensitive) force elision OFF;
 * `1` / `true` / `on` / `yes` force it ON. Any other value, or an unset
 * variable, returns `undefined` so the caller falls through to the
 * `package.json` switch. The env override is the deploy-time / ops escape
 * hatch: force-disable elision to rule it out while debugging a wrong-strip
 * without editing committed code, or force-enable it regardless of an
 * app's `package.json`. It is also the seam the differential elision test
 * uses to render the same app on and off in one process.
 * @returns {boolean | undefined}
 */
function elideEnvOverride() {
  const raw = process.env.WEBJS_ELIDE;
  if (raw == null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return undefined;
}

/**
 * Read the project-level elision switch.
 * Precedence: the `WEBJS_ELIDE` env override wins when set, otherwise the
 * `package.json` `{ "webjs": { "elide": false } }` switch disables
 * display-only and inert-route elision app-wide (everything ships, like
 * before the feature existed). Any other value, or an absent key, leaves
 * elision enabled (the default). Re-read on every rebuild so toggling
 * either control takes effect without a server restart.
 * @param {string} appDir
 * @returns {Promise<boolean>}
 */
export async function readElideEnabled(appDir) {
  const override = elideEnvOverride();
  if (override !== undefined) return override;
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.elide === false) return false;
  } catch {
    // No package.json, malformed JSON, or unreadable. Keep the default.
  }
  return true;
}

/**
 * Read the `WEBJS_SEED` environment override, if set. Same grammar as
 * `WEBJS_ELIDE`: `0`/`false`/`off`/`no` force seeding OFF, `1`/`true`/`on`/`yes`
 * force it ON, anything else (or unset) falls through to the package.json
 * switch. The deploy-time / ops escape hatch and the seam tests use to render
 * an app with seeding on and off in one process.
 * @returns {boolean | undefined}
 */
function seedEnvOverride() {
  const raw = process.env.WEBJS_SEED;
  if (raw == null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return undefined;
}

/**
 * Read the project-level SSR action-seeding switch (#472). Precedence: the
 * `WEBJS_SEED` env override wins when set, otherwise the package.json
 * `{ "webjs": { "seed": false } }` switch disables it (the client re-fetches on
 * hydration as it did before the feature). Default ON (opt-out), mirroring
 * elision: any value other than the literal `false` keeps seeding enabled.
 *
 * Seeding installs a process-global `module.registerHooks` load hook, so unlike
 * elision it is read ONCE at boot (not re-read per rebuild): toggling it needs a
 * restart, like a deploy.
 * @param {string} appDir
 * @returns {Promise<boolean>}
 */
export async function readSeedEnabled(appDir) {
  const override = seedEnvOverride();
  if (override !== undefined) return override;
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.seed === false) return false;
  } catch {
    // No package.json, malformed JSON, or unreadable. Keep the default.
  }
  return true;
}

/**
 * Read the client-router switch (`webjs.clientRouter`) from the app's
 * package.json (#629). Default `true`: the client router auto-enables in the
 * browser whenever `@webjsdev/core` loads (the automatic-navigation thesis).
 * `{ "webjs": { "clientRouter": false } }` opts the WHOLE app out (pure MPA,
 * full-page navigation), which the render path signals to the browser so the
 * core bundle's module-end auto-enable is skipped. Any other value, or an
 * absent key, keeps the router on. Re-read on every rebuild (alongside elide)
 * so toggling it takes effect without a server restart.
 * @param {string} appDir
 * @returns {Promise<boolean>}
 */
export async function readClientRouterEnabled(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.clientRouter === false) return false;
  } catch {
    // No package.json, malformed JSON, or unreadable. Keep the default.
  }
  return true;
}

/**
 * Read the per-path response-header config (`webjs.headers`) from the
 * app's package.json and compile it to URLPattern rules. A missing,
 * malformed, or unreadable config yields an empty rule set (the secure
 * defaults still apply), never a throw.
 *
 * @param {string} appDir
 * @returns {Promise<ReturnType<typeof compileHeaderRules>>}
 */
export async function readHeaderRules(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return compileHeaderRules(pkg);
  } catch {
    return [];
  }
}

/**
 * Read the declarative redirect config (`webjs.redirects`) from the app's
 * package.json and compile it to URLPattern rules (issue #254). A missing,
 * malformed, or unreadable config yields an empty rule set (no redirects),
 * never a throw. Patterns are compiled ONCE here at boot, not per request.
 *
 * @param {string} appDir
 * @returns {Promise<ReturnType<typeof compileRedirectRules>>}
 */
export async function readRedirectRules(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return compileRedirectRules(pkg);
  } catch {
    return [];
  }
}

/**
 * Read the trailing-slash policy (`webjs.trailingSlash`) from the app's
 * package.json (issue #255). A missing, malformed, or unreadable config
 * yields `'ignore'` (no canonicalization), never a throw, so an
 * unconfigured app is unchanged.
 *
 * @param {string} appDir
 * @returns {Promise<'never' | 'always' | 'ignore'>}
 */
export async function readTrailingSlashFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readTrailingSlashPolicy(pkg);
  } catch {
    return 'ignore';
  }
}

/**
 * Read the sub-path base path (`webjs.basePath`) from the app's
 * package.json (issue #256). A missing, malformed, or unreadable config
 * yields `''` (root mount), never a throw, so an unconfigured app is
 * byte-identical to before this feature. Normalized to `''` or
 * `/segment[/segment...]` by `readBasePath`.
 *
 * @param {string} appDir
 * @returns {Promise<string>}
 */
export async function readBasePathFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readBasePath(pkg);
  } catch {
    return '';
  }
}

/**
 * Read the cross-origin allowlist (`webjs.allowedOrigins`) from the app's
 * package.json. These hosts / origins are accepted by the action CSRF check
 * even when cross-site (reverse-proxy / multi-domain setups). A missing or
 * unreadable config yields `[]`.
 *
 * @param {string} appDir
 * @returns {Promise<string[]>}
 */
export async function readAllowedOriginsFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readAllowedOrigins(pkg);
  } catch {
    return [];
  }
}

/**
 * Read the CSP config (`webjs.csp`) from the app's package.json and
 * normalize it (issue #233). A missing, malformed, or unreadable config
 * yields a disabled config (no nonce minted, no CSP header), never a
 * throw: a broken security knob must fail closed, not take the app down.
 *
 * @param {string} appDir
 * @returns {Promise<ReturnType<typeof readCspConfig>>}
 */
export async function readCspConfigFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readCspConfig(pkg);
  } catch {
    return readCspConfig(undefined);
  }
}

/**
 * Resolve the request body-size limits (issue #237) from the app's package.json
 * `webjs.maxBodyBytes` / `webjs.maxMultipartBytes` plus the env overrides
 * (`WEBJS_MAX_BODY_BYTES` / `WEBJS_MAX_MULTIPART_BYTES`). A missing or
 * unreadable package.json falls through to the secure defaults (env still wins),
 * never a throw.
 *
 * @param {string} appDir
 * @returns {Promise<{ json: number, multipart: number }>}
 */
export async function readBodyLimitsFromApp(appDir) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  } catch {
    pkg = undefined;
  }
  return readBodyLimits(pkg);
}

/**
 * Extra dev watch roots from the app's package.json `webjs.dev.watch` (#894).
 * These are directories the app READS from but that live OUTSIDE its appDir, so
 * the recursive `fs.watch(appDir)` never sees them (e.g. the website renders
 * posts from a repo-root `blog/` dir, a sibling of the app, so editing a post
 * would not live-reload). Each entry is resolved relative to the appDir and MAY
 * escape it (`"../blog"`); a change under one runs the same rebuild + reload as
 * an in-tree edit. Opt-in: a missing/empty config yields `[]`, so a plain app
 * watches only its appDir, unchanged.
 *
 * Returns absolute, de-duped paths, skipping any that overlap the appDir (the
 * appDir is already watched recursively, so an ancestor or descendant root
 * would just double-fire the rebuild). Existence is NOT checked here (the caller
 * filters missing paths so it can log them); the reader stays a pure
 * package.json read, matching the other `readXFromApp` helpers.
 *
 * @param {string} appDir
 * @returns {Promise<string[]>}
 */
export async function readDevWatchPathsFromApp(appDir) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const raw = pkg && pkg.webjs && pkg.webjs.dev && pkg.webjs.dev.watch;
  if (!Array.isArray(raw)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const abs = resolve(appDir, entry);
    // Skip the appDir itself and any ancestor/descendant overlap: the appDir is
    // already watched recursively, so an overlapping extra root double-fires.
    if (abs === appDir || appDir.startsWith(abs + sep) || abs.startsWith(appDir + sep)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

/**
 * Resolve the node:http server timeouts (issue #237) from the app's
 * package.json `webjs.requestTimeoutMs` / `webjs.headersTimeoutMs` /
 * `webjs.keepAliveTimeoutMs` plus the env overrides. A missing or unreadable
 * package.json falls through to the secure defaults (env still wins).
 *
 * @param {string} appDir
 * @returns {Promise<{ requestTimeout: number, headersTimeout: number, keepAliveTimeout: number }>}
 */
export async function readServerTimeoutsFromApp(appDir) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  } catch {
    pkg = undefined;
  }
  return computeServerTimeouts(pkg);
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
  // instrumentation-client.{js,ts} (#848) is an app-ROOT file (sibling of app/,
  // like env.js / readiness.js), not a router stem. Resolve it once and stash it
  // on the route table so ssrOpts + the browser-servable gate reach it uniformly.
  routeTable.instrumentationClient = await findInstrumentationClient(appDir);

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
    browserBoundFiles: null,
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
    } catch { /* a frame-build failure must never affect the request path */ }
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
  let analysisDone = false;        // deterministic analysis complete (readiness gate)
  // A pinned app applied its FULL vendor map and published the build id at boot
  // (above). The deferred vendor stage still runs once (and after every rebuild)
  // to PRUNE that map to the elision-reachable specifiers, so a pinned app serves
  // the same map an unpinned one does (#197); it does not re-publish the build id
  // (the boot hash stays the deploy fingerprint). An unpinned app starts false and
  // resolves live on the first request.
  let vendorResolved = false;      // vendor map fully resolved/pruned (or permanently tolerated)
  let vendorAttemptedOnce = false; // the first (blocking) vendor attempt has run
  let vendorGen = 0;               // bumped on rebuild; a stale resolve cannot flip vendorResolved
  let readyDone = false;           // mirrors analysisDone; the /__webjs/ready gate
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
            state.browserBoundFiles = computeBrowserBoundFiles(state.routeTable, state.moduleGraph, components, appDir);
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
              // scanner matches only a literal tag, so it sees neither, but
              // they fail DIFFERENTLY (no call never upgrades; a computed tag
              // still registers when its module reaches the browser), so one
              // message has to distinguish them. The doctor check and
              // `webjs elision` say the same thing.
              for (const { className, file } of await findOrphanComponents(appDir)) {
                logger.warn?.(
                  `[webjs] ${className} extends WebComponent but is never registered with a literal tag in ${file} ` +
                    `(either there is no registration call, or its tag is computed), so the scanner cannot see it: ` +
                    `no elision verdict, no preload hint, and with no registration call at all ` +
                    `<${kebab(className)}> tags never upgrade. ` +
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
        const scan = () => scanBareImports(appDir, new Set([...state.elidableComponents, ...state.inertRouteModules, ...state.importOnlyRouteModules.keys()]));
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
  let readinessFn; // undefined = unloaded, null = no file, function = loaded
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

  async function rebuild() {
    rebuildInFlight = rebuildInFlight.then(() => doRebuild()).catch((e) => {
      logger.error?.(`[webjs] rebuild failed:`, e);
      // Push the failure to the open tab so the overlay appears live after a
      // breaking edit, not only on the next manual navigation (#264).
      reportDevError(e, { kind: 'rebuild' });
    });
    return rebuildInFlight;
  }

  async function doRebuild() {
    // The route table is the only eager artifact (cheap directory scan); rebuild
    // it so routing reflects added/removed route files immediately.
    state.routeTable = await buildRouteTable(appDir);
    state.routeTable.instrumentationClient = await findInstrumentationClient(appDir);
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
    readinessFn = undefined; // reload readiness.{js,ts} after a rebuild
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
    opts.onReload?.();
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
        // readCspConfig already drops a directive whose name/value carries a
        // control char, so buildCspHeader produces a Headers-safe value. The
        // try/catch is a belt-and-suspenders backstop: a surprise value must
        // never throw the response pipeline (fail closed to no CSP header
        // rather than a self-inflicted 500 on every request).
        try {
          merged.headers.set(cspHeaderName(cspConfig), buildCspHeader(cspConfig, nonce));
        } catch {
          /* a malformed policy must not take the request down: serve without CSP */
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
      } catch { /* never let the cache write crash the response */ }

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
      } catch { /* never let validator computation crash the response */ }

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
  function produce(req) {
    return (async () => {
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
        let reqUrl;
        try { reqUrl = new URL(req.url); } catch { reqUrl = null; }
        if (reqUrl) {
          const stripped = stripBasePath(reqUrl.pathname, basePathValue);
          if (stripped === null) {
            // Not under the base path: this request is not for this app.
            return new Response('Not found', {
              status: 404,
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            });
          }
          if (stripped !== reqUrl.pathname) {
            reqUrl.pathname = stripped;
            // Rewrite the Request with the stripped URL, preserving method,
            // headers, and body. `duplex: 'half'` is required by the spec when
            // a body stream is present on a non-GET/HEAD request.
            //
            // SECURITY (#756): this is a fresh Request object, so it is NOT in
            // the listener's out-of-band trusted-IP WeakMap (the Bun shell
            // stamps the IP there instead of cloning the Request to set the
            // header). Without carrying it forward, `clientIp` would fall back
            // to the inbound `x-webjs-remote-ip` header that the copied
            // `req.headers` still carries, which a client can spoof. So strip
            // that header on the rebuild and propagate the framework-trusted IP
            // across the new object, the same pattern form-dispatch.js uses.
            const headers = new Headers(req.headers);
            headers.delete('x-webjs-remote-ip');
            const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
            const next = new Request(
              reqUrl.toString(),
              /** @type {any} */ ({
                method: req.method,
                headers,
                body: hasBody ? req.body : undefined,
                duplex: hasBody ? 'half' : undefined,
                redirect: req.redirect,
                signal: req.signal,
              }),
            );
            propagateTrustedRemoteIp(req, next);
            req = next;
          }
        }
      }

      // Declarative redirects (issue #254): apply the configured old-path ->
      // new-path rules at the VERY START of request handling, before the
      // probes, routing, SSR, or asset serving. A matched source returns a
      // 308 (permanent, the SEO default) / 307 (temporary) / configured
      // status immediately, so a moved URL never reaches the router.
      // `applyRedirects` skips /__webjs/* itself, so the framework probes /
      // runtime below are never redirected. The secure-header + conditional-GET
      // funnel in handle() still wraps this Response, like any other.
      const redirectResp = applyRedirects(req, redirectRules);
      if (redirectResp) return redirectResp;

      // Trailing-slash canonicalization (issue #255): after the explicit
      // redirects above (so an explicit rule wins first and the two never
      // form a loop), 308-redirect a non-canonical path to the policy's
      // canonical form (`never` strips a trailing slash, `always` adds one).
      // Default `'ignore'` is a no-op. The root `/` and file paths are
      // exempt; `/__webjs/*` is exempt too (defense in depth, the redirects
      // above already skip it). The funnel in handle() still wraps this.
      const slashResp = applyTrailingSlash(req, trailingSlashPolicy);
      if (slashResp) return slashResp;

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
      let probePath;
      try { probePath = new URL(req.url).pathname; } catch { probePath = ''; }
      if (probePath === '/__webjs/health') {
        return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
      }
      // Build-info probe (issue #239): which build is live? Answered before
      // ensureReady like the other probes (it depends only on the package
      // version + already-published build id + process info, never the app
      // analysis). No secrets.
      if (probePath === '/__webjs/version') {
        return buildInfoResponse();
      }
      if (probePath === '/__webjs/ready') {
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
      // Framework-internal static assets (the @webjsdev/core runtime, the dev
      // reload client, downloaded vendor bundles) depend on neither the analysis
      // nor the vendor importmap, so serve them BEFORE ensureReady(). Otherwise a
      // cold instance blocks them behind the first vendor resolve (issue #190),
      // and the core bundle is on every page's boot path, so that stalled first
      // interactivity site-wide. Matched on the decoded path, like handleCore.
      let assetPath = probePath;
      try { assetPath = decodeURIComponent(probePath); } catch { /* keep raw on malformed escape */ }
      // Content-hash fingerprint (#243): a `?v=` query means an immutable,
      // content-addressed asset url. Detected off the raw request url here
      // (probePath was parsed from it above).
      let assetVersioned = false;
      try { assetVersioned = new URL(req.url).searchParams.has('v'); } catch { /* none */ }
      const staticResp = await tryServeFrameworkStatic(assetPath, req.method.toUpperCase(), { coreDir, appDir, dev, versioned: assetVersioned });
      if (staticResp) return staticResp;
      // Build all whole-app analysis on the first request (memoized), before
      // any SSR, module serve, gate check, action dispatch, or middleware runs.
      await ensureReady();
      const next = () => handleCore(req, { state, appDir, coreDir, dev, reportError, reportDevError, cspEnabled: cspConfig.enabled, allowedOrigins: allowedOriginsValue });
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
    })();
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
    appDir,
    dev,
    logger,
  };
}

/**
 * Start a WebJs HTTP server. Thin wrapper around `createRequestHandler`.
 *
 * Speaks plain HTTP/1.1. TLS termination + HTTP/2 to the browser is
 * expected to be handled by a reverse proxy (PaaS edge, nginx, Caddy,
 * etc.) sitting in front of this process. See the deployment docs for
 * the recommended topology.
 *
/**
 * Paths under the app root whose changes must NOT trigger a dev rebuild.
 * `node_modules` / `.git` are noise. `.webjs/` is the framework's generated
 * artefact dir (the #258 routes.d.ts and the vendor pin) that the dev server
 * itself writes on startup and on every rebuild, so without this skip the
 * write fires a watch event, triggers a rebuild, re-writes the file, and loops
 * forever. `db/dev.db*` (the SQLite file + sidecars) and `db/migrations`
 * (drizzle-kit output) churn during db:migrate. The `db/dev.db` branch is
 * prefix-only (no trailing separator) so the `-journal` / `-wal` sidecars match
 * too, while staying anchored to `db/dev.db` so a SOURCE file like
 * `db/schema.server.ts` still triggers a reload. The others stay
 * separator-anchored so an unrelated name like `node_modules.bak/foo` does not.
 *
 * @param {string} filename relative path from an fs.watch `event.filename`
 * @returns {boolean} true when the change should be ignored
 */
export function shouldIgnoreWatchPath(filename) {
  return /(?:^|[\\/])(?:node_modules|\.git|\.webjs)(?:[\\/]|$)|(?:^|[\\/])db[\\/](?:dev\.db|migrations)/.test(filename || '');
}

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

/** @type {string} memoized `@webjsdev/server` version, folded into the app-source signal (#899). */
let _frameworkServerVersion;
/**
 * The installed `@webjsdev/server` version (this package). Folded into the
 * app-source deploy signal so a server-framework release (which alters SSR
 * output but ships no new browser module) turns over the client's stale caches.
 * @returns {string}
 */
function frameworkServerVersion() {
  if (_frameworkServerVersion !== undefined) return _frameworkServerVersion;
  try {
    const v = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    _frameworkServerVersion = typeof v === 'string' ? v.replace(/[^\w.-]/g, '').slice(0, 32) : '';
  } catch { _frameworkServerVersion = ''; }
  return _frameworkServerVersion;
}

/**
 * @param {{
 *   appDir: string,
 *   port?: number,
 *   dev?: boolean,
 *   compress?: boolean,
 *   logger?: import('./logger.js').Logger,
 *   onError?: (error: unknown, ctx: { request: Request, requestId: string|null, phase: string }) => void,
 * }} opts
 */
export async function startServer(opts) {
  const dev = !!opts.dev;
  const port = opts.port ?? 8080;
  // Compression default: on in prod, off in dev (cheaper to debug raw bytes).
  const compress = opts.compress ?? !dev;
  const logger = opts.logger || defaultLogger({ dev });

  // Runtime-neutral SSE registry + fanout (shared by the node:http and Bun.serve
  // shells via listener-core.js, so live-reload + the dev error overlay behave
  // identically on both). Built before the handler so its onReload / onDevError
  // callbacks can fan out through it.
  const hub = new SseHub();
  let app;
  try {
    app = await createRequestHandler({
      ...opts,
      logger,
      onReload: () => hub.reload(),
      // Dev error overlay (#264): push a frame to every open tab over the SAME
      // SSE channel. A distinct `webjs-error` event name (NOT `error`, which is
      // EventSource's native connection-error event) carries the JSON frame.
      onDevError: (frame) => hub.devError(frame),
    });
  } catch (e) {
    // The hub starts its keepalive interval in its constructor (before this
    // await), so a boot failure must clear it rather than leak a live timer.
    hub.closeAll();
    throw e;
  }

  /** @type {AbortController | null} */
  let watcherAbort = null;
  if (dev) {
    // Watch the app root recursively via Node's built-in
    // `fs.promises.watch`. Stable on macOS, Windows, and Linux as of
    // Node 24. No external dep needed.
    //
    // fs.watch returns relative paths in event.filename. `shouldIgnoreWatchPath`
    // (module-level, exported for tests) skips node_modules, .git, .webjs/, and
    // the SQLite dev DB (db/dev.db) + db/migrations so a file the dev server itself writes never loops.
    const rebuild = debounce(() => app.rebuild(), 80);
    watcherAbort = new AbortController();
    const watchRoot = async (root) => {
      try {
        const events = fsWatch(root, { recursive: true, signal: watcherAbort.signal });
        for await (const event of events) {
          const filename = event.filename || '';
          if (shouldIgnoreWatchPath(filename)) continue;
          // A regenerate output (#967) is a build product the server itself
          // writes on request; ignoring it stops a spurious rebuild + reload
          // (and a reload -> refetch -> recompile -> reload cycle), same as the
          // db/dev.db carve-out above. `app` exposes the check because `state`
          // lives in createRequestHandler's scope, not here.
          if (app.isRegenerateOutput(filename)) continue;
          rebuild();
        }
      } catch (err) {
        if (err && /** @type any */(err).name !== 'AbortError') {
          logger.warn({ err }, `file watcher exited (${root})`);
        }
      }
    };
    watchRoot(app.appDir);
    // Extra roots the app reads from OUTSIDE its appDir (#894): repo-root content
    // dirs (blog markdown, data fixtures) the recursive appDir watch can't see.
    // Opt-in via `webjs.dev.watch`; each funnels into the same debounced rebuild.
    const extraWatch = (await readDevWatchPathsFromApp(app.appDir)).filter((p) => existsSync(p));
    for (const root of extraWatch) watchRoot(root);
    if (extraWatch.length) logger.info?.(`[webjs] also watching ${extraWatch.length} extra dev path(s): ${extraWatch.join(', ')}`);
  }

  // Inbound server timeouts (issue #237). On node these are the node:http
  // built-ins; on Bun the node `requestTimeout` maps to Bun's single
  // `idleTimeout`. Defends against slowloris and hung connections. Overridable
  // via `webjs.requestTimeoutMs` / `headersTimeoutMs` / `keepAliveTimeoutMs` in
  // package.json or the matching WEBJS_*_MS env vars; `0` disables that timeout.
  const timeouts = await readServerTimeoutsFromApp(app.appDir);

  // The shared context both listener shells consume. The transport-specific glue
  // (node:http `res.write`, Bun.serve streaming Response) lives in each shell;
  // the SSE registry, the live-reload path predicate, the WS module loader, and
  // the lifecycle wiring are shared via listener-core.js so the shells can't drift.
  /** @type {import('./listener-types.js').ListenerContext} */
  const ctx = { app, dev, compress, logger, hub, port, basePathStr: basePath(), timeouts, watcherAbort };

  // Pick the adapter by runtime. Bun is Request/Response-native, so its shell
  // skips the node:http bridge (toWebRequest/sendWebResponse) for ~1.9x more
  // req/s on the listening path (#511); the Bun shell is dynamically imported so
  // the `Bun.*` global is never referenced on Node.
  if (serverRuntime() === 'bun') {
    const { startBunListener } = await import('./listener-bun.js');
    return startBunListener(ctx);
  }
  return startNodeListener(ctx);
}

/**
 * The node:http listener shell: the original `startServer` socket path, now
 * reading the shared `ListenerContext`. Bridges node `IncomingMessage` ->
 * `Request` (`toWebRequest`) and `Response` -> `ServerResponse`
 * (`sendWebResponse`), emits 103 Early Hints, and drives SSE + WS over node
 * primitives, sharing the SSE registry + lifecycle wiring with the Bun shell.
 * @param {import('./listener-types.js').ListenerContext} ctx
 * @returns {{ server: import('node:http').Server, close: () => Promise<void> }}
 */
function startNodeListener(ctx) {
  const { app, dev, compress, logger, hub, port, basePathStr, timeouts, watcherAbort } = ctx;

  const server = makeHttpServer(async (req, res) => {
    try {
      const url = urlFromRequest(req);

      // SSE: handled specially; doesn't fit the req→Response model. Match the
      // base-path-stripped pathname so the reload stream answers at
      // `<basePath>/__webjs/events` under a sub-path deploy (#256). With no
      // basePath this is a pure pass-through (the bare path still matches).
      if (stripBasePath(url.pathname, basePathStr) === '/__webjs/events') {
        if (!dev) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        // `retry: 300` shrinks the browser's EventSource reconnect backoff from
        // its ~3s default so a reconnect after a `node --watch` restart happens
        // promptly. The `hello` data is a per-process boot id (#893): the client
        // reloads on a reconnect ONLY when it changes (a real restart), so a
        // transient reconnect never triggers a spurious reload.
        res.write(`retry: 300\nevent: hello\ndata: ${DEV_BOOT_ID}\n\n`);
        // Register a node client wrapper in the shared hub: the fanout + keepalive
        // live in SseHub; only the transport write (res.write / res.end) is local.
        const client = {
          send: (s) => { try { res.write(s); } catch {} },
          close: () => { try { res.end(); } catch {} },
        };
        hub.add(client);
        // Replay an unresolved dev error (#264) so a tab that connects AFTER the
        // breaking edit (e.g. opened via a fresh navigation) still shows the
        // overlay, not only the tab that was open when the error fired.
        const pending = app.getLastDevError?.();
        if (pending) {
          try { res.write(`event: webjs-error\ndata: ${JSON.stringify(pending)}\n\n`); } catch {}
        }
        res.socket?.on('close', () => hub.remove(client));
        return;
      }

      // 103 Early Hints: before running SSR, send preload hints for the
      // page's module URLs so the browser can begin fetching them while
      // the server is still computing the body. Skipped in dev (file churn
      // would send stale URLs after rebuilds) and for non-GET/HEAD.
      if (
        !dev &&
        (req.method === 'GET' || req.method === 'HEAD') &&
        typeof res.writeEarlyHints === 'function'
      ) {
        const match = app.routeFor(url.pathname);
        if (match && match.moduleUrls.length) {
          try {
            res.writeEarlyHints({
              link: match.moduleUrls.map((u) => `<${u}>; rel=modulepreload`),
            });
          } catch (e) {
            logger.warn('writeEarlyHints failed', { err: String(e) });
          }
        }
      }

      const webReq = toWebRequest(req, url);
      const resp = await app.handle(webReq);
      await sendWebResponse(res, resp, req, { compress });
    } catch (e) {
      logger.error('request pipeline threw', { err: e instanceof Error ? e.stack : String(e) });
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(dev && e instanceof Error ? `webjs error: ${e.stack}` : 'Internal server error');
    }
  });

  // node:http built-in timeouts: `requestTimeout` bounds the time to receive the
  // WHOLE request, `headersTimeout` just the headers (kept strictly under
  // requestTimeout so it actually fires), `keepAliveTimeout` the idle window
  // before a kept-alive socket is closed.
  server.requestTimeout = timeouts.requestTimeout;
  server.headersTimeout = timeouts.headersTimeout;
  server.keepAliveTimeout = timeouts.keepAliveTimeout;

  // WebSocket upgrade handling: any route.js that exports `WS` becomes a
  // WebSocket endpoint at its URL.
  attachWebSocket(server, () => app.getRouteTable(), { dev, logger });

  server.listen(port, () => {
    logger.info(`webjs ${dev ? 'dev' : 'prod'} server ready on http://localhost:${port}`);
    // The server is now accepting connections; warm the first-request analysis
    // in the background so a real first request finds it memoized. Fire-and-
    // forget: listening (and thus readiness probes / load-balancer health) does
    // not wait on it, and a failure here does not bring the process down.
    app.warmup();
  });

  const closeServer = () => new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve(undefined)));
  });
  const shutdown = makeShutdown({ closeServer, hub, logger });
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Catch-all process handlers: log, but don't tear the process down on a
  // single mishandled promise. Uncaught exceptions are different: state may be
  // corrupted, so log + start an orderly shutdown rather than continuing.
  installProcessHandlers(logger, () => shutdown('uncaughtException', { fatal: true }));

  return {
    server,
    close: () => new Promise((r) => {
      if (watcherAbort) watcherAbort.abort();
      // Clear the shared SSE keepalive timer so repeated startServer/close cycles
      // (e.g. across a test run) don't accumulate live intervals.
      hub.closeAll();
      server.close(() => r());
    }),
  };
}

/**
 * The core request → response pipeline, minus middleware.
 * @param {Request} req
 * @param {{state: any, appDir: string, coreDir: string, dev: boolean}} ctx
 */
/**
 * Serve framework-internal static assets that depend on NEITHER the whole-app
 * analysis NOR the vendor importmap: the `@webjsdev/core` runtime files, the
 * dev reload client, and (in `--download` pin mode) the committed vendor
 * bundles. `handle()` calls this BEFORE `ensureReady()`, so a cold instance
 * returns them immediately instead of blocking on the first vendor resolve
 * (issue #190). The core bundle is on every page's boot path, so coupling it
 * to the jspm resolve stalled first interactivity site-wide on a cold instance.
 *
 * Like the health / readiness probes (also answered pre-`ensureReady`), these
 * bypass app middleware. That is correct: they are framework infrastructure the
 * app needs to function, not app routes, and `state.middleware` is not even
 * loaded until `ensureReady()` completes.
 *
 * @param {string} path decoded pathname
 * @param {string} method upper-cased HTTP method
 * @param {{ coreDir: string, appDir: string, dev: boolean, versioned?: boolean }} ctx
 *   `versioned` is true when the request carried a `?v=` query (a
 *   content-hash-fingerprinted url, issue #243); the core module is then served
 *   `immutable` (1 year) instead of the 1h fallback, since the hash in the url
 *   busts the cache on the next deploy.
 * @returns {Promise<Response|null>} a Response, or null when path is not one of these assets
 */
async function tryServeFrameworkStatic(path, method, ctx) {
  const { coreDir, appDir, dev, versioned } = ctx;

  // Dev live-reload client.
  if (path === '/__webjs/reload.js') {
    if (!dev) return new Response('Not found', { status: 404 });
    return new Response(reloadClientJs(basePath()), {
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    });
  }

  // Dev live-reload SharedWorker: one shared connection for all tabs (#887).
  if (path === '/__webjs/reload-worker.js') {
    if (!dev) return new Response('Not found', { status: 404 });
    return new Response(reloadWorkerJs(basePath()), {
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    });
  }

  // Core module: /__webjs/core/*
  //
  // ETag + ~1h max-age, NOT immutable. The URL path is un-versioned
  // (`/__webjs/core/src/render-client.js` etc.), so bumping `@webjsdev/core`
  // ships different bytes at the same URL. An `immutable` cache-control
  // directive at an edge CDN (Cloudflare, Vercel, Fly) keeps the prior bytes
  // pinned for up to a year, which silently bricks the next deploy: browsers
  // load the old client renderer against a server emitting the new SSR shape,
  // and any exports added in the bump (e.g., the slot.js entry points landed
  // for 0.6.0) resolve to undefined in the cached file.
  // Regression: 2026-05-20, ui.webjs.dev tier-2 components after
  // @webjsdev/core 0.5.0 -> 0.6.0 republish.
  if (path.startsWith('/__webjs/core/')) {
    const rel = path.slice('/__webjs/core/'.length);
    const abs = resolve(coreDir, rel);
    // Trailing-separator boundary check, not a raw string prefix: a raw
    // `startsWith(coreDir)` would admit a sibling like `@webjsdev/core-evil`,
    // reachable via an encoded slash (`..%2f`, which survives URL normalization
    // and then decodes to `../`). Match the public-root branch's guard.
    if (abs !== coreDir && !abs.startsWith(coreDir + sep)) {
      return new Response('forbidden', { status: 403 });
    }
    // A `?v=<hash>` request is content-addressed, so serve it `immutable` (#243):
    // the hash busts the cache on the next core bump, so the regression the
    // un-versioned 1h cap guards against (a stale immutable core after a bump)
    // cannot recur. An un-fingerprinted request keeps the 1h fallback.
    return fileResponse(abs, { dev, immutable: !!versioned });
  }

  // Vendor URL handler for `webjs vendor pin --download` mode only. In default
  // pin mode (or no-pin mode) the importmap routes bare imports straight to
  // ga.jspm.io URLs and the browser bypasses this server entirely. When the
  // user ran `webjs vendor pin --download`, the importmap has local
  // `/__webjs/vendor/<file>.js` URLs and this serves the committed bundle files
  // from `.webjs/vendor/`. These are read-only static content: allow GET/HEAD
  // for the normal fetch, OPTIONS for any cross-origin preflight (204 with the
  // same Allow header rather than 405, which some intermediaries treat as a
  // hard failure even for a CORS probe), and 405 everything else.
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
      // HEAD must return same headers as GET with no body.
      return new Response(null, { status: resp.status, headers: resp.headers });
    }
    return resp;
  }

  return null;
}

async function handleCore(req, ctx) {
  const { state, appDir, coreDir, dev, reportError, reportDevError, cspEnabled, allowedOrigins } = ctx;
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
        onError: reportError ? (e) => reportError(e, req, 'action') : undefined,
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
 * Install signal handlers that stop accepting new connections, close SSE
 * clients, and exit once in-flight requests drain.
 * @param {import('node:http').Server} server
 * @param {Set<import('node:http').ServerResponse>} sseClients
 * @param {import('./logger.js').Logger} logger
 */
/**
 * Create a plain HTTP/1.1 server. WebJs deploys are expected to sit
 * behind a reverse proxy (PaaS edge, nginx, Caddy, etc.) that handles
 * TLS termination and speaks HTTP/2 to clients: Node's http2 module
 * doesn't need to be involved on the framework side.
 *
 * @param {(req: any, res: any) => void} handler
 */
function makeHttpServer(handler) {
  return createHttp1Server(handler);
}

/* ------------ helpers ------------ */

/** @param {import('node:http').IncomingMessage} req @param {URL} url */
function toWebRequest(req, url) {
  const method = (req.method || 'GET').toUpperCase();
  /** @type {Record<string,string>} */
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    // Drop HTTP/2 pseudo-headers (`:method`, `:path`, `:scheme`, `:authority`).
    // They're parsed separately into req.method / req.url and are rejected
    // by the standard Headers class if we pass them through verbatim.
    if (k.startsWith(':')) continue;
    // Strip any inbound `x-webjs-remote-ip` header so clients cannot
    // spoof the framework-stamped client IP that rate-limit's
    // `clientIp(req, { trustProxy: false })` reads. We rewrite it
    // below from the actual TCP socket. Node's IncomingMessage
    // always lowercases header keys, so a literal compare is enough.
    if (k === 'x-webjs-remote-ip') continue;
    headers[k] = Array.isArray(v) ? v.join(',') : String(v ?? '');
  }
  // Stamp the framework-trusted remote IP from the socket. Read by
  // `clientIp(req)` (rate-limit.js) as the bucket key when
  // `trustProxy: false` (the safe default).
  const remoteIp = req.socket?.remoteAddress;
  if (remoteIp) headers['x-webjs-remote-ip'] = remoteIp;
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    body = new ReadableStream({
      start(controller) {
        req.on('data', (chunk) => controller.enqueue(chunk));
        req.on('end', () => controller.close());
        req.on('error', (e) => controller.error(e));
      },
    });
  }
  return new Request(url, /** @type any */ ({ method, headers, body, duplex: 'half' }));
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {Response} webRes
 * @param {import('node:http').IncomingMessage} [req]
 * @param {{ compress?: boolean }} [opts]
 */
async function sendWebResponse(res, webRes, req, opts) {
  /** @type {Record<string,string | string[]>} */
  const headers = {};
  // Preserve multi-value headers (Set-Cookie) via getSetCookie when available.
  if (typeof /** @type any */ (webRes.headers).getSetCookie === 'function') {
    const cookies = /** @type any */ (webRes.headers).getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
  }
  webRes.headers.forEach((v, k) => {
    if (k === 'set-cookie') return;
    headers[k] = v;
  });

  // Negotiate compression via the SHARED seam (listener-core.js), so the node and
  // Bun shells negotiate + compress identically (brotli > gzip > deflate, node:zlib
  // both sides). Skip a body that is already content-encoded (a route.ts returning
  // pre-compressed bytes), and merge into any pre-existing `Vary` rather than
  // clobbering it (`isCompressible` already excludes `text/event-stream`).
  let compressor = null;
  if (opts?.compress && req && webRes.body && !headers['content-encoding'] && isCompressible(headers['content-type'])) {
    const encoding = negotiateEncoding(req.headers['accept-encoding']);
    compressor = createCompressor(encoding);
    if (compressor) {
      headers['content-encoding'] = encoding;
      headers['vary'] = varyWithAcceptEncoding(typeof headers['vary'] === 'string' ? headers['vary'] : '');
      delete headers['content-length'];
    }
  }

  res.writeHead(webRes.status, headers);
  if (!webRes.body) { res.end(); return; }

  if (compressor) {
    compressor.pipe(res);
    const reader = webRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        compressor.write(value);
      }
    } finally {
      compressor.end();
    }
    return;
  }

  const reader = webRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
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

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
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

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Walk the route table + component scanner to collect every file the
 * browser may legitimately fetch as an ES module, then expand via the
 * module graph into the full transitive closure.
 *
 * This is webjs's equivalent of Next.js's bundler-produced page
 * manifest, derived lazily on the first request (and re-derived on every
 * rebuild) instead of at compile time. The dev server's source-file branch uses the returned
 * Set as an authorization gate: in-set → served (subject to the
 * .server.{js,ts} stub guardrail); out-of-set → 404.
 *
 * Browser-bound entries:
 *   - page.{js,ts,mjs,mts}        (re-runs on client for hydration)
 *   - layout.{js,ts,mjs,mts}      (same)
 *   - error.{js,ts,mjs,mts}       (same)
 *   - loading.{js,ts,mjs,mts}     (same)
 *   - not-found.{js,ts,mjs,mts}   (same)
 *   - component files discovered by the scanner (eager + lazy)
 *
 * Server-only entries (NOT in the set):
 *   - route.{js,ts}   (API handlers, never fetched as JS module)
 *   - middleware.{js,ts}
 *   - metadata routes (sitemap.js, robots.js, manifest.js, …)
 *   - .server.{js,ts} files (browser gets a stub, not the source)
 *
 * Components are passed in (rather than rescanned) so the caller can
 * share one scan with `primeComponentRegistry`. Saves a full
 * appDir walk on each analysis (the first request and every rebuild).
 *
 * @param {Awaited<ReturnType<typeof buildRouteTable>>} routeTable
 * @param {Awaited<ReturnType<typeof buildModuleGraph>>} moduleGraph
 * @param {Awaited<ReturnType<typeof scanComponents>>} components
 * @param {string} appDir
 * @returns {Set<string>}
 */
/**
 * Collect every page + layout file across the route table. These are the
 * modules the client boot script imports, and thus the candidates for
 * inert-route elision (dropping a module that does no client work).
 * `route.{js,ts}` / middleware / metadata are excluded: they never ship.
 *
 * @param {Awaited<ReturnType<typeof buildRouteTable>>} routeTable
 * @returns {string[]}
 */
function collectRouteModules(routeTable) {
  /** @type {Set<string>} */
  const mods = new Set();
  for (const page of routeTable.pages || []) {
    if (page.file) mods.add(page.file);
    for (const f of page.layouts || []) mods.add(f);
  }
  return [...mods];
}

function computeBrowserBoundFiles(routeTable, moduleGraph, components, appDir) {
  /** @type {Set<string>} */
  const entries = new Set();
  for (const page of routeTable.pages) {
    if (page.file) entries.add(page.file);
    for (const f of page.layouts || []) entries.add(f);
    for (const f of page.errors || []) entries.add(f);
    for (const f of page.loadings || []) entries.add(f);
    for (const f of page.forbiddens || []) entries.add(f);
    for (const f of page.unauthorizeds || []) entries.add(f);
  }
  if (routeTable.notFound) entries.add(routeTable.notFound);
  if (routeTable.notFounds) {
    for (const f of routeTable.notFounds.values()) entries.add(f);
  }
  if (routeTable.globalError) entries.add(routeTable.globalError);
  if (routeTable.globalNotFound) entries.add(routeTable.globalNotFound);
  // instrumentation-client is browser-bound (imported first in the boot), so it
  // must be servable through the gate.
  if (routeTable.instrumentationClient) entries.add(routeTable.instrumentationClient);
  // Lazy components live in the registry but no page imports their
  // class directly; the lazy-loader fetches their module URLs on
  // viewport entry. Add every discovered component file as an entry so
  // the graph walk covers both eager and lazy paths.
  for (const c of components) entries.add(c.file);
  return reachableFromEntries(moduleGraph, [...entries], appDir);
}

/**
 * List the app's top-level source directory names, for expanding a `#*`
 * catch-all import alias into one browser importmap prefix scope per dir (#555).
 * Excludes infra dirs that are never imported via `#` (node_modules, dotfiles,
 * the build/vendor caches). A new top-level folder is picked up on the next boot
 * (dev restarts on changes), so the alias stays zero-maintenance.
 * @param {string} appDir
 * @returns {string[]}
 */
function appTopLevelDirs(appDir) {
  const SKIP = new Set(['node_modules', 'dist', 'public']);
  try {
    return readdirSync(appDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Find the absolute directory of the `@webjsdev/core` package, regardless of
 * whether we're running from the monorepo or an installed copy.
 * @param {string} appDir
 */
function locateCoreDir(appDir) {
  try {
    const require = createRequire(join(appDir, 'package.json'));
    const pkgPath = require.resolve('@webjsdev/core/package.json');
    return dirname(pkgPath);
  } catch {}
  const here = fileURLToPath(import.meta.url);
  return resolve(here, '..', '..', '..', 'core');
}

/**
 * Find an npm package's installed root folder in the app's node_modules graph.
 * @param {string} appDir
 * @param {string} pkgName
 * @returns {string | null}
 */
function locatePackageDir(appDir, pkgName) {
  // Many packages lock down `./package.json` in their exports field, so we
  // resolve the bare specifier (always exported) and trim back to the
  // folder named pkgName.
  const match = '/node_modules/' + pkgName + '/';
  const tryFrom = (from) => {
    const require = createRequire(from);
    const entry = require.resolve(pkgName).split(sep).join('/');
    const at = entry.lastIndexOf(match);
    if (at < 0) return null;
    return entry.slice(0, at + match.length - 1).split('/').join(sep);
  };
  try { const d = tryFrom(join(appDir, 'package.json')); if (d) return d; } catch {}
  try { const d = tryFrom(fileURLToPath(import.meta.url)); if (d) return d; } catch {}
  return null;
}

/**
 * The dev live-reload client. The `EventSource` URL is a framework-emitted
 * same-origin path, so it must carry the base path under a sub-path deploy
 * (#256), like the importmap targets and the RPC stub. No-op when basePath
 * is empty.
 * @param {string} bp the normalized base path (`''` = no-op)
 * @returns {string}
 */
// The overlay renderer source, read once + `export`-stripped so it inlines as
// plain functions into the classic reload-client script. Sharing the one source
// (`dev-overlay.js`, which the browser test imports directly) means the test
// drives the EXACT code that ships, with no drift (#264).
const DEV_OVERLAY_SRC = readFileSync(new URL('./dev-overlay.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');

// The reload SharedWorker relay source (#887), read once + `export`-stripped so
// it inlines into the served worker script. Sharing the one source
// (`dev-reload-worker.js`, which the browser test imports directly) means the
// test drives the EXACT relay code that ships, with no drift (same as #264).
const RELOAD_WORKER_SRC = readFileSync(new URL('./dev-reload-worker.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '');

function reloadClientJs(bp) {
  // The overlay renderer uses textContent throughout (never innerHTML), so the
  // error message / code frame can never inject markup (#264). Served only in
  // dev (the /__webjs/reload.js branch 404s in prod), so it never reaches a
  // production page.
  //
  // Every tab shares ONE live-reload connection through a SharedWorker (#887).
  // The old client opened an `EventSource` per tab, and because the dev server
  // is HTTP/1.1 and browsers cap concurrent connections per host at ~6, a
  // handful of open tabs would hold every connection slot with idle SSE streams
  // and later tabs could not even fetch their HTML. The SharedWorker holds the
  // single `EventSource` (see reloadWorkerJs) and relays each `reload` /
  // `webjs-error` to every tab. The overlay still renders on the main thread
  // (a worker has no DOM), so the worker forwards only the raw frame data.
  //
  // Fallback: where `SharedWorker` is missing (some mobile browsers) or its
  // construction throws (a strict dev CSP without `worker-src`), each tab opens
  // its own `EventSource`, the original behaviour. Correct, just not shared.
  const eventsUrl = JSON.stringify(withBasePath('/__webjs/events', bp));
  const workerUrl = JSON.stringify(withBasePath('/__webjs/reload-worker.js', bp));
  const versionUrl = JSON.stringify(withBasePath('/__webjs/version', bp));
  return `// webjs dev reload client
${DEV_OVERLAY_SRC}
function __webjsApplyError(data) {
  let f; try { f = JSON.parse(data); } catch (_) { return; }
  renderDevOverlay(f);
}
// Keep the overlay tracking the page actually on screen (#1047): a render frame
// is scoped to the URL that produced it, so navigating away takes it down, and a
// frame that arrived before the URL advanced goes up once it does. The gate
// itself lives inside renderDevOverlay, so __webjsApplyError needs no change.
installDevOverlayNavSync();
// Never reload INTO a server that is still restarting (Node's node --watch
// briefly kills the process on an edit), which would paint a style-less,
// half-rendered page (#893). Probe the lightweight /__webjs/version endpoint
// until it answers, THEN reload. Under an in-process reload the server is up,
// so the first probe passes and the reload is instant; under a restart the
// probes fail until the fresh server is listening, so the old page stays put
// until the new one is ready. Bounded, so a genuinely-dead server still
// reloads (and shows the browser's own error) rather than hanging forever.
function __webjsReloadWhenReady() {
  var tries = 0;
  function attempt() {
    fetch(${versionUrl}, { cache: 'no-store' }).then(function (r) {
      if (r && r.ok) location.reload(); else again();
    }).catch(again);
  }
  function again() { if (++tries > 100) location.reload(); else setTimeout(attempt, 100); }
  attempt();
}
function __webjsDirectEvents() {
  // Same restart-reload as the SharedWorker relay (#893), for the per-tab
  // fallback: the hello frame carries the server's per-process boot id, so a
  // CHANGED id on reconnect means a real restart (reload), while a transient
  // reconnect to the same process keeps the id (no spurious reload).
  var lastBoot = null;
  const es = new EventSource(${eventsUrl});
  es.addEventListener('hello', (e) => {
    if (lastBoot !== null && e.data !== lastBoot) __webjsReloadWhenReady();
    lastBoot = e.data;
  });
  es.addEventListener('reload', () => __webjsReloadWhenReady());
  es.addEventListener('webjs-error', (e) => __webjsApplyError(e.data));
}
try {
  if (typeof SharedWorker !== 'undefined') {
    const w = new SharedWorker(${workerUrl});
    w.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'reload') __webjsReloadWhenReady();
      else if (m.type === 'webjs-error') __webjsApplyError(m.data);
    };
    w.port.start();
  } else {
    __webjsDirectEvents();
  }
} catch (_) {
  __webjsDirectEvents();
}
`;
}

/**
 * The dev live-reload SharedWorker. One instance is shared across every tab of
 * the same origin (a SharedWorker is keyed by its script URL), so it holds the
 * ONE `EventSource` to `/__webjs/events` and fans each event out to all tabs
 * over their `MessagePort`s (#887). The `EventSource` URL carries the base path
 * the same way the client's does (#256). Served only in dev.
 * @param {string} bp the normalized base path (`''` = no-op)
 * @returns {string}
 */
function reloadWorkerJs(bp) {
  return `// webjs dev reload worker (one shared connection for all tabs)
${RELOAD_WORKER_SRC}
startReloadWorker(self, EventSource, ${JSON.stringify(withBasePath('/__webjs/events', bp))});
`;
}
