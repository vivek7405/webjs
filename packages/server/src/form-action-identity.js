/**
 * Resolving a bound `<form action=${action}>` back to `<hash>/<fn>` (#1155).
 *
 * The renderer holds a function and needs the identity the browser will submit.
 * On the client that is trivial (the RPC stub stamps its own identity on
 * itself), but at SSR the value is the REAL server function, so something has
 * to have watched it load. The `'use server'` load hook did, which is why it
 * installs unconditionally rather than only when seeding is on.
 *
 * The naming is the RPC endpoint's, deliberately: the same `hashFile(file)`
 * over the absolute path, the same `<hash>/<fnName>` shape. One identity
 * scheme means the form dispatcher and the RPC endpoint resolve the same
 * string to the same function, so the two transports can never disagree about
 * what an action IS.
 */

import { actionIdentitiesOf, identityHookInstalled } from './action-seed.js';
import { pathToFileURL } from 'node:url';

/**
 * Resolved identities for functions the hook never registered. Only ever
 * populated by the scan fallback below, so on a supported runtime it stays
 * empty.
 * @type {WeakMap<Function, string>}
 */
const _scanned = new WeakMap();

/** Emit the scan-fallback warning once per process rather than per render. */
let _warnedScan = false;

/**
 * The `<hash>/<fn>` identity of an action function, or null.
 *
 * @param {import('./actions.js').ActionIndex} idx
 * @param {Function} fn
 * @returns {Promise<string | null>}
 */
export async function resolveActionIdentity(idx, fn) {
  const known = actionIdentitiesOf(fn);
  if (known.length) {
    // The FIRST registration the index knows. Order is defining-module-first,
    // so a function re-exported through a barrel resolves to the module that
    // also carries its `validate` / `middleware` / `method` / `invalidates`
    // config exports; the barrel is used only when the defining module is not
    // in the index at all (an action from a linked workspace package, which
    // the app-tree walk never reaches).
    for (const entry of known) {
      const hash = idx.fileToHash.get(entry.file);
      if (!hash) continue;
      // Falling back past the defining module has a COST worth saying out loud:
      // the dispatcher loads whatever module the identity names and reads
      // `validate` / `middleware` / `method` / `invalidates` off THAT namespace,
      // and a `export { fn } from '...'` re-export carries only `fn`. So a form
      // bound this way runs with the action's validation and middleware
      // skipped. It is not a form-only hazard (the RPC endpoint resolves the
      // same barrel hash the same way, so both transports agree), which is why
      // this warns rather than refuses: refusing would break a page that works.
      if (entry !== known[0]) warnConfigExportsBypassed(known[0], entry);
      return `${hash}/${entry.fnName}`;
    }
    // Registered, but under no name the index knows. Minting a hash from the
    // path (which `actionFileHash` will happily do for any string) would
    // produce an identity the dispatcher cannot resolve, and an unresolvable
    // hash reads as a deploy skew: every submission would answer 422 "please
    // submit again", forever, with nothing logged. Refusing at render is the
    // better failure, but the renderer's message can only say "not a server
    // action", which is wrong here and would send the author looking in the
    // wrong place. So name the real cause once, on the server.
    warnUnindexedAction(known[0]);
    return null;
  }
  return await scanForIdentity(idx, fn);
}

/** Files already warned about, so a re-render does not repeat the line. */
const _warnedUnindexed = new Set();

/**
 * No name the action index knows.
 *
 * The message names the SYMPTOM and lists the causes rather than asserting one.
 * Two produce this, and they need opposite fixes: the module genuinely lives
 * outside the app tree, or it lives inside but under a different path than the
 * one that was walked (an `appDir` reached through a symlink, since the index
 * stores the walked path while the ESM loader realpaths the module). Asserting
 * the first would confidently misdiagnose the second, whose author would then
 * go looking for a package that does not exist.
 *
 * The remedy has to say NAMED, too: `export * from` cannot be enumerated, so
 * the facade never wraps it and nothing registers, which leaves the page
 * failing in exactly the same way it already was.
 *
 * @param {{ file: string, fnName: string }} entry
 */
function warnUnindexedAction(entry) {
  if (_warnedUnindexed.has(entry.file)) return;
  _warnedUnindexed.add(entry.file);
  console.warn(
    `[webjs] cannot bind ${entry.fnName} to a <form>: it is a 'use server' export, but the `
    + `action index has no entry for ${entry.file}, so the identity the browser submits `
    + 'could never be resolved back. Either the module is outside the app directory, or '
    + 'the app directory was reached through a symlink so the walked path and the loaded '
    + `path differ. Fix the path, or add a NAMED re-export ("export { ${entry.fnName} } `
    + `from ...") in a 'use server' module inside the app; a star re-export cannot be `
    + 'enumerated and will not register it.',
  );
}

/** Defining modules already warned about for a bypassed-config fallback. */
const _warnedBypass = new Set();

/**
 * @param {{ file: string, fnName: string }} defining
 * @param {{ file: string, fnName: string }} used
 */
