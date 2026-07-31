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

import { actionIdentityOf, identityHookInstalled, actionFileHash } from './action-seed.js';
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
    const hash = idx.fileToHash.get(known.file) || await actionFileHash(known.file);
    return `${hash}/${known.fnName}`;
  }
  return await scanForIdentity(idx, fn);
}

/**
 * Cold-path fallback: find the function by loading the indexed action modules
 * and comparing exports.
 *
 * Reached in two situations, and neither is the normal one. A runtime with
 * neither `module.registerHooks` nor `Bun.plugin` never installs the hook at
 * all; and a module imported BEFORE the hook installed is already cached
 * unwrapped, which is mostly a unit-test shape since the server installs the
 * hook at boot ahead of any app module.
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
async function scanForIdentity(idx, fn) {
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
      mod = await import(pathToFileURL(file).toString() + (idx.dev ? `?t=${Date.now()}` : ''));
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
 * Returns a `reason` rather than a bare null on failure, because the two
 * failures need different responses. An unknown HASH is a deploy skew (a form
 * rendered by an older build, submitted against a newer one), which re-renders
 * the page with a resubmit message. An unknown FUNCTION inside a known file is
 * a real 404: that file exists and simply has no such export.
 *
 * @param {import('./actions.js').ActionIndex} idx
 * @param {string} id the submitted `<hash>/<fn>` value
 * @returns {Promise<{ ok: true, file: string, fnName: string, module: Record<string, unknown> }
 *   | { ok: false, reason: 'malformed' | 'skew' | 'unknown-fn' }>}
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
  } catch {
    return { ok: false, reason: 'skew' };
  }
  return { ok: true, file, fnName, module };
}
