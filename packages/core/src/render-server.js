import { html, isTemplate } from './html.js';
import { BINDING_PREFIXES } from './binding-prefixes.js';
import { escapeText, escapeAttr } from './escape.js';
import {
  assertNotFunctionActionAttr, assertNotFunctionReflectedActionProp,
  assertIdentifiableAction, bindFormActionStartTag, isBoundFormAction, resolveFormActionId,
  assertConvergentBoundForm, assertSubmitterHasNoName, assertSubmitterHasNoValue,
  assertSubmitterHasNoFormAttribute,
  assertSingleSubmitterAction, bindSubmitterStartTag, parseStartTagAttrs,
  isSubmitterReflectedProp, FORM_ACTION_FIELD,
} from './form-action.js';
import { lookup, lookupModuleUrl, allTags } from './registry.js';
import { stylesToString, isCSS } from './css.js';
import { isRepeat } from './repeat.js';
import { isSuspense } from './suspense.js';
import { unsafeHTML, isUnsafeHTML, isLive, isKeyed, isGuard, isTemplateContent, isRef, isCache, isUntil, isAsyncAppend, isAsyncReplace, isWatch } from './directives.js';
import { stringify, parse } from './serialize.js';
import { cspNonce } from './csp-nonce.js';

/**
 * Render a TemplateResult (or any renderable value) to an HTML string.
 *
 * Async by design: template holes may be Promises, components' `render()`
 * methods may be async, and data-fetching inside nested components is
 * awaited before the final string is emitted.
 *
 * If `opts.suspenseCtx` is provided, Suspense boundaries encountered during
 * the render will push `{ id, promise }` into `opts.suspenseCtx.pending`
 * and their fallback HTML is emitted immediately. The caller is responsible
 * for streaming each resolved promise afterwards. Without a suspenseCtx,
 * Suspense still works but we fall back to emitting only the fallback
 * (the promise is dropped: appropriate for static pre-render).
 *
 * @typedef {{ pending: {id: string, promise: Promise<unknown>}[], nextId: number }} SuspenseCtx
 *
 * A boundary's enclosing form scope used to be recorded here and threaded back
 * in (#1207), because the page pipeline in `@webjsdev/server` drains
 * `ctx.pending` and re-renders each resolved child through a FRESH scan with no
 * view of the shell it belongs to, so a `<button formaction=${fn}>` inside a
 * bound form's Suspense boundary read as form-less and was refused. Gone with
 * #1307: a bound submitter carries its own `formmethod` and enctype, so no
 * renderer needs to know what encloses it and there is nothing left to thread.
 *
 * @param {unknown} value
 * @param {{ ssr?: boolean, suspenseCtx?: SuspenseCtx, dev?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function renderToString(value, opts = { ssr: true }) {
  const ctx = opts && opts.suspenseCtx;
  // The server `dev` flag drives prod-silence of SSR error states (#483).
  // `opts.dev` wins; else inherit a `dev` already stamped on the ctx (so a
  // streamed sub-context inherits it); back-fill the ctx so downstream renders
  // sharing it see the same flag. Undefined stays undefined (NODE_ENV fallback).
  const dev = opts && opts.dev !== undefined ? opts.dev : ctx && ctx.dev;
  if (ctx && ctx.dev === undefined && dev !== undefined) ctx.dev = dev;
  const html = await render(value, ctx);
  return opts && opts.ssr === false ? html : await injectDSD(html, ctx, [], dev);
}

/**
 * @param {unknown} value
 * @param {SuspenseCtx} [ctx]
 * @returns {Promise<string>}
 */
async function render(value, ctx) {
  if (value == null || value === false || value === true) return '';
  if (value && typeof /** @type any */ (value).then === 'function') {
    value = await value;
    return render(value, ctx);
  }
  // unsafeHTML: inject raw HTML string without escaping.
  if (isUnsafeHTML(value)) {
    return String(/** @type any */ (value).value ?? '');
  }
  // live() on the server just unwraps and renders the inner value.
  if (isLive(value)) {
    return render(/** @type any */ (value).value, ctx);
  }
  // watch() on the server reads the signal once and inlines the
  // result. Subscription is a client-only concern; the SSR HTML
  // freezes a snapshot of the current value.
  if (isWatch(value)) {
    return render(/** @type any */ (value).signal.get(), ctx);
  }
  // keyed() on the server: render the wrapped template; key is client-only.
  if (isKeyed(value)) {
    return render(/** @type any */ (value).value, ctx);
  }
  // guard() on the server: always invoke the value function (no cache on SSR).
  if (isGuard(value)) {
    return render(/** @type any */ (value).fn(), ctx);
  }
  // templateContent() on the server: emit the template's innerHTML verbatim.
  if (isTemplateContent(value)) {
    const tpl = /** @type any */ (value).template;
    return String(tpl?.innerHTML ?? '');
  }
  // ref() on the server: no-op (no DOM yet). Returns empty string.
  if (isRef(value)) {
    return '';
  }
  // cache() on the server: pass-through to the inner value.
  if (isCache(value)) {
    return render(/** @type any */ (value).value, ctx);
  }
  // until() on the server: render the first synchronous candidate, or
  // await the first Promise to settle when all candidates are Promises.
  // Rejections are swallowed (treated as "no value"); if every candidate
  // rejects, render empty rather than crash the SSR pipeline.
  if (isUntil(value)) {
    const args = /** @type any */ (value).args;
    for (const a of args) {
      if (!a || typeof (/** @type any */ (a).then) !== 'function') {
        return render(a, ctx);
      }
    }
    if (args.length > 0) {
      try {
        const winner = await Promise.race(args.map((p) => Promise.resolve(p).catch(() => undefined)));
        return render(winner, ctx);
      } catch {
        return '';
      }
    }
    return '';
  }
  // asyncAppend / asyncReplace on the server: render empty. Full
  // streaming is a follow-up; pages should use Suspense for streaming.
  if (isAsyncAppend(value) || isAsyncReplace(value)) {
    return '';
  }
  if (Array.isArray(value)) {
    const parts = await Promise.all(value.map((v) => render(v, ctx)));
    return parts.join('');
  }
  if (isRepeat(value)) {
    const r = /** @type any */ (value);
    const parts = await Promise.all(r.items.map((it, i) => render(r.templateFn(it, i), ctx)));
    return parts.join('');
  }
  if (isSuspense(value)) {
    const s = /** @type any */ (value);
    const fallback = await render(s.fallback, ctx);
    if (ctx) {
      const id = `s${ctx.nextId++}`;
      ctx.pending.push({ id, promise: Promise.resolve(s.children) });
      return `<webjs-boundary id="${id}">${fallback}</webjs-boundary>`;
    }
    return fallback;
  }
  if (isTemplate(value)) return renderTemplate(/** @type any */ (value), ctx);
  return escapeText(String(value));
}

/**
 * @param {import('./html.js').TemplateResult} tr
 * @param {SuspenseCtx} [ctx]
 * @returns {Promise<string>}
 */
