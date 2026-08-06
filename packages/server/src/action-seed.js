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
import { redactStringsAndTemplates } from './js-scan.js';

/** Ambient per-render seed collector. `Map<key, value>` or undefined. */
const als = new AsyncLocalStorage();

/** Whether seed COLLECTION is on (the `webjs.seed` switch). */
let _seedEnabled = false;
/** Dev mode, threaded from `dev.js` at boot. Gates the determinism assertion. */
let _devMode = false;
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
 * EVERY registration is kept, defining module first, because one function can
 * legitimately be exported from more than one `'use server'` module (a barrel
 * re-exporting it). The defining module is the right answer whenever it is
 * available, since it is the one carrying the action's `validate` /
 * `middleware` / `method` / `invalidates` config exports. But it is not always
 * REACHABLE: the action index only walks the app tree, so an action defined in
 * a linked workspace package and re-exported through an in-app barrel has an
 * indexed name only under the barrel. Keeping both lets the caller prefer the
 * defining module and fall back rather than fail.
 *
 * @type {WeakMap<Function, { file: string, fnName: string }[]>}
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
  const all = actionIdentitiesOf(fn);
  return all.length ? all[0] : null;
}

/**
 * EVERY `{ file, fnName }` the function was exported as, defining module first.
 * The form-action resolver needs the whole list, because only some of them may
 * be in the action index (see the `_identity` note above).
 * @param {unknown} fn
 * @returns {{ file: string, fnName: string }[]}
 */
export function actionIdentitiesOf(fn) {
  if (typeof fn !== 'function') return [];
  return _identity.get(/** @type {Function} */ (fn)) || [];
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
    const key = `${hash}/${fnName}/${argsKey}`;
    // Dev-only determinism assertion (#1309). A duplicate key means the SAME
    // action ran twice with the SAME arguments in ONE render; the collector
    // keeps the LAST result, so a component that painted the first one hydrates
    // with the second. Compared on the FULL key, never on `hash/fn`: a
    // legitimate second call with different arguments has a different key and
    // cannot false-fire. In its OWN try/catch so a diagnostic failure can never
    // skip `collector.set` and turn observability into a dropped seed.
    if (_devMode && collector.has(key)) {
      try { await assertDeterministic(collector.get(key), value, hash, fnName); } catch { /* never affect the seed */ }
    }
    collector.set(key, value);
  } catch {
    // Drop the seed; the client stub falls back to a normal RPC.
  }
}

/** Warned-once ids, keyed `hash/fn` so the Set is bounded by the action count. */
const _nonDeterministic = new Set();

/**
 * Warn (once per action function) when one render recorded two DIFFERENT results
 * for the same key. `Object.is` settles a memoized or cached return for free;
 * the fallback compares through the SAME serializer the seed uses, so
 * "different" means different on the wire, which is the only difference that can
 * reach a client. Dev only, and only on a duplicate key.
 * @param {unknown} prev
 * @param {unknown} next
 * @param {string} hash
 * @param {string} fnName
 */
