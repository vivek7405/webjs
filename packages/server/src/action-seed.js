/**
 * The `'use server'` module load hook: action IDENTITY (#1155) and SSR
 * action-result seeding (#472, follow-up to async render #469).
 *
 * Two jobs share ONE hook because they need the same thing, a handle on every
 * exported action function at the moment its module loads, and installing two
 * hooks to get it twice would be pure cost.
 *
 * They are gated differently, and that difference is the point. SEEDING is an
 * optimization an app can switch off (`webjs.seed: false` / `WEBJS_SEED=0`).
 * IDENTITY is not optional: it is what lets `<form action=${action}>` resolve
 * to something the server can run, so a seeding-disabled app would otherwise
 * have every no-JS form silently stop working. So the hook installs
 * unconditionally and only the seed COLLECTION is gated.
 *
 * When a component's `async render()` does a bare `const u = await getUser(id)`
 * during SSR, the action runs server-side and its result is baked into the
 * first paint. On HYDRATION the client re-runs `async render()`, which re-calls
 * the action over RPC. Stale-while-revalidate (#470) hides the flicker, but the
 * redundant round-trip still happens once per async component on first load.
 *
 * This module captures each `'use server'` action result invoked DURING SSR and
 * serializes it into the page (one `<script type="application/json">` block).
 * The generated client RPC stub (`actions.js`) reads that seed on its FIRST call
 * with matching args and resolves without the RPC; a later refetch / arg-change
 * goes to the network as normal.
 *
 * ## How the capture works (no source transform, no build step)
 *
 * The framework promise is "what you write is what you see in the browser source
 * tab", not "what you write is the exact function object that runs server-side"
 * (the RPC stub already replaces the action on the client). So we install a
 * SERVER-SIDE transparent facade at module load: for a `'use server'`
 * `*.server.*` module, the load hook returns a facade that re-exports each
 * function wrapped in a `Proxy`. The Proxy records `(file, fn, args) -> result`
 * into an ambient `AsyncLocalStorage` collector WHENEVER a collector is active,
 * and is a pure passthrough otherwise.
 *
 * The facade SOURCE and the wrapping (`__actionWrap`, `buildSeedFacade`) are
 * runtime-neutral; only the INSTALL mechanism differs by runtime (`#529`), chosen
 * by `serverRuntime()`: Node uses the synchronous `module.registerHooks` load
 * hook (Node 24+, main-thread); Bun uses a `Bun.plugin` `onLoad` (Bun has no
 * `module.registerHooks`). Both feed the same `AsyncLocalStorage` collector and
 * emit the same seed wire, so a page seeds identically on either runtime.
 *
 * Recording is gated entirely by the ALS collector, which is established ONLY
 * around the SSR page render (`collectSeeds`). The RPC endpoint path runs with
 * NO collector, so the Proxy is a transparent passthrough there. The browser
 * NEVER sees this module (it sees the RPC stub), and the on-disk source is
 * unchanged, so the source-fidelity promise holds.
 *
 * ## Safety
 *
 * A key HIT returns the exact SSR value (correct by construction); a key MISS
 * degrades to a normal RPC (never wrong data, only a missed optimization). The
 * whole feature is therefore fail-open: any failure in the hook, the facade, or
 * the serializer simply skips seeding and the client re-fetches as before.
 *
 * Disabled by default-off of the flag removes the hook entirely, so module
 * loading is byte-identical to before the feature.
 */

import * as nodeModule from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stringify } from '@webjsdev/core';
import { hashFile } from './actions.js';
import { isStreamable } from './action-stream.js';
import { serverRuntime } from './listener-core.js';

/** Ambient per-render seed collector. `Map<key, value>` or undefined. */
const als = new AsyncLocalStorage();

/** Whether seed COLLECTION is on (the `webjs.seed` switch). */
let _seedEnabled = false;
/** Whether the load hook is installed at all (so identity is available). */
let _hookInstalled = false;
/** Idempotency guard: `module.registerHooks` must run at most once. */
let _registered = false;

