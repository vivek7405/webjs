/**
 * Form-action attribute guard (#1154).
 *
 * Both SSR state machines and the client renderer import from here so the
 * rule cannot drift between them. It already drifted once: the guard was
 * added to the buffered renderer alone, leaving the Suspense-streaming path
 * emitting a server action's whole body into the response.
 */

/**
 * Refuse to stringify a function interpolated into a form-action attribute.
 *
 * At SSR a `'use server'` import is the REAL server function (the RPC stub
 * only exists in the browser), and a plain attribute hole commits via
 * `String(val)`, so without this guard the action's SOURCE, secrets included,
 * is serialized into the served HTML. The client renderer guards the same
 * commit so a client re-render cannot write the source into the live DOM
 * either.
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
  if (!isFormActionAttr(attrName)) return;
  throw new Error(formActionError(attrName, tag));
}

/** @param {string} attrName @returns {boolean} */
function isFormActionAttr(attrName) {
  const name = String(attrName).toLowerCase();
  return name === 'action' || name === 'formaction';
}

/**
 * The refusal message. Deliberately never echoes the function's source, which
 * is the very thing being withheld.
 * @param {string} attrName
 * @param {string} [tag]
 */
function formActionError(attrName, tag) {
  return `[webjs] a function was interpolated into ${String(attrName).toLowerCase()}= `
    + `on <${tag || 'form'}>. Stringifying a function into HTML would leak its `
    + `source (a 'use server' action's body included) to every visitor, so this `
    + `is refused. Pass a URL string instead.`;
}