async function renderTemplate(tr, ctx) {
  const { strings, values } = tr;
  let out = '';
  let state = 'text';
  let attrName = '';
  let attrStart = 0;
  let attrQuote = '';
  let commentDashes = 0;
  let currentTag = '';   // lowercased tag name currently being parsed
  let rawTail = '';      // rolling lowercased tail, tracks </script>/</style>
  let tagStart = -1;     // index in `out` of the `<` opening the current tag
  /** @type {string | null} */
  let pendingActionId = null;  // identity of a bound form action, until the tag closes
  /** @type {string | null} */
  let pendingSubmitterTag = null;  // tag of a bound submitter, until it closes
  // Shapes on the CURRENT start tag that a bound form may not carry (#1155).
  // Collected as the tag is scanned and judged at its `>`, because the action
  // hole may come after them.
  let pendingActionCount = 0;
  /** @type {string[]} */
  let pendingPropAttrs = [];
  /** @type {string[]} */
  let pendingSubmitterProps = [];
  // Whether the tag stream is currently inside a form that BOUND an action
  // (#1207), as THIS scan can see it. Three states, and the third is the point:
  //   'bound'   an enclosing <form> opened here and bound an action
  //   'unbound' an enclosing <form> opened here and bound nothing
  //   'none'    there is conclusively no enclosing <form>
  //   'unknown' there may be one, but this scan cannot see it
  //
  // The last two look alike and must not be merged, which is what a boolean did.
  // A component's template is rendered by a SEPARATE pass (`injectDSD` calls
  // `render` on it), so a `<button formaction=${fn}>` inside a component inside
  // a bound form read as "no form", was refused, and in production vanished
  // from a page that still returned 200. That pass now says 'unknown' and the
  // boundness question is skipped, exactly as the client skips it when it
  // cannot reach the form, so both renderers are best effort in the same place
  // and for the same reason. A top-level scan that simply contains no form
  // stays 'none' and is still refused, because there the answer IS known.
  //
  let isCloseTag = false;

  // A bound `action=${fn}` is committed at its hole, but the edits it implies
  // (forcing `method` / `enctype`, and the hidden identity field) are only
  // possible once the whole start tag is known: an attribute the author wrote
  // AFTER the action hole still counts, and the hidden field belongs INSIDE
  // the form, after the `>`. So the hole records the identity and this runs at
  // the `>`, rewriting the start tag that was just emitted.
  const closeBoundFormTag = () => {
    // Reset per tag whether or not this one was bound, so a later form is never
    // judged on an earlier tag's shapes.
    const propAttrs = pendingPropAttrs;
    const submitterProps = pendingSubmitterProps;
    const duplicateAction = pendingActionCount > 1;
    const submitterTag = pendingSubmitterTag;
    pendingPropAttrs = [];
    pendingSubmitterProps = [];
    pendingActionCount = 0;
    pendingSubmitterTag = null;
    if (pendingActionId != null) {
      assertConvergentBoundForm({ duplicateAction, propAttrs });
      const bound = bindFormActionStartTag(out.slice(tagStart), pendingActionId);
      out = out.slice(0, tagStart) + bound.tag + bound.hidden;
      pendingActionId = null;
    }
    if (submitterTag != null) {
      // #1307: a bound submitter carries its WHOLE submission, so `formmethod`
      // and the enctype are injected onto the button here rather than inherited
      // from a form this scan may not even be able to see. That is what removed
      // the enclosing-form question, and with it the four-state scope tracking
      // that could never answer it for a button inside a component.
      out = out.slice(0, tagStart)
        + bindSubmitterStartTag(out.slice(tagStart), submitterTag, { duplicateAction, propAttrs: submitterProps });
    }
  };
  // #1155: a `.method` / `.enctype` / `.encoding` prop on a form is dropped
  // here but applied for real in the browser, where all three are reflected IDL
  // attributes, so a bound form carrying one submits differently with JS than
  // without it. Recorded and refused at the `>`, once the tag's action hole is
  // known.
  const notePropAttr = (name, tag) => {
    const t = String(tag).toLowerCase();
    if (t === 'button' || t === 'input') {
      // #1207: the submitter twin. `name` / `value` / `formAction` / `formMethod`
      // / `formEnctype` all reflect on a submitter, so a `.prop` spelling is
      // dropped here and written to the attribute in the browser.
      if (isSubmitterReflectedProp(name)) pendingSubmitterProps.push(String(name));
      return;
    }
    if (t !== 'form') return;
    let n = String(name).toLowerCase();
    if (n === 'encoding') n = 'enctype';
    if (n === 'method' || n === 'enctype') pendingPropAttrs.push(String(name));
  };
  const noteActionHole = (name, tag) => {
    const t = String(tag).toLowerCase();
    const n = String(name).toLowerCase();
    if ((t === 'form' && n === 'action') ||
        ((t === 'button' || t === 'input') && n === 'formaction')) {
      pendingActionCount += 1;
    }
  };

  // Every `>` in a tag state funnels through here, so the bound-form bookkeeping
  // stays in one place rather than at five call sites.
  //
  // `allowRawtext` is NOT a preference. Only two of those five call sites ever
  // entered rawtext: the `tag-name` and `in-tag` exits. The three attribute
  // exits (`attr-name`, `after-eq`, `attr-unquoted`) always forced `text`, so
  // `<script defer>` and `<style media=print>`, whose start tags end on a bare
  // or unquoted attribute, escaped their bodies. Switching them to rawtext here
  // would silently turn `<script defer>${userInput}</script>` from escaped into
  // raw script, which is an XSS mitigation this change has no business
  // touching. Whether that escaping is the RIGHT behaviour is a separate
  // question from #1207; this preserves it exactly.
  const handleTagEnd = (allowRawtext) => {
    closeBoundFormTag();
    isCloseTag = false;
    state = allowRawtext && isRawtextTag(currentTag) ? 'rawtext' : 'text';
    if (state === 'rawtext') rawTail = '';
  };

  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      switch (state) {
        case 'text':
          out += c;
          if (c === '<') { state = 'tag-open'; tagStart = out.length - 1; isCloseTag = false; }
          break;
        case 'tag-open':
          out += c;
          if (c === '!') state = 'bang-1';
          else if (c === '/') { state = 'tag-name'; currentTag = ''; isCloseTag = true; }
          else if (/[a-zA-Z]/.test(c)) { state = 'tag-name'; currentTag = c.toLowerCase(); }
          else state = 'text';
          break;
        case 'bang-1':
          out += c;
          state = c === '-' ? 'bang-dash' : 'tag-name';
          break;
        case 'bang-dash':
          out += c;
          if (c === '-') { state = 'comment'; commentDashes = 0; }
          else state = 'tag-name';
          break;
        case 'comment':
          out += c;
          if (c === '-') commentDashes += 1;
          else if (c === '>' && commentDashes >= 2) { state = 'text'; commentDashes = 0; }
          else commentDashes = 0;
          break;
        case 'tag-name':
          out += c;
          if (c === '>') {
            handleTagEnd(true);
          } else if (/\s/.test(c)) state = 'in-tag';
          else currentTag += c.toLowerCase();
          break;
        case 'in-tag':
          out += c;
          if (c === '>') {
            handleTagEnd(true);
          } else if (!/\s/.test(c) && c !== '/') {
            state = 'attr-name';
            attrName = c;
            attrStart = out.length - 1;
          }
          break;
        case 'rawtext':
          out += c;
          rawTail = (rawTail + c.toLowerCase()).slice(-9);
          if (rawTail.endsWith('</script>') || rawTail.endsWith('</style>')) {
            state = 'text';
            rawTail = '';
            currentTag = '';
          }
          break;
        case 'attr-name':
          if (c === '=') { state = 'after-eq'; out += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; out += c; }
          else if (c === '>') { state = 'text'; attrName = ''; out += c; handleTagEnd(false); }
          else { attrName += c; out += c; }
          break;
        case 'after-eq':
          if (c === '"' || c === "'") { state = 'attr-quoted'; attrQuote = c; out += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; out += c; }
          else if (c === '>') { state = 'text'; attrName = ''; out += c; handleTagEnd(false); }
          else { state = 'attr-unquoted'; out += c; }
          break;
        case 'attr-unquoted':
          if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; out += c; }
          else if (c === '>') { state = 'text'; attrName = ''; out += c; handleTagEnd(false); }
          else out += c;
          break;
        case 'attr-quoted':
          out += c;
          if (c === attrQuote) { state = 'in-tag'; attrName = ''; }
          break;
      }
    }

    if (i < values.length) {
      let val = values[i];
      // Resolve promises anywhere in the value graph.
      if (val && typeof /** @type any */ (val).then === 'function') {
        val = await val;
      }
      if (state === 'comment') {
        // Holes inside <!-- comments --> are emitted raw (no escaping; comments
        // are inert and not rendered by browsers).
        out += String(val ?? '');
        commentDashes = 0;
      } else if (state === 'rawtext') {
        // Inside <script> / <style>: emit the value as-is (no HTML escaping).
        // Author is responsible for not closing the tag with user-controlled
        // data: the usual caveat for CSS/JS interpolation.
        out += String(val ?? '');
        rawTail = '';
      } else if (state === 'text') {
        out += await render(val, ctx);
      } else if (state === 'after-eq') {
        const prefix = attrName[0];
        const name = attrName.slice(1);
        const kind = BINDING_PREFIXES[prefix];
        if (kind === 'event') {
          // Event listener. Client-only behaviour, drop at SSR.
          out = out.slice(0, attrStart);
          state = 'in-tag';
          attrName = '';
        } else if (kind === 'prop') {
          // Property binding. Only meaningful on custom elements (which
          // have a hyphen in the tag name and a WebComponent subclass
          // that knows how to apply + strip data-webjs-prop-* on
          // hydration). For native elements (`<input .value=${v}>`)
          // the attribute would be dead weight (nothing consumes it),
          // so we drop it the same way the old behaviour did. The
          // client renderer still applies the property when the
          // template runs in the browser, which is the only place a
          // page-level `.prop` on a native element could have set the
          // property to begin with.
          out = out.slice(0, attrStart);
          // `<webjs-suspense .fallback=${html`...`}>` (#471). This element is
          // defined only in the browser, so the injectDSD walk skips it
          // (`lookup(tag)` finds no class) and no server-side instance runs
          // consumePropAttrs. A normal data-webjs-prop-* binding would then
          // land at connectedCallback, too late for the streaming placeholder.
          // So render the fallback to HTML now and carry it as
          // data-webjs-fallback, which the injectDSD streaming pre-pass reads
          // as the boundary placeholder. (The value itself would serialize
          // fine: a TemplateResult is a plain {strings, values} object.)
          if (currentTag === 'webjs-suspense' && name === 'fallback') {
            const fbHtml = await render(val, ctx);
            out += `data-webjs-fallback="${escapeAttr(fbHtml)}"`;
            state = 'in-tag';
            attrName = '';
            continue;
          }
          if (!currentTag.includes('-')) {
            // A native element's `.prop` is dropped at SSR, so this path never
            // leaked here. It still refuses a function where the property is a
            // REFLECTED IDL attribute (`.action` on a form, `.formAction` on a
            // button or input), so the rule does not depend on which renderer
            // sees it first: the client sets that property for real and the
            // reflection writes the source into the DOM. A page that renders
            // clean on the server and throws on hydration is a worse failure
            // than one that refuses at the earliest point. Elsewhere the
            // property is a plain expando that reflects nothing, so refusing
            // it would be a false positive.
            assertNotFunctionReflectedActionProp(val, name, currentTag);
            notePropAttr(name, currentTag);
            state = 'in-tag';
            attrName = '';
            continue;
          }
          // `undefined` has no meaningful HTML representation. Drop
          // silently so the consumer falls back to its constructor
          // default. `null` is preserved because it's a real value
          // distinct from "not set".
          if (val === undefined) {
            state = 'in-tag';
            attrName = '';
            continue;
          }
          try {
            const encoded = await stringify(val);
            out += `data-webjs-prop-${kebabCase(name)}="${escapeAttr(encoded)}"`;
          } catch (e) {
            // Unserializable value (function, class instance with
            // private state, DOM node, etc.). Drop with a warning so
            // SSR does not crash. Same constraint as Next.js RSC.
            console.warn(
              `[webjs] property binding .${name} has an unserializable `
              + `value during SSR. Dropping. The browser will see the `
              + `property as undefined. Detail: ${e && e.message}`
            );
          }
          state = 'in-tag';
          attrName = '';
        } else if (kind === 'bool') {
          // Never leaked (a boolean binding stringifies nothing), but
          // `?action=${fn}` is meaningless in every case and refusing it keeps
          // the rule true for every sigil rather than only the quoted ones.
          assertNotFunctionActionAttr(val, name, currentTag);
          out = out.slice(0, attrStart);
          if (val) out += `${name}=""`;
          state = 'in-tag';
          attrName = '';
        } else if (isBoundFormAction(val, attrName, currentTag)) {
          noteActionHole(attrName, currentTag);
          if (currentTag === 'form') {
            // #1155: the form-level binding. Drop the `action=` attribute
            // entirely so the form posts to the page's own url (an omitted
            // attribute, not `action=""`, which the spec calls a conformance
            // error), and remember the identity so the `>` can force the
            // submission attributes and emit the hidden field.
            pendingActionId = assertIdentifiableAction(await resolveFormActionId(val), currentTag);
            // Trailing whitespace goes with the attribute: every injected
            // attribute carries its own leading space, so keeping the old one
            // would double it in the emitted tag.
            out = out.slice(0, attrStart).replace(/\s+$/, '');
          } else {
            // #1207: the submitter binding. The identity replaces the
            // `formaction=` hole IN PLACE with the button's own name/value
            // pair, the one channel a browser submits for the pressed button
            // alone. No `formaction` url is emitted, so the submission still
            // targets the page and the form-level identity is simply overridden
            // by this later entry.
            //
            // Refused here rather than at the `>` only where the answer cannot
            // change later: boundness of the ENCLOSING form is already decided
            // (its start tag is emitted), and an attribute written BEFORE the
            // hole is already in `out`. Everything else waits for the close,
            // where `assertSubmitterStartTag` sees the whole tag.
            // A second binding hole on this same tag, refused here so the
            // author gets the duplicate message rather than a confusing
            // complaint about the `name` the FIRST hole just injected.
            assertSingleSubmitterAction(pendingSubmitterTag != null, currentTag);
            const attrs = parseStartTagAttrs(out.slice(tagStart));
            if (attrs.has('name')) assertSubmitterHasNoName(attrs.get('name') || '', currentTag, false);
            if (attrs.has('value')) assertSubmitterHasNoValue(currentTag);
            if (attrs.has('form')) assertSubmitterHasNoFormAttribute(currentTag);
            const subId = assertIdentifiableAction(await resolveFormActionId(val), currentTag);
            pendingSubmitterTag = currentTag;
            out = out.slice(0, attrStart) + `name="${FORM_ACTION_FIELD}" value="${escapeAttr(subId)}"`;
          }
          state = 'in-tag';
          attrName = '';
        } else {
          // A second `action` hole that resolved to a plain url still COUNTS,
          // so the duplicate refusal fires whatever the values happen to be.
          noteActionHole(attrName, currentTag);
          // #1154: never stringify a function into action=/formaction= (it
          // would serialize a server action's source into the served HTML).
          assertNotFunctionActionAttr(val, attrName, currentTag);
          out += `"${escapeAttr(String(val ?? ''))}"`;
          state = 'in-tag';
          attrName = '';
        }
      } else if (state === 'attr-quoted' || state === 'attr-unquoted') {
        // Same guard for a hole inside a quoted/unquoted value, the
        // `action="${fn}"` and mixed `action="/x/${fn}"` shapes (#1154).
        assertNotFunctionActionAttr(val, attrName, currentTag);
        out += escapeAttr(String(val ?? ''));
      }
    }
  }
  return out;
}

// Browser-only names whose absence during SSR produces a recognisable error.
// Mirrors the `no-browser-globals-in-render` webjs check rule, which catches
// these at edit time; this turns the runtime SSR crash into the same guidance.
const SSR_BROWSER_GLOBALS = new Set([
  'document', 'window', 'localStorage', 'sessionStorage', 'navigator',
  'matchMedia', 'requestAnimationFrame', 'getComputedStyle',
  'IntersectionObserver', 'MutationObserver', 'ResizeObserver',
]);
// Attribute methods (get/set/has/remove/toggleAttribute), the event methods
// (add/removeEventListener, dispatchEvent), and attachInternals are backed by
// the server-side element shim and work at SSR, so they are NOT listed here.
// What remains is the genuinely browser-only HTMLElement surface that still
// has no server stand-in and throws at SSR.
const SSR_HTMLELEMENT_METHODS = new Set([
  'attachShadow', 'querySelector', 'querySelectorAll',
  'getBoundingClientRect', 'focus', 'blur', 'scrollIntoView',
]);

/**
 * If `e` is the recognisable failure of touching a browser-only API during
 * SSR (a `ReferenceError` for a browser global, or a `TypeError` calling an
 * HTMLElement method that does not exist on the bare server-side instance),
 * return an actionable, member-naming hint; otherwise null.
 * @param {unknown} e
 * @returns {string | null}
 */
