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
 * `formaction=${fn}` on a submit button is refused rather than supported. It
 * is legal HTML, and a per-submitter identity could ride the submitter's own
 * `name`/`value` pair, but that pair is also how a multi-button form tells its
 * buttons apart, so supporting it would either clobber an author's own
 * `name=` or need a second parallel wire. Refusing states the boundary; a form
 * per action is the shape to write instead.
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
 * Is this hole the ONE supported form-action binding: an unquoted
 * `action=${fn}` on a `<form>`?
 *
 * Both halves matter. Unquoted, because quoting turns a binding hole back into
 * a plain attribute the renderer stringifies, and there is no way to bind half
 * an action into a url. On a `<form>`, because that is the only element whose
 * `action` submits anything; anywhere else the attribute is inert and binding
 * a function to it means the author expected something that will never happen.
 *
 * @param {unknown} val the hole's resolved value
 * @param {string} attrName the AUTHORED attribute name (no sigil, unquoted branch)
 * @param {string} [tag] lowercased owner tag
 * @returns {boolean}
 */
export function isBoundFormAction(val, attrName, tag) {
  if (typeof val !== 'function') return false;
  if (String(attrName).toLowerCase() !== 'action') return false;
  return String(tag || '').toLowerCase() === 'form';
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
    `[webjs] the function in action= on <${tag || 'form'}> is not a server action. `
    + `Only a function imported from a 'use server' *.server.{js,ts} module can be `
    + `bound to a form, because the identity the browser submits has to resolve `
    + `back to something the server can run. Move the handler into a server `
    + `action and import it, or pass a url string.`,
  );
}

/**
 * The enctypes a form submission can actually be parsed from. `text/plain` is
 * legal HTML and useless here: the server parses a submission as multipart or
 * urlencoded, so a `text/plain` bound form runs under JS (the router sends
 * FormData) and is a bare 405 without it. That is precisely the
 * works-one-way-only near-miss this module refuses everywhere else, so it is
 * refused here too rather than silently corrected.
 */
const PARSEABLE_ENCTYPES = new Set(['multipart/form-data', 'application/x-www-form-urlencoded']);

/**
 * The shared refusal for a bound form whose own attributes contradict the
 * binding. Kept in one place because SSR reads the emitted start tag and the
 * client reads the live element, and the two must refuse identically.
 * @param {string | null | undefined} method
 * @param {string | null | undefined} enctype
 */
