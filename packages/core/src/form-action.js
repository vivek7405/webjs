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
 * a function, an unsupported `formaction=` shape, and `action=` on a tag that
 * is not a `<form>` all refuse, so there is exactly one way to write each
 * binding and no silently-broken near-miss.
 *
 * `formaction=${fn}` on a SUBMITTER is the second supported shape (#1207), for
 * a form whose buttons run different actions. The identity rides the channel a
 * browser gives only to the button that was pressed: its own `name`/`value`
 * pair. So the renderers emit `<button name="__webjs_action" value="<id>">` and
 * no `formaction` url at all, exactly as a bound `action=${fn}` emits no
 * `action`. The form-level hidden field is the form's FIRST child and SSR emits
 * it right after the start tag, so a submitter's entry necessarily follows it
 * in DOM order; the dispatcher reads `getAll(FORM_ACTION_FIELD)` and takes the
 * LAST, which is the submitter's whenever one was pressed. Nothing new is
 * needed on the JS path either: `new FormData(form, submitter)` already
 * includes the pressed button's pair.
 *
 * THE RULE, one sentence, and the whole reason this file is shaped the way it
 * is (#1307): the renderer supplies submission attributes at the level where
 * the action is BOUND, and never overrides what the author wrote at that same
 * level. A bound `<form>` gains `method="post"` and `enctype`; a bound
 * `<button>` gains `formmethod="post"` and `formenctype` ON THE BUTTON. So a
 * bound submitter is SELF-SUFFICIENT: it works inside a bound form, an unbound
 * form, a `method="get"` form, or a form with no method at all, and it asks
 * nothing of the element around it.
 *
 * That is what React does (`pushFormActionAttribute` emits `formMethod` and
 * `formEncType` beside the identity, from an action descriptor that is
 * literally `{name, method: 'POST', encType: 'multipart/form-data'}`), and it
 * is what makes the rule below possible.
 *
 * Refused shapes on a submitter, each because the identity would not arrive:
 *   - Its own `name` (static `name="..."` or a `name=${n}` hole) or its own
 *     `value`, because the identity occupies both halves of that one pair.
 *   - `<input type="image">`, which submits `name.x` / `name.y` coordinates
 *     instead of `name=value`, so the identity would never arrive.
 *   - A control that is not a submitter at all, where `formaction` is inert.
 *   - A `form="other"` attribute, which moves the submitter's form owner
 *     somewhere the identity field it needs may not be.
 *
 * WHAT IS NOT REFUSED, and the line that decides it: only a SAME-ELEMENT
 * contradiction refuses, never a rule about the author's OTHER elements. A
 * same-element contradiction has no correct behaviour to fall back to (a bound
 * button that also says `formmethod="get"` cannot both run the action and send
 * no body). A cross-element rule always does have one, namely whatever native
 * HTML would have done, so the renderer honours it instead of refusing.
 *
 * The concrete consequence, and it is a deliberate reversal of #1207's Part B:
 * a PLAIN, non-binding `<button formmethod="get">` inside a bound form now
 * renders untouched. Native HTML says the submitter's override wins, an author
 * who typed it meant it, and the form's action simply does not run, which is
 * exactly what the same markup does in any other framework. The dev-time client
 * guard reports at submit time when a submission carries an identity it cannot
 * deliver, which is the right place for a judgement call about intent.
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
 * Is this hole one of the two supported form-action bindings: an unquoted
 * `action=${fn}` on a `<form>`, or an unquoted `formaction=${fn}` on a
 * `<button>` / `<input>`?
 *
 * Unquoted matters in both cases, because quoting turns a binding hole back
 * into a plain attribute the renderer stringifies, and there is no way to bind
 * half an action into a url. The TAG matters because those are the only
 * elements whose `action` / `formaction` submits anything; anywhere else the
 * attribute is inert and binding a function to it means the author expected
 * something that will never happen.
 *
 * Whether the `<button>` is really a SUBMITTER, and whether its form is bound,
 * are checked separately: they depend on attributes that may be written after
 * this hole, so they are judged once the whole start tag is known.
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
 * Refuse a submitter carrying its own `name` alongside `formaction=${fn}`.
 *
 * The identity needs BOTH halves of the submitter's one `name`/`value` pair, so
 * an author `name` has nowhere to go. `allowFrameworkName` is what lets this
 * run twice over the same element without tripping on the framework's own
 * write: the renderers emit `name="__webjs_action"` themselves, and the client
 * re-reconciles an element it already stamped on a previous pass, so a `name`
 * that IS the identity field is ours and not the author's. It is passed false
 * only where the caller has already established the author wrote one too (SSR
 * sees two `name` attributes on the emitted tag; the client recorded a `name`
 * part or a static `name` on the compiled template).
 *
 * @param {string} name
 * @param {string} [tag]
 * @param {boolean} [allowFrameworkName] treat `name="__webjs_action"` as the framework's own
 */
export function assertSubmitterHasNoName(name, tag, allowFrameworkName = true) {
  if (!name) return;
  if (name === FORM_ACTION_FIELD && allowFrameworkName) return;
  const found = name === FORM_ACTION_FIELD
    ? 'a second "name" attribute'
    : `name="${name}"`;
  throw new Error(
    `[webjs] formaction=\${action} on <${tag || 'button'}> cannot be used when `
    + `the element already carries a "name" attribute (found ${found}). The `
    + `action identity is submitted as the button's own name/value pair, so `
    + `there is no room for a second one. Move the action to the enclosing `
    + `<form action=\${action}> or drop the submitter's "name".`,
  );
}

/**
 * Refuse a formaction binding on a control that is not a submitter.
 *
 * `<input type="image">` gets its own message rather than the generic one: it
 * IS a submitter, so "use a submitter" would be unhelpful advice. It submits
 * `name.x` / `name.y` coordinate pairs instead of `name=value`, so the identity
 * would never arrive and the form would look bound while posting nothing.
 *
 * A `<button>` with no `type` is a submitter (submit is the HTML default),
 * which is why an absent type passes here.
 *
 * @param {string} tag
 * @param {string | null | undefined} type
 */
export function assertSubmitterType(tag, type) {
  const t = String(tag || '').toLowerCase();
  const value = type == null ? null : String(type).toLowerCase();
  if (isSubmitterType(t, value)) {
    if (t === 'input' && value === 'image') {
      throw new Error(
        `[webjs] formaction=\${action} is not supported on <input type="image"> `
        + `because image submitters submit coordinate pairs (name.x/name.y) `
        + `instead of name=value, so the action identity would never arrive. `
        + `Use a <button> instead.`,
      );
    }
    if (t === 'input') {
      // `<input type="submit">` IS a submitter and Part B still judges its
      // `formmethod` / `formenctype`, but it cannot carry a BINDING. The
      // identity has to occupy the submitter's `value`, and on this control
      // `value` is also the visible caption, so binding an action renders a
      // button captioned `a1b2c3d4e5/publishDraft`. The only fix, an author
      // `value="Publish"`, is the very channel the identity needs, so the two
      // requirements cannot both be met. A `<button>` has no such conflict: its
      // label is its children.
      throw new Error(
        `[webjs] formaction=\${action} is not supported on <input type="submit"> `
        + `because the action identity has to occupy the submitter's "value", `
        + `which on this control is also its visible label, so the button would `
        + `render captioned with the action's id and could not be given a real `
        + `one. Use <button formaction=\${action}>Publish</button>, whose label `
        + `is its children.`,
      );
    }
    return;
  }
  throw new Error(
    `[webjs] formaction=\${action} on <${t}>${value ? ` type="${value}"` : ''} `
    + `requires a submitter control, and formaction is inert on anything else. `
    + `Use <button formaction=\${action}>.`,
  );
}

/**
 * Is this tag/type pair a control that SUBMITS its form?
 *
 * Shared by the binding guard and the Part B sweep, which need the same answer
 * for opposite reasons: the first refuses `formaction=${fn}` on a non-submitter,
 * the second only inspects `formmethod` / `formenctype` on a real submitter,
 * where those attributes are not inert.
 *
 * @param {string} tag lowercased
 * @param {string | null | undefined} type lowercased, or null when absent
 * @returns {boolean}
 */
export function isSubmitterType(tag, type) {
  const value = type == null ? null : String(type).toLowerCase();
  if (tag === 'button') return value == null || value === '' || value === 'submit';
  if (tag === 'input') return value === 'submit' || value === 'image';
  return false;
}

/**
 * Refuse an author `value` on a bound submitter, for the same reason as `name`:
 * the identity is a name/value PAIR, so both halves are spoken for.
 * @param {string} tag
 */
export function assertSubmitterHasNoValue(tag) {
  throw new Error(
    `[webjs] formaction=\${action} on <${tag || 'button'}> cannot be used when `
    + `the element already carries a "value" attribute. The action identity is `
    + `submitted as the button's own name/value pair, so both halves are taken. `
    + `Drop the "value", or dispatch on it from one form-level action instead.`,
  );
}

/**
 * Refuse a static `formaction="/url"` alongside the bound hole.
 *
 * The same failure as a static `action="/url"` on a bound form, one level down:
 * SSR only rewrites the attribute the HOLE wrote, so the static one survives
 * into the emitted tag, while the client's reconcile removes it. With JS off
 * the browser posts the identity to `/url`; with JS on the router posts to the
 * page. Same template, two different targets.
 *
 * @param {string} tag
 */
export function assertSubmitterHasNoStaticFormAction(tag) {
  throw new Error(
    `[webjs] a bound formaction=\${action} on <${tag || 'button'}> cannot also `
    + `carry a plain formaction attribute: the two name different targets and `
    + `the renderers resolve them differently. Drop the static attribute.`,
  );
}

/**
 * Refuse a submitter whose form owner is chosen through the `form` attribute.
 *
 * Boundness was just established for the ENCLOSING form. A `form="other"`
 * re-points the submitter at a different one, which may not be bound at all, so
 * the check that passed would have been about the wrong element.
 *
 * @param {string} tag
 */
export function assertSubmitterHasNoFormAttribute(tag) {
  throw new Error(
    `[webjs] formaction=\${action} on <${tag || 'button'}> cannot be used with `
    + `a "form" attribute, which re-points the submitter at a form other than `
    + `the bound one it sits in. Keep the submitter inside its bound <form>.`,
  );
}

/**
 * Refuse two `formaction=${...}` holes on one submitter, the per-button twin of
 * the duplicate-`action` refusal: SSR would emit the second alongside the
 * identity it already wrote, while the client resolves last-wins.
 *
 * @param {boolean} duplicate
 * @param {string} tag
 */
export function assertSingleSubmitterAction(duplicate, tag) {
  if (!duplicate) return;
  throw new Error(
    `[webjs] two formaction=\${action} holes were found on one <${tag || 'button'}>. `
    + `Only one can win, and the two renderers pick differently, so bind exactly `
    + `one action per submitter.`,
  );
}

/**
 * The submitter twin of `assertConvergentBoundForm`: refuse a `.prop` spelling
 * on a submitter that the two renderers can never agree on.
 *
 * Same argument, one level down. A `.prop` on a native element is DROPPED at
 * SSR and applied for real in the browser, and on a `<button>` / `<input>` all
 * of `name`, `value`, `formAction`, `formMethod` and `formEnctype` are
 * REFLECTED IDL attributes, so the browser write lands in the content
 * attribute. Measured: `<button .name=${'intent'} formaction=${fn}>` renders
 * clean at SSR (the prop is dropped, so the identity's `name` survives) and
 * then throws on hydration, where `.name` has written `name="intent"` over it.
 * That is the render-on-the-server, crash-on-hydration direction, which is the
 * one failure this module treats as unacceptable.
 *
 * Scoped to a BOUND submitter (#1307). A plain `<button .name=${'intent'}>`
 * inside a bound form is the ordinary one-action-plus-intent-dispatch pattern
 * and is left alone, and a plain button's `.formMethod` / `.formEnctype` is now
 * an ordinary native property on an ordinary button, since its own override no
 * longer contradicts anything the renderer promised. The native-property rule
 * (SSR drops a `.prop`, the browser reflects it) is what this codebase already
 * accepts everywhere else, including for an unbound form's `.method`.
 *
 * @param {string[] | undefined} propAttrs attribute names a property part owns
 * @param {string} tag lowercased owner tag
 * @returns {void}
 */
export function assertConvergentSubmitter(propAttrs, tag) {
  const relevant = (propAttrs || []).filter((n) => isSubmitterReflectedProp(n));
  const prop = relevant[0];
  if (!prop) return;
  throw new Error(
    `[webjs] a <${tag || 'button'}> submitter binds .${prop}=. That property is a `
    + `reflected IDL attribute on a submitter, so a property binding is dropped `
    + `at SSR and written to the attribute in the browser: the page would render `
    + `on the server and throw on hydration. Write it as a plain attribute.`,
  );
}

/**
 * Is this property name one whose write reflects into a submitter attribute the
 * form-action rules care about?
 *
 * @param {string} name any case, sigil already stripped
 * @returns {boolean}
 */
export function isSubmitterReflectedProp(name) {
  const n = String(name).toLowerCase();
  return n === 'name' || n === 'value' || n === 'formaction'
    || n === 'formmethod' || n === 'formenctype';
}

/**
 * The submitter twin of `assertSubmittableForm`: refuse a BOUND submitter whose
 * own `formmethod` / `formenctype` contradicts the action it binds.
 *
 * Only a BOUND submitter reaches here (#1307), which is the reversal of #1207's
 * Part B. A plain `<button formmethod="get">` inside a bound form is a legal
 * native override that means exactly what the author typed, so it renders
 * untouched and the form's action simply does not run. Refusing it would be a
 * rule about the author's OTHER element, and native HTML already defines the
 * outcome. The dev-time client guard reports at submit time when a submission
 * holds an identity it cannot deliver.
 *
 * On a bound submitter both values ARE same-element contradictions, because the
 * renderer would otherwise be supplying `formmethod="post"` and an enctype onto
 * the very element the author just told to do something else. Refusing the
 * VALUES that cannot work, never the attributes themselves, so `formenctype`
 * naming either parseable encoding stays fully supported.
 *
 * @param {string} tag lowercased owner tag, for the message
 * @param {string | null | undefined} formMethod the submitter's `formmethod`, or null
 * @param {string | null | undefined} formEnctype the submitter's `formenctype`, or null
 */
export function assertSubmittableSubmitter(tag, formMethod, formEnctype) {
  const method = formMethod == null ? null : String(formMethod);
  const enctype = formEnctype == null ? null : String(formEnctype);

  if (method != null && /^dialog$/i.test(method)) {
    throw new Error(
      `[webjs] formaction=\${action} on <${tag}> cannot be combined with `
      + `formmethod="dialog", which dismisses a <dialog> instead of submitting, `
      + `so the bound action would never run. Drop one of the two.`,
    );
  }

  // Compared UNTRIMMED, exactly as `assertSubmittableForm` compares a form's
  // own `method`. These are enumerated attributes a browser matches against
  // exact keywords with no whitespace stripping, so `formmethod=" post "` falls
  // to the invalid-value default and the button submits as a GET. Trimming here
  // would accept the padded value, emit it untouched, and produce exactly the
  // silently-posts-nowhere submitter this refusal exists to make impossible.
  if (method != null && !/^post$/i.test(method)) {
    throw new Error(
      `[webjs] <${tag} formmethod="${method}" formaction=\${action}> cannot work: a `
      + `bound server action is submitted as a POST body, and a "${method}" `
      + `submission sends none, so the action would never run. Drop the formmethod `
      + `attribute (WebJs emits formmethod="post" on a bound submitter), or drop the `
      + `binding.`,
    );
  }
  if (enctype != null && !PARSEABLE_ENCTYPES.has(enctype.toLowerCase())) {
    throw new Error(
      `[webjs] <${tag} formenctype="${enctype}" formaction=\${action}> cannot work: a `
      + `form submission is parsed as multipart/form-data or `
      + `application/x-www-form-urlencoded, and a "${enctype}" body is neither, so the `
      + `bound action could never read it. Drop the formenctype attribute (WebJs emits `
      + `multipart/form-data on a bound submitter).`,
    );
  }
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
 * property and a function is a legitimate value. There is a separate path
 * that reflects on a custom element, a prop declared `reflect: true`, which
 * runs in the setter and never reaches any commit site. It used to write the
 * source, which is why this carve-out was once narrower than it looked.
 * #1169 closed it at the setter, where a function now removes the attribute.
 *
 * That close is not total, so do not read this exclusion as a guarantee the
 * source can never reach a custom element's attribute. `_reflectAttribute`
 * runs a prop's own `converter.toAttribute` BEFORE the function guard, so an
 * author who supplies one still owns what gets written, a stringified
 * function included. That is deliberate (supplying a converter is taking
 * responsibility for the serialization), but it means the guarantee here
 * covers the converter-less case.
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
  const attr = tag === 'button' || tag === 'input' ? 'formaction=' : 'action=';
  throw new Error(
    `[webjs] the function in ${attr} on <${tag || 'form'}> is not a server action. `
    + `Only a function imported from a 'use server' *.server.{js,ts} module can be `
    + `bound to a form or a submitter, because the identity the browser submits `
    + `has to resolve back to something the server can run. Move the handler into `
    + `a server action and import it, or pass a url string.`,
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
export const PARSEABLE_ENCTYPES = new Set(['multipart/form-data', 'application/x-www-form-urlencoded']);

/**
 * The shared refusal for a bound form whose own attributes contradict the
 * binding. Kept in one place because SSR reads the emitted start tag and the
 * client reads the live element, and the two must refuse identically.
 * @param {string | null | undefined} method
 * @param {string | null | undefined} enctype
 */
export function assertSubmittableForm(method, enctype) {
  // Compared UNTRIMMED on purpose. `method` and `enctype` are enumerated
  // attributes the browser matches against exact keywords with no whitespace
  // stripping, so `method=" post "` falls to the invalid-value default and the
  // form submits as a GET. Trimming here would accept the padded value, emit it
  // untouched, and produce exactly the silently-posts-nowhere form this module
  // exists to make impossible.
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
  // The hole's own `action` is already gone. Anything still here is a SECOND,
  // static one, which SSR would emit and the client would remove.
  assertConvergentBoundForm({ staticAction: attrs.has('action') });
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
 * A STATIC `action="/url"` alongside the bound hole is the third, and it is the
 * one that fails quietly rather than loudly. SSR only drops the `action` the
 * HOLE wrote, so the static one survives into the emitted start tag, while the
 * client's reconcile calls `removeAttribute('action')` and takes it out. With
 * JS off the browser posts the identity to `/url`; with JS on the router posts
 * to the page. Same template, two different targets.
 *
 * All three are properties of the template, so they are checked only once the
 * value proves the form is really bound. `<form action=${aString} .method=${m}>`
 * is an ordinary form and is left alone.
 *
 * @param {{ staticAction?: boolean, duplicateAction?: boolean, propAttrs?: string[] }} shape
 * @returns {void}
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
 * THE decision both renderers make about a bound SUBMITTER, in one place, the
 * twin of `resolveBoundFormAttrs` (#1307).
 *
 * Sharing it is the point, for the same reason the form version is shared: SSR
 * reaches it with the attributes parsed off the start tag it just emitted, the
 * client reaches it with the values its template would have emitted, and the
 * predicate is literally the same function.
 *
 * Returns what to INJECT for each attribute, or null to leave the author's own
 * value alone. Throws when a value cannot submit at all.
 *
 * @param {string} tag lowercased owner tag, for the message
 * @param {string | typeof ABSENT | null} formMethod
 * @param {string | typeof ABSENT | null} formEnctype
 * @returns {{ formMethod: string | null, formEnctype: string | null }}
 */
export function resolveBoundSubmitterAttrs(tag, formMethod, formEnctype) {
  const hasMethod = formMethod !== ABSENT && formMethod != null;
  const hasEnctype = formEnctype !== ABSENT && formEnctype != null;
  assertSubmittableSubmitter(
    tag,
    hasMethod ? /** @type string */ (formMethod) : null,
    hasEnctype ? /** @type string */ (formEnctype) : null,
  );
  return {
    formMethod: hasMethod ? null : 'post',
    formEnctype: hasEnctype ? null : 'multipart/form-data',
  };
}

/**
 * Rewrite a bound submitter's START TAG (#1307), the twin of
 * `bindFormActionStartTag`.
 *
 * The identity was already written at the hole, in place of the `formaction=`
 * the author spelled. What is added here is the REST of the submission, because
 * only at the `>` is the whole start tag known and an attribute the author wrote
 * AFTER the binding still counts:
 *   - `formmethod="post"` when absent, so the submission carries a body whatever
 *     the enclosing form declares, or fails to declare.
 *   - `formenctype="multipart/form-data"` when absent, so a file input works on
 *     the no-JS path.
 *
 * That pair is what makes the button self-sufficient, and it is the whole fix
 * for #1307: the renderer no longer has to know anything about the enclosing
 * form, so the cannot-tell case it could never resolve stops existing.
 *
 * No `formaction` is emitted. An empty url is an HTML conformance error, which
 * is the same reason `bindFormActionStartTag` omits `action` rather than writing
 * `action=""`. React does emit `formAction=""` here; WebJs deliberately does
 * not. The consequence, stated so nobody rediscovers it: a bound submitter
 * inside a form that declares its own `action="/x"` submits to `/x`. That is
 * native precedence honoured, the author supplied a target at the form level and
 * none on the button, and the action still RUNS there because the identity
 * travels in the body. Leaving the form's `action` off, the ordinary shape,
 * keeps the submission on the current page.
 *
 * @param {string} startTag the emitted start tag, ending in `>`
 * @param {string} tag lowercased owner tag
 * @param {{ duplicateAction?: boolean, propAttrs?: string[] }} shape
 * @returns {string} the rewritten start tag
 */
export function bindSubmitterStartTag(startTag, tag, shape) {
  assertSubmitterStartTag(startTag, tag, shape);
  const attrs = parseStartTagAttrs(startTag);
  const resolved = resolveBoundSubmitterAttrs(
    tag,
    attrs.has('formmethod') ? attrs.get('formmethod') : ABSENT,
    attrs.has('formenctype') ? attrs.get('formenctype') : ABSENT,
  );
  // The close is `>` or `/>`; `<input>` is void and may be written either way,
  // so keep whichever the author wrote.
  const close = startTag.endsWith('/>') ? '/>' : '>';
  const head = startTag.slice(0, startTag.length - close.length);
  let inject = '';
  if (resolved.formMethod !== null) inject += ` formmethod="${resolved.formMethod}"`;
  if (resolved.formEnctype !== null) inject += ` formenctype="${resolved.formEnctype}"`;
  return head + inject + close;
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
    releaseFormAction(form, method, enctype, shape.propAttrs);
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
 * Element-agnostic on purpose: a bound `<form>` reaches it for `method` /
 * `enctype` and a bound submitter for `formmethod` / `formenctype` (#1307).
 *
 * @param {Element} el
 * @param {string} name
 * @param {string | typeof ABSENT} authored
 * @param {string | null} inject
 */
export function applyResolvedAttr(el, name, authored, inject) {
  if (inject !== null) { el.setAttribute(name, inject); return; }
  // The author's value is authoritative. It is already committed, except for a
  // hole whose value is empty, which some branches express by removing the
  // attribute; put it back so the DOM matches what SSR emitted.
  if (authored !== ABSENT && el.getAttribute(name) !== authored) {
    el.setAttribute(name, /** @type string */ (authored));
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
 * Written through `setAttribute`, not the `value` IDL property, so the live DOM
 * matches SSR's markup byte for byte. Assigning `.value` sets the input's value
 * and its dirty flag but leaves no `value` CONTENT attribute, so a
 * client-created field would serialize without one, and any consumer reading
 * the markup (a morph, an `outerHTML` snapshot, a test) would see a field SSR
 * always writes in full.
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
 * SSR: judge one submitter's emitted START TAG, at its `>`.
 *
 * Called from BOTH state machines so the rules cannot drift between them, which
 * is the failure #1154 already had once (a guard shipped in `renderTemplate`
 * and not in `streamTemplate`). Judged at the `>` rather than at the hole
 * because every input is an attribute the author may have written AFTER the
 * binding.
 *
 * ONE caller shape since #1307: the tag carried a `formaction=${fn}` hole, so
 * the full refusal set applies. The old `bound: false` sweep over every
 * ordinary submitter inside a bound form is gone with Part B, because a plain
 * button's own `formmethod` / `formenctype` is now a legal native override
 * rather than a near-miss.
 *
 * `name` and `value` are judged by COUNT, not by value, because the renderer
 * has already injected its own pair by this point and a browser resolves a
 * duplicate attribute by keeping the first.
 *
 * @param {string} startTag the emitted start tag, ending in `>`
 * @param {string} tag lowercased owner tag
 * @param {{ duplicateAction?: boolean, propAttrs?: string[] }} shape
 * @returns {void}
 */
export function assertSubmitterStartTag(startTag, tag, shape) {
  const attrs = parseStartTagAttrs(startTag);
  const type = attrs.has('type') ? attrs.get('type') : null;

  assertConvergentSubmitter(shape.propAttrs, tag);
  assertSingleSubmitterAction(!!shape.duplicateAction, tag);
  if (attrs.has('formaction')) assertSubmitterHasNoStaticFormAction(tag);
  if (countStartTagAttr(startTag, 'value') > 1) assertSubmitterHasNoValue(tag);
  if (countStartTagAttr(startTag, 'name') > 1) {
    // The renderer injected exactly one `name`, so a second is the author's.
    // Falling back to FORM_ACTION_FIELD matters for an EMPTY author name
    // (`name=${null}` emits `name=""`): the parse keeps the last duplicate, so
    // reading the value back would find `''` and the guard would wave through
    // a tag carrying two `name` attributes. A browser resolves that by keeping
    // the FIRST, so whichever came first would silently win, and SSR would
    // ship markup the client never produces.
    assertSubmitterHasNoName(attrs.get('name') || FORM_ACTION_FIELD, tag, false);
  }
  assertSubmitterType(tag, type);
  if (attrs.has('form')) assertSubmitterHasNoFormAttribute(tag);
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
 * A `.method` / `.enctype` / `.encoding` PROPERTY binding is the exception, and
 * it has to be named rather than inferred. Its write reflects to the content
 * attribute, but it is not an attribute part, so "the template supplies nothing
 * for it" reads true and the removal below would wipe the author's own value on
 * every re-render. The property spelling is refused on a BOUND form, so this is
 * the only path that can meet one.
 *
 * Keeping it does leave the client and SSR holding different attributes for an
 * UNBOUND `<form action=${url} .method=${'post'}>`: SSR drops `.prop` bindings
 * on native elements, so it emits no `method`, while the browser reflects one.
 * That is the ordinary native-property rule applying to an ordinary form, not a
 * form-action divergence, and it is what the same template does with no action
 * hole at all. Removing the attribute would "fix" the mismatch only by
 * destroying the author's binding, which is a worse answer than agreeing with
 * every other native property on the page.
 *
 * @param {HTMLFormElement} form
 * @param {string | typeof ABSENT} method
 * @param {string | typeof ABSENT} enctype
 * @param {string[] | undefined} propAttrs attribute names a property part owns
 */
function releaseFormAction(form, method, enctype, propAttrs) {
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
  const owned = (name) => (propAttrs || []).some((p) => {
    const x = String(p).toLowerCase();
    return x === name || (name === 'enctype' && x === 'encoding');
  });
  if (method === ABSENT && !owned('method')) form.removeAttribute('method');
  if (enctype === ABSENT && !owned('enctype')) form.removeAttribute('enctype');
}

/**
 * The submitter twin of `releaseFormAction`'s attribute half (#1307).
 *
 * When a submitter's action hole stops resolving to an action, the `formmethod`
 * / `formenctype` the framework supplied must come off with the identity, or a
 * released button keeps attributes SSR does not emit for the same template.
 *
 * Recomputed rather than remembered, exactly as the form version is: an
 * attribute is the framework's precisely when the template supplies nothing for
 * it on THIS pass, so there is no bookkeeping to go stale. A `.formMethod` /
 * `.formEnctype` PROPERTY binding is named rather than inferred for the same
 * reason it is on a form: its write reflects to the content attribute but it is
 * not an attribute part, so "the template supplies nothing" reads true and a
 * blind removal would wipe the author's own value on every re-render.
 *
 * @param {Element} el
 * @param {string | typeof ABSENT} formMethod
 * @param {string | typeof ABSENT} formEnctype
 * @param {string[] | undefined} propAttrs attribute names a property part owns
 */
export function releaseSubmitterAttrs(el, formMethod, formEnctype, propAttrs) {
  const owned = (name) => (propAttrs || []).some((p) => String(p).toLowerCase() === name);
  if (formMethod === ABSENT && !owned('formmethod')) el.removeAttribute('formmethod');
  if (formEnctype === ABSENT && !owned('formenctype')) el.removeAttribute('formenctype');
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
 * LAST occurrence wins, matching how a Map collapses duplicate keys. That is
 * deliberately NOT how a browser resolves a duplicate attribute (it keeps the
 * FIRST and drops the rest), so any rule that turns on duplication asks
 * `countStartTagAttr` rather than reading a value back from here.
 *
 * @param {string} startTag
 * @returns {Map<string, string>}
 */
export function parseStartTagAttrs(startTag) {
  return new Map(parseStartTagAttrEntries(startTag));
}

/**
 * Parse emitted start-tag attributes into ordered entries, duplicates kept.
 *
 * The renderers inject `name` and `value` onto a bound submitter themselves, so
 * telling "the author wrote one too" from "this is ours" is a question about
 * how MANY there are, which a Map cannot answer.
 *
 * @param {string} startTag
 * @returns {[string, string][]}
 */
function parseStartTagAttrEntries(startTag) {
  /** @type {[string, string][]} */
  const entries = [];
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
      if (name) entries.push([name.toLowerCase(), '']);
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
    if (name) entries.push([name.toLowerCase(), value]);
  }
  return entries;
}

/**
 * Count occurrences of an attribute in an emitted start tag.
 *
 * A browser resolves duplicate attributes by keeping the FIRST and dropping the
 * rest, so on a bound submitter the count is what separates "the author also
 * wrote one" from "this is the identity we injected". Reading the value back
 * cannot answer it, because the parse collapses duplicates.
 *
 * @param {string} startTag
 * @param {string} wanted
 * @returns {number}
 */
export function countStartTagAttr(startTag, wanted) {
  const name = String(wanted).toLowerCase();
  return parseStartTagAttrEntries(startTag).filter(([attr]) => attr === name).length;
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
export function carriesFunction(val, seen) {
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
 * is the very thing being withheld. It names the supported shapes, because
 * every refused shape here is a near-miss of one of them and the author's next
 * question is what to write instead.
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