function browserMemberHint(e) {
  const msg = e && typeof (/** @type any */ (e).message) === 'string' ? /** @type any */ (e).message : '';
  // Match on a word boundary, NOT end-of-string: V8 (Node) ends the message at
  // "is not defined" / "is not a function", but JSC (Bun) appends a detail
  // clause (e.g. ". (In '({}).querySelector(\"p\")', '...' is undefined)"), so an
  // anchored `$` would miss the Bun message and drop the actionable hint.
  let m = /^(\w+) is not defined\b/.exec(msg);
  if (e instanceof ReferenceError && m && SSR_BROWSER_GLOBALS.has(m[1])) {
    return `\`${m[1]}\` is a browser-only global and is undefined during SSR.`;
  }
  m = /\.(\w+) is not a function\b/.exec(msg);
  if (e instanceof TypeError && m && SSR_HTMLELEMENT_METHODS.has(m[1])) {
    return `\`${m[1]}\` is an HTMLElement method that does not exist on the server-side component instance during SSR.`;
  }
  return null;
}

/** True in a production build (no dev error surfacing). */
function isProd() {
  return typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production';
}

/**
 * Default component-scoped error state for an async/sync render that threw
 * during SSR, used when the component does not define renderError() (#469).
 * Dev surfaces the tag + message loudly so the failure is obvious; prod
 * renders an empty (silent, isolated) element so no internal detail leaks.
 *
 * The prod-silence signal is the SERVER's `dev` flag, threaded through the SSR
 * render context (#483). WebJs keys prod on the CLI `dev` flag, not `NODE_ENV`,
 * and `webjs start` does not export `NODE_ENV=production`, so a bare prod launch
 * would otherwise leak the message. When `dev` is undefined (a context-free
 * `renderToString` with no server signal, e.g. a bare unit test) it falls back
 * to `isProd()` / `NODE_ENV`, preserving the prior behaviour for that path.
 *
 * @param {string} tag
 * @param {Error} err
 * @param {boolean} [dev]  server dev flag; undefined falls back to NODE_ENV
 * @returns {unknown} a TemplateResult (dev) or '' (prod)
 */
function defaultSSRErrorTemplate(tag, err, dev) {
  const surface = dev === undefined ? !isProd() : !!dev;
  if (!surface) return '';
  const msg = err && err.message ? err.message : String(err);
  return html`<div data-webjs-error="${tag}" style="border:1px solid #f5c2c7;background:#f8d7da;color:#842029;padding:8px 12px;border-radius:6px;font:13px/1.4 system-ui,sans-serif">
    <strong>&lt;${tag}&gt; failed to render</strong>
    <div style="margin-top:4px;white-space:pre-wrap">${msg}</div>
  </div>`;
}

/**
 * Index just past the end of the comment starting at `start`, or -1 if it is
 * unterminated. Shared so every scanner that has to decide where a comment
 * stops agrees, including on the spec short forms.
 *
 * @param {string} html
 * @param {number} start  index of the `<` of `<!--`
 * @returns {number}
 */
function endOfComment(html, start) {
  let p = start + 4;
  // `<!-->` and `<!--->` are comments whose data is empty (spec short forms).
  if (html[p] === '>') return p + 1;
  if (html.startsWith('->', p)) return p + 2;
  while (p < html.length) {
    // `--!>` is the spec's "abrupt closing" form and closes just like `-->`.
    if (html.startsWith('-->', p)) return p + 3;
    if (html.startsWith('--!>', p)) return p + 4;
    p += 1;
  }
  return -1;
}

/**
 * Index of the `</script` that really closes a `<script>` whose content starts
 * at `from`, or -1 when unterminated (#1134).
 *
 * Script data is not plain raw text: once the content contains `<!--` followed
 * by `<script`, the tokenizer is in the script-data-double-escaped state, where
 * a `</script>` is TEXT (it only steps back to the escaped state) and the
 * element ends at the NEXT `</script>`. The legacy comment-wrapped inline
 * script that document.writes a script tag is the pattern that produces this.
 * Stopping at the first `</script>` there re-opened the original #1128 bug in
 * the one element the scanner most explicitly claims to handle.
 *
 * @param {string} html
 * @param {number} from  index just past the opening tag's `>`
 * @returns {number}
 */
function endOfScriptContent(html, from) {
  const re = /<!--|-->|<\/script(?=[\s/>])|<script(?=[\s/>])/gi;
  re.lastIndex = from;
  let escaped = false;
  let dbl = false;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = m[0];
    if (t === '<!--') {
      // The token's own trailing `--` puts the tokenizer in a dash-dash state
      // REGARDLESS of what state it was in (`<!` are inert bytes in escaped and
      // double-escaped states too), and every dash-dash state exits straight
      // back to plain script data on `>`. So `<!-->`, `<!--->`, and any dash
      // run followed by `>` clear BOTH flags: entering fresh it cancels the
      // escape before it starts, and inside an escaped or double-escaped body
      // it is the exit a browser honours, after which the element ends at the
      // next `</script>`.
      let q = m.index + 4;
      while (html[q] === '-') q += 1;
      if (html[q] === '>') { escaped = false; dbl = false; re.lastIndex = q + 1; }
      else if (!escaped) escaped = true;
    }
    else if (t === '-->') { escaped = false; dbl = false; }
    else if (t[1] === '/') {
      if (dbl) dbl = false;
      else return m.index;
    } else if (escaped) dbl = true;
  }
  return -1;
}

/**
 * Byte ranges of `html` where a tag-shaped match is NOT an element (#1128).
 *
 * The element scanners below match tags with a flat regex over already-
 * assembled markup, which has no notion of an HTML context. So a registered tag
 * name written inside a comment used to be constructed and rendered as a real
 * element, and the replacement consumed the rest of the comment INCLUDING its
 * closing `-->`, leaving an unterminated comment that swallowed every following
 * byte. Whether it happened depended on whether the name in the comment was a
 * registered component, which is what made it look random.
 *
 * This is a single left-to-right pass rather than a search for `<!--`, because
 * the naive version introduces failures worse than the bug: an `<!--` inside an
 * attribute value (`title="use <!-- here"`) or inside RCDATA would open a region
 * that never closes, and every component after it would silently stop rendering.
 * Deciding that requires knowing the context, which means tokenizing, so the
 * pass tracks the same states the HTML parser does for these purposes:
 *
 * - **Comments**, including the spec's short forms. `<!-->` and `<!--->` close
 *   immediately, `--!>` closes as well as `-->`, and an unterminated comment
 *   runs to EOF, exactly as a browser would treat the same bytes.
 * - **Markup declarations and bogus comments** (`<!doctype …>`, `<![CDATA[…]]>`),
 *   which end at the next `>`.
 * - **Tags**, consumed with their quoted attribute values, so `<` and `<!--`
 *   inside an attribute are inert rather than context-changing.
 * - **Text-only elements**, whose content the HTML tokenizer never reads as
 *   markup: raw text (`script`, `style`, `iframe`, `xmp`, `noembed`,
 *   `noframes`, `plaintext`) and RCDATA (`textarea`, `title`). Their content is
 *   returned as a skip range too, because a component tag inside a `<style>`
 *   comment or an `<iframe>` fallback hit the identical markup-destroying path,
 *   so excluding them would leave half the bug live.
 *
 *   Two deliberate exclusions. `<template>` content IS parsed and legitimately
 *   carries components (Declarative Shadow DOM and the streamed swap templates
 *   both depend on that). `<noscript>` content is parsed as markup when
 *   scripting is disabled, which for a progressive-enhancement framework is the
 *   case that matters, so components inside it must keep rendering.
 *
 * @param {string} html
 * @returns {[number, number][]} ascending, non-overlapping `[start, end)` pairs
 */
function inertRanges(html) {
  /** @type {[number, number][]} */
  const ranges = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = endOfComment(html, lt);
      const stop = end === -1 ? n : end;
      ranges.push([lt, stop]);
      i = stop;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      // Doctype / bogus comment / processing instruction: ends at the next `>`.
      const close = html.indexOf('>', lt);
      const end = close === -1 ? n : close + 1;
      ranges.push([lt, end]);
      i = end;
      continue;
    }
    const name = /^<\/?([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64));
    if (!name) {
      // `</` followed by anything that is not an ASCII letter is the third
      // bogus-comment form (`</1`, `</<`, `</ `), which the spec also runs to
      // the next `>`. Without this branch the bytes after it are scanned as
      // markup and a tag inside gets instantiated, which is the original bug.
      if (html.startsWith('</', lt)) {
        const close = html.indexOf('>', lt);
        const end = close === -1 ? n : close + 1;
        ranges.push([lt, end]);
        i = end;
        continue;
      }
      i = lt + 1;
      continue;
    }
    // Consume the tag, honouring quoted attribute values so a `<` or `<!--`
    // inside one cannot be mistaken for markup.
    //
    // A quote only OPENS a value when it directly follows `=`. That condition
    // is load-bearing rather than pedantic: `escapeAttr` does not escape `'`,
    // so an interpolated apostrophe in a single-quoted attribute emits three
    // unbalanced quotes (`title='don't'`). Treating every quote as a delimiter
    // left the scanner stuck inside a value to EOF, which returned a truncated
    // range list and silently re-enabled this whole bug for the rest of the
    // page. A browser recovers at the `>`, and so does this: after the value
    // closes, the stray `'` is just an attribute-name character.
    let p = lt + 1;
    let quote = '';
    // `expectValue` is set by `=` and cleared by the first non-whitespace
    // character after it. Only THAT character can open a quoted value, which is
    // what the spec does: before-attribute-value reconsumes anything else in
    // attribute-value-unquoted state. Keying off "the previous character was
    // `=`" instead re-opens the hole on `<a title==">`, where the `"` is an
    // ordinary value character; an odd quote count then ran the scan to EOF and
    // returned one giant inert range, silently disabling this whole fix for the
    // rest of the page.
    let expectValue = false;
    // Unquoted values need their own state for two reasons the spec spells out
    // and a simpler scan gets wrong: `>` ends the tag from here (so `attr=>` is
    // a missing value, not a value of `>`), and `/` is an ordinary value
    // character, so an unquoted URL ending in `/` is NOT a self-closing solidus.
    let inUnquoted = false;
    let selfClosing = false;
    while (p < n) {
      const c = html[p];
      const isSpace = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '>') {
        // Checked before the value branches: a `>` arriving where a value was
        // expected terminates the tag (`<a href=>`). Consuming it as a value
        // character ran the scan on to the NEXT `>`, which swallowed the real
        // tag end and re-armed the original bug for what followed.
        selfClosing = !inUnquoted && html[p - 1] === '/';
        p += 1;
        break;
      } else if (expectValue) {
        // The first non-whitespace character after `=` decides the value form.
        if (!isSpace) {
          if (c === '"' || c === "'") quote = c;
          else inUnquoted = true;
          expectValue = false;
        }
      } else if (inUnquoted) {
        if (isSpace) inUnquoted = false;
      } else if (c === '=') {
        expectValue = true;
      }
      p += 1;
    }
    // The tag's interior is not markup either. A component tag written inside
    // an attribute value (`title="renders a <my-card> element"`) was otherwise
    // instantiated in place, destroying the rest of the document exactly like
    // the comment case. Start at lt+1 so the tag's OWN opening `<` still
    // matches; only what is nested inside it is inert.
    if (p > lt + 1) ranges.push([lt + 1, p]);
    i = p;
    const tag = name[1].toLowerCase();
    const isClose = html[lt + 1] === '/';
    // A self-closing start tag has no content to skip. In HTML the `/` is
    // ignored, but in SVG and MathML foreign content it genuinely closes the
    // element, and `<svg><title/></svg>` otherwise finds no `</title`, runs the
    // range to EOF, and makes every component in the rest of the document
    // inert. Honouring `/>` costs only the malformed-HTML case (`<style/>`,
    // already broken authoring) and fails in the direction where components
    // keep rendering rather than silently vanishing.
    if (!isClose && !selfClosing && isTextOnlyTag(tag)) {
      // Everything up to the matching close tag is text, not markup.
      let contentEnd;
      if (tag === 'plaintext') {
        // `<plaintext>` has no end tag at all: the rest of the document is text.
        contentEnd = n;
      } else if (tag === 'script') {
        // Script data has the double-escaped state (#1134), so its real end is
        // not necessarily the first `</script`.
        const end = endOfScriptContent(html, p);
        contentEnd = end === -1 ? n : end;
      } else {
        const close = new RegExp(`</${tag}(?=[\\s/>])`, 'i').exec(html.slice(p));
        contentEnd = close ? p + close.index : n;
      }
      if (contentEnd > p) ranges.push([p, contentEnd]);
      i = contentEnd;
    }
  }
  return ranges;
}