async function assertDeterministic(prev, next, hash, fnName) {
  if (Object.is(prev, next)) return;
  const id = `${hash}/${fnName}`;
  if (_nonDeterministic.has(id)) return;
  if ((await stringify(prev)) === (await stringify(next))) return;
  _nonDeterministic.add(id);
  console.warn(
    `[webjs] SSR action seeding: "${fnName}" returned two DIFFERENT results for the SAME arguments during one render. `
    + 'The seed carries the LAST result, so a component that painted the first one hydrates with the second. '
    + 'Make the action deterministic for a given argument list, or turn seeding off with "webjs": { "seed": false }.',
  );
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
  // APPEND, defining module first. A barrel is faceted too and its body runs
  // AFTER the module it re-exports from, so the first registration is the
  // defining one: the module that also carries `validate` / `middleware` /
  // `method` / `invalidates`. Overwriting re-filed the function under the
  // BARREL, and the dispatcher then read those config exports off a namespace
  // carrying none of them, running a submission with the action's validation
  // and auth middleware silently skipped. Keeping the later ones too matters
  // just as much: when the defining module is outside the walked app tree, the
  // barrel is the only name the action index knows.
  const list = _identity.get(orig) || [];
  if (!list.some((e) => e.file === file && e.fnName === fnName)) list.push({ file, fnName });
  _identity.set(orig, list);
  if (!_seedEnabled) return orig;
  const wrapped = seedProxy(file, fnName, orig);
  // The wrapper is a fresh object every time, so it shares the TARGET's list
  // rather than starting one of its own.
  _identity.set(wrapped, list);
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

/** A declarator right-hand side that is unambiguously a function. */
const RHS_FN_RE = /^(?:async\s+)?function\b|^(?:async\s*)?(?:<[^>]*>\s*)?\([^)]*\)\s*=>|^(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/;
/**
 * A declarator right-hand side that is unambiguously NOT a function: a string /
 * template / numeric literal, an object or array literal, a `new` expression, a
 * tagged template, or a keyword literal. Runs on REDACTED source, so a literal
 * body is blank but its delimiters survive, which is all this needs.
 */
const RHS_VAL_RE = /^['"`]|^[+-]?\d|^[{[]|^new\s|^(?:true|false|null|undefined)\s*[;,]?\s*$|^[A-Za-z_$][\w$]*\s*`/;

/**
 * Split a declaration statement into its declarators on TOP-LEVEL commas, so
 * `const a = 1, b = f(x, y)` yields two parts rather than three. Depth-tracking
 * is enough because the input is redacted (no string / template / regex body can
 * carry an unbalanced bracket).
 * @param {string} stmt
 * @returns {string[]}
 */
function splitDeclarators(stmt) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(stmt.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(stmt.slice(start));
  return parts;
}

/**
 * Extract the names of every named export from an action module's source, split
 * into the ones that must be emitted as HOISTED function declarations and the
 * ones that must stay plain value bindings. Conservative: a name it misses
 * simply is not wrapped (no seed for it, RPC fallback). A `export *` re-export
 * cannot be enumerated statically and is not reported here: the facade
 * re-exports it wholesale through its own `export * from` catch-all (#538), so
 * nothing about it needs a decision.
 *
 * ## Why the split matters, and which way to guess
 *
 * The two buckets get structurally different facade code, and each is wrong for
 * the other's members in a DIFFERENT way, so the fallback direction is a real
 * decision rather than a detail:
 *
 *  - `fnNames` emits a hoisted `export function n(...)`. Hoisting is what makes
 *    a circular re-export between two `'use server'` modules load (#1208), but
 *    a VALUE emitted this way is silently handed to importers as a callable.
 *  - `valNames` emits `export const n = __w(...)`. Correct for any value, but a
 *    `const` is in TDZ until the facade body runs, so a FUNCTION emitted this
 *    way re-breaks the #1208 cycle.
 *
 * The two export FORMS are therefore defaulted in opposite directions, because
 * each starts from a different prior:
 *
 *  - An `export { ... }` LIST is the cycle-critical form: its local may not be
 *    declared in this file at all (`export { helper } from './c2.server.js'` is
 *    the #1208 fixture). So a listed name is demoted to a value only on POSITIVE
 *    evidence (a literal / object / array / `new` / tagged-template right-hand
 *    side, or a `class`), and anything undecidable stays a function.
 *  - A direct `export const` always HAS its initializer right here, and is much
 *    more often a genuine value, so it defaults to `valNames` and is promoted to
 *    `fnNames` only on positive function evidence.
 *
 * Both residues are wrong in the value-as-function direction and both PREDATE
 * this split, so it is a strict improvement rather than a new trade, but neither
 * is eliminated. A list-exported name whose right-hand side is computed rather
 * than literal (`const limit = Number(env.L)`, `const x = cond ? a : b`,
 * `const x = someCall()`, or a value whose TS annotation contains a generic
 * comma, which splits the declarator) is still emitted as a function. And a
 * direct `export const` whose right-hand side is a call (`export const post =
 * withAuth(...)`) is still emitted as a `const`, so it keeps the TDZ exposure in
 * a circular import that every direct value export has always had.
 *
 * Scanning runs over a REDACTED copy (string / template / regex / comment bodies
 * blanked by the shared `js-scan` lexer), so a `const` written in a doc comment
 * or quoted in a string cannot register as a real declaration.
 *
 * @param {string} src
 * @returns {{ fnNames: string[], valNames: string[], names: string[], hasDefault: boolean }}
 */
export function extractExportNames(src) {
  const fnNames = new Set();
  const valNames = new Set();
  // Blank every literal body (`blankStrings`), so only code position is read.
  const code = redactStringsAndTemplates(src, true);

  // Locally declared functions: declarations, and declarators whose right-hand
  // side is unambiguously a function.
  const localFns = new Set();
  // Locally declared non-functions, on POSITIVE evidence only (see above).
  const localVals = new Set();
  let m;

  const reLocalFn = /\b(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reLocalFn.exec(code))) localFns.add(m[1]);

  const reLocalClass = /\b(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reLocalClass.exec(code))) localVals.add(m[1]);

  const reDeclStmt = /\b(?:const|let|var)\s+([^;\n]+)/g;
  while ((m = reDeclStmt.exec(code))) {
    for (const part of splitDeclarators(m[1])) {
      // `name = rhs`, tolerating a TS type annotation. A destructuring head or a
      // bare `let x;` does not match and is left undecided on purpose.
      const d = /^\s*([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*([\s\S]*)$/.exec(part);
      if (!d) continue;
      const [, name, rhs] = d;
      const body = rhs.trim();
      if (RHS_FN_RE.test(body)) localFns.add(name);
      else if (RHS_VAL_RE.test(body)) localVals.add(name);
      // Otherwise undecided: left out of both, so a list export of it falls
      // through to `fnNames` (hoisted, cycle-safe).
    }
  }

  // Direct function exports.
  const reFn = /\bexport\s+(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reFn.exec(code))) fnNames.add(m[1]);

  const reFnVar = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[\w$]+\s*=>)/g;
  while ((m = reFnVar.exec(code))) fnNames.add(m[1]);

  // Direct class exports.
  const reClass = /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reClass.exec(code))) valNames.add(m[1]);

  // Direct variable exports that are not function assignments. `reFnVar` above
  // only sees a bare `function` / arrow right-hand side, so consult `localFns`
  // too: it ran the declarator through `RHS_FN_RE`, which tolerates a TS type
  // annotation, and so recognises the very common
  // `export const create: Handler = async (i) => ...`. This only ever PROMOTES
  // a name to the hoisted bucket on positive function evidence; the default for
  // a direct `export const` stays the value binding.
  const reVar = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reVar.exec(code))) {
    const n = m[1];
    if (fnNames.has(n)) continue;
    if (localFns.has(n)) fnNames.add(n);
    else valNames.add(n);
  }

  // Export list: `export { a, b as bee }`.
  const reList = /\bexport\s*\{([^}]*)\}/g;
  while ((m = reList.exec(code))) {
    // `export { default as X } from './other.js'` re-exports ANOTHER module's
    // default under a named binding. It gives this module no default export, so
    // it must not set `hasDefault` (that would fabricate `export default
    // undefined` on a module that has none). `X` itself needs no entry here: it
    // is a named export of the re-export target, which the facade's own
    // `export * from` catch-all already carries.
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const as = seg.split(/\s+as\s+/);
      const local = as[0].trim();
      const exported = (as[1] || as[0]).trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(exported)) continue;
      if (local === 'default') continue;

      if (exported === 'default') fnNames.add('__default__');
      else if (localVals.has(local) && !localFns.has(local)) valNames.add(exported);
      else fnNames.add(exported);
    }
  }

  // A name reaching both buckets (e.g. `export const x = () => {}` also seen as
  // a plain variable export) is a function: the hoisted form is the safe one.
  for (const fn of fnNames) valNames.delete(fn);

  const hasDefault = /\bexport\s+default\b/.test(code) || fnNames.delete('__default__') || valNames.delete('__default__');
  return { fnNames: [...fnNames], valNames: [...valNames], names: [...fnNames, ...valNames], hasDefault };
}

