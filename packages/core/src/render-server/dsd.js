import { lookup, allTags } from '../registry.js';
import { stylesToString, isCSS } from '../css.js';
import { unsafeHTML } from '../directives.js';
import { render, defaultSSRErrorTemplate, browserMemberHint } from './template-renderer.js';
import { escapeRegex, findClosingTagInString, inertAt, inertRanges } from './html-scan.js';
import { decodeAttrEntities } from './text.js';
import {
  appendReflectedAttrs, applyAttrsToInstance, consumePropAttrs, parseAttrs, seedServerAttrs,
  withHostMarker,
} from './attrs.js';
import { partitionAuthoredBySlot, substituteSlotsInRender } from './slots.js';

/**
 * Declarative Shadow DOM injection: the SSR pass that walks rendered HTML for
 * registered custom elements, instantiates each one, renders it, and splices
 * the result back in.
 *
 * The string-scanning primitives live in `html-scan.js`, the attribute plumbing
 * in `attrs.js`, the light-DOM slot projection in `slots.js`, and name-case /
 * entity decoding in `text.js`. This module owns the walk itself and the
 * `<webjs-suspense>` pass that runs ahead of it.
 *
 * The dependency on `template-renderer.js` is one-way. That module reaches back
 * only for `isRawtextTag` and `kebabCase`, and takes both from the leaves
 * above, which is what keeps this directory acyclic.
 */

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
export async function injectDSD(html, ctx, ancestors = [], dev) {
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
      // This is a SEPARATE render pass over one component's own template,
      // driven by walking the already-emitted HTML, so it has no idea whether
      // the host tag sits inside a `<form>`. It does not need to: a bound
      // submitter carries its whole submission (#1307), so nothing here asks
      // about an enclosing form.
      const rawInner = await render(tpl, ctx);

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
export async function processSuspenseElements(html, ctx, ancestors = [], dev) {
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
    const fallbackHtml = fbMatch ? decodeAttrEntities(fbMatch[1]) : '';

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