/**
 * Random-access membership test over ascending, non-overlapping ranges, for
 * callers whose queries are NOT monotonic (findClosingTagInString resets its
 * regex cursors backward while pairing opens with closes). O(ranges) per call;
 * monotonic callers use `inertAt` below instead.
 *
 * @param {[number, number][]} ranges
 * @param {number} index
 * @returns {boolean}
 */
function inRanges(ranges, index) {
  for (const [start, end] of ranges) {
    if (start > index) return false;
    if (index < end) return true;
  }
  return false;
}

/**
 * A left-to-right membership test over ascending, non-overlapping ranges.
 *
 * Returns a function that answers "is this index inert?" and REMEMBERS how far
 * it has walked, so a caller scanning matches in increasing order pays O(ranges)
 * across the whole scan instead of O(ranges) per match. Restarting each time is
 * an O(tags x components) term, which is measurable on a large page: holding a
 * document at 40k tags and raising the component count adds hundreds of
 * milliseconds that the cursor removes.
 *
 * The cursor only ever moves forward, so callers MUST query in non-decreasing
 * index order. All three call sites do (`matchAll`, and the two loops that
 * consume their input left to right). A caller that needs random access should
 * scan `ranges` directly rather than reusing this.
 *
 * @param {[number, number][]} ranges
 * @returns {(index: number) => boolean}
 */
function inertAt(ranges) {
  let cursor = 0;
  return (index) => {
    while (cursor < ranges.length && ranges[cursor][1] <= index) cursor += 1;
    if (cursor >= ranges.length) return false;
    return index >= ranges[cursor][0];
  };
}

/**
 * Scan an HTML string for registered custom elements and inject
 * Declarative Shadow DOM (`<template shadowrootmode="open">`).
 * Awaits each component's render() so async components are fully resolved.
 *
 * @param {string} html
 * @param {SuspenseCtx} [ctx]
 * @param {any[]} [ancestors]
 * @param {boolean} [dev]  server dev flag, threaded to the per-component error
 *   template for prod-silence (#483); undefined falls back to NODE_ENV
 * @returns {Promise<string>}
 */
async function injectDSD(html, ctx, ancestors = [], dev) {
  // Resolve <webjs-suspense> boundaries first (#471): in a streaming context
  // each becomes a fallback placeholder now, with its children pushed for
  // out-of-order streaming; without a streaming context the children render
  // inline (blocking). Run before the custom-element walk so a streamed
  // boundary's children leave the main flow and are not double-processed.
  html = await processSuspenseElements(html, ctx, ancestors, dev);
  const tags = allTags();
  if (!tags.length) return html;
  // Sort longest tag name first so the regex alternation tries the most
  // specific match before its prefixes. Combined with the (?=[\s>/])
  // lookahead this prevents `my-card` from spuriously matching the prefix
  // of `<my-card-2>` (or `slot-ssr-1` matching `<slot-ssr-14>`, etc).
  // Attribute section is "anything that isn't `>`, with quoted values as a
  // single unit" so slashes in URL-valued attrs (e.g. then="/dashboard") don't
  // prevent the match. Non-greedy so self-closing `/>` still captures into the
  // third group.
  const sortedTags = [...tags].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `<(${sortedTags.map(escapeRegex).join('|')})(?=[\\s>/])((?:"[^"]*"|'[^']*'|[^>])*?)(/?)>`,
    'g'
  );
  /** @type {{start:number, end:number, text:string}[]} */
  const edits = [];
  // A tag name inside a comment, a script, a style, RCDATA, or another tag's
  // attribute value is text, not an element (#1128).
  const inert = inertRanges(html);
  const isInert = inertAt(inert);
  for (const m of html.matchAll(pattern)) {
    const [match, tag, attrs, selfClose] = m;
    const Cls = lookup(tag);
    if (!Cls) continue;
    if (isInert(m.index)) continue;
    // Track which custom elements actually appeared: used by SSR to emit
    // `<link rel="modulepreload">` hints for their module URLs.
    if (ctx && ctx.usedComponents) ctx.usedComponents.add(tag);
    let opening = selfClose ? `<${tag}${attrs}>` : match;
    // Hoisted so the per-component error boundary (#469) can ask the failed
    // instance for its renderError() output.
    let instance = null;
    try {
      const isShadow = /** @type any */ (Cls).shadow === true;
      instance = new /** @type any */ (Cls)();
      // Thread the ancestor chain (the enclosing custom-element instances)
      // so the server element shim's closest() can resolve a parent at SSR.
      // Set before performServerUpdate so a willUpdate() that reads a parent
      // via closest() sees the chain. Each child recursion below extends it.
      instance.__ssrTag = tag;
      instance.__ssrAncestors = ancestors;
      const attrMap = parseAttrs(attrs);
      // Decode `data-webjs-prop-*` attributes first (rich-typed values
      // emitted for `.prop=${val}` bindings in the parent template),
      // then coerce the ordinary string attributes by `static
      // properties` type. Property bindings take priority on a name
      // collision because they preserve the original JS reference.
      const propValues = consumePropAttrs(attrMap);
      // Names already present in the source opening tag (including the
      // data-webjs-prop-* bindings, which were stripped from attrMap above
      // but remain in the emitted `attrs` string). Reflected/added
      // attributes are appended only when their name is NOT already here, so
      // existing output stays byte-identical when nothing reflects.
      const presentAttrNames = new Set(Object.keys(parseAttrs(attrs)).map((n) => n.toLowerCase()));
      // Seed the server attribute shim so `this.getAttribute(...)` /
      // `this.hasAttribute(...)` in willUpdate / render read the source
      // attributes (a lit muscle-memory pattern) instead of reading empty.
      seedServerAttrs(instance, attrMap);
      applyAttrsToInstance(instance, attrMap, Cls);
      for (const [k, v] of Object.entries(propValues)) instance[k] = v;
      // Extract the authored inner HTML BEFORE the render (the injectDSD
      // reorder): the source scan needs no render output, and hoisting it lets
      // the light-DOM branch below project the authored children into the
      // rendered slots. The shadow branch is a read-only peek (its authored
      // children stay in place for native projection, and its edit keeps the
      // old end).
      let authoredInner = '';
      let closeEnd = m.index + match.length;
      if (!selfClose) {
        const innerStart = m.index + match.length;
        const closeIdx = findClosingTagInString(html, innerStart, tag, inert);
        if (closeIdx !== -1) {
          authoredInner = html.slice(innerStart, closeIdx);
          const closeRe = new RegExp(`</${escapeRegex(tag)}\\s*>`, 'i');
          const tail = html.slice(closeIdx);
          const closeMatch = closeRe.exec(tail);
          const closeLen = closeMatch ? closeMatch[0].length : `</${tag}>`.length;
          closeEnd = closeIdx + closeLen;
        } else {
          // Unclosed in source. Take rest of html as authored content
          // and synthesize a closing tag on output.
          authoredInner = html.slice(innerStart);
          closeEnd = html.length;
        }
      }
      const partitioned = partitionAuthoredBySlot(authoredInner);
      // Run the pre-render lifecycle (willUpdate, controllers' hostUpdate,
      // then reflect reflect:true props) so derived state computed there is
      // correct in the SSR'd HTML, matching how lit runs the update cycle at
      // SSR. WebComponent instances expose performServerUpdate; bare
      // Base-extending kit components (no lifecycle) do not, so it is guarded.
      if (typeof instance.performServerUpdate === 'function') instance.performServerUpdate();
      let tpl = instance.render ? instance.render() : '';
      if (tpl && typeof tpl.then === 'function') tpl = await tpl;
      // Surface attributes the component set up to and including render()
      // that were not already in the source tag: reflected reflect:true
      // props, an explicit this.setAttribute in the constructor / willUpdate,
      // or a host-attribute mutation inside render() itself (a light-DOM
      // compound-component pattern, e.g. this.dataset.state / this.className /
      // this.hidden on the host). Reading after render() captures all three.
      // Appending keeps the original tag byte-identical when nothing changed.
      opening = appendReflectedAttrs(opening, instance, presentAttrNames);
      // Mark LIGHT-DOM component hosts so the framework default
      // `@layer webjs-host { :where([data-wj-host]) { display: block } }`
      // (injected once in the document head) applies at first paint. A custom
      // element is `display:inline` by default, which collapses a component used
      // as a block container (a board / card) until an author style intervenes.
      // The low-priority `@layer` keeps it overridable by any author style,
      // INCLUDING Tailwind's layered utilities (`class="flex"` wins). Emitted
      // uniformly regardless of elision, so the elision on-vs-off differential is
      // preserved.
      //
      // Shadow hosts are NOT marked: a document-level rule targeting the host
      // beats the shadow tree's own `:host { display: … }` (the encapsulation-
      // context criterion outranks both layer and specificity for normal
      // declarations), so marking them would silently override the shadow
      // author's `:host` display. Shadow components set their own host display
      // via `:host` in `static styles` (the idiomatic mechanism), which the
      // framework must not clobber.
      if (!isShadow) opening = withHostMarker(opening);
      // Render the template to HTML. injectDSD recurses on the result so
      // nested custom elements (e.g. <theme-toggle> inside <blog-shell>)
      // get their own DSD pass.
      // 'unknown' for the form scope (#1207): this is a SEPARATE render pass
      // over one component's own template, driven by walking the already-emitted
      // HTML, so it has no idea whether the host tag sits inside a bound
      // `<form>`. Passing the default 'none' claimed there was no form at all,
      // which refused a perfectly good `<button formaction=${fn}>` in a
      // component inside a bound form and, because component SSR errors are
      // isolated, made the button vanish from a page that still returned 200.
      const rawInner = await render(tpl, ctx, 'unknown');

      if (isShadow) {
        // Shadow DOM: native <slot> stays as-is in the DSD template. The
        // browser handles projection from the host's light-DOM children
        // into the shadow tree natively. No framework substitution here.
        const innerProcessed = await injectDSD(rawInner, ctx, [...ancestors, instance], dev);
        const rawStyles = /** @type any */ (Cls).styles;
        const styleList = Array.isArray(rawStyles) ? rawStyles : rawStyles && isCSS(rawStyles) ? [rawStyles] : [];
        const styleStr = stylesToString(styleList);
        edits.push({
          start: m.index,
          end: m.index + match.length,
          text: `${opening}<template shadowrootmode="open">${styleStr}${innerProcessed}</template>`,
        });
      } else {
        // Light DOM. When the component has a non-empty rendered template,
        // run the slot pipeline so behaviour matches shadow DOM: authored
        // children are visible only where projected through <slot>; any
        // child without a matching slot is dropped.
        //
        // When rendered template is empty (Base-extending decorator
        // components that have no render() method, or render() that
        // returns an empty template), the host acts as a transparent
        // wrapper: authored children stay in place adjacent to the
        // (empty) hydration marker. This preserves the kit's
        // decorator-pattern components (those extending Base from the
        // ui package's lib/utils.ts) without forcing a render() rewrite.
        const renderedIsEmpty = rawInner.trim() === '';
        if (renderedIsEmpty) {
          edits.push({
            start: m.index,
            end: m.index + match.length,
            text: `${opening}<!--webjs-hydrate-->`,
          });
          continue;
        }
        //
        // The authored inner HTML + slot partition were extracted BEFORE
        // the render (the #1015 reorder, see above), so here:
        // 1. Substitute each <slot> in the rendered output with a
        //    framework-marked <slot data-webjs-light data-projection
        //    ="actual|fallback"> element carrying projection or
        //    fallback content per first-wins rule.
        // 2. Recursively run injectDSD on the substituted output so
        //    nested custom elements (inside projected children) get
        //    their own DSD pass.
        const innerWithSlots = substituteSlotsInRender(rawInner, partitioned, tag);
        const innerProcessed = await injectDSD(innerWithSlots, ctx, [...ancestors, instance], dev);
        edits.push({
          start: m.index,
          end: closeEnd,
          text: `${opening}<!--webjs-hydrate-->${innerProcessed}</${tag}>`,
        });
      }
    } catch (e) {
      const hint = browserMemberHint(e);
      if (hint) {
        console.error(
          `[webjs] SSR failed for <${tag}>: ${hint} It was touched in the component's constructor or render(), which run during SSR. Move browser-only work to connectedCallback() or a lifecycle hook (firstUpdated/updated), which SSR never calls; seed first-paint defaults in the constructor only from server-known inputs (attributes / props).`,
          e,
        );
      } else {
        console.error(`[webjs] SSR failed for <${tag}>:`, e);
      }
      // Per-component error isolation (#469). A render that throws (most
      // commonly a rejected `await getData()` in an async render, but any
      // render throw) is caught HERE, per component: the loop continues so
      // siblings render normally, and this element renders a component-scoped
      // error state instead of bubbling to the route error.js or leaving its
      // raw, unprocessed children in the output. renderError() customizes the
      // error UI; the default surfaces the message in dev and renders an empty
      // (silent, isolated) element in prod so no internal detail leaks.
      const err = e instanceof Error ? e : new Error(String(e));
      let errorInner = '';
      try {
        let errTpl;
        if (instance && typeof instance.renderError === 'function') {
          errTpl = instance.renderError(err);
        }
        if (errTpl === undefined) errTpl = defaultSSRErrorTemplate(tag, err, dev);
        errorInner = await render(errTpl, ctx);
        if (errorInner.trim()) {
          errorInner = await injectDSD(errorInner, ctx, instance ? [...ancestors, instance] : ancestors, dev);
        }
      } catch (renderErrorThrew) {
        console.error(`[webjs] renderError() for <${tag}> also threw:`, renderErrorThrew);
        errorInner = '';
      }
      // Replace the element (opening tag through its matching close) with the
      // error state plus a hydration marker, so the client error boundary
      // (component.js renderError) can take over on hydration.
      let closeEnd = m.index + match.length;
      if (!selfClose) {
        const innerStart = m.index + match.length;
        const closeIdx = findClosingTagInString(html, innerStart, tag, inert);
        if (closeIdx !== -1) {
          const closeRe = new RegExp(`</${escapeRegex(tag)}\\s*>`, 'i');
          const cm = closeRe.exec(html.slice(closeIdx));
          closeEnd = closeIdx + (cm ? cm[0].length : `</${tag}>`.length);
        } else {
          closeEnd = html.length;
        }
      }
      // A shadow component renders into a shadow root on the client, so its
      // SSR error state must ride a DSD template too (matching the success
      // path), not land in light DOM. Otherwise the client renders the error
      // into the shadow root while the light error box lingers underneath.
      const isShadowErr = /** @type any */ (Cls).shadow === true;
      // Mark the LIGHT host here too, so a component whose SSR render() throws
      // paints its error state as display:block (not the inline default),
      // matching the success path. When an `async render()` rejects, it throws
      // before the success-path withHostMarker (above) ran, so `opening` is still
      // unmarked; when a later template render throws, the success marker already
      // ran and this call is a no-op (withHostMarker is idempotent). Shadow hosts
      // stay unmarked (their :host must win).
      if (!isShadowErr) opening = withHostMarker(opening);
      let text;
      if (isShadowErr) {
        const rawStyles = /** @type any */ (Cls).styles;
        const styleList = Array.isArray(rawStyles) ? rawStyles : rawStyles && isCSS(rawStyles) ? [rawStyles] : [];
        const styleStr = stylesToString(styleList);
        text = `${opening}<template shadowrootmode="open">${styleStr}${errorInner}</template>`;
      } else {
        text = `${opening}<!--webjs-hydrate-->${errorInner}</${tag}>`;
      }
      edits.push({ start: m.index, end: closeEnd, text });
    }
  }
  if (!edits.length) return html;

  // Drop edits whose range lives inside an earlier edit's range. This
  // happens when an outer custom element with <slot> in its render takes
  // an edit that spans its opening + closing tags (covering inner custom
  // elements among authored children); the inner matches were enumerated
  // independently against the original html, but those inner elements
  // are processed by the recursive injectDSD call on innerWithSlots.
  // Keeping both edits would double-process them and corrupt the output.
  // A consequence: a nested instance's render() runs once per chain depth
  // (the discarded top-level pass sees an empty ancestor chain, so its
  // closest() reads null; the kept recursive pass has the real chain). The
  // kept pass is the only output, and closest() is a read, so render() must
  // stay pure at SSR (the standard SSR contract), not branch on side effects.
  edits.sort((a, b) => a.start - b.start);
  /** @type {{start:number, end:number, text:string}[]} */
  const filtered = [];
  let consumedTo = -1;
  for (const e of edits) {
    if (e.start >= consumedTo) {
      filtered.push(e);
      consumedTo = e.end;
    }
  }
  // Apply edits from last to first so indices stay stable.
  let out = html;
  for (let i = filtered.length - 1; i >= 0; i--) {
    const { start, end, text } = filtered[i];
    out = out.slice(0, start) + text + out.slice(end);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Slot SSR helpers
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** @param {string} tag @returns {boolean} */
function isVoidElement(tag) {
  return VOID_ELEMENTS.has(tag.toLowerCase());
}

/**
 * Resolve `<webjs-suspense>` boundaries in an HTML string (#471). For each
 * top-level boundary (nested ones are handled by the recursive injectDSD that
 * processes a boundary's streamed children):
 *
 * - Streaming (a SuspenseCtx is present): emit the boundary as
 *   `<webjs-suspense id="sN">FALLBACK</webjs-suspense>` and push the raw inner
 *   children to `ctx.pending` (wrapped in `unsafeHTML` so the streaming pass
 *   renders them as HTML, not escaped text, then runs injectDSD over them).
 *   `streamSuspenseBoundaries` later streams the resolved children as a
 *   `<template data-webjs-resolve="sN">` plus the swap script. Multiple
 *   boundaries resolve via `Promise.all`, so their data fetches run
 *   concurrently. The placeholder is the boundary's `.fallback`
 *   (carried as `data-webjs-fallback`); a boundary without one shows empty.
 * - Blocking (no ctx): render the children inline now and drop the fallback,
 *   so a non-streaming `renderToString` returns the real content. The
 *   `<webjs-suspense>` wrapper stays as an inert inline element.
 *
 * @param {string} html
 * @param {SuspenseCtx} [ctx]
 * @param {any[]} [ancestors]
 * @param {boolean} [dev]  server dev flag for prod-silence of a throwing
 *   component in an inline (ctx-absent) boundary (#483)
 * @returns {Promise<string>}
 */
async function processSuspenseElements(html, ctx, ancestors = [], dev) {
  if (html.indexOf('<webjs-suspense') === -1) return html;
  const OPEN = /<webjs-suspense((?:"[^"]*"|'[^']*'|[^>])*?)>/i;
  // A commented-out boundary is text, not an element (#1128). This scanner is
  // the reason the comment fix cannot live in injectDSD alone: it runs FIRST
  // and hands the boundary's children to a fresh injectDSD as a standalone
  // string, which has no idea those bytes came from inside a comment. Under
  // streaming it is worse than a stray render, because the children's data
  // fetches run and the swap script targets an id that only exists inside a
  // comment, so it can never resolve. Ranges are computed against the FULL
  // input once, and `consumed` maps the shrinking `rest` back onto it.
  const inert = inertRanges(html);
  const isInert = inertAt(inert);
  let consumed = 0;
  let result = '';
  let rest = html;
  // Bounded loop: each iteration consumes at least the opening tag.
  for (let guard = 0; guard < 10000; guard++) {
    const m = OPEN.exec(rest);
    if (!m) {
      result += rest;
      break;
    }
    if (isInert(consumed + m.index)) {
      // Emit through the end of this match and keep scanning after it.
      const skipTo = m.index + m[0].length;
      result += rest.slice(0, skipTo);
      rest = rest.slice(skipTo);
      consumed += skipTo;
      continue;
    }
    const openStart = m.index;
    const openEnd = m.index + m[0].length;
    result += rest.slice(0, openStart);
    const attrs = m[1] || '';
    const fbMatch = /data-webjs-fallback="([^"]*)"/i.exec(attrs);
    const fallbackHtml = fbMatch ? unescapeAttr(fbMatch[1]) : '';

    // Pass the FULL-input ranges shifted into `rest` coordinates rather than
    // letting the helper re-tokenize the suffix. `rest` can begin mid-comment
    // or mid-raw-text after the skip path above, and a tokenizer restarted
    // there is in the wrong state: a text-only opener named later in that same
    // comment would read as a real element and mark everything to EOF inert,
    // so the boundary's real close tag was skipped and the trailing markup
    // folded into the boundary. The shifted view keeps the full-string truth,
    // including a first range that starts before `rest` does.
    const shifted = [];
    for (const [s, e] of inert) {
      if (e <= consumed) continue;
      shifted.push([Math.max(0, s - consumed), e - consumed]);
    }
    const closeIdx = findClosingTagInString(rest, openEnd, 'webjs-suspense', shifted);
    let inner;
    let afterClose;
    if (closeIdx === -1) {
      inner = rest.slice(openEnd);
      afterClose = '';
    } else {
      inner = rest.slice(openEnd, closeIdx);
      const cm = /<\/webjs-suspense\s*>/i.exec(rest.slice(closeIdx));
      afterClose = rest.slice(closeIdx + (cm ? cm[0].length : '</webjs-suspense>'.length));
    }

    if (ctx) {
      const id = `s${ctx.nextId++}`;
      // Raw children stream in later. unsafeHTML so the streaming pass emits
      // the markup verbatim (then injectDSD runs over it, resolving the async
      // components and any nested boundaries).
      ctx.pending.push({ id, promise: Promise.resolve(unsafeHTML(inner)) });
      result += `<webjs-suspense id="${id}">${fallbackHtml}</webjs-suspense>`;
    } else {
      const innerProcessed = await injectDSD(inner, ctx, ancestors, dev);
      result += `<webjs-suspense>${innerProcessed}</webjs-suspense>`;
    }
    consumed += rest.length - afterClose.length;
    rest = afterClose;
  }
  return result;
}