/**
 * Pick a prefix for the facade's per-function memo variables that cannot collide
 * with anything else the facade declares.
 *
 * The memo for export `n` is declared at module scope as `<prefix>n`, so a module
 * exporting both `ping` and `_fn_ping` would emit `var _fn_ping` alongside
 * `export function _fn_ping`, a duplicate declaration. That is a SyntaxError in
 * generated source, which the load hook's try/catch cannot contain (the parse
 * happens after the hook returns), so it would crash the module load outright
 * instead of degrading to no seeding. Pathological naming, but the feature's
 * contract is that any failure is fail-open, and a hard crash is not.
 *
 * @param {{ fnNames: string[], valNames: string[] }} exports
 * @returns {string}
 */
function memoPrefix(exports) {
  const taken = new Set([...exports.fnNames, ...exports.valNames, '__orig', '__w']);
  let prefix = '_fn_';
  while (exports.fnNames.some((n) => taken.has(prefix + n))) prefix = `_${prefix}`;
  return prefix;
}

/**
 * Build the facade module source for a `'use server'` action module: it imports
 * the REAL module via a `?webjs-seed-orig` query (which the hook passes through
 * unwrapped) and re-exports each function through `__actionWrap`.
 * @param {string} origUrl the real module URL, WITHOUT the seed query
 * @param {string} absPath the real module's absolute file path (the hash basis)
 * @param {{ fnNames: string[], valNames: string[], names: string[], hasDefault: boolean }} exports
 * @returns {string}
 */