/**
 * `action function -> { file, fnName }` for every export the hook wrapped.
 *
 * A WeakMap rather than a property on the function: the wrapped value may be a
 * Proxy whose property writes pass through to the target, so stamping it would
 * mutate the app's own function object, and a frozen action would make the
 * stamp fail silently. Both the wrapper and the original are registered,
 * because which one a caller holds depends on whether seeding is on.
 *
 * @type {WeakMap<Function, { file: string, fnName: string }>}
 */
const _identity = new WeakMap();

/** Memoized `absPath -> hash` so a hot action call does not re-hash per call. */
const _hashCache = new Map();

/** This module's own URL, embedded into the generated facade's import. */
const SELF_URL = import.meta.url;

/**
 * Whether seeding is active (the load hook is installed). The SSR emitter
 * (`ssr.js`) checks this so a disabled app does ZERO extra work and produces
 * byte-identical output.
 * @returns {boolean}
 */
export function seedingEnabled() {
  return _seedEnabled && _hookInstalled;
}

/**
 * Whether the load hook is installed, and therefore whether action identity is
 * being registered. False only on a runtime with neither `module.registerHooks`
 * nor `Bun.plugin`, where the form-action resolver falls back to a module scan.
 * @returns {boolean}
 */
export function identityHookInstalled() {
  return _hookInstalled;
}

/**
 * The `{ file, fnName }` an action function was exported as, or null when the
 * hook never saw it (a module loaded before the hook installed, or a runtime
 * with no hook).
 * @param {unknown} fn
 * @returns {{ file: string, fnName: string } | null}
 */
export function actionIdentityOf(fn) {
  if (typeof fn !== 'function') return null;
  return _identity.get(/** @type {Function} */ (fn)) || null;
}

/**
 * Compute (and memoize) the action file's hash the SAME way the RPC stub /
 * action index do (`hashFile` over the absolute path string), so the seed key
 * the server emits matches the key the client stub looks up. A path mismatch
 * (e.g. a symlinked appDir whose realpath differs) only yields a key MISS,
 * which safely degrades to a normal RPC. Note that the FORM path does not reach
 * here: it resolves an identity only against the action index, because a hash
 * the index does not know is unresolvable at submit time (see
 * `resolveActionIdentity`).
 * @param {string} absPath
 * @returns {Promise<string>}
 */
export async function actionFileHash(absPath) {
  let h = _hashCache.get(absPath);
  if (h === undefined) {
    h = await hashFile(absPath);
    _hashCache.set(absPath, h);
  }
  return h;
}

/**
 * Record one action call's resolved result into the active collector, keyed
 * `hash/fn/stringify(args)`. The args key uses the SAME serializer the client
 * stub uses to form its lookup key, so they match for identical args. Never
 * throws into the caller's render: a serialization failure just drops the seed
 * (the client re-fetches).
 * @param {Map<string, unknown>} collector
 * @param {string} file absolute action file path
 * @param {string} fnName
 * @param {unknown[]} args
 * @param {unknown} value resolved action result
 */
async function recordSeed(collector, file, fnName, args, value) {
  // A streamed result (#489) is not a serializer-safe value: recording it would
  // make buildSeedScript's stringify throw and drop EVERY seed on the page. A
  // streamed action is never seeded; the client streams it fresh on each call.
  if (isStreamable(value)) return;
  try {
    const hash = await actionFileHash(file);
    const argsKey = await stringify(args);
    collector.set(`${hash}/${fnName}/${argsKey}`, value);
  } catch {
    // Drop the seed; the client stub falls back to a normal RPC.
  }
}

/**
 * Register one exported action function's identity, and, when seeding is on,
 * wrap it so that a resolved result is recorded into an active collector.
 *
 * Identity is registered unconditionally: it is what `<form action=${action}>`
 * resolves through (#1155), so it cannot depend on the seed switch.
 *
 * The Proxy is NOT created when seeding is off. Outside a collector it is a
 * transparent passthrough anyway, so with collection disabled it would be pure
 * indirection on every action call for the lifetime of the process. Identity
 * is registered for BOTH the original and the wrapper, so a caller resolves
 * whichever of the two it happens to hold.
 *
 * Non-functions (a `const VERSION = '1.0'` export) pass through untouched, and
 * the Proxy forwards property reads, so any metadata an app or the framework
 * attaches to the function still resolves through the wrapper.
 *
 * @param {string} file absolute action file path
 * @param {string} fnName
 * @param {unknown} orig
 * @returns {unknown}
 */