/**
 * Find the position of the matching closing tag for `tagName` starting from
 * `fromIndex` in `html`. Handles nested same-tag elements via depth tracking.
 * Returns the index of the `<` of `</tagName>`, or -1 if unclosed.
 *
 * @param {string} html
 * @param {number} fromIndex
 * @param {string} tagName
 * @returns {number}
 */
function findClosingTagInString(html, fromIndex, tagName, inert) {
  const esc = escapeRegex(tagName);
  // Match same-name opening tags. Followed by a name-boundary character
  // so we don't accept <table> as opening <tab>.
  const openRe = new RegExp(`<${esc}(?:[\\s>/])`, 'gi');
  const closeRe = new RegExp(`</${esc}\\s*>`, 'gi');
  // A tag inside a comment, raw text, RCDATA, or an attribute value is text
  // and must count for NEITHER side of the depth ledger (#1133). Counting a
  // commented `<my-card>` as a nested open meant depth never returned to zero,
  // and matching a commented `</my-card>` as the close truncated the authored
  // children at the comment, so the projected content ended with an
  // unterminated `<!--` that a browser read as commenting out the real close
  // tags. Callers that already computed the ranges for this exact string pass
  // them; a caller that did not gets them computed here.
  const ranges = inert === undefined ? inertRanges(html) : inert;
  const next = (re) => {
    let m;
    while ((m = re.exec(html)) !== null) {
      if (ranges.length === 0 || !inRanges(ranges, m.index)) return m;
    }
    return null;
  };
  openRe.lastIndex = fromIndex;
  closeRe.lastIndex = fromIndex;
  let depth = 1;
  while (depth > 0) {
    const o = next(openRe);
    const c = next(closeRe);
    if (!c) return -1;
    if (o && o.index < c.index) {
      depth++;
      closeRe.lastIndex = o.index + 1;
    } else {
      depth--;
      if (depth === 0) return c.index;
      openRe.lastIndex = c.index + 1;
    }
  }
  return -1;
}

/**
 * Extract the `slot` attribute value from an attribute string. Returns
 * null when the attribute is absent.
 *
 * @param {string} attrsRaw
 * @returns {string | null}
 */
function extractSlotAttr(attrsRaw) {
  const m = /\bslot\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrsRaw);
  if (!m) return null;
  const value = m[1] ?? m[2] ?? m[3] ?? '';
  // Per shadow DOM spec, slot="" (empty) and missing slot attribute both
  // route to the default slot. `default` is the framework's reserved alias
  // for it (#1015: the client record normalizes it identically, so both
  // sides agree end to end).
  return value === '' || value === 'default' ? null : value;
}

