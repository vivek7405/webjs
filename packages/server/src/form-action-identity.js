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

import { actionIdentityOf, identityHookInstalled } from './action-seed.js';
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
  const known = actionIdentityOf(fn);
  if (known) {
    // Only a hash the INDEX knows. Minting one from the path (which
    // `actionFileHash` will happily do for any string) produces an identity the
    // dispatcher cannot resolve, and an unresolvable hash reads as a deploy
    // skew: every submission would answer 422 "please submit again", forever,
    // with nothing logged. An action outside the indexed app tree (a linked
    // workspace package, a path whose realpath differs from the walked one) is
    // better refused loudly at render, which is what returning null does.
    const hash = idx.fileToHash.get(known.file);
    if (hash) return `${hash}/${known.fnName}`;
    return null;
  }
  return await scanForIdentity(idx, fn);
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