export function __actionWrap(file, fnName, orig) {
  if (typeof orig !== 'function') return orig;
  // FIRST registration wins. A barrel (`export { createTodo } from './x.server.ts'`)
  // is faceted too, and its body runs AFTER the module it re-exports from, so an
  // unconditional set would re-file the function under the BARREL. The dispatcher
  // then loads the barrel to run it and reads `validate` / `middleware` /
  // `method` / `invalidates` off a namespace that carries none of them, silently
  // running a form submission with the action's validation and auth middleware
  // skipped. The defining module always evaluates first, so first-wins names it.
  const identity = _identity.get(orig) || { file, fnName };
  _identity.set(orig, identity);
  if (!_seedEnabled) return orig;
  const wrapped = seedProxy(file, fnName, orig);
  // The wrapper is a fresh object every time, so it carries the identity the
  // TARGET already had rather than this facade's own.
  _identity.set(wrapped, identity);
  return wrapped;
}

/**
 * The seed-recording Proxy. Split out of `__actionWrap` so the identity
 * registration above reads as the unconditional half and this as the gated one.
 * @param {string} file
 * @param {string} fnName
 * @param {Function} orig
 * @returns {Function}
 */
function seedProxy(file, fnName, orig) {
  return new Proxy(orig, {
    apply(target, thisArg, args) {
      const collector = als.getStore();
      const result = Reflect.apply(target, thisArg, args);
      if (!collector) return result;
      if (result && typeof result.then === 'function') {
        // Record the RESOLVED value, and return the same value to the caller so
        // the awaiting `async render()` gets its data unchanged.
        return result.then(async (value) => {
          await recordSeed(collector, file, fnName, args, value);
          return value;
        });
      }
      // A synchronous return (rare for an action): record best-effort. The
      // record is async but fire-and-forget here; collectSeeds awaits the
      // render's own microtasks, and a sync action that the render awaits will
      // have settled the record before the render resolves.
      recordSeed(collector, file, fnName, args, result);
      return result;
    },
  });
}

/**
 * Extract the names of every named export from an action module's source, used
 * to generate the facade's `export const NAME = wrap(...)` lines. Conservative:
 * a name it misses simply is not wrapped (no seed for it, RPC fallback). A
 * `export *` re-export cannot be enumerated statically, so its presence makes
 * the caller skip faceting that module entirely (passthrough = no seeding for
 * it), never producing a broken facade.
 * @param {string} src
 * @returns {{ names: string[], hasDefault: boolean, hasStar: boolean } }
 */
export function extractExportNames(src) {
  const names = new Set();
  let m;
  const reFn = /\bexport\s+(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reFn.exec(src))) names.add(m[1]);
  const reVar = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reVar.exec(src))) names.add(m[1]);
  const reClass = /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reClass.exec(src))) names.add(m[1]);
  const reList = /\bexport\s*\{([^}]*)\}/g;
  while ((m = reList.exec(src))) {
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      // `a` or `a as b` (the EXPORTED name is what an importer binds).
      const as = seg.split(/\s+as\s+/);
      const exported = (as[1] || as[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported) && exported !== 'default') names.add(exported);
      else if (exported === 'default') names.add('__default__');
    }
  }
  const hasDefault = /\bexport\s+default\b/.test(src) || names.delete('__default__');
  // A real star re-export always has a `from`. Without that anchor the pattern
  // matches the word "export" at the end of a JSDoc line (`\s*` spans the
  // newline onto the next line's leading `*`), so prose could change how a
  // module loads.
  const hasStar = /\bexport\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\b/.test(src);
  return { names: [...names], hasDefault, hasStar };
}

/**
 * Build the facade module source for a `'use server'` action module: it imports
 * the REAL module via a `?webjs-seed-orig` query (which the hook passes through
 * unwrapped) and re-exports each function through `__actionWrap`.
 * @param {string} origUrl the real module URL, WITHOUT the seed query
 * @param {string} absPath the real module's absolute file path (the hash basis)
 * @param {{ names: string[], hasDefault: boolean }} exports
 * @returns {string}
 */
