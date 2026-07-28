/**
 * Form-action binding shared bits (#1154, #1155).
 *
 * Both renderers (server + client) import from here so the guard cannot
 * drift between SSR and hydration.
 */

/**
 * The hidden field that carries a form-bound action's identity
 * (`<hash>/<fn>`) from the SSR'd markup to the server dispatcher (#1155).
 * Reserved name; user form fields must not use it.
 */
export const ACTION_FIELD = '__webjs_action';

/**
 * Refuse to stringify a function interpolated into a form-action attribute
 * (#1154). At SSR a `'use server'` import is the REAL server function (the
 * RPC stub only exists in the browser), and a plain attribute hole commits
 * via `String(val)`, so without this guard the action's SOURCE, secrets
 * included, is serialized into the served HTML. The client renderer guards
 * the same commit so a client re-render cannot write the source into the
 * live DOM either.
 *
 * Name-based on purpose (`action`, plus `formaction`, the submit-button
 * override, which leaks identically): a function stringified under these
 * names is never useful on any tag, and other attributes keep today's
 * stringify behaviour so the claim stays narrow.
 *
 * @param {unknown} val the hole's resolved value
 * @param {string} attrName the attribute being committed (any case)
 * @param {string} [tag] lowercased owner tag, for the error message
 */
export function assertNotFunctionActionAttr(val, attrName, tag) {
  if (typeof val !== 'function') return;
  const name = String(attrName).toLowerCase();
  if (name !== 'action' && name !== 'formaction') return;
  throw new Error(
    `[webjs] a function was interpolated into ${name}= on <${tag || 'form'}>. `
    + `Stringifying a function into HTML would leak its source (a 'use server' `
    + `action's body included) to every visitor, so this is refused. `
    + `Bind a 'use server' action exported from a *.server.{js,ts} module, `
    + `or pass a URL string.`
  );
}
