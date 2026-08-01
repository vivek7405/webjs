import { isBindingPrefix } from './binding-prefixes.js';
import { escapeAttr } from './escape.js';

/**
 * Form actions: binding a `'use server'` action straight into a form (#1155),
 * and the guard that refuses every OTHER way a function could reach the markup
 * (#1154).
 *
 * ONE supported shape, and it is the shape a Next-trained author already
 * writes:
 *
 *   import { submitFeedback } from '#modules/feedback/actions/submit.server.ts';
 *   html`<form action=${submitFeedback}> ... </form>`
 *
 * The renderers do not stringify that function. They resolve its IDENTITY
 * (`<file-hash>/<export-name>`, the same naming the RPC endpoint uses), drop
 * the `action` attribute so the form posts to the page's own url, force the
 * attributes the submission needs (`method="post"`, `enctype`), and emit one
 * hidden field carrying the identity. The server resolves that field back to
 * the function and runs it. Nothing about the action's source reaches the
 * browser, and the form works with JS off because it is an ordinary HTML
 * submission.
 *
 * Every other function-in-an-action shape stays REFUSED, because it would
 * stringify the function's body into the served HTML. At SSR a `'use server'`
 * import is the REAL server function (the RPC stub only exists in the
 * browser), so a plain `String(val)` commit serializes the action's body,
 * secrets included, to every visitor. The refusal list is deliberately wider
 * than the leak: a quoted `action="${fn}"`, `?action=${fn}`, an array holding
 * a function, `formaction=` anywhere, and `action=` on a tag that is not a
 * `<form>` all refuse, so there is exactly one way to write this and no
 * silently-broken near-miss.
 *
 * `formaction=${fn}` on a submit button is supported when the enclosing `<form>`
 * is also bound to a server action (`<form action=${formAction}>`), and the
 * submitter does not carry its own `name` attribute. Without JS, the browser
 * submits the pressed button's `name="__webjs_action"` value in the `FormData`.
 * Server `form-dispatch.js` reads `formData.getAll("__webjs_action")` and takes
 * the last entry, giving the pressed submitter precedence over the form's default
 * action.
 *
 * Refused shapes on a submitter:
 *   - A submitter carrying its own `name` attribute (static `name="..."` or
 *     dynamic `name=${n}`), because a button cannot hold both its own name and
 *     the `__webjs_action` identity.
 *   - A `formaction=${fn}` submitter inside an unbound `<form>`, because POST
 *     method and multipart encoding must be set on the form start tag.
 *   - `<input type="image">`, because image submitters submit coordinate pairs
 *     (`name.x`/`name.y`) instead of `name=value`.
 *   - Submitter `formenctype="text/plain"` or `formmethod="get"` inside a bound form.
 *
 * Both SSR state machines and the client renderer import from here so the
 * rules cannot drift between them. Each renderer commits attribute, boolean
 * and property holes on separate branches, so they have more call sites than
 * it looks like from any one file and are easy to change one at a time. That
 * is why the predicates live here rather than at each site.
 *
 * The second SSR machine (`streamTemplate`) is reached only through
 * `renderToStream(v, { ssr: false })`, which no page render uses: the server
 * renders every page, Suspense included, via `renderToString`. It is kept in
 * lockstep for the public API surface rather than for a live page.
 */

/**
 * The hidden field carrying a bound action's identity. The server's form
 * dispatcher reads it off the submitted `FormData`; nothing else is
 * authoritative, so a form that lost this field is never dispatched by
 * guesswork.
 */
export const FORM_ACTION_FIELD = '__webjs_action';

/**
 * The property a generated client RPC stub carries its own identity on.
 * Written by the generated stub source (`packages/server/src/actions.js`), read
 * here. A plain string property rather than a symbol because the stub is
 * generated source that only imports the framework's runtime helpers.
 */
export const FORM_ACTION_ID_KEY = '$$webjsAction';

/** @type {((fn: Function) => (string | null | Promise<string | null>)) | null} */
let _resolver = null;