function buildFacade(origUrl, absPath, exports) {
  const sep = origUrl.includes('?') ? '&' : '?';
  const origSpec = JSON.stringify(origUrl + sep + 'webjs-seed-orig');
  const file = JSON.stringify(absPath);
  let out = `import * as __orig from ${origSpec};\n`;
  out += `import { __actionWrap as __w } from ${JSON.stringify(SELF_URL)};\n`;
  // Fail-open catch-all (#535). Re-export every named binding of the real module.
  // An explicit `export const NAME = __w(...)` below SHADOWS the matching star
  // binding (an explicit export wins over a star re-export of the same name, with
  // no SyntaxError), so an enumerated export is still wrapped and seeded. A named
  // export the `extractExportNames` regex MISSED (exotic syntax, an unusual
  // re-export form, a codegen-produced export) is NOT enumerated below, so it
  // flows through this star unwrapped: it resolves and works over a normal RPC,
  // just is not seeded, instead of being dropped and crashing the importer with
  // `undefined`. `export *` does not carry `default`, which the explicit default
  // line below still handles.
  out += `export * from ${origSpec};\n`;
  for (const n of exports.names) {
    const k = JSON.stringify(n);
    out += `export const ${n} = __w(${file}, ${k}, __orig[${k}]);\n`;
  }
  if (exports.hasDefault) {
    out += `export default __w(${file}, 'default', __orig.default);\n`;
  }
  return out;
}

