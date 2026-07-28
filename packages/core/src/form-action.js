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
  if (!isFormActionAttr(attrName)) return;
  throw new Error(formActionError(attrName, tag));
}

/** @param {string} attrName @returns {boolean} */
export function isFormActionAttr(attrName) {
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
    + `on <${tag || 'form'}>, and it is not a 'use server' action. Stringifying a `
    + `function into HTML would leak its source (a server action's body included) `
    + `to every visitor, so this is refused. Bind a 'use server' action exported `
    + `from a *.server.{js,ts} module, or pass a URL string.`;
}

/**
 * Resolves a form-bound action function to its wire identity, `<hash>/<fn>`
 * (#1155). Server-only wiring, installed exactly like the CSP nonce provider:
 * `@webjsdev/server` calls `setFormActionResolver` at load time, the browser
 * bundle never does, so a client-side render keeps refusing every function.
 *
 * @type {((fn: Function) => string | null) | null}
 */
let _resolver = null;

/**
 * Internal: server-only wiring. Installed once by `@webjsdev/server`.
 * @param {(fn: Function) => string | null} fn
 */
export function setFormActionResolver(fn) {
  _resolver = fn;
}

/**
 * Resolve a form-bound action to `<hash>/<fn>`, or throw the refusal above when
 * it is not an identifiable `'use server'` action.
 *
 * Throwing on an unresolvable function is load-bearing for progressive
 * enhancement, not defensive: emitting the form WITHOUT the identity field
 * would render a form that posts to the page and dispatches nothing, a silent
 * no-op with no error anywhere. Failing the render is the only outcome that
 * cannot ship a dead form.
 *
 * @param {Function} val
 * @param {string} attrName
 * @param {string} [tag]
 * @returns {string} the `<hash>/<fn>` identity
 */
export function resolveFormActionOrThrow(val, attrName, tag) {
  const id = _resolver ? _resolver(val) : null;
  if (!id) throw new Error(formActionError(attrName, tag));
  return id;
}

/**
 * The hidden field carrying the action identity, plus the attributes the
 * framework forces rather than trusting the author to write.
 *
 * `method="post"`: a form with no method GETs, so the action would never run.
 * `enctype="multipart/form-data"`: without it a no-JS file upload silently
 * arrives as a filename string instead of the file.
 *
 * @param {string} id the `<hash>/<fn>` identity
 * @param {(name: string) => boolean} has whether the form already set an attribute
 * @returns {{ forced: string, field: string }}
 */
export function formActionMarkup(id, has) {
  let forced = '';
  if (!has('method')) forced += ' method="post"';
  if (!has('enctype')) forced += ' enctype="multipart/form-data"';
  const field = `<input type="hidden" name="${ACTION_FIELD}" value="${escapeAttrValue(id)}">`;
  return { forced, field };
}

/** Minimal attribute escape; the identity is framework-generated, so this is belt and braces. */
function escapeAttrValue(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * The single decision point both SSR state machines route through when an
 * attribute hole resolves to a function.
 *
 * There are two of them (`renderTemplate` and the Suspense-streaming
 * `streamTemplate`), and they HAVE already diverged once: the guard was added
 * to the buffered renderer alone, leaving the streamed path emitting a server
 * action's whole body into the response. Anything that must hold for both
 * belongs here rather than at either call site.
 *
 * Returns null when the value is not a function bound to an action attribute,
 * meaning the caller proceeds with its normal stringify.
 *
 * @param {unknown} val the resolved hole value
 * @param {string} attrName the attribute being committed
 * @param {string} tag lowercased owner tag
 * @param {Set<string>} seenAttrs attribute names already written on this tag
 * @returns {{ attrValue: string, forced: string, field: string } | null}
 */
export function commitFormActionAttr(val, attrName, tag, seenAttrs) {
  if (typeof val !== 'function') return null;
  if (!isFormActionAttr(attrName)) {
    // A function on any other attribute keeps the pre-existing stringify
    // behaviour: widening the claim here would change unrelated rendering.
    return null;
  }
  const id = resolveFormActionOrThrow(val, attrName, tag);
  const { forced, field } = formActionMarkup(id, (n) => seenAttrs.has(n));
  // The form posts to its OWN url; the identity rides the hidden field, which
  // is what lets one action be bound from any page (#1155) while the failure
  // re-render still targets the page the form was on.
  return { attrValue: '""', forced, field };
}