/**
 * Partition authored inner HTML by each top-level child's `slot=""`
 * attribute. Text nodes, comment nodes, and elements without `slot=""`
 * all route to the default-slot key (null).
 *
 * Returns a Map keyed by slot name (null for default) whose values are
 * the concatenated HTML strings for that slot in source order.
 *
 * @param {string} html
 * @returns {Map<string|null, string>}
 */
function partitionAuthoredBySlot(html) {
  /** @type {Map<string|null, string>} */
  const groups = new Map();
  let defaultBuf = '';
  let cursor = 0;
  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor);
    if (lt === -1) {
      defaultBuf += html.slice(cursor);
      break;
    }
    if (lt > cursor) defaultBuf += html.slice(cursor, lt);
    const rest = html.slice(lt);
    if (rest.startsWith('<!--')) {
      // Find the comment's end the same way inertRanges does, rather than with
      // a bare `indexOf('-->')`. The two helpers both decide where a comment
      // stops, so a bare search makes them DISAGREE on the spec short forms
      // (`--!>`, `<!-->`, `<!--->`): this one would run past the real end and
      // swallow the slotted children that follow, silently routing a
      // `slot="head"` child into the default slot.
      const commentEnd = endOfComment(html, lt);
      if (commentEnd === -1) {
        defaultBuf += rest;
        cursor = html.length;
        break;
      }
      defaultBuf += html.slice(lt, commentEnd);
      cursor = commentEnd;
      continue;
    }
    if (rest.startsWith('<!') || rest.startsWith('</')) {
      const end = html.indexOf('>', lt);
      if (end === -1) {
        defaultBuf += rest;
        cursor = html.length;
        break;
      }
      defaultBuf += html.slice(lt, end + 1);
      cursor = end + 1;
      continue;
    }
    const tagMatch = /^<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/.exec(rest);
    if (!tagMatch) {
      defaultBuf += '<';
      cursor = lt + 1;
      continue;
    }
    const [tagFull, tagName, attrsRaw, selfCloseSlash] = tagMatch;
    const lower = tagName.toLowerCase();
    const isSelfClose = !!selfCloseSlash || isVoidElement(lower);
    const slotAttr = extractSlotAttr(attrsRaw);
    let elemEnd;
    if (isSelfClose) {
      elemEnd = lt + tagFull.length;
    } else {
      const innerStart = lt + tagFull.length;
      const closeIdx = findClosingTagInString(html, innerStart, lower);
      if (closeIdx === -1) {
        // Unclosed element. Take to end of html.
        const elementHTML = html.slice(lt);
        if (slotAttr !== null) appendStringToMap(groups, slotAttr, elementHTML);
        else defaultBuf += elementHTML;
        cursor = html.length;
        continue;
      }
      const closeRe = new RegExp(`</${escapeRegex(lower)}\\s*>`, 'i');
      const tail = html.slice(closeIdx);
      const closeMatch = closeRe.exec(tail);
      const closeLen = closeMatch ? closeMatch[0].length : `</${lower}>`.length;
      elemEnd = closeIdx + closeLen;
    }
    const elementHTML = html.slice(lt, elemEnd);
    if (slotAttr !== null) appendStringToMap(groups, slotAttr, elementHTML);
    else defaultBuf += elementHTML;
    cursor = elemEnd;
  }
  if (defaultBuf.length > 0) groups.set(null, defaultBuf);
  return groups;
}

/** Append a string to a Map<K, string>, concatenating if the key exists. */
function appendStringToMap(map, key, value) {
  const existing = map.get(key);
  if (existing !== undefined) map.set(key, existing + value);
  else map.set(key, value);
}

/**
 * Substitute every `<slot>` tag in `rendered` with a framework-marked
 * `<slot data-webjs-light data-projection="actual|fallback">` element
 * carrying either the projected children for that slot (from
 * `partitioned`) or the slot's authored fallback content. Multiple
 * slots with the same name follow the first-wins rule per spec; later
 * same-named slots fall back regardless of available projection.
 *
 * The `ownerTag` (the tag of the component whose template rendered these
 * slots) is emitted as `data-wj-slot-owner` so the client resolves template
 * ownership on hydration the same way the client renderer stamps SLOT_OWNER,
 * which is what makes a FORWARDED slot (rendered by this component but nested
 * inside a child) route to this component and not the child (#1023).
 *
 * @param {string} rendered
 * @param {Map<string|null, string>} partitioned
 * @param {string} ownerTag
 * @returns {string}
 */
function substituteSlotsInRender(rendered, partitioned, ownerTag) {
  const ownerAttr = ownerTag ? ` data-wj-slot-owner="${escapeAttr(ownerTag)}"` : '';
  /** @type {Set<string|null>} */
  const consumedNames = new Set();
  let result = '';
  let cursor = 0;
  const slotRe = /<slot((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/gi;
  // A `<slot>` written inside a comment is documentation, not a slot (#1128).
  // Substituting one is worse here than in the element walk: a commented slot
  // has no `</slot>`, so the fallback scan below swallows the rest of the
  // template, the component's REAL slot is never substituted, and the authored
  // children are dropped from the page entirely.
  const inert = inertRanges(rendered);
  const isInert = inertAt(inert);
  let m;
  while ((m = slotRe.exec(rendered)) !== null) {
    if (isInert(m.index)) continue;
    result += rendered.slice(cursor, m.index);
    const [fullOpen, attrsRaw, selfCloseSlash] = m;
    const isSelfClose = !!selfCloseSlash;
    const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrsRaw);
    const name = nameMatch ? (nameMatch[1] ?? nameMatch[2] ?? nameMatch[3]) : null;
    // Strip the `name` attribute from the carried-through attribute
    // string so we can re-add it (with escaping) on the framework slot.
    const otherAttrs = attrsRaw.replace(/\bname\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '').trim();
    let fallback = '';
    let totalEnd;
    if (isSelfClose) {
      totalEnd = m.index + fullOpen.length;
    } else {
      const innerStart = m.index + fullOpen.length;
      const closeIdx = findClosingTagInString(rendered, innerStart, 'slot', inert);
      if (closeIdx === -1) {
        fallback = rendered.slice(innerStart);
        totalEnd = rendered.length;
      } else {
        fallback = rendered.slice(innerStart, closeIdx);
        const closeRe = /<\/slot\s*>/i;
        const tail = rendered.slice(closeIdx);
        const closeMatch = closeRe.exec(tail);
        const closeLen = closeMatch ? closeMatch[0].length : '</slot>'.length;
        totalEnd = closeIdx + closeLen;
      }
    }
    // `default` and `''` are the reserved aliases for the default slot
    // (#1015), matching the client's keyOfName exactly: the LOOKUP key
    // normalizes, while the emitted name attribute stays as authored so the
    // output bytes are unchanged for every other app.
    const slotKey = name === 'default' || name === '' ? null : name;
    const projected = partitioned.get(slotKey);
    const nameAttr = name !== null ? ` name="${escapeAttr(name)}"` : '';
    const extraAttrs = otherAttrs ? ` ${otherAttrs}` : '';
    if (projected !== undefined && !consumedNames.has(slotKey)) {
      consumedNames.add(slotKey);
      result += `<slot data-webjs-light data-projection="actual"${ownerAttr}${nameAttr}${extraAttrs}>${projected}</slot>`;
    } else {
      result += `<slot data-webjs-light data-projection="fallback"${ownerAttr}${nameAttr}${extraAttrs}>${fallback}</slot>`;
    }
    cursor = totalEnd;
    slotRe.lastIndex = totalEnd;
  }
  result += rendered.slice(cursor);
  return result;
}

/** @param {string} s */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} tag */
function isRawtextTag(tag) {
  return tag === 'script' || tag === 'style';
}

/**
 * RCDATA elements: their content is text (character references aside), so a
 * tag-shaped string inside one is not markup. Kept next to `isRawtextTag` so
 * the two lists stay together rather than drifting apart.
 * @param {string} tag
 * @returns {boolean}
 */
function isRcdataTag(tag) {
  return tag === 'textarea' || tag === 'title';
}

/**
 * Elements whose content the HTML tokenizer never reads as markup, for the
 * purposes of `inertRanges` only (#1128).
 *
 * Deliberately NOT `isRawtextTag`, even though it overlaps: that predicate is
 * shared with the template tokenizer, where widening it would change how holes
 * inside those elements are escaped. This one answers a narrower question,
 * "can a tag-shaped string in here be a real element", and the answer is no for
 * every raw-text and RCDATA element, not just the two the template path cares
 * about. `<iframe>` with fallback markup is the realistic trigger.
 *
 * `<noscript>` is excluded on purpose: its content IS parsed as markup when
 * scripting is disabled, which for a progressive-enhancement framework is the
 * case that matters, so components inside it must keep rendering.
 *
 * @param {string} tag
 * @returns {boolean}
 */
function isTextOnlyTag(tag) {
  return isRawtextTag(tag) || isRcdataTag(tag)
    || tag === 'iframe' || tag === 'xmp' || tag === 'noembed'
    || tag === 'noframes' || tag === 'plaintext';
}

/**
 * Minimal attribute string parser.
 * @param {string} attrStr
 * @returns {Record<string,string>}
 */
