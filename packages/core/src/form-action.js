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
  const resolved = resolveBoundFormAttrs(
    attrs.has('method') ? attrs.get('method') : ABSENT,
    attrs.has('enctype') ? attrs.get('enctype') : ABSENT,
  );
  // The close is `>` or `/>`; a self-closing form is not valid HTML but the
  // scanner can still hand one over, so keep whichever the author wrote.
  const close = startTag.endsWith('/>') ? '/>' : '>';
  const head = startTag.slice(0, startTag.length - close.length);
  let inject = '';
  if (resolved.method !== null) inject += ` method="${resolved.method}"`;
  if (resolved.enctype !== null) inject += ` enctype="${resolved.enctype}"`;
  return { tag: head + inject + close, hidden: formActionHiddenField(id) };
}

/**
 * Refuse the shapes a bound form can be written in that the two renderers can
 * never agree on, so neither ships a form that submits differently with JS than
 * without it.
 *
 * A `.prop` binding on a native element is DROPPED at SSR and applied for real
 * in the browser, where `method` / `enctype` / the `encoding` alias are
 * reflected IDL attributes. Measured: SSR of `<form action=${fn} .method=
 * ${'get'}>` emits `method="post"` while a browser ends at `method="get"`. No
 * amount of reconciliation closes that, because the client cannot un-know an
 * assignment it made and the server cannot know one it never saw. This is the
 * same argument that already refuses `.action` on a form.
 *
 * Two `action=${...}` holes on one form is the other: SSR emits the second as a
 * plain `action` url ALONGSIDE the identity field, which is incoherent, while
 * the client resolves last-wins.
 *
 * Both are properties of the template, so they are checked only once the value
 * proves the form is really bound. `<form action=${aString} .method=${m}>` is
 * an ordinary form and is left alone.
 *
 * @param {{ duplicateAction?: boolean, propAttrs?: string[] }} shape
 * @returns {void}
 */