/**
 * Internal: server-only wiring. `@webjsdev/server` installs the resolver that
 * maps a REAL server-action function back to its `<hash>/<fn>` identity, which
 * it knows from the module load hook that registered the function. The browser
 * never calls this: a stub carries its identity on itself, so
 * `formActionId` resolves synchronously there.
 *
 * @param {(fn: Function) => (string | null | Promise<string | null>)} fn
 * @returns {void}
 */
export function setFormActionResolver(fn) {
  _resolver = fn;
}

/**
 * The identity of an action function, or null when it has none.
 *
 * Synchronous, and that is a constraint rather than a preference: the client
 * renderer commits attributes synchronously, so identity has to be readable
 * without awaiting there. A stub carries its own, so the client path is a
 * property read. On the server the resolver is consulted, and it may answer
 * with a promise, which `resolveFormActionId` awaits and this does not.
 *
 * @param {unknown} fn
 * @returns {string | null}
 */
export function formActionId(fn) {
  if (typeof fn !== 'function') return null;
  const own = /** @type any */ (fn)[FORM_ACTION_ID_KEY];
  return typeof own === 'string' && own ? own : null;
}

/**
 * The identity of an action function, consulting the server resolver when the
 * function does not carry one. Used by the SSR renderers, which are async.
 *
 * @param {unknown} fn
 * @returns {Promise<string | null>}
 */
