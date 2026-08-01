/** Form actions (#1155): `<form action=${importedAction}>` and its wire. */

/** The hidden field carrying a bound action's identity into the submission. */
export const FORM_ACTION_FIELD: '__webjs_action';

/** The property a generated client RPC stub carries its own identity on. */
export const FORM_ACTION_ID_KEY: '$$webjsAction';

/**
 * Server-only wiring: maps a REAL server-action function back to its
 * `<hash>/<fn>` identity. `@webjsdev/server` installs it at boot; the browser
 * bundle drops it, because a stub carries its identity on itself.
 */
export function setFormActionResolver(
  fn: (fn: Function) => string | null | Promise<string | null>,
): void;
