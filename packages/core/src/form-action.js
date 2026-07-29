import { isBindingPrefix } from './binding-prefixes.js';

/**
 * Form-action attribute guard (#1154).
 *
 * Both SSR state machines and the client renderer import from here so the
 * rule cannot drift between them. Each renderer commits attribute, boolean and
 * property holes on separate branches, so the rule has more call sites than it
 * looks like from any one file, and they are easy to change one at a time.
 * That is why the predicate lives here rather than at each site.
 *
 * Two entry points, and the difference between them is the point:
 * `assertNotFunctionActionAttr` is name-based, because an ATTRIBUTE is
 * stringified into the markup on whatever tag it appears.
 * `assertNotFunctionReflectedActionProp` is name-and-tag-based, because a
 * PROPERTY only reaches the markup where the DOM reflects it. Using the first
 * on the property path refused `<div .action=${fn}>`, which never leaked.
 *
 * The second SSR machine (`streamTemplate`) is reached only through
 * `renderToStream(v, { ssr: false })`, which no page render uses: the server
 * renders every page, Suspense included, via `renderToString`. Guarding it is
 * about the public API surface rather than a live page leak, so do not infer
 * from a bug there that pages were affected.
 */

/**
 * Refuse to stringify a function interpolated into a form-action attribute.
 *
 * At SSR a `'use server'` import is the REAL server function (the RPC stub
 * only exists in the browser), and a plain attribute hole commits via
 * `String(val)`, so without this guard the action's SOURCE, secrets included,
 * is serialized into the served HTML. The client renderer guards the same
 * commit so a client re-render cannot write the source into the live DOM
 * through a template binding. It does NOT cover property REFLECTION: a prop
 * declared `reflect: true` writes `String(value)` to its attribute from the
 * setter, which is not a commit site and is not reachable from here.
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
  if (!carriesFunction(val)) return;
  if (!isFormActionAttr(attrName)) return;
  throw new Error(formActionError(attrName, tag));
}

/**
 * Refuse a function in a `.prop` binding, but ONLY where that property is a
 * reflected IDL attribute and therefore really does write the source out.
 *
 * The attribute form leaks on any tag, because an attribute is stringified
 * into the HTML wherever it appears. A PROPERTY is different: it leaks only
 * when the DOM reflects it back to an attribute, and that is per element.
 * `action` reflects on `<form>`; `formAction` reflects on `<button>` and
 * `<input>`. Anywhere else (`<div .action=${fn}>`, `<li .action=${fn}>`, and
 * `.action` on a `<button>`) the property is a plain expando: nothing is
 * stringified and nothing reaches the markup.
 *
 * Gating on "is not a custom element" instead refused all of those, which is a
 * false positive on a binding WebJs supports and that never leaked. A guard
 * that turns a working delegated-command pattern (`<button .action=${() =>
 * save(row)}>`) into a render error is not a narrower claim, it is a wrong one.
 *
 * A custom element is excluded for the same reason rather than a different
 * one: it has no IDL reflection, so its `.action` is an author-defined
 * property and a function is a legitimate value. Note the separate path that
 * DOES write the source there, a prop declared `reflect: true`, which runs in
 * the setter and never reaches any commit site.
 *
 * @param {unknown} val the hole's resolved value
 * @param {string} propName the property being assigned (any case)
 * @param {string} [tag] lowercased owner tag
 */
export function assertNotFunctionReflectedActionProp(val, propName, tag) {
  if (!reflectsAsFormAction(propName, tag)) return;
  assertNotFunctionActionAttr(val, propName, tag);
}

/**
 * Is `propName` an IDL attribute that `tag` reflects to a content attribute?
 * @param {string} propName
 * @param {string} [tag]
 * @returns {boolean}
 */
function reflectsAsFormAction(propName, tag) {
  let name = String(propName).toLowerCase();
  if (isBindingPrefix(name[0])) name = name.slice(1);
  const owner = String(tag || '').toLowerCase();
  if (name === 'action') return owner === 'form';
  if (name === 'formaction') return owner === 'button' || owner === 'input';
  return false;
}

/**
 * Does stringifying this value expose a function's source?
 *
 * The commit sites do `String(val)`, and `Array.prototype.toString` stringifies
 * each element through `String()` too, so `action=${[serverAction]}` leaks
 * exactly as `action=${serverAction}` does. Recursive because nested arrays
 * join the same way.
 *
 * Tracks visited arrays because `Array.prototype.join` has a cycle guard and
 * this has to match it. A self-referential array stringifies to `''` rather
 * than recursing forever, so a naive walk would turn a render that used to
 * succeed into a stack overflow. Refusing to leak must not become a new way
 * to crash.
 *
 * Deliberately NOT a check on the stringified result: sniffing the output for
 * something function-shaped would misfire on a legitimate URL, and the value's
 * shape is the thing actually being claimed. An object with a hand-written
 * `toString` that returns a function's source is out of scope; that is
 * deliberate exfiltration, not the accident this guards.
 *
 * @param {unknown} val
 * @param {Set<unknown>} [seen]
 * @returns {boolean}
 */
function carriesFunction(val, seen) {
  if (typeof val === 'function') return true;
  if (!Array.isArray(val)) return false;
  const visited = seen || new Set();
  if (visited.has(val)) return false;
  visited.add(val);
  return val.some((v) => carriesFunction(v, visited));
}

/**
 * Is this the name of a form-action attribute?
 *
 * Strips a leading binding sigil before comparing. The SSR state machines
 * accumulate the AUTHORED name, and only the unquoted `after-eq` branch splits
 * the prefix off, so a quoted hole arrives here as `.action` / `?action` /
 * `@action` with the sigil still attached. Comparing the raw name let every one
 * of those through, which is the same leak wearing a different hat: the
 * renderer treats a quoted binding hole as a plain attribute and stringifies it.
 *
 * @param {string} attrName
 * @returns {boolean}
 */
function isFormActionAttr(attrName) {
  let name = String(attrName).toLowerCase();
  if (isBindingPrefix(name[0])) name = name.slice(1);
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
