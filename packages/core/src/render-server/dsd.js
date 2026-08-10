import { lookup, allTags } from '../registry.js';
import { stylesToString, isCSS } from '../css.js';
import { escapeAttr } from '../escape.js';
import { readAttributeValue, resolveAttributeProperty } from '../attribute-reader.js';
import { parse } from '../serialize.js';
import { unsafeHTML } from '../directives.js';
import {
  assertNotFunctionActionAttr, assertNotFunctionReflectedActionProp,
  assertIdentifiableAction, bindFormActionStartTag, isBoundFormAction, resolveFormActionId,
  assertConvergentBoundForm, assertSubmitterHasNoName, assertSubmitterHasNoValue,
  assertSubmitterHasNoFormAttribute,
  assertSingleSubmitterAction, bindSubmitterStartTag, parseStartTagAttrs,
  isSubmitterReflectedProp, FORM_ACTION_FIELD,
} from '../form-action.js';
import NAMED_ENTITIES, { LEGACY_NAMES } from '../html-entities.js';
import { render, defaultSSRErrorTemplate, browserMemberHint } from './template-renderer.js';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** @param {string} tag @returns {boolean} */
function isVoidElement(tag) {
  return VOID_ELEMENTS.has(tag.toLowerCase());
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
export function endOfComment(html, start) {
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
export function endOfScriptContent(html, from) {
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
export function inertRanges(html) {
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
export function inRanges(ranges, index) {
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
export function inertAt(ranges) {
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
export function findClosingTagInString(html, fromIndex, tagName, inert) {
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
export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} tag */
export function isRawtextTag(tag) {
  return tag === 'script' || tag === 'style';
}

/**
 * RCDATA elements: their content is text (character references aside), so a
 * tag-shaped string inside one is not markup. Kept next to `isRawtextTag` so
 * the two lists stay together rather than drifting apart.
 * @param {string} tag
 * @returns {boolean}
 */
export function isRcdataTag(tag) {
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
export function isTextOnlyTag(tag) {
  return isRawtextTag(tag) || isRcdataTag(tag)
    || tag === 'iframe' || tag === 'xmp' || tag === 'noembed'
    || tag === 'noframes' || tag === 'plaintext';
}

/**
 * Minimal attribute string parser.
 * @param {string} attrStr
 * @returns {Record<string,string>}
 */
export function parseAttrs(attrStr) {
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
export function seedServerAttrs(instance, attrs) {
  if (!instance || typeof instance.setAttribute !== 'function') return;
  for (const [name, raw] of Object.entries(attrs)) {
    instance.setAttribute(name, decodeAttrEntities(raw));
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
export function withHostMarker(opening) {
  if (/\sdata-wj-host(?=[\s>=])/i.test(opening)) return opening;
  return `${opening.slice(0, -1)} data-wj-host>`;
}

export function appendReflectedAttrs(opening, instance, presentAttrNames) {
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
export function applyAttrsToInstance(instance, attrs, Cls) {
  for (const [sourceName, sourceValue] of Object.entries(attrs)) {
    // The browser LOWERCASES every attribute name while parsing an HTML
    // document, so `cfgData="x"` reaches the client reader as `cfgdata` and a
    // camelCase name can never match anything in `observedAttributes`.
    // Resolving the source case here made SSR read a name the platform cannot
    // deliver, which is the divergence, not the fix (#1341).
    const resolved = resolveAttributeProperty(Cls, sourceName.toLowerCase());
    // An attribute mapping to no attribute-backed property is IGNORED, exactly
    // as `attributeChangedCallback` ignores it and as lit's reader does. This
    // used to assign it as an instance property (`instance[propName] = raw`),
    // which no browser upgrade ever reproduces, and which on a real
    // HTMLElement could mutate DOM state through `id` / `hidden` / `slot`.
    // `seedServerAttrs` has already applied every source attribute properly,
    // so nothing needs the copy (#1341).
    if (resolved === undefined) continue;
    const { propName, def } = resolved;
    // A browser decodes every character reference BEFORE any reader sees the
    // value, so decode once here, for every branch, and hand the shared reader
    // an already-decoded string exactly as the DOM hands the client one. It
    // used to be a `decode` argument the reader applied on the JSON and
    // converter branches alone, which left a `String`-typed prop holding the
    // raw source text while `getAttribute()` on the client returned the decoded
    // one (#1341).
    //
    // One reader for both sides (#1340): `readAttributeValue` in
    // `attribute-reader.js` is the same function `attributeChangedCallback` in
    // `component.js` calls, so a custom `converter.fromAttribute` runs here
    // too, ahead of type coercion, and the #1253 unparseable-JSON fallback is
    // shared rather than mirrored.
    //
    // A converter that THROWS is not caught here. It lands in the
    // per-component error isolation below, which is deliberate: an author who
    // supplies a converter owns the read, the same rule `_reflectAttribute`
    // states for `toAttribute`. See the comment on `readAttributeValue`.
    instance[propName] = readAttributeValue(def, decodeAttrEntities(sourceValue));
  }
}

/** @param {string} s */
export function camelCase(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Inverse of camelCase. `userName` -> `user-name`, `userID` -> `user-i-d`.
 * Used to serialize property-binding names into HTML attribute names,
 * which are case-insensitive in the parser. The original JS property
 * name is recovered via camelCase() on the consumer side.
 *
 * @param {string} s
 */
export function kebabCase(s) {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** windows-1252 mappings the HTML tokenizer applies to the C1 range. */
const C1_REPLACEMENTS = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

// The trailing `;` is OPTIONAL on the named arm, because a browser decodes a
// legacy semicolon-less reference too. The callback decides which of the two
// forms it has; see `decodeNamed`.
const CHAR_REF = /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([a-zA-Z][a-zA-Z0-9]*)(;?))/g;
// A Map, not the imported object, so a name that collides with something on
// `Object.prototype` misses instead of returning a function. See `decodeNamed`.
const NAMED = new Map(Object.entries(NAMED_ENTITIES));
const LEGACY = new Set(LEGACY_NAMES);

/**
 * Decode HTML character references in an attribute value.
 *
 * `parseAttrs` hands back the literal characters between the quote marks, so
 * nothing has decoded them yet, while a browser decodes EVERY reference before
 * any reader sees the value. This closes that gap (#1341): the full WHATWG
 * named table plus decimal and hexadecimal numeric references, with the
 * tokenizer's own numeric fix-ups (null, a surrogate, and anything past
 * U+10FFFF become U+FFFD; the C1 range maps through windows-1252). It replaced
 * a three-entity `unescapeAttr`, which left a `String`-typed prop undecoded
 * entirely and turned `&lt;script&gt;` into the half-decoded `<script&gt;`.
 *
 * SINGLE PASS on purpose. A replacement is never rescanned, so `&amp;lt;`
 * decodes to the literal `&lt;` and never to `<`. The old function got that
 * from replacing `&amp;` last, which does not generalise past three entities.
 *
 * The 106 legacy semicolon-LESS names are covered too, because a browser really
 * does decode them and measurably: Chromium, Firefox, and WebKit all hand a
 * reader U+00A0 for `s="&nbsp"`. Leaving them literal would have been a value
 * divergence of exactly the kind this function exists to remove, not a
 * harmless non-goal. The rule that governs them, in an ATTRIBUTE value, is a
 * one-character LOOKAHEAD rather than deep tokenizer state, which is why it is
 * implementable here. `decodeNamed` carries the rule and the reason it takes
 * the shape it does; the short version is that `&nbsp` at the end of a value
 * decodes while `&nbspx`, `&nbsp=x`, and `&notin` stay literal, all three
 * verified against the three engines.
 *
 * The same function also decodes `data-webjs-fallback`, which is MARKUP, where
 * the tokenizer applies no such carve-out. Using the attribute rule there is
 * deliberate and strictly conservative: that payload is written by
 * `escapeAttr`, which emits only `&amp;` / `&quot;` / `&lt;`, so every
 * reference in it is semicolon-terminated and never reaches this path.
 *
 * @param {string} s
 * @returns {string}
 */
export function decodeAttrEntities(s) {
  // Load bearing, not a micro-optimisation: skipping the scan for the common
  // no-`&` value is what makes this cheaper per attribute than the three
  // chained `replace` calls it replaced, which paid for three passes always.
  if (s.indexOf('&') === -1) return s;
  return s.replace(CHAR_REF, (match, dec, hex, name, semi, offset) => {
    if (dec !== undefined) return fromCodePoint(parseInt(dec, 10));
    if (hex !== undefined) return fromCodePoint(parseInt(hex, 16));
    return decodeNamed(match, name, semi === ';', s[offset + match.length]);
  });
}

/**
 * Resolve one named reference, semicolon-terminated or legacy.
 *
 * The table is read through a `Map` rather than by indexing the imported
 * object. An object-literal lookup resolves through `Object.prototype`, so
 * `&constructor;` / `&toString;` / `&hasOwnProperty;` and four more returned a
 * FUNCTION instead of `undefined` and threw on the spread in
 * `codePointsToString`, a path `seedServerAttrs` reaches for every attribute of
 * every custom element, which rendered the whole component as an SSR error box.
 * A browser leaves those literal, since they are not named references, so the
 * throw was a divergence of exactly the kind this file exists to remove. A
 * `Map` has no prototype chain to fall through, which closes the shape rather
 * than guarding one call site.
 *
 * WHY THERE IS NO LONGEST-PREFIX LOOP. The tokenizer consumes the longest name
 * in the table, so `&notin` is `&not` followed by `in`. Here that always
 * collapses to the whole name: `CHAR_REF` captures `[a-zA-Z][a-zA-Z0-9]*`, so a
 * prefix SHORTER than the name is by construction followed by an ASCII
 * alphanumeric, which is precisely when the attribute carve-out declines to
 * decode. A loop over shorter prefixes could therefore only ever return
 * `match`, which is what falling through to the end already does. `&notin`
 * stays literal either way, verified against the three engines, though note it
 * gets there by not being a legacy name rather than by the carve-out.
 *
 * That same greediness means an ASCII alphanumeric character can never follow
 * the match: whatever follows is by construction not `[a-zA-Z0-9]`, or the
 * capture would have eaten it. So only the `=` check is needed for the
 * attribute carve-out. `&nbspx` is literal because `nbspx` is not a legacy
 * name, NOT because of the lookahead; `&nbsp=x` is the shape the lookahead
 * actually decides.
 *
 * @param {string} match  the whole matched reference, returned unchanged when nothing decodes
 * @param {string} name   the name, with no `&` and no `;`
 * @param {boolean} hadSemi
 * @param {string|undefined} nextChar  the character after the match, if any
 * @returns {string}
 */
export function decodeNamed(match, name, hadSemi, nextChar) {
  if (hadSemi) {
    const cp = NAMED.get(name);
    return cp === undefined ? match : codePointsToString(cp);
  }
  if (!LEGACY.has(name)) return match;
  // The attribute carve-out: a legacy name decodes only when what follows is
  // neither `=` nor an ASCII alphanumeric. Nothing following at all (the end of
  // the value) decodes, which is the common `s="&nbsp"` shape. Because CHAR_REF
  // captures greedily, what follows is never an ASCII alphanumeric, so only `=`
  // needs to be checked here.
  if (nextChar === '=') return match;
  // Every legacy name is in the table under the same name, asserted by a test
  // rather than left to trust, so this cannot miss.
  return codePointsToString(NAMED.get(name));
}

/** @param {number|number[]} cp */
export function codePointsToString(cp) {
  return typeof cp === 'number' ? String.fromCodePoint(cp) : String.fromCodePoint(...cp);
}

/**
 * The tokenizer's numeric character reference fix-ups.
 * @param {number} n
 * @returns {string}
 */
export function fromCodePoint(n) {
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '\uFFFD';
  if (C1_REPLACEMENTS[n] !== undefined) return String.fromCodePoint(C1_REPLACEMENTS[n]);
  return String.fromCodePoint(n);
}

export function consumePropAttrs(attrs) {
  const props = {};
  for (const key of Object.keys(attrs)) {
    if (!key.startsWith('data-webjs-prop-')) continue;
    const propName = camelCase(key.slice('data-webjs-prop-'.length));
    try {
      props[propName] = parse(decodeAttrEntities(attrs[key]));
    } catch {}
    delete attrs[key];
  }
  return props;
}