function buildFacade(origUrl, absPath, exports) {
  const sep = origUrl.includes('?') ? '&' : '?';
  const origSpec = JSON.stringify(origUrl + sep + 'webjs-seed-orig');
  const file = JSON.stringify(absPath);
  const memo = memoPrefix(exports);
  let out = `import * as __orig from ${origSpec};\n`;
  out += `import { __actionWrap as __w } from ${JSON.stringify(SELF_URL)};\n`;
  out += `export * from ${origSpec};\n`;
  for (const n of exports.fnNames) {
    const k = JSON.stringify(n);
    const v = `${memo}${n}`;
    // `var`, NOT `let`. The exported function is hoisted, which is the whole
    // reason a circular re-export between two `'use server'` modules loads
    // (#1208): the other module in the cycle can call it before this facade's
    // body has run. A `let` memo would be in TDZ at that moment, so the call
    // would throw `Cannot access '...' before initialization`, re-breaking the
    // very cycle the hoisting exists to survive. `var` hoists initialized to
    // undefined, so the first call falls through to the lookup as intended.
    out += `var ${v};\n`;
    out += `export function ${n}(...args) {\n`;
    out += `  const fn = ${v} || (${v} = __w(${file}, ${k}, __orig[${k}]));\n`;
    out += `  return typeof fn === 'function' ? fn.apply(this, args) : fn;\n`;
    out += `}\n`;
    out += `__w(${file}, ${k}, ${n});\n`;
  }
  for (const n of exports.valNames) {
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
 * @param {{ seed?: boolean, dev?: boolean }} [opts] `dev` gates the determinism
 *   assertion in `recordSeed` (a console warning has no place in production).
 * @returns {Promise<void>}
 */
export async function registerActionHooks(opts = {}) {
  _seedEnabled = opts.seed !== false;
  _devMode = opts.dev === true;
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
 * @param {Map<string, unknown> | null} collector
 * @param {{ dev?: boolean, reason?: string }} [opts] in DEV, stamp a
 *   `data-webjs-dev` marker and emit the block even when the collector is EMPTY.
 *   The marker is the only dev signal the browser gets (#1309): a
 *   `process.env.NODE_ENV` gate is a compile-time constant in the built core
 *   bundle, so the client cannot decide this for itself. Emitting an empty block
 *   in dev is what lets a page that seeded NOTHING still be reported on.
 * @returns {Promise<string>}
 */
export async function buildSeedScript(collector, opts = {}) {
  const dev = opts.dev === true;
  if ((!collector || collector.size === 0) && !dev) return '';
  try {
    const obj = {};
    if (collector) for (const [k, v] of collector) obj[k] = v;
    const payload = await stringify(obj);
    const safe = payload
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    // Attribute-safe by construction: `reason` is a framework literal ('ok' /
    // 'streamed'), never app input, and is emitted only in dev.
    const marker = dev ? ` data-webjs-dev="${opts.reason || 'ok'}"` : '';
    return `<script type="application/json" id="__webjs-seeds"${marker}>${safe}</script>`;
  } catch {
    return '';
  }
}

/** Test seam: clear the per-file hash memo (e.g. between fixtures). */
export function __clearSeedHashCache() {
  _hashCache.clear();
}