function parseAttrs(attrStr) {
  /** @type {Record<string,string>} */
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/**
 * Seed the element's attributes from the source opening tag so reads like
 * `this.getAttribute(name)` / `this.hasAttribute(name)` inside willUpdate /
 * render return the real value during SSR. Goes through `setAttribute`, which
 * both the server element shim (Node SSR) and a real `HTMLElement`
 * (renderToString called in a browser, e.g. tests) implement, so the path
 * does not depend on the shim's internal store. A bare Base-extending kit
 * component without `setAttribute` is skipped.
 *
 * @param {any} instance
 * @param {Record<string,string>} attrs  parsed source attributes (data-webjs-prop-* already removed)
 */
function seedServerAttrs(instance, attrs) {
  if (!instance || typeof instance.setAttribute !== 'function') return;
  for (const [name, raw] of Object.entries(attrs)) {
    instance.setAttribute(name, unescapeAttr(raw));
  }
}

/**
 * Append attributes the component set before render (reflected reflect:true
 * properties, or an explicit `this.setAttribute` in the constructor /
 * willUpdate) to the element's opening tag, skipping any name already present
 * in the source tag. Reads via the standard `getAttributeNames` /
 * `getAttribute` API so it works whether the instance is the server shim or a
 * real `HTMLElement`. Returns the opening tag unchanged when there is nothing
 * to add, so existing SSR output stays byte-identical when no component
 * reflects, which preserves the elision on-vs-off differential invariant.
 *
 * @param {string} opening  the element's opening tag, ending in `>`
 * @param {any} instance
 * @param {Set<string>} presentAttrNames  lowercased names already in the source tag
 * @returns {string}
 */
/**
 * Add the component host marker (`data-wj-host`) to an opening tag, unless it
 * is already present. Insert before the closing `>` the same way
 * `appendReflectedAttrs` does. Idempotent so a re-processed tag is unchanged.
 * @param {string} opening  the element's opening tag, ending in `>`
 * @returns {string}
 */
function withHostMarker(opening) {
  if (/\sdata-wj-host(?=[\s>=])/i.test(opening)) return opening;
  return `${opening.slice(0, -1)} data-wj-host>`;
}

function appendReflectedAttrs(opening, instance, presentAttrNames) {
  if (!instance || typeof instance.getAttributeNames !== 'function') return opening;
  let extra = '';
  for (const rawName of instance.getAttributeNames()) {
    const name = String(rawName).toLowerCase();
    if (presentAttrNames.has(name)) continue;
    const value = instance.getAttribute(rawName);
    extra += value === '' ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`;
  }
  if (!extra) return opening;
  // Insert before the closing `>` (the opening tag is normalised to end in
  // `>`; a self-closing source tag was already rewritten without the slash).
  return `${opening.slice(0, -1)}${extra}>`;
}

/**
 * Coerce attribute strings to typed properties on a component instance
 * based on its static `properties` declaration.
 */
function applyAttrsToInstance(instance, attrs, Cls) {
  const props = Cls.properties || {};
  for (const [key, raw] of Object.entries(attrs)) {
    // Resolve the source attribute name to its property: a custom `attribute`
    // option wins, else the kebab-cased property name, else the camelCase of
    // the attribute (the common case). Mirrors the client attributeChangedCallback
    // so a custom-attribute prop gets the right value in the SSR'd first paint.
    let propName, rawDef;
    for (const [k, decl] of Object.entries(props)) {
      const d = typeof decl === 'object' ? decl : { type: decl };
      if ((d.attribute || hyphenate(k)) === key) { propName = k; rawDef = decl; break; }
    }
    if (rawDef === undefined) {
      rawDef = props[key] || props[camelCase(key)];
      propName = props[key] ? key : camelCase(key);
    }
    if (!rawDef) {
      instance[propName] = raw;
      continue;
    }
    // The factory accepts a bare constructor shorthand (`{ expanded: Boolean }`)
    // alongside the long form (`{ expanded: { type: Boolean } }`); normalize so
    // the type-based coercion below sees a `{ type }` object either way.
    const def = typeof rawDef === 'object' ? rawDef : { type: rawDef };
    if (def.type === Number) instance[propName] = Number(raw);
    else if (def.type === Boolean) instance[propName] = raw !== 'false';
    else if (def.type === Object || def.type === Array) {
      // `raw` is the entity-encoded attribute text (parseAttrs returns the
      // literal characters between the quotes), so decode the HTML entities
      // before JSON.parse. A JSON attribute carries `&quot;` for every `"`;
      // parsing it raw throws, and the prop then falls to the failure value
      // below rather than to the object the author wrote.
      //
      // An unparseable attribute falls back to `null`, NOT to the raw string
      // (#1253), matching this branch's counterpart in
      // `attributeChangedCallback`. They have to agree, or the same
      // `<my-el cfg="oops">` SSRs holding a string and re-renders holding
      // something else the moment the element upgrades. `null` is the right
      // value to agree on: a string is never a valid value for a property the
      // author declared `Object` or `Array`. This function iterates the
      // attributes PRESENT on the source tag, so an absent one is not read here
      // at all and its property keeps whatever the constructor gave it; the
      // agreement being asserted is about a present, unparseable attribute.
      //
      // That agreement is about this FALLBACK, not a guarantee that the two
      // readers see the same attributes in the first place. This function
      // walks the parsed source tag while the client goes through
      // `observedAttributes` and the browser's own name-lowercasing, and
      // hand-written markup can land in the gaps between those routes (the
      // entity decoding just below is one, since it reverses far less than a
      // browser does). Those gaps predate #1253 and it neither causes nor
      // closes any of them; no attempt is made here to enumerate them,
      // because every attempt so far has been incomplete.
      //
      // Scoped to the DEFAULT converter, which is all this branch is. The
      // client reader tries `converter.fromAttribute` FIRST and only falls
      // through to here when there is none, while this function has no
      // converter arm at all, so a prop declaring one is read differently by
      // the two sides regardless of what this line does. That gap predates
      // #1253 and is left alone rather than widened.
      try { instance[propName] = JSON.parse(unescapeAttr(raw)); } catch { instance[propName] = null; }
    } else instance[propName] = raw;
  }
}