/** Match `*.server.{js,ts,mjs,mts}` (optionally with a query). Also the Bun plugin filter. */
export const SERVER_FILE_RE = /\.server\.m?[jt]s(\?|$)/;
/** The `'use server'` directive in the file head. */
const USE_SERVER_RE = /^\s*(['"])use server\1\s*;?\s*$/m;

/**
 * Whether a load specifier (a Node file URL or a Bun file path, with an optional
 * query) is a faceting candidate: a `*.server.*` module that is NOT the facade's
 * own `?webjs-seed-orig` passthrough of the real module. Runtime-neutral.
 * @param {string} specifier
 * @returns {boolean}
 */
export function isSeedCandidate(specifier) {
  return SERVER_FILE_RE.test(specifier) && !specifier.includes('webjs-seed-orig');
}

/**
 * Build the wrapping facade for a candidate module's source, or null to pass it
 * through unwrapped (no `'use server'`, a non-enumerable `export *`, or no
 * exports). Runtime-neutral: the caller passes the load specifier (URL on Node,
 * path on Bun) used as the facade's `?webjs-seed-orig` import base, plus the
 * absolute file path (the hash basis) and the already-read source.
 * @param {string} origSpec the real module's load specifier (URL or path), no seed query
 * @param {string} absPath the real module's absolute file path
 * @param {string} src the module source
 * @returns {string | null} facade source, or null for passthrough
 */
export function buildSeedFacade(origSpec, absPath, src) {
  const head = src.split('\n').slice(0, 5).join('\n');
  if (!USE_SERVER_RE.test(head)) return null;
  const exports = extractExportNames(src);
  // `export *` used to bail out to a passthrough here, so a facade could never
  // drop a re-exported binding it was unable to enumerate. #538 then gave the
  // facade its own `export * from` catch-all, which covers exactly that, and
  // the bail-out was left behind. Keeping it is now actively harmful: identity
  // rides the facade (#1155), so a passthrough means `<form action=${fn}>`
  // throws "is not a server action" at SSR for a function that works perfectly
  // over RPC. A star re-export therefore facades like anything else, its
  // enumerable names wrapped and the rest carried by the catch-all.
  if (exports.names.length === 0 && !exports.hasDefault) return null;
  return buildFacade(origSpec, absPath, exports);
}

/**
 * The synchronous `module.registerHooks` load hook (Node). For a `'use server'`
 * `*.server.*` module it returns a wrapping facade; for everything else
 * (including the `?webjs-seed-orig` passthrough of the real module) it defers to
 * `nextLoad`. Fail-open: any error defers to `nextLoad`, so a load that the hook
 * cannot facade simply runs unwrapped (no seeding for it).
 * @param {string} url
 * @param {object} context
 * @param {(u: string, c: object) => any} nextLoad
 */
function seedLoadHook(url, context, nextLoad) {
  try {
    if (!isSeedCandidate(url)) return nextLoad(url, context);
    const absPath = fileURLToPath(url.split('?')[0]);
    const src = readFileSync(absPath, 'utf8');
    const source = buildSeedFacade(url, absPath, src);
    if (source == null) return nextLoad(url, context);
    return { source, format: 'module', shortCircuit: true };
  } catch {
    return nextLoad(url, context);
  }
}

/**
 * Install the `'use server'` load hook (idempotent). Called once at boot from
 * `dev.js`, BEFORE any action module is imported (a module loaded before the
 * hook would already be cached unwrapped). The install mechanism is chosen by
 * `serverRuntime()` (#529): Node's synchronous `module.registerHooks`, or a
 * `Bun.plugin` `onLoad` on Bun. A no-op on a second call. Async because the Bun
 * path dynamically imports `action-seed-bun.js` (so the `Bun.*` global is never
 * referenced on Node); the Node path resolves synchronously.
 *
 * The hook installs whatever `seed` says, because action IDENTITY (#1155) rides
 * it and is not optional. `seed` gates only whether results are COLLECTED.
 *
 * @param {{ seed?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export async function registerActionHooks(opts = {}) {
  _seedEnabled = opts.seed !== false;
  if (_registered) return;
  _registered = true;

  if (serverRuntime() === 'bun') {
    // Bun has no module.registerHooks; install the same facade via Bun.plugin.
    const { installBunSeedPlugin } = await import('./action-seed-bun.js');
    installBunSeedPlugin({ isSeedCandidate, buildSeedFacade, serverFileRe: SERVER_FILE_RE });
    _hookInstalled = true;
    return;
  }

  // A runtime that is neither Node-with-registerHooks nor Bun. Seeding stays
  // OFF (fail-open): `seedingEnabled()` is false, ssr.js emits no seed block,
  // and the client RPC stub falls back to a normal fetch. Never wrong data.
  // Identity has no such graceful degradation, so the form-action resolver
  // falls back to a module scan instead (see `resolveActionIdentity`).
  if (typeof nodeModule.registerHooks !== 'function') {
    console.warn('[webjs] the \'use server\' load hook is not installed: this runtime has neither module.registerHooks nor Bun.plugin. SSR action-result seeding (#472) is off, and form-action identity (#1155) resolves by scanning the action index instead.');
    return;
  }

  nodeModule.registerHooks({ load: seedLoadHook });
  _hookInstalled = true;
}

/**
 * Run `fn` (the page render) inside a fresh ambient seed collector and return
 * both its value and the collected seeds. Every action call made during the
 * render (however deeply nested in the SSR walker / async render chain) records
 * into this collector via the ambient ALS.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ value: T, collector: Map<string, unknown> }>}
 */
export async function collectSeeds(fn) {
  const collector = new Map();
  const value = await als.run(collector, fn);
  return { value, collector };
}

/**
 * Serialize a collector into a `<script type="application/json">` block to embed
 * in the page. Returns '' for an empty collector (so a render with no seeded
 * action is byte-identical to before). The payload is rich-serialized (same wire
 * format the RPC stub's `parse` reads) and HTML-escaped so it can never break out
 * of the script element. A `type="application/json"` script is DATA, not
 * executable JS, so it needs no CSP nonce.
 * @param {Map<string, unknown>} collector
 * @returns {Promise<string>}
 */
export async function buildSeedScript(collector) {
  if (!collector || collector.size === 0) return '';
  try {
    const obj = {};
    for (const [k, v] of collector) obj[k] = v;
    const payload = await stringify(obj);
    const safe = payload
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    return `<script type="application/json" id="__webjs-seeds">${safe}</script>`;
  } catch {
    return '';
  }
}

/** Test seam: clear the per-file hash memo (e.g. between fixtures). */
export function __clearSeedHashCache() {
  _hashCache.clear();
}
