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
    // in the index at all (an action from a linked workspace package, or one
    // reached under a path the app-tree walk never produced, such as through a
    // symlink).
    for (const entry of known) {
      const hash = idx.fileToHash.get(entry.file);
      if (!hash) continue;
      // Falling back past the defining module can COST something, so say so.
      // The dispatcher loads whatever module the identity names and reads
      // `validate` / `middleware` / `method` / `invalidates` off THAT namespace
      // BY NAME, which cuts both ways: config declared beside the action does
      // not travel with a `export { fn } from '...'` re-export, and config the
      // re-exporting module declares for its own exports applies to this action
      // instead. Neither direction is knowable without loading the module,
      // which is why the warning states the condition rather than the
      // consequence (see `warnConfigExportsBypassed`). It warns
      // rather than refuses because the RPC endpoint resolves the same barrel
      // hash the same way: both transports agree, and refusing would break a
      // page that works while leaving the RPC path open anyway.
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
    + 'could never be resolved back. Common causes: the module is outside the app '
    + 'directory, or the app directory was reached through a symlink so the walked path '
    + `and the loaded path differ. Fix the path, or add a NAMED re-export ("export { ${entry.fnName} } `
    + `from ...") in a 'use server' module inside the app; a star re-export cannot be `
    + 'enumerated and will not register it.',
  );
}

/** Defining modules already warned about for a bypassed-config fallback. */
const _warnedBypass = new Set();

/**
 * Warn that the dispatched module is not the defining one.
 *
 * Deliberately CONDITIONAL about the consequence. What is known here is cheap
 * and certain: the identity names a re-exporting module, so the dispatcher will
 * read config off that namespace. What that costs is not knowable without
 * loading the module, which this path refuses to do (it is a render-time
 * resolve, and eager-loading every action module is exactly the cost
 * `scanForIdentity` exists to avoid).
 *
 * Config is matched BY NAME off the dispatched namespace
 * (`actionConfigFn(mod, 'validate')`), with no association back to a particular
 * function, and that cuts BOTH ways. Three wordings have now been wrong by
 * describing only one direction:
 *
 *   - config declared beside the action does NOT travel with a plain
 *     `export { fn } from` re-export, so it stops applying
 *   - config the DISPATCHING module declares DOES apply to this action, even
 *     though it was written for one of that module's own exports
 *
 * The second is why "an action that declares no config loses nothing" was
 * false: a config-less action re-exported through a module that has a
 * `validate` for its own sibling inherits that validator, and its submissions
 * start failing with a message about a different action.
 *
 * It follows that re-exporting the config into a SHARED barrel is bad advice
 * (it attaches one action's validator to every sibling), while re-exporting it
 * into a module holding only this action is safe and is the only option when
 * the action lives in a workspace package several apps share, which is exactly
 * the case that produces this warning. The remedy has to offer both, and the
 * second needs its CONDITION stated: among indexed re-exporters the identity
 * goes to the first one LOADED (registration order, and module load is lazy per
 * route), so a stray second re-exporter can silently win over the remedy module
 * depending on which page a visitor hits first.
 *
 * The second remedy also cannot silence this line. The defining module stays
 * outside the index, so the fallback still runs and this check cannot see
 * inside the dispatched module to know the config now travels with it. Round 4
 * of this PR's review found a diagnostic that persisted in the state its own
 * remedy produced while still describing it as broken; the honest fix is the
 * message saying so itself.
 *
 * `webjs check` catches none of it: `one-action-per-configured-file` counts
 * callables from `export function` / `export const … =>`, so a re-exported
 * action is invisible to it (a pure barrel reads as zero callables).
 *
 * @param {{ file: string, fnName: string }} defining
 * @param {{ file: string, fnName: string }} used
 */
function warnConfigExportsBypassed(defining, used) {
  if (_warnedBypass.has(defining.file)) return;
  _warnedBypass.add(defining.file);
  console.warn(
    `[webjs] ${defining.fnName} is bound to a <form>, but its module ${defining.file} is `
    + `not in the action index, so the submission is dispatched through ${used.file} `
    + 'instead. Config is matched by NAME off that module, so it flows both ways: a '
    + '`validate` / `middleware` / `method` / `invalidates` declared beside the action does '
    + 'not travel with a plain `export { fn } from` re-export, and any that module declares '
    + 'of its own applies to this action. Move the action inside the app directory. Or '
    + 're-export it from a module holding only this one action, put its config there, and '
    + 'make sure NO other in-app module re-exports it: among re-exporters the first one '
    + 'loaded wins the identity, so a shared barrel can silently override the dedicated '
    + 'module. Adding config to a re-export module that carries several actions applies it '
    + 'to all of them, and `webjs check` cannot see that. This notice keeps printing after '
    + 'the dedicated-module fix, because the check cannot see inside the dispatched module; '
    + 'if that module carries the config, it is working as intended. (The RPC endpoint '
    + 'resolves the same way, so this is not specific to forms.)',
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