/** @param {string} s */
function camelCase(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Kebab-case a property name for its default HTML attribute (matches component.js). @param {string} s */
function hyphenate(s) {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Inverse of camelCase. `userName` -> `user-name`, `userID` -> `user-i-d`.
 * Used to serialize property-binding names into HTML attribute names,
 * which are case-insensitive in the parser. The original JS property
 * name is recovered via camelCase() on the consumer side.
 *
 * @param {string} s
 */
function kebabCase(s) {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Reverse `escapeAttr` on a server-side attribute value. Needed
 * because `parseAttrs` returns the literal characters between the
 * quote marks; HTML entities are not decoded by the regex. The
 * browser handles this automatically, so client-side reads via
 * `getAttribute()` do not need the same step.
 *
 * @param {string} s
 */
function unescapeAttr(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/**
 * Decode `data-webjs-prop-<kebab>` attributes from a parsed attribute
 * map, returning a map of camelCase property name to decoded value.
 * Mutates `attrs` by deleting the consumed entries so they do not
 * appear in the rendered output a second time.
 *
 * @param {Record<string,string>} attrs
 * @returns {Record<string, unknown>}
 */
function consumePropAttrs(attrs) {
  /** @type {Record<string, unknown>} */
  const props = {};
  for (const key of Object.keys(attrs)) {
    if (!key.startsWith('data-webjs-prop-')) continue;
    const propName = camelCase(key.slice('data-webjs-prop-'.length));
    try {
      props[propName] = parse(unescapeAttr(attrs[key]));
    } catch {
      // Malformed payload. Skip silently so the rest of the component
      // can still render. The client-side hydration will also try and
      // fail, which is fine: undefined-prop semantics.
    }
    delete attrs[key];
  }
  return props;
}

// ---------------------------------------------------------------------------
// Streaming renderer
// ---------------------------------------------------------------------------

/**
 * Render a TemplateResult (or any renderable value) to a `ReadableStream`
 * that yields HTML chunks as strings.
 *
 * Works identically to {@link renderToString} but streams partial HTML as
 * it is rendered: avoiding buffering the entire page in memory. For
 * Suspense boundaries, the fallback is yielded immediately and resolved
 * content is streamed afterwards at the end of the response.
 *
 * **AI hint:** Use `renderToStream` when you want to pipe SSR output
 * directly into a `Response` for streaming delivery (e.g. HTTP chunked
 * transfer). It accepts the same arguments as `renderToString`.
 *
 * @param {unknown} value  A TemplateResult, string, array, or any renderable.
 * @param {{ ssr?: boolean, suspenseCtx?: SuspenseCtx }} [opts]
 * @returns {ReadableStream<string>}
 */
export function renderToStream(value, opts = { ssr: true }) {
  const ctx = opts && opts.suspenseCtx;
  // Server dev flag for prod-silence of SSR error states (#483), same sourcing
  // as renderToString: opts.dev wins, else inherit from the ctx, else undefined
  // (NODE_ENV fallback). Back-fill the ctx so the streamed sub-renders share it.
  const dev = opts && opts.dev !== undefined ? opts.dev : ctx && ctx.dev;
  if (ctx && ctx.dev === undefined && dev !== undefined) ctx.dev = dev;
  return new ReadableStream({
    async start(controller) {
      try {
        if (opts && opts.ssr === false) {
          // No DSD injection: just stream the raw rendered chunks.
          await streamRender(value, ctx, controller, 'none');
        } else {
          // Render to string first to run DSD injection (which operates on
          // the full HTML), then enqueue the result. This matches the
          // semantics of renderToString but still gives us a stream.
          const html = await render(value, ctx);
          const full = await injectDSD(html, ctx, [], dev);
          controller.enqueue(full);
        }

        // Stream resolved Suspense boundaries after the main content.
        if (ctx && ctx.pending.length) {
          await streamSuspenseBoundaries(ctx, controller, dev);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * Recursively render a value, enqueuing HTML chunks into the stream
 * controller as they become available.
 *
 * @param {unknown} value
 * @param {SuspenseCtx} [ctx]
 * @param {ReadableStreamDefaultController<string>} controller
 */
async function streamRender(value, ctx, controller) {
  if (value == null || value === false || value === true) return;
  if (value && typeof /** @type any */ (value).then === 'function') {
    value = await value;
    return streamRender(value, ctx, controller);
  }
  if (isUnsafeHTML(value)) {
    controller.enqueue(String(/** @type any */ (value).value ?? ''));
    return;
  }
  if (isLive(value)) {
    return streamRender(/** @type any */ (value).value, ctx, controller);
  }
  if (isWatch(value)) {
    return streamRender(/** @type any */ (value).signal.get(), ctx, controller);
  }
  if (isKeyed(value)) {
    return streamRender(/** @type any */ (value).value, ctx, controller);
  }
  if (isGuard(value)) {
    return streamRender(/** @type any */ (value).fn(), ctx, controller);
  }
  if (isTemplateContent(value)) {
    const tpl = /** @type any */ (value).template;
    controller.enqueue(String(tpl?.innerHTML ?? ''));
    return;
  }
  if (isRef(value)) {
    return;
  }
  if (isCache(value)) {
    return streamRender(/** @type any */ (value).value, ctx, controller);
  }
  if (isUntil(value)) {
    const args = /** @type any */ (value).args;
    for (const a of args) {
      if (!a || typeof (/** @type any */ (a).then) !== 'function') {
        return streamRender(a, ctx, controller);
      }
    }
    if (args.length > 0) {
      try {
        const winner = await Promise.race(args.map((p) => Promise.resolve(p).catch(() => undefined)));
        return streamRender(winner, ctx, controller);
      } catch {
        return;
      }
    }
    return;
  }
  if (isAsyncAppend(value) || isAsyncReplace(value)) {
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) await streamRender(v, ctx, controller);
    return;
  }
  if (isRepeat(value)) {
    const r = /** @type any */ (value);
    for (let i = 0; i < r.items.length; i++) {
      await streamRender(r.templateFn(r.items[i], i), ctx, controller);
    }
    return;
  }
  if (isSuspense(value)) {
    const s = /** @type any */ (value);
    if (ctx) {
      const id = `s${ctx.nextId++}`;
      controller.enqueue(`<webjs-boundary id="${id}">`);
      await streamRender(s.fallback, ctx, controller);
      controller.enqueue(`</webjs-boundary>`);
      ctx.pending.push({ id, promise: Promise.resolve(s.children) });
    } else {
      await streamRender(s.fallback, ctx, controller);
    }
    return;
  }
  if (isTemplate(value)) {
    await streamTemplate(/** @type any */ (value), ctx, controller);
    return;
  }
  controller.enqueue(escapeText(String(value)));
}

/**
 * Stream a TemplateResult by yielding each static string piece and
 * processing each value hole incrementally.
 *
 * @param {import('./html.js').TemplateResult} tr
 * @param {SuspenseCtx} [ctx]
 * @param {ReadableStreamDefaultController<string>} controller
 */
async function streamTemplate(tr, ctx, controller) {
  const { strings, values } = tr;
  let state = 'text';
  let attrName = '';
  let attrStart = 0;
  let attrQuote = '';
  let commentDashes = 0;
  let currentTag = '';
  let rawTail = '';
  // Buffer used for attribute handling where we may need to backtrack.
  let buf = '';
  let tagStart = -1;
  /** @type {string | null} */
  let pendingActionId = null;
  // Shapes on the CURRENT start tag that a bound form may not carry (#1155).
  // Collected as the tag is scanned and judged at its `>`, because the action
  // hole may come after them.
  let pendingActionCount = 0;
  /** @type {string[]} */
  let pendingPropAttrs = [];
  /** @type {string[]} */
  let pendingSubmitterProps = [];
  /** @type {string | null} */
  let pendingSubmitterTag = null;  // tag of a bound submitter, until it closes
  // See the buffered machine: seeded from the caller so a nested template
  // rendered into a bound form's children knows it is inside one.
  let isCloseTag = false;

  // See the buffered machine for why this runs at the `>` rather than at the
  // hole. `tagStart` indexes into `buf`, which is safe because `buf` is only
  // flushed on a `text`-state hole and a start tag contains none.
  const closeBoundFormTag = () => {
    // Reset per tag whether or not this one was bound, so a later form is never
    // judged on an earlier tag's shapes.
    const propAttrs = pendingPropAttrs;
    const submitterProps = pendingSubmitterProps;
    const duplicateAction = pendingActionCount > 1;
    const submitterTag = pendingSubmitterTag;
    pendingPropAttrs = [];
    pendingSubmitterProps = [];
    pendingActionCount = 0;
    pendingSubmitterTag = null;
    if (pendingActionId != null) {
      assertConvergentBoundForm({ duplicateAction, propAttrs });
      const bound = bindFormActionStartTag(buf.slice(tagStart), pendingActionId);
      buf = buf.slice(0, tagStart) + bound.tag + bound.hidden;
      pendingActionId = null;
    }
    if (submitterTag != null) {
      // #1307, the SAME injection as the buffered machine, through the same
      // helper, so this second state machine cannot drift from it.
      buf = buf.slice(0, tagStart)
        + bindSubmitterStartTag(buf.slice(tagStart), submitterTag, { duplicateAction, propAttrs: submitterProps });
    }
  };
  // #1155: a `.method` / `.enctype` / `.encoding` prop on a form is dropped
  // here but applied for real in the browser, where all three are reflected IDL
  // attributes, so a bound form carrying one submits differently with JS than
  // without it. Recorded and refused at the `>`, once the tag's action hole is
  // known.
  const notePropAttr = (name, tag) => {
    const t = String(tag).toLowerCase();
    if (t === 'button' || t === 'input') {
      // #1207: the submitter twin. `name` / `value` / `formAction` / `formMethod`
      // / `formEnctype` all reflect on a submitter, so a `.prop` spelling is
      // dropped here and written to the attribute in the browser.
      if (isSubmitterReflectedProp(name)) pendingSubmitterProps.push(String(name));
      return;
    }
    if (t !== 'form') return;
    let n = String(name).toLowerCase();
    if (n === 'encoding') n = 'enctype';
    if (n === 'method' || n === 'enctype') pendingPropAttrs.push(String(name));
  };
  const noteActionHole = (name, tag) => {
    const t = String(tag).toLowerCase();
    const n = String(name).toLowerCase();
    if ((t === 'form' && n === 'action') ||
        ((t === 'button' || t === 'input') && n === 'formaction')) {
      pendingActionCount += 1;
    }
  };

  // Same contract as the buffered machine, `allowRawtext` included: only the
  // `tag-name` and `in-tag` exits ever entered rawtext here either, so a start
  // tag ending on a bare or unquoted attribute must keep escaping its body.
  const handleTagEnd = (allowRawtext) => {
    closeBoundFormTag();
    isCloseTag = false;
    state = allowRawtext && isRawtextTag(currentTag) ? 'rawtext' : 'text';
    if (state === 'rawtext') rawTail = '';
  };

  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      switch (state) {
        case 'text':
          buf += c;
          if (c === '<') { state = 'tag-open'; tagStart = buf.length - 1; isCloseTag = false; }
          break;
        case 'tag-open':
          buf += c;
          if (c === '!') state = 'bang-1';
          else if (c === '/') { state = 'tag-name'; currentTag = ''; isCloseTag = true; }
          else if (/[a-zA-Z]/.test(c)) { state = 'tag-name'; currentTag = c.toLowerCase(); }
          else state = 'text';
          break;
        case 'bang-1':
          buf += c;
          state = c === '-' ? 'bang-dash' : 'tag-name';
          break;
        case 'bang-dash':
          buf += c;
          if (c === '-') { state = 'comment'; commentDashes = 0; }
          else state = 'tag-name';
          break;
        case 'comment':
          buf += c;
          if (c === '-') commentDashes += 1;
          else if (c === '>' && commentDashes >= 2) { state = 'text'; commentDashes = 0; }
          else commentDashes = 0;
          break;
        case 'tag-name':
          buf += c;
          if (c === '>') {
            handleTagEnd(true);
          } else if (/\s/.test(c)) state = 'in-tag';
          else currentTag += c.toLowerCase();
          break;
        case 'in-tag':
          buf += c;
          if (c === '>') {
            handleTagEnd(true);
          } else if (!/\s/.test(c) && c !== '/') {
            state = 'attr-name';
            attrName = c;
            attrStart = buf.length - 1;
          }
          break;
        case 'rawtext':
          buf += c;
          rawTail = (rawTail + c.toLowerCase()).slice(-9);
          if (rawTail.endsWith('</script>') || rawTail.endsWith('</style>')) {
            state = 'text';
            rawTail = '';
            currentTag = '';
          }
          break;
        case 'attr-name':
          if (c === '=') { state = 'after-eq'; buf += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; buf += c; }
          else if (c === '>') { state = 'text'; attrName = ''; buf += c; handleTagEnd(false); }
          else { attrName += c; buf += c; }
          break;
        case 'after-eq':
          if (c === '"' || c === "'") { state = 'attr-quoted'; attrQuote = c; buf += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; buf += c; }
          else if (c === '>') { state = 'text'; attrName = ''; buf += c; handleTagEnd(false); }
          else { state = 'attr-unquoted'; buf += c; }
          break;
        case 'attr-unquoted':
          if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; buf += c; }
          else if (c === '>') { state = 'text'; attrName = ''; buf += c; handleTagEnd(false); }
          else buf += c;
          break;
        case 'attr-quoted':
          buf += c;
          if (c === attrQuote) { state = 'in-tag'; attrName = ''; }
          break;
      }
    }

    // Flush the buffer before processing the value hole: but only when
    // we're in text state (in attribute states we may need the buffer for
    // backtracking).
    if (i < values.length) {
      let val = values[i];
      if (val && typeof /** @type any */ (val).then === 'function') {
        val = await val;
      }
      if (state === 'comment') {
        buf += String(val ?? '');
        commentDashes = 0;
      } else if (state === 'rawtext') {
        buf += String(val ?? '');
        rawTail = '';
      } else if (state === 'text') {
        // Flush the buffered static content before streaming the value.
        if (buf) { controller.enqueue(buf); buf = ''; }
        await streamRender(val, ctx, controller);
      } else if (state === 'after-eq') {
        const prefix = attrName[0];
        const name = attrName.slice(1);
        const kind = BINDING_PREFIXES[prefix];
        if (kind === 'event' || kind === 'prop') {
          // Guard `prop` ONLY, matching the buffered machine. An `@action`
          // event binding is dropped here and never stringified, and a
          // function is the LEGITIMATE value for one (`<my-el @action=${fn}>`
          // listens for an `action` event), so refusing it would be a false
          // positive. `.action` differs where the property REFLECTS: on a form
          // (and `.formAction` on a button or input) the client assignment
          // writes the source into the DOM, so refusing at SSR keeps a page
          // from rendering clean on the server and throwing on hydration.
          // Elsewhere the property reflects nothing and a function stays
          // legal, which is why the check below is gated on a hyphen-free
          // tag. A custom element is excluded for a different reason than
          // "it does not reflect": a prop declared `reflect: true` DOES
          // reflect there, and used to write the source from its own setter.
          // #1169 guards that at the setter (a function removes the
          // attribute; an array carrying one does too, except under an
          // Object/Array type, where JSON drops it losslessly), so it
          // needs no commit-site check here.
          //
          // Unlike the buffered machine this drops EVERY prop, including
          // `<webjs-suspense .fallback>`: there is no injectDSD pre-pass on
          // this path (it is reached only through `renderToStream(v, { ssr:
          // false })`), so there is no consumer for a `data-webjs-fallback`
          // and emitting one would put an attribute in the markup that nothing
          // reads.
          if (kind === 'prop' && !currentTag.includes('-')) {
            assertNotFunctionReflectedActionProp(val, name, currentTag);
            notePropAttr(name, currentTag);
          }
          buf = buf.slice(0, attrStart);
          state = 'in-tag';
          attrName = '';
        } else if (kind === 'bool') {
          // A boolean binding stringifies nothing, so this never leaked, but
          // `?action=${fn}` is meaningless in every case (a truthy function
          // emits a bare `action=""`), and refusing it keeps the rule the docs
          // state true for every sigil rather than true only when quoted.
          assertNotFunctionActionAttr(val, name, currentTag);
          buf = buf.slice(0, attrStart);
          if (val) buf += `${name}=""`;
          state = 'in-tag';
          attrName = '';
        } else if (isBoundFormAction(val, attrName, currentTag)) {
          noteActionHole(attrName, currentTag);
          // The SAME bindings as the buffered renderer (#1155, #1207), in the
          // second machine, so `renderToStream(v, { ssr: false })` emits an
          // identical form rather than refusing one the page renderer accepts.
          if (currentTag === 'form') {
            pendingActionId = assertIdentifiableAction(await resolveFormActionId(val), currentTag);
            buf = buf.slice(0, attrStart).replace(/\s+$/, '');
          } else {
            assertSingleSubmitterAction(pendingSubmitterTag != null, currentTag);
            const attrs = parseStartTagAttrs(buf.slice(tagStart));
            if (attrs.has('name')) assertSubmitterHasNoName(attrs.get('name') || '', currentTag, false);
            if (attrs.has('value')) assertSubmitterHasNoValue(currentTag);
            if (attrs.has('form')) assertSubmitterHasNoFormAttribute(currentTag);
            const subId = assertIdentifiableAction(await resolveFormActionId(val), currentTag);
            pendingSubmitterTag = currentTag;
            buf = buf.slice(0, attrStart) + `name="${FORM_ACTION_FIELD}" value="${escapeAttr(subId)}"`;
          }
          state = 'in-tag';
          attrName = '';
        } else {
          noteActionHole(attrName, currentTag);
          // The SAME guard as the buffered renderer above. This is a second,
          // independent state machine, so it inherits nothing from that one;
          // a change to the rule has to land in both. Reached only via
          // `renderToStream(v, { ssr: false })`, which no page render uses, so
          // this covers the public API surface rather than a page leak.
          assertNotFunctionActionAttr(val, attrName, currentTag);
          buf += `"${escapeAttr(String(val ?? ''))}"`;
          state = 'in-tag';
          attrName = '';
        }
      } else if (state === 'attr-quoted' || state === 'attr-unquoted') {
        assertNotFunctionActionAttr(val, attrName, currentTag);
        buf += escapeAttr(String(val ?? ''));
      }
    }
  }

  // Flush any remaining buffer content.
  if (buf) controller.enqueue(buf);
}

/**
 * After the main HTML has been streamed, resolve pending Suspense promises
 * and stream their replacement content as out-of-order `<template>` tags
 * with tiny inline scripts that swap the fallback for the resolved HTML.
 *
 * @param {SuspenseCtx} ctx
 * @param {ReadableStreamDefaultController<string>} controller
 * @param {boolean} [dev]  server dev flag for prod-silence of a rejected
 *   streamed boundary (#483); undefined falls back to NODE_ENV
 */
async function streamSuspenseBoundaries(ctx, controller, dev) {
  // Resolve the per-request nonce once per call. The provider in
  // @webjsdev/server sources it from AsyncLocalStorage; outside a
  // request scope (or in the browser) the helper returns '' and we
  // emit the script unnonced, which is fine on documents not under
  // strict CSP and matches the no-nonce case for the rest of the
  // SSR pipeline.
  const nonce = cspNonce();
  const nonceAttr = nonce ? ` nonce="${escapeAttr(nonce)}"` : '';
  while (ctx.pending.length) {
    const batch = ctx.pending.splice(0);
    await Promise.all(
      batch.map(async ({ id, promise }) => {
        try {
          const resolved = await promise;
          const html = await render(resolved, ctx);
          const full = await injectDSD(html, ctx, [], dev);
          controller.enqueue(
            `<template data-webjs-resolve="${id}">${full}</template>` +
            `<script${nonceAttr}>` +
            `(function(){` +
            `var t=document.currentScript.previousElementSibling;` +
            `var b=document.getElementById("${id}");` +
            `if(b&&t){b.replaceWith(t.content.cloneNode(true));t.remove()}` +
            `document.currentScript.remove()` +
            `})()` +
            `</script>`
          );
        } catch (err) {
          console.error(`[webjs] Suspense boundary "${id}" rejected:`, err);
          // Render a boundary-scoped error state rather than leaving the
          // fallback stuck forever (#471). Dev surfaces the message; prod
          // renders a silent empty element (no leak). A failure HERE (the
          // error render itself throwing) leaves the fallback in place.
          try {
            const e = err instanceof Error ? err : new Error(String(err));
            const errHtml = await injectDSD(await render(defaultSSRErrorTemplate('webjs-suspense', e, dev), ctx), ctx, [], dev);
            controller.enqueue(
              `<template data-webjs-resolve="${id}">${errHtml}</template>` +
              `<script${nonceAttr}>` +
              `(function(){` +
              `var t=document.currentScript.previousElementSibling;` +
              `var b=document.getElementById("${id}");` +
              `if(b&&t){b.replaceWith(t.content.cloneNode(true));t.remove()}` +
              `document.currentScript.remove()` +
              `})()` +
              `</script>`
            );
          } catch (errorRenderThrew) {
            console.error(`[webjs] Suspense boundary "${id}" error render also threw:`, errorRenderThrew);
          }
        }
      })
    );
  }
}
