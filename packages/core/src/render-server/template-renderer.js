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
import { injectDSD, kebabCase, decodeAttrEntities, isRawtextTag } from './dsd.js';

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
  let pendingActionId = null;
  let pendingSubmitterTag = null;
  let pendingActionCount = 0;
  let pendingPropAttrs = [];
  let pendingSubmitterProps = [];

  const closeBoundFormTag = () => {
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
      out = out.slice(0, tagStart)
        + bindSubmitterStartTag(out.slice(tagStart), submitterTag, { duplicateAction, propAttrs: submitterProps });
    }
  };

  const notePropAttr = (name, tag) => {
    const t = String(tag).toLowerCase();
    if (t === 'button' || t === 'input') {
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
      if (val && typeof /** @type any */ (val).then === 'function') {
        val = await val;
      }
      if (state === 'comment') {
        out += String(val ?? '');
        commentDashes = 0;
      } else if (state === 'rawtext') {
        out += String(val ?? '');
        rawTail = '';
      } else if (state === 'text') {
        out += await render(val, ctx);
      } else if (state === 'after-eq') {
        const prefix = attrName[0];
        const name = attrName.slice(1);
        const kind = BINDING_PREFIXES[prefix];
        if (kind === 'event') {
          out = out.slice(0, attrStart);
          state = 'in-tag';
          attrName = '';
        } else if (kind === 'prop') {
          out = out.slice(0, attrStart);
          if (currentTag === 'webjs-suspense' && name === 'fallback') {
            const fbHtml = await render(val, ctx);
            out += `data-webjs-fallback="${escapeAttr(fbHtml)}"`;
            state = 'in-tag';
            attrName = '';
            continue;
          }
          if (!currentTag.includes('-')) {
            assertNotFunctionReflectedActionProp(val, name, currentTag);
            notePropAttr(name, currentTag);
            state = 'in-tag';
            attrName = '';
            continue;
          }
          if (val === undefined) {
            state = 'in-tag';
            attrName = '';
            continue;
          }
          try {
            const encoded = await stringify(val);
            out += `data-webjs-prop-${kebabCase(name)}="${escapeAttr(encoded)}"`;
          } catch (e) {
            console.warn(
              `[webjs] property binding .${name} has an unserializable `
              + `value during SSR. Dropping. The browser will see the `
              + `property as undefined. Detail: ${e && e.message}`
            );
          }
          state = 'in-tag';
          attrName = '';
        } else if (kind === 'bool') {
          assertNotFunctionActionAttr(val, name, currentTag);
          out = out.slice(0, attrStart);
          if (val) out += `${name}=""`;
          state = 'in-tag';
          attrName = '';
        } else if (isBoundFormAction(val, attrName, currentTag)) {
          noteActionHole(attrName, currentTag);
          if (currentTag === 'form') {
            pendingActionId = assertIdentifiableAction(await resolveFormActionId(val), currentTag);
            out = out.slice(0, attrStart).replace(/\s+$/, '');
          } else {
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
          noteActionHole(attrName, currentTag);
          assertNotFunctionActionAttr(val, attrName, currentTag);
          out += `"${escapeAttr(String(val ?? ''))}"`;
          state = 'in-tag';
          attrName = '';
        }
      } else if (state === 'attr-quoted' || state === 'attr-unquoted') {
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

export async function streamTemplate(tr, ctx, controller) {
  const { strings, values } = tr;
  let state = 'text';
  let attrName = '';
  let attrStart = 0;
  let attrQuote = '';
  let commentDashes = 0;
  let currentTag = '';
  let rawTail = '';
  let buf = '';
  let tagStart = -1;
  let pendingActionId = null;
  let pendingActionCount = 0;
  let pendingPropAttrs = [];
  let pendingSubmitterProps = [];
  let pendingSubmitterTag = null;

  const closeBoundFormTag = () => {
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
      buf = buf.slice(0, tagStart)
        + bindSubmitterStartTag(buf.slice(tagStart), submitterTag, { duplicateAction, propAttrs: submitterProps });
    }
  };
  const notePropAttr = (name, tag) => {
    const t = String(tag).toLowerCase();
    if (t === 'button' || t === 'input') {
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
        if (buf) { controller.enqueue(buf); buf = ''; }
        await streamRender(val, ctx, controller);
      } else if (state === 'after-eq') {
        const prefix = attrName[0];
        const name = attrName.slice(1);
        const kind = BINDING_PREFIXES[prefix];
        if (kind === 'event' || kind === 'prop') {
          if (kind === 'prop' && !currentTag.includes('-')) {
            assertNotFunctionReflectedActionProp(val, name, currentTag);
            notePropAttr(name, currentTag);
          }
          buf = buf.slice(0, attrStart);
          state = 'in-tag';
          attrName = '';
        } else if (kind === 'bool') {
          assertNotFunctionActionAttr(val, name, currentTag);
          buf = buf.slice(0, attrStart);
          if (val) buf += `${name}=""`;
          state = 'in-tag';
          attrName = '';
        } else if (isBoundFormAction(val, attrName, currentTag)) {
          noteActionHole(attrName, currentTag);
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

  if (buf) controller.enqueue(buf);
}