function assertSubmittableForm(method, enctype) {
  if (method != null && !/^post$/i.test(method.trim())) {
    throw new Error(
      `[webjs] <form method="${method}" action=\${action}> cannot work: a bound `
      + `server action is submitted as a POST body, and a "${method}" form sends `
      + `no body. Drop the method attribute (WebJs emits method="post") or `
      + `remove the bound action.`,
    );
  }
  if (enctype != null && !PARSEABLE_ENCTYPES.has(enctype.trim().toLowerCase())) {
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
 * `startTag` is the already-committed `<form ...>` text, holes included, so
 * this reads the attributes the browser will actually see rather than the ones
 * the template literal spelled out. That matters for a hole-provided
 * `method=${m}`, which no scan of the source template could resolve.
 *
 * Three edits, none of them optional:
 *   - `action` is gone already (the caller drops it at the hole), so the form
 *     posts to the page's own url. Omitted rather than emitted as `action=""`,
 *     which the HTML spec treats as a conformance error.
 *   - `method="post"` when absent. A GET form puts its fields in the query
 *     string and sends no body, so a bound action would never run.
 *   - `enctype="multipart/form-data"` when absent, so a file input works on
 *     the no-JS path. Text-only fields round-trip identically either way.
 *
 * An explicit `method="get"` throws rather than being silently upgraded: the
 * author wrote two things that cannot both be true, and quietly picking one
 * hides the mistake.
 *
 * @param {string} startTag the emitted start tag, ending in `>`
 * @param {string} id the action identity
 * @returns {{ tag: string, hidden: string }}
 */
export function bindFormActionStartTag(startTag, id) {
  const attrs = parseStartTagAttrs(startTag);
  assertSubmittableForm(attrs.get('method'), attrs.get('enctype'));
  // The close is `>` or `/>`; a self-closing form is not valid HTML but the
  // scanner can still hand one over, so keep whichever the author wrote.
  const close = startTag.endsWith('/>') ? '/>' : '>';
  const head = startTag.slice(0, startTag.length - close.length);
  let inject = '';
  if (!attrs.has('method')) inject += ' method="post"';
  if (!attrs.has('enctype')) inject += ' enctype="multipart/form-data"';
  return { tag: head + inject + close, hidden: formActionHiddenField(id) };
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
 * Bound-action binds recorded during one commit pass, applied by
 * `flushFormActionBinds` once every part has been committed.
 *
 * The deferral is not an optimization. The binding validates the form's
 * `method` and `enctype`, and a hole-provided one written AFTER the action
 * hole has not been applied when the action part commits, so validating at
 * commit time reads `null` and lets `<form action=${fn} method=${'get'}>`
 * through on the client while SSR refuses it (SSR validates the whole start
 * tag at its `>`, so it always sees the final attributes). That divergence
 * ships a form which submits its fields in the query string and never runs the
 * action, which is the outcome the guard exists to prevent.
 *
 * @type {{ form: HTMLFormElement, fn: Function }[]}
 */
const _pendingBinds = [];

/**
 * Record a bound action to apply after the current commit pass.
 * @param {HTMLFormElement} form
 * @param {Function} fn
 * @returns {void}
 */
export function queueFormActionBind(form, fn) {
  _pendingBinds.push({ form, fn });
}

/**
 * Apply every queued bind, now that the whole instance's attributes are final.
 *
 * The queue is drained BEFORE the first bind runs, so a bind that THROWS cannot
 * leave the rest of its own batch behind.
 *
 * @returns {void}
 */
export function flushFormActionBinds() {
  if (_pendingBinds.length) {
    const pending = _pendingBinds.splice(0, _pendingBinds.length);
    for (const { form, fn } of pending) bindFormActionElement(form, fn);
  }
  if (_pendingRevalidate.length) {
    const forms = _pendingRevalidate.splice(0, _pendingRevalidate.length);
    for (const form of forms) {
      if (!_boundForms.has(form)) continue;   // released during this same pass
      assertStillSubmittable(form);
    }
  }
}

/**
 * Drop anything still queued, called from the `finally` of a commit pass.
 *
 * Draining at flush time is not enough on its own: a part committed AFTER a
 * form was queued can throw (a `formaction=${fn}` refusal later in the same
 * template), so the pass never reaches its flush and the entry survives into
 * the NEXT render, where it is applied to a form belonging to an abandoned
 * one. Measured: a template whose form carries `method="get"` and whose next
 * element throws leaves that form queued, and the following unrelated render
 * fails with the form's own error. A failed pass must take its pending binds
 * with it.
 *
 * @returns {void}
 */
export function discardPendingFormActionBinds() {
  _pendingBinds.length = 0;
  _pendingRevalidate.length = 0;
}

/**
 * Forms that carry a bound action, so a LATER attribute change on one can be
 * validated against the binding.
 * @type {WeakSet<Element>}
 */
const _boundForms = new WeakSet();

/** Bound forms to re-validate at the end of this pass. @type {HTMLFormElement[]} */
const _pendingRevalidate = [];

/**
 * Attributes the BIND supplied on each form, so releasing one can take back
 * exactly what it added and nothing the author wrote.
 * @type {WeakMap<Element, string[]>}
 */
const _forcedAttrs = new WeakMap();

/**
 * Is `name` an attribute whose value decides whether a bound form can submit?
 * @param {string} name
 * @returns {boolean}
 */
function affectsSubmittability(name) {
  const attr = String(name).toLowerCase();
  return attr === 'method' || attr === 'enctype';
}

/**
 * Note that a bound form's `method` / `enctype` was written, so the end of the
 * pass re-checks it.
 *
 * Deferred rather than checked at the write, for the same reason that moved the
 * bind itself: a write site sees ONE attribute mid-pass, so validating there
 * judges a half-built tag. Deferring also makes every write path equivalent,
 * which matters because there are three (a value, a REMOVAL, and the separate
 * mixed-attribute branch a QUOTED hole compiles to) and instrumenting them one
 * at a time is how two of the three got missed.
 *
 * @param {Element} el
 * @param {string} name
 * @returns {void}
 */
export function noteBoundFormAttrWrite(el, name) {
  if (!_boundForms.has(el) || !affectsSubmittability(name)) return;
  _pendingRevalidate.push(/** @type any */ (el));
}

/**
 * Re-check a bound form after a write to its `method` / `enctype`.
 *
 * Stricter than `assertSubmittableForm`, and it has to be: that one treats an
 * ABSENT attribute as "not set yet, the renderer will supply it", which is
 * right before a bind and wrong after one. Binding always leaves both present,
 * so absent HERE means this pass removed it, and a removal is not neutral: a
 * `<form>` with no `method` submits as GET, which is the same silent break as
 * writing `"get"` outright. SSR refuses the same template (a null hole renders
 * `method=""`, which is not `post`), so accepting it would put the two
 * renderers back out of step.
 *
 * @param {HTMLFormElement} form
 * @returns {void}
 */
function assertStillSubmittable(form) {
  const method = form.getAttribute('method');
  const enctype = form.getAttribute('enctype');
  if (method == null || enctype == null) {
    const missing = method == null ? 'method' : 'enctype';
    const why = method == null
      ? 'A form with no method submits as GET, which sends no body, so the action would never run.'
      : 'A form with no enctype submits urlencoded, so a file input sends only the filename.';
    throw new Error(
      `[webjs] a bound <form action=\${action}> lost its ${missing} attribute `
      + `during a re-render. ${why} Leave both to WebJs (it supplies `
      + `method="post" and an enctype) rather than driving them from a hole `
      + `that can resolve to null.`,
    );
  }
  assertSubmittableForm(method, enctype);
}

/**
 * Release a form that no longer carries a bound action.
 *
 * Reached when an action hole resolves to something else (`action=${flag ? act
 * : '/legacy'}`). Two things have to go: the membership, or every later
 * `method` write on a now-ordinary form would be judged against a binding that
 * is gone, and the hidden identity field, or the form would post the old
 * action's identity to its new url.
 *
 * @param {Element} el
 * @returns {void}
 */
export function releaseFormAction(el) {
  if (!_boundForms.has(el)) return;
  _boundForms.delete(el);
  for (const child of el.children) {
    if (child.localName === 'input' && child.getAttribute('name') === FORM_ACTION_FIELD) {
      child.remove();
      break;
    }
  }
  // Take back the attributes the BIND added, and only those. Leaving them puts
  // the two renderers out of step again: SSR of `<form action=${'/legacy'}>`
  // emits no method at all, so a client that kept `method="post"
  // enctype="multipart/form-data"` would POST multipart to a url the server
  // renders as an ordinary GET form.
  const forced = _forcedAttrs.get(el);
  if (forced) {
    for (const name of forced) el.removeAttribute(name);
    _forcedAttrs.delete(el);
  }
}

/**
 * Apply a bound action to a LIVE form element, producing the same three edits
 * SSR makes. Runs when a shipping component re-renders a template holding
 * `<form action=${fn}>`: that render rebuilds the form from the template, so
 * the SSR'd hidden field is gone and has to be put back.
 *
 * The identity is read synchronously off the stub, which is what the browser
 * import of a `'use server'` module resolves to. A function with no identity
 * throws for the same reason it does at SSR: a form that looks right and posts
 * nowhere is the one outcome this feature cannot have.
 *
 * The field is inserted as the form's FIRST child, ahead of every child-part
 * marker the template clone already contains, so a later child update cannot
 * take it out again. Idempotent: a re-render finds the existing field and only
 * refreshes its value.
 *
 * @param {HTMLFormElement} form
 * @param {Function} fn
 * @returns {void}
 */
export function bindFormActionElement(form, fn) {
  const id = assertIdentifiableAction(formActionId(fn), form.localName);
  const method = form.getAttribute('method');
  assertSubmittableForm(method, form.getAttribute('enctype'));
  form.removeAttribute('action');
  const forced = [];
  if (method == null) { form.setAttribute('method', 'post'); forced.push('method'); }
  if (!form.hasAttribute('enctype')) {
    form.setAttribute('enctype', 'multipart/form-data');
    forced.push('enctype');
  }
  if (forced.length) _forcedAttrs.set(form, forced);

  let field = null;
  for (const el of form.children) {
    if (el.localName === 'input' && el.getAttribute('name') === FORM_ACTION_FIELD) {
      field = el;
      break;
    }
  }
  if (!field) {
    field = form.ownerDocument.createElement('input');
    field.setAttribute('type', 'hidden');
    field.setAttribute('name', FORM_ACTION_FIELD);
    form.insertBefore(field, form.firstChild);
  }
  field.setAttribute('value', id);
  // Remember it, so a later `method` / `enctype` write on this same form is
  // validated against the binding (see `noteBoundFormAttrWrite`).
  _boundForms.add(form);
}

/**
 * Parse the attributes of an emitted start tag into `name -> value`, where a
 * valueless attribute maps to the empty string.
 *
 * A real tokenizer rather than a regex over the whole tag, because the tag is
 * emitted HTML and an attribute VALUE can contain anything: `<form
 * data-note="use method=get here" action=${fn}>` has to report no `method`
 * attribute, and a regex looking for `method=` reports one. Getting that wrong
 * means silently skipping the forced `method="post"` and shipping a form that
 * submits nothing.
 *
 * @param {string} startTag
 * @returns {Map<string, string>}
 */
export function parseStartTagAttrs(startTag) {
  /** @type {Map<string, string>} */
  const attrs = new Map();
  // Skip `<` and the tag name.
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
    i++; // the `=`
    while (i < startTag.length && /\s/.test(startTag[i])) i++;
    let value = '';
    const q = startTag[i];
    if (q === '"' || q === "'") {
      i++;
      while (i < startTag.length && startTag[i] !== q) value += startTag[i++];
      i++; // closing quote
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
 * is the very thing being withheld. It names the one supported shape, because
 * every refused shape here is a near-miss of it and the author's next question
 * is what to write instead.
 * @param {string} attrName
 * @param {string} [tag]
 */
function formActionError(attrName, tag) {
  return `[webjs] a function was interpolated into ${String(attrName).toLowerCase()}= `
    + `on <${tag || 'form'}>. Stringifying a function into HTML would leak its `
    + `source (a 'use server' action's body included) to every visitor, so this `
    + `is refused. To run a server action from a form, write an unquoted `
    + `action=\${action} on the <form> itself. Anywhere else, pass a URL string.`;
}