export async function resolveFormActionId(fn) {
  const own = formActionId(fn);
  if (own) return own;
  if (typeof fn !== 'function' || !_resolver) return null;
  try {
    const id = await _resolver(/** @type {Function} */ (fn));
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * Is this hole a supported form-action binding:
 *   - unquoted `action=${fn}` on a `<form>`
 *   - unquoted `formaction=${fn}` on a `<button>` or `<input>` submitter
 *
 * @param {unknown} val the hole's resolved value
 * @param {string} attrName the AUTHORED attribute name (no sigil, unquoted branch)
 * @param {string} [tag] lowercased owner tag
 * @returns {boolean}
 */
export function isBoundFormAction(val, attrName, tag) {
  if (typeof val !== 'function') return false;
  const attr = String(attrName).toLowerCase();
  const t = String(tag || '').toLowerCase();
  if (attr === 'action') return t === 'form';
  if (attr === 'formaction') return t === 'button' || t === 'input';
  return false;
}

/**
 * Refuse a submitter carrying its own `name` attribute alongside `formaction=${fn}`.
 *
 * @param {string} name
 * @param {string} [tag]
 */
export function assertSubmitterHasNoName(name, tag) {
  if (name && name !== FORM_ACTION_FIELD) {
    throw new Error(
      `[webjs] formaction=\${action} on <${tag || 'button'}> cannot be used when `
      + `the element already carries a "name" attribute (found name="${name}"). `
      + `Move the action to the enclosing <form action=\${action}> or remove the `
      + `submitter's "name" attribute.`,
    );
  }
}

/**
 * Refuse `<input type="image">` with `formaction=${fn}`.
 *
 * @param {string} [tag]
 */
export function assertSubmitterNotImage(tag) {
  throw new Error(
    `[webjs] formaction=\${action} is not supported on <input type="image"> `
    + `because image submitters submit coordinate pairs (name.x/name.y) `
    + `instead of name=value. Use <button> or <input type="submit"> instead.`,
  );
}

/**
 * Refuse a `formaction=${fn}` submitter whose enclosing form is not bound.
 *
 * @param {boolean} insideBoundForm
 * @param {string} [tag]
 */
export function assertSubmitterFormIsBound(insideBoundForm, tag) {
  if (insideBoundForm) return;
  throw new Error(
    `[webjs] formaction=\${action} on <${tag || 'button'}> requires the enclosing `
    + `<form> to also be bound to a server action (e.g. <form action=\${formAction}>). `
    + `The enclosing <form> must carry an action binding so POST method and `
    + `multipart encoding are set at form start.`,
  );
}

/**
 * Refuse to stringify a function interpolated into a form-action attribute.
 *
 * Name-based on purpose (`action`, plus `formaction`, the submit-button
 * override, which leaks identically): a function stringified under these names
 * is never useful on any tag, and other attributes keep today's stringify
 * behaviour so the claim stays narrow. The one supported shape
 * (`isBoundFormAction`) is claimed by the caller BEFORE this runs, so
 * everything reaching here is a shape with no meaning.
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
 * `<form .action=${fn}>` is refused rather than treated as the supported
 * binding: the supported one is the plain `action=${fn}` attribute, and a
 * `.prop` binding on a native element is dropped at SSR, so accepting it would
 * mean a form that submits under JS and does nothing without it.
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
 * Refuse a bound action the renderer cannot identify.
 *
 * A function reaches here having passed `isBoundFormAction`, so the author
 * meant it as a server action. If identity resolution came back empty it is
 * not one: a local closure, a plain helper, or a `'use server'` module the
 * server never registered. Emitting the form anyway would produce markup that
 * looks right and silently posts nowhere, which is the one outcome a
 * progressive-enhancement form must never have, so this throws instead.
 *
 * @param {string | null} id
 * @param {string} [tag]
 * @returns {string} the identity, narrowed
 */
export function assertIdentifiableAction(id, tag) {
  if (id) return id;
  throw new Error(
    `[webjs] the function in ${tag === 'button' || tag === 'input' ? 'formaction=' : 'action='} `
    + `on <${tag || 'form'}> is not a server action. `
    + `Only a function imported from a 'use server' *.server.{js,ts} module can be `
    + `bound, because the identity the browser submits has to resolve `
    + `back to something the server can run. Move the handler into a server `
    + `action and import it, or pass a url string.`,
  );
}

/**
 * The enctypes a form submission can actually be parsed from.
 */
export const PARSEABLE_ENCTYPES = new Set(['multipart/form-data', 'application/x-www-form-urlencoded']);

/**
 * The shared refusal for a bound form whose own attributes contradict the binding.
 * @param {string | null | undefined} method
 * @param {string | null | undefined} enctype
 */
export function assertSubmittableForm(method, enctype) {
  if (method != null && !/^post$/i.test(method)) {
    throw new Error(
      `[webjs] <form method="${method}" action=\${action}> cannot work: a bound `
      + `server action is submitted as a POST body, and a "${method}" form sends `
      + `no body. Drop the method attribute (WebJs emits method="post") or `
      + `remove the bound action.`,
    );
  }
  if (enctype != null && !PARSEABLE_ENCTYPES.has(enctype.toLowerCase())) {
    throw new Error(
      `[webjs] <form enctype="${enctype}" action=\${action}> cannot work: a form `
      + `submission is parsed as multipart/form-data or `
      + `application/x-www-form-urlencoded, and a "${enctype}" body is neither, so `
      + `the submission would run under JS and do nothing without it. Drop the `
      + `enctype attribute (WebJs emits multipart/form-data).`,
    );
  }
}

/**
 * Rewrite a form's START TAG for a bound action and produce the hidden field
 * that must follow it.
 *
 * @param {string} startTag the emitted start tag, ending in `>`
 * @param {string} id the action identity
 * @returns {{ tag: string, hidden: string }}
 */
export function bindFormActionStartTag(startTag, id) {
  const attrs = parseStartTagAttrs(startTag);
  assertConvergentBoundForm({ staticAction: attrs.has('action') });
  const resolved = resolveBoundFormAttrs(
    attrs.has('method') ? attrs.get('method') : ABSENT,
    attrs.has('enctype') ? attrs.get('enctype') : ABSENT,
  );
  const close = startTag.endsWith('/>') ? '/>' : '>';
  const head = startTag.slice(0, startTag.length - close.length);
  let inject = '';
  if (resolved.method !== null) inject += ` method="${resolved.method}"`;
  if (resolved.enctype !== null) inject += ` enctype="${resolved.enctype}"`;
  return { tag: head + inject + close, hidden: formActionHiddenField(id) };
}

/**
 * Refuse the shapes a bound form can be written in that the two renderers can
 * never agree on.
 *
 * @param {{ staticAction?: boolean, duplicateAction?: boolean, propAttrs?: string[] }} shape
 */
export function assertConvergentBoundForm(shape) {
  if (shape.duplicateAction) {
    throw new Error(
      '[webjs] two action=${...} holes were found on one <form>. A form can carry '
      + 'only one action binding. Move one to a submit button\'s formaction=${action} '
      + 'or remove the duplicate.',
    );
  }
  if (shape.staticAction) {
    throw new Error(
      '[webjs] a bound <form action=${action}> also carries a plain action="..." '
      + 'attribute. A bound form posts to the page\'s own url, so the two say '
      + 'different things: without JS the browser would post to the written url '
      + 'and with JS it would not. Drop the action attribute, or drop the binding.',
    );
  }
  const prop = shape.propAttrs && shape.propAttrs[0];
  if (prop) {
    throw new Error(
      `[webjs] a bound <form action=\${action}> also binds .${prop}=. `
      + 'A property binding on a native element is dropped at SSR and applied in '
      + 'the browser, so the form would submit one way with JS and another way '
      + 'without it. Write it as a plain attribute.',
    );
  }
}

/**
 * The sentinel for "this attribute is not present at all".
 */
export const ABSENT = Symbol('webjs.attr.absent');

/**
 * Resolve what to inject for method/enctype.
 * @param {string | typeof ABSENT | null} method
 * @param {string | typeof ABSENT | null} enctype
 * @returns {{ method: string | null, enctype: string | null }}
 */
export function resolveBoundFormAttrs(method, enctype) {
  const hasMethod = method !== ABSENT && method != null;
  const hasEnctype = enctype !== ABSENT && enctype != null;
  assertSubmittableForm(
    hasMethod ? /** @type string */ (method) : null,
    hasEnctype ? /** @type string */ (enctype) : null,
  );
  return {
    method: hasMethod ? null : 'post',
    enctype: hasEnctype ? null : 'multipart/form-data',
  };
}

/**
 * The hidden field carrying a bound action's identity into the submission.
 * @param {string} id
 * @returns {string}
 */
export function formActionHiddenField(id) {
  return `<input type="hidden" name="${FORM_ACTION_FIELD}" value="${escapeAttr(id)}">`;
}

/**
 * Converge a live `<form>` on what SSR would have emitted for it (#1155).
 * @param {HTMLFormElement} form
 * @param {unknown} value
 * @param {string | typeof ABSENT} method
 * @param {string | typeof ABSENT} enctype
 * @param {{ duplicateAction: boolean, propAttrs: string[] }} shape
 * @returns {void}
 */
export function reconcileFormAction(form, value, method, enctype, shape) {
  const id = typeof value === 'function' ? formActionId(value) : null;

  if (!id) {
    if (typeof value === 'function') assertIdentifiableAction(null, form.localName);
    releaseFormAction(form, method, enctype, shape.propAttrs);
    return;
  }

  assertConvergentBoundForm(shape);

  const resolved = resolveBoundFormAttrs(method, enctype);
  form.removeAttribute('action');
  applyResolvedAttr(form, 'method', method, resolved.method);
  applyResolvedAttr(form, 'enctype', enctype, resolved.enctype);
  ensureIdentityField(form, id);
}

/**
 * Write (or leave) one resolved attribute.
 * @param {Element} form
 * @param {string} name
 * @param {string | typeof ABSENT} authored
 * @param {string | null} inject
 */
function applyResolvedAttr(form, name, authored, inject) {
  if (inject !== null) { form.setAttribute(name, inject); return; }
  if (authored !== ABSENT && form.getAttribute(name) !== authored) {
    form.setAttribute(name, /** @type string */ (authored));
  }
}

/**
 * Ensure the hidden identity field is present, first, and current.
 * @param {HTMLFormElement} form
 * @param {string} id
 */
function ensureIdentityField(form, id) {
  const first = form.firstElementChild;
  let field = first && first.localName === 'input'
    && first.getAttribute('name') === FORM_ACTION_FIELD
    ? /** @type {HTMLInputElement} */ (first)
    : null;
  if (!field) {
    for (const child of form.children) {
      if (child.localName === 'input' && child.getAttribute('name') === FORM_ACTION_FIELD) {
        field = /** @type {HTMLInputElement} */ (child);
        break;
      }
    }
  }
  if (!field) {
    field = document.createElement('input');
    field.type = 'hidden';
    field.name = FORM_ACTION_FIELD;
    form.insertBefore(field, form.firstChild);
  }
  field.value = id;
}

/**
 * Release a form that was candidate-bound when its value turns out NOT to be an
 * action function.
 * @param {HTMLFormElement} form
 * @param {string | typeof ABSENT} method
 * @param {string | typeof ABSENT} enctype
 * @param {string[]} [propAttrs]
 */
function releaseFormAction(form, method, enctype, propAttrs) {
  for (const child of Array.from(form.children)) {
    if (child.localName === 'input' && child.getAttribute('name') === FORM_ACTION_FIELD) {
      child.remove();
      break;
    }
  }
  const owned = (name) => (propAttrs || []).some((p) => {
    const x = String(p).toLowerCase();
    return x === name || (name === 'enctype' && x === 'encoding');
  });
  if (method === ABSENT && !owned('method')) form.removeAttribute('method');
  if (enctype === ABSENT && !owned('enctype')) form.removeAttribute('enctype');
}

/**
 * Parse start tag attributes into a map.
 * @param {string} startTag
 * @returns {Map<string, string>}
 */
export function parseStartTagAttrs(startTag) {
  /** @type {Map<string, string>} */
  const attrs = new Map();
  let i = 1;
  while (i < startTag.length && !/[\s/>]/.test(startTag[i])) i++;
  while (i < startTag.length) {
    while (i < startTag.length && /[\s/]/.test(startTag[i])) i++;
    if (i >= startTag.length || startTag[i] === '>') break;
    let name = '';
    while (i < startTag.length && !/[\s/>=]/.test(startTag[i])) name += startTag[i++];
    while (i < startTag.length && /\s/.test(startTag[i])) i++;
    if (startTag[i] !== '=') {
      if (name) attrs.set(name.toLowerCase(), '');
      continue;
    }
    i++;
    while (i < startTag.length && /\s/.test(startTag[i])) i++;
    let value = '';
    const q = startTag[i];
    if (q === '"' || q === "'") {
      i++;
      while (i < startTag.length && startTag[i] !== q) value += startTag[i++];
      i++;
    } else {
      while (i < startTag.length && !/[\s>]/.test(startTag[i])) value += startTag[i++];
    }
    if (name) attrs.set(name.toLowerCase(), value);
  }
  return attrs;
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
 * @param {string} attrName
 * @returns {boolean}
 */
function isFormActionAttr(attrName) {
  let name = String(attrName).toLowerCase();
  if (isBindingPrefix(name[0])) name = name.slice(1);
  return name === 'action' || name === 'formaction';
}

/**
 * The refusal message.
 * @param {string} attrName
 * @param {string} [tag]
 */
function formActionError(attrName, tag) {
  return `[webjs] a function was interpolated into ${String(attrName).toLowerCase()}= `
    + `on <${tag || 'form'}>. Stringifying a function into HTML would leak its `
    + `source (a 'use server' action's body included) to every visitor, so this `
    + `is refused. To run a server action from a form, write an unquoted `
    + `action=\${action} on the <form> itself or a formaction=\${action} on a `
    + `<button> inside a bound form. Anywhere else, pass a URL string.`;
}