function warnConfigExportsBypassed(defining, used) {
  if (_warnedBypass.has(defining.file)) return;
  _warnedBypass.add(defining.file);
  console.warn(
    `[webjs] ${defining.fnName} is bound to a <form>, but ${defining.file} is not in the `
    + `action index, so the submission is dispatched through ${used.file} instead. Any `
    + "`validate` / `middleware` / `method` / `invalidates` the action declares beside it "
    + 'does NOT run, because a re-export carries only the function. (The RPC endpoint '
    + 'resolves the same way, so this is not specific to forms.) Move the action inside '
    + 'the app, or re-export its config exports alongside it.',
  );
}

/**
 * Cold-path fallback: find the function by loading the indexed action modules
 * and comparing exports.
 *
 * Reached in exactly one situation: a runtime with neither
 * `module.registerHooks` nor `Bun.plugin`, which never installs the hook at all.
 * A module imported BEFORE the hook installed is also unwrapped, but the gate
 * below rules it out, and the server installs the hook at boot ahead of any app
 * module, so that shape only exists in a unit test that imports one by hand.
 *
 * It is gated on the hook being ABSENT rather than merely on a registry miss.
 * The scan imports every `'use server'` module in the app, which is exactly the
 * eager loading (DB driver init, connection pools) that `buildActionIndex`
 * avoids by only hashing paths. Paying that during a render because one lookup
 * missed would turn a fast miss into a slow one on every page; with the hook
 * installed, a miss means the function genuinely is not an action, and the
 * renderer should say so immediately.
 *
 * @param {import('./actions.js').ActionIndex} idx
 * @param {Function} fn
 * @returns {Promise<string | null>}
 */
export async function scanForIdentity(idx, fn) {
  if (identityHookInstalled()) return null;
  const cached = _scanned.get(fn);
  if (cached) return cached;
  if (!_warnedScan) {
    _warnedScan = true;
    console.warn(
      '[webjs] resolving a bound form action by scanning the action index, because '
      + "the 'use server' load hook is not installed on this runtime. Every action "
      + 'module is imported to do it. Node 24+ and Bun both install the hook.',
    );
  }
  for (const [hash, file] of idx.hashToFile) {
    let mod;
    try {
      // Deliberately NOT cache-busted, unlike every other dev-time import here.
      // The match is function-object identity against the instance the page
      // already holds, and a busted specifier is a fresh module whose exports
      // are new objects, so `value === fn` could never be true. In dev that
      // made this fallback import every action module and always return null.
      mod = await import(pathToFileURL(file).toString());
    } catch {
      continue;
    }
    for (const [name, value] of Object.entries(mod)) {
      if (value !== fn) continue;
      const id = `${hash}/${name}`;
      _scanned.set(fn, id);
      return id;
    }
  }
  return null;
}

/**
 * Resolve an identity string back to the function it names, for the form
 * dispatcher.
 *
 * Returns a `reason` rather than a bare null on failure, because the failures
 * need different responses. An unknown HASH is a deploy skew (a form rendered
 * by an older build, submitted against a newer one), which re-renders the page
 * with a resubmit message.
 *
 * An unknown FUNCTION inside a known file is NOT decided here: this resolves
 * the file and hands back its module namespace, and the caller decides whether
 * the named export is a callable action (it also has to reject a reserved
 * config export, which only it knows about). That is why there is no
 * `unknown-fn` reason.
 *
 * A module that THROWS at import is a third case, and folding it into skew was
 * a real defect. The hash resolves (the index only hashes paths, it never
 * imports), so a `.server.ts` whose module scope throws (a DB connection built
 * at load with a missing env var) would answer every submission with "please
 * submit again" forever, with the actual error discarded: no log line, no
 * `onError`, nothing. The same broken module surfaces a logged 500 through a
 * page render and through the RPC endpoint, which lets `loadModule` throw on
 * purpose, so the form path was the one place it went silent. The error is
 * carried out instead and the caller turns it into a sanitized, digest-logged
 * 500 like any other action throw.
 *
 * @param {import('./actions.js').ActionIndex} idx
 * @param {string} id the submitted `<hash>/<fn>` value
 * @returns {Promise<{ ok: true, file: string, fnName: string, module: Record<string, unknown> }
 *   | { ok: false, reason: 'malformed' | 'skew' }
 *   | { ok: false, reason: 'load-failed', error: unknown }>}
 */
export async function lookupActionIdentity(idx, id) {
  const raw = typeof id === 'string' ? id : '';
  const slash = raw.indexOf('/');
  if (slash <= 0 || slash === raw.length - 1) return { ok: false, reason: 'malformed' };
  const hash = raw.slice(0, slash);
  const fnName = raw.slice(slash + 1);
  const file = idx.hashToFile.get(hash);
  if (!file) return { ok: false, reason: 'skew' };
  let module;
  try {
    module = await import(pathToFileURL(file).toString() + (idx.dev ? `?t=${Date.now()}-${Math.random().toString(36).slice(2)}` : ''));
  } catch (error) {
    return { ok: false, reason: 'load-failed', error };
  }
  return { ok: true, file, fnName, module };
}