export function assertConvergentBoundForm(shape) {
  if (shape.duplicateAction) {
    throw new Error(
      '[webjs] a <form> carries two action=${...} holes. Only one can win, and '
      + 'the two renderers pick differently, so bind exactly one action.',
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
 * The sentinel for "this attribute is not present at all", as distinct from
 * present-and-empty. The difference decides the outcome: an ABSENT `method` is
 * supplied by the framework, while `method=""` is a value the author's template
 * produced and cannot submit, so it is refused.
 */
export const ABSENT = Symbol('webjs.attr.absent');

/**
 * THE decision both renderers make about a bound form, in one place.
 *
 * Sharing it is the point. SSR reaches it with the attributes parsed off the
 * start tag it just emitted; the client reaches it with the values its template
 * would have emitted, reconstructed per part kind. Because the inputs mean the
 * same thing and the predicate is literally the same function, a shape the two
 * renderers could disagree about has to be a difference in how the inputs were
 * gathered, which is a much smaller surface than two independent guards.
 *
 * Returns what to INJECT for each attribute, or null to leave the author's own
 * value alone. Throws when a value cannot submit at all.
 *
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
 *
 * This runs at the END of a commit pass, unconditionally, for every candidate
 * the template recorded. Both of those matter:
 *
 * END of the pass, because whether a form can submit is a fact about the whole
 * start tag, and an attribute written after the action hole has not been
 * committed when that hole commits.
 *
 * UNCONDITIONALLY, because `updateInstance` re-applies only the parts whose own
 * value changed, so anything hanging off the action hole never runs when a
 * SIBLING hole is what moved.
 *
 * The `method` / `enctype` decision is made from the TEMPLATE (the recorded
 * statics plus this pass's values, resolved per part kind), never by reading
 * them back off the DOM. Reading the DOM cannot work: `?method=${false}` and
 * `method=${null}` both leave no attribute, and SSR resolves them to opposite
 * answers (it emits nothing for the first and `method=""` for the second). The
 * template is the only place that distinction survives.
 *
 * A consequence worth stating, because it looks like a hole and is not: a write
 * from OUTSIDE the template (a `ref` callback, `firstUpdated`, author code, an
 * extension) is deliberately not seen here. SSR cannot see such a write either,
 * so ignoring it is what keeps the two renderers in agreement; catching it
 * would make the client refuse state the server never had.
 *
 * @param {HTMLFormElement} form
 * @param {unknown} value        the action hole's resolved value
 * @param {string | typeof ABSENT} method   what SSR would have emitted
 * @param {string | typeof ABSENT} enctype  what SSR would have emitted
 * @param {{ duplicateAction: boolean, propAttrs: string[] }} shape compile-time refusals
 * @returns {void}
 */
export function reconcileFormAction(form, value, method, enctype, shape) {
  const id = typeof value === 'function' ? formActionId(value) : null;

  if (!id) {
    // Not a bound action (a url string, null, or a function the browser stub
    // never stamped). A function that was MEANT as an action still refuses, so
    // a form never silently posts nowhere.
    if (typeof value === 'function') assertIdentifiableAction(null, form.localName);
    releaseFormAction(form, method, enctype);
    return;
  }

  // Shapes SSR and the client can never agree on, refused rather than
  // reconciled, through the same helper SSR calls.
  assertConvergentBoundForm(shape);

  const resolved = resolveBoundFormAttrs(method, enctype);
  form.removeAttribute('action');
  applyResolvedAttr(form, 'method', method, resolved.method);
  applyResolvedAttr(form, 'enctype', enctype, resolved.enctype);
  ensureIdentityField(form, id);
}

/**
 * Write (or leave) one resolved attribute.
 *
 * `inject` non-null means the template supplies nothing and the framework owns
 * this attribute, so it is set. Otherwise the author's own value is already on
 * the element, put there by whichever commit branch owns that hole, and is left
 * exactly as written.
 *
 * @param {Element} form
 * @param {string} name
 * @param {string | typeof ABSENT} authored
 * @param {string | null} inject
 */
function applyResolvedAttr(form, name, authored, inject) {
  if (inject !== null) { form.setAttribute(name, inject); return; }
  // The author's value is authoritative. It is already committed, except for a
  // hole whose value is empty, which some branches express by removing the
  // attribute; put it back so the DOM matches what SSR emitted.
  if (authored !== ABSENT && form.getAttribute(name) !== authored) {
    form.setAttribute(name, /** @type string */ (authored));
  }
}

/**
 * Ensure the hidden identity field is present, first, and current.
 *
 * FIRST is load-bearing: it puts the field outside every child part's marker
 * range, so a later child update cannot take it out. `firstElementChild` is the
 * fast path because both this function and SSR put it there, and the scan is
 * only a fallback for a form whose children were moved by hand.
 *
 * @param {HTMLFormElement} form
 * @param {string} id
 */
function ensureIdentityField(form, id) {
  const first = form.firstElementChild;
  let field = first && first.localName === 'input'
    && first.getAttribute('name') === FORM_ACTION_FIELD ? first : null;
  if (!field) {
    for (const el of form.children) {
      if (el.localName === 'input' && el.getAttribute('name') === FORM_ACTION_FIELD) {
        field = el;
        break;
      }
    }
  }
  if (!field) {
    field = form.ownerDocument.createElement('input');
    field.setAttribute('type', 'hidden');
    field.setAttribute('name', FORM_ACTION_FIELD);
    form.insertBefore(field, form.firstChild);
  }
  if (field.getAttribute('value') !== id) field.setAttribute('value', id);
}

/**
 * Drop a binding whose action hole no longer resolves to an action.
 *
 * Both halves matter. The identity field has to go, or the form keeps posting
 * the old action's identity to whatever it now targets. And the attributes the
 * framework supplied have to go with it, or a released form keeps a
 * `method="post" enctype="multipart/form-data"` that SSR does not emit for the
 * same template.
 *
 * Which attributes were framework-supplied is not remembered from the bind, it
 * is recomputed: an attribute is the framework's exactly when the template
 * supplies nothing for it on THIS pass. That is why there is no bookkeeping to
 * go stale.
 *
 * @param {HTMLFormElement} form
 * @param {string | typeof ABSENT} method
 * @param {string | typeof ABSENT} enctype
 */
function releaseFormAction(form, method, enctype) {
  const first = form.firstElementChild;
  if (first && first.localName === 'input' && first.getAttribute('name') === FORM_ACTION_FIELD) {
    first.remove();
  } else {
    for (const el of form.children) {
      if (el.localName === 'input' && el.getAttribute('name') === FORM_ACTION_FIELD) {
        el.remove();
        break;
      }
    }
  }
  if (method === ABSENT) form.removeAttribute('method');
  if (enctype === ABSENT) form.removeAttribute('enctype');
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
