import { html, isTemplate } from '../html.js';
import { BINDING_PREFIXES } from '../binding-prefixes.js';
import { escapeText, escapeAttr } from '../escape.js';
import {
  assertNotFunctionActionAttr, assertNotFunctionReflectedActionProp,
  assertIdentifiableAction, bindFormActionStartTag, isBoundFormAction, resolveFormActionId,
  assertConvergentBoundForm, assertSubmitterHasNoName, assertSubmitterHasNoValue,
  assertSubmitterHasNoFormAttribute,
  assertSingleSubmitterAction, bindSubmitterStartTag, parseStartTagAttrs,
  isSubmitterReflectedProp, FORM_ACTION_FIELD,
} from '../form-action.js';
import { isRepeat } from '../repeat.js';
import { isSuspense } from '../suspense.js';
import { isUnsafeHTML, isLive, isKeyed, isGuard, isTemplateContent, isRef, isCache, isUntil, isAsyncAppend, isAsyncReplace, isWatch } from '../directives.js';
import { stringify } from '../serialize.js';
import { isRawtextTag } from './html-scan.js';
import { kebabCase } from './text.js';

/** True in a production build (no dev error surfacing). */
export function isProd() {
  return typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production';
}

/**
 * If `e` is the recognisable failure of touching a browser-only API during
 * SSR (a `ReferenceError` for a browser global, or a `TypeError` calling an
 * HTMLElement method that does not exist on the bare server-side instance),
 * return an actionable, member-naming hint; otherwise null.
 * @param {unknown} e
 * @returns {string | null}
 */
export function browserMemberHint(e) {
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
export function defaultSSRErrorTemplate(tag, err, dev) {
  const surface = dev === undefined ? !isProd() : !!dev;
  if (!surface) return '';
  const msg = err && err.message ? err.message : String(err);
  return html`<div data-webjs-error="${tag}" style="border:1px solid #f5c2c7;background:#f8d7da;color:#842029;padding:8px 12px;border-radius:6px;font:13px/1.4 system-ui,sans-serif">
    <strong>&lt;${tag}&gt; failed to render</strong>
    <div style="margin-top:4px;white-space:pre-wrap">${msg}</div>
  </div>`;
}

/**
 * @param {unknown} value
 * @param {SuspenseCtx} [ctx]
 * @returns {Promise<string>}
 */
export async function render(value, ctx) {
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
export async function renderTemplate(tr, ctx) {
  const { strings, values } = tr;
  let out = '';
  let state = 'text';
  let attrName = '';
  let attrStart = 0;
  let attrQuote = '';
  let commentDashes = 0;
  let currentTag = '';
  let rawTail = '';
  let tagStart = -1;
  /** @type {string | null} */
  let pendingActionId = null;
  /** @type {string | null} */
  let pendingSubmitterTag = null;
  // Shapes on the CURRENT start tag that a bound form may not carry (#1155).
  // Collected as the tag is scanned and judged at its `>`, because the action
  // hole may come after them.
  let pendingActionCount = 0;
  /** @type {string[]} */
  let pendingPropAttrs = [];
  /** @type {string[]} */
  let pendingSubmitterProps = [];

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
          if (c === '<') { state = 'tag-open'; tagStart = out.length - 1; }
          break;
        case 'tag-open':
          out += c;
          if (c === '!') state = 'bang-1';
          else if (c === '/') { state = 'tag-name'; currentTag = ''; }
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
            // alone. No `formaction` url is emitted, so the submission targets
            // whatever the FORM targets, and a form-level identity is simply
            // overridden by this later entry.
            //
            // Refused here rather than at the `>` only where the answer cannot
            // change later: an attribute written BEFORE the hole is already in
            // `out`. Everything else waits for the close,
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

/**
 * Recursively render a value, enqueuing HTML chunks into the stream
 * controller as they become available.
 *
 * @param {unknown} value
 * @param {SuspenseCtx} [ctx]
 * @param {ReadableStreamDefaultController<string>} controller
 */
export async function streamRender(value, ctx, controller) {
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
export async function streamTemplate(tr, ctx, controller) {
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
  let pendingSubmitterTag = null;

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
          if (c === '<') { state = 'tag-open'; tagStart = buf.length - 1; }
          break;
        case 'tag-open':
          buf += c;
          if (c === '!') state = 'bang-1';
          else if (c === '/') { state = 'tag-name'; currentTag = ''; }
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
