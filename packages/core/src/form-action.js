import { isBindingPrefix } from './binding-prefixes.js';

/**
 * Form-action attribute guard (#1154).
 *
 * Both SSR state machines and the client renderer import from here so the
 * rule cannot drift between them. It already drifted once: the guard was
 * added to the buffered `renderTemplate` alone, leaving `streamTemplate`
 * stringifying the function. That second machine is reached only through
 * `renderToStream(v, { ssr: false })`, which no page render uses (the server
 * renders every page, Suspense included, via `renderToString`), so it was a
 * public-API hole rather than a live page leak. Worth closing on its own
 * terms, and worth noting as the reason the rule lives in one place.
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
  if (!carriesFunction(val)) return;
  if (!isFormActionAttr(attrName)) return;
  throw new Error(formActionError(attrName, tag));
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
