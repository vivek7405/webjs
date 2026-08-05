import { isTemplate, MARKER } from './html.js';
import { BINDING_PREFIXES, isBindingPrefix } from './binding-prefixes.js';
import { escapeAttr } from './escape.js';
import {
  assertNotFunctionActionAttr, assertNotFunctionReflectedActionProp,
  reconcileFormAction, isBoundFormAction, ABSENT, assertSubmitterHasNoName,
  assertSubmitterType, assertSubmitterHasNoValue, assertSubmitterHasNoStaticFormAction,
  assertSubmitterHasNoFormAttribute, assertSingleSubmitterAction,
  assertSubmitterFormIsBound, assertSubmitterSubmission, assertBoundFormSubmitters,
  assertConvergentSubmitter, isSubmitterReflectedProp,
  formActionId, assertIdentifiableAction, FORM_ACTION_FIELD,
} from './form-action.js';
import { isRepeat } from './repeat.js';
import { isUnsafeHTML, isLive, isKeyed, isGuard, isTemplateContent, isRef, isCache, isUntil, isAsyncAppend, isAsyncReplace, isWatch } from './directives.js';
import { Signal } from './signal.js';
import {
  LIGHT_SLOT_ATTR,
  PROJECTION_ATTR,
  PROJECTION_FALLBACK,
  SLOT_FALLBACK_FRAG,
  SLOT_STATE,
  SLOT_OWNER,
  RENDERING,
  applySlotAssignments,
  rescueAssignedNodes,
  withRendererWrites,
  drainRendererBackstop,
} from './slot.js';

/**
 * Open the renderer-write window on a light-DOM host while `fn` commits into
 * it, so the host's patched slot-interception methods delegate to native and
 * a renderer commit is never mistaken for authored content. A no-op (just runs
 * `fn`) when `node` is not a slot host, so nested and non-host commits pay
 * nothing. Covers the ASYNC commit paths (async directives, streaming) that
 * run outside a synchronous render() call.
 */
function commitInto(node, fn) {
  const host = node && /** @type {any} */ (node)[SLOT_STATE] ? node : null;
  if (!host) return fn();
  return withRendererWrites(host, fn);
}

/**
 * Client-side renderer with **fine-grained** updates.
 *
 * Each TemplateResult is compiled once (keyed by the tagged-template's
 * `strings` array identity, so reuse is free across renders) into:
 *   - a `<template>` element with static HTML + marker comments/attributes
 *     at each dynamic hole
 *   - a list of `Part` descriptors (kind + DOM location + attr/event name)
 *
 * On first render the template is cloned into the container and each Part
 * is bound to the freshly-created node. Subsequent renders compare the new
 * values to the last-applied values and only touch parts that changed.
 * Text-position holes containing nested TemplateResults reuse the existing
 * child instance when the inner `strings` match; they only rebuild when the
 * template shape changes.
 *
 * Consequences worth knowing:
 *   - Input focus, cursor position, selection, and scroll inside components
 *     survive re-renders triggered by property assignments, signal changes,
 *     or `requestUpdate()`.
 *   - Event listeners are attached once and retargeted when the handler
 *     reference changes (swap-in-place via a dispatch closure, so `addEventListener`
 *     isn't churned every render).
 *   - A plain `.map()` array reconciles POSITIONALLY (non-keyed), matching
 *     lit-html: each index updates its item instance in place when the
 *     template shape is unchanged, so DOM node identity (and the focus,
 *     selection, scroll, and in-progress native drag it carries) survives an
 *     item-level update. See `reconcileArray`. Keyed reordering still needs
 *     the `repeat()` directive.
 */

/**
 * One `method` / `enctype` hole on a candidate bound form. `statics` / `group`
 * are carried for a mixed attribute, whose value is the concatenation of its
 * static pieces and every one of its holes.
 *
 * @typedef {{ i: number, kind: string, statics?: string[], group?: number[] }} FormAttrPart
 */

/**
 * What one `<form action=${...}>` in a template needs at reconcile time (#1155).
 * Every field is a property of the TEMPLATE, computed once per template literal
 * call site, so it cannot drift out of step with the live DOM.
 *
 * @typedef {{
 *   actionIdxs: number[],
 *   duplicateAction: boolean,
 *   staticAction: boolean,
 *   authoredName: boolean,
 *   authoredValue: boolean,
 *   authoredForm: boolean,
 *   nameParts: {i: number, kind: string}[],
 *   valueParts: {i: number, kind: string}[],
 *   propAttrs: string[],
 *   staticMethod: string | null,
 *   staticEnctype: string | null,
 *   methodParts: FormAttrPart[],
 *   enctypeParts: FormAttrPart[],
 * }} FormActionRecord
 */

/** @type {WeakMap<TemplateStringsArray | string[], { templateEl: HTMLTemplateElement, parts: PartDescriptor[], formActions: FormActionRecord[] | null }>} */
const templateCache = new WeakMap();
/**
 * Forms whose `action` hole currently holds a function (#1207). Read by a
 * submitter that reconciles before its form does, so it can tell a form that is
 * about to be bound from one that never will be. Keyed weakly so a detached
 * form is collected with its entry.
 * @type {WeakMap<HTMLFormElement, unknown>}
 */
const formActionCandidates = new WeakMap();
/**
 * Submitters this renderer stamped with an identity, so a later release removes
 * only the framework's own `name` / `value` and never an author's.
 * @type {WeakMap<Element, string>}
 */
const submitterActionBindings = new WeakMap();
const INSTANCE = Symbol.for('webjs.instance');

/**
 * @typedef {{
 *   kind: 'child' | 'attr' | 'attr-mixed' | 'event' | 'prop' | 'bool' | 'element' | 'slot' | 'noop',
 *   path: number[],
 *   name?: string,
 *   statics?: string[],
 *   group?: number[],
 * }} PartDescriptor
 *
 * @typedef {{
 *   strings: TemplateStringsArray | string[],
 *   bound: BoundPart[],
 *   lastValues: unknown[],
 *   startNode: Comment,
 *   endNode: Comment,
 * }} TemplateInstance
 *
 * @typedef {
 *   | { kind: 'child', marker: Comment, child?: TemplateInstance | ChildNode[] }
 *   | { kind: 'attr', el: Element, name: string }
 *   | { kind: 'attr-mixed', el: Element, name: string, statics: string[], group: number[] }
 *   | { kind: 'event', el: Element, name: string, handler: ((e: Event) => void) | null, dispatcher: (e: Event) => void }
 *   | { kind: 'prop', el: Element, name: string }
 *   | { kind: 'bool', el: Element, name: string }
 *   | { kind: 'element', el: Element, lastTarget?: any }
 *   | { kind: 'slot', slotEl: HTMLSlotElement, applied: boolean }
 *   | { kind: 'noop' }
 * } BoundPart
 */

/**
 * The container the in-progress `render()` is committing into, or null
 * outside one. Every part created or applied during that render belongs to
 * THIS container's component, which is what an out-of-band commit needs to
 * know to reach the right error boundary. A structural parent walk cannot
 * work it out: `html`<child-el>${watch(sig)}</child-el>`` puts the part in the
 * PARENT's template but inside the child's tag, so the walk meets the child
 * first. Same reason `SLOT_OWNER` exists.
 * @type {any}
 */
let currentRenderRoot = null;

/**
 * The element carrying the error boundary for a render root. A ShadowRoot has
 * no boundary of its own; its `.host` is the component.
 * @param {any} root
 * @returns {any}
 */
function boundaryOwnerOf(root) {
  if (!root) return null;
  if (root.nodeType === 11 && root.host) return root.host;
  return root;
}

/**
 * Run an OUT-OF-BAND commit (a `watch` notify microtask, an `until`
 * resolution) with the part's owner installed as the current render root.
 *
 * Without this the commit runs with no owner in scope, so any `watch` /
 * `until` nested INSIDE the template it commits is installed unstamped and
 * its own later throw escapes to the window. A directive nested in that
 * template belongs to the same component as the part committing it, which is
 * exactly the owner already recorded here.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {() => void} fn
 */
function commitOutOfBand(part, fn) {
  const owner = /** @type any */ (part).__commitOwner;
  const prev = currentRenderRoot;
  if (owner) currentRenderRoot = owner;
  try {
    fn();
  } finally {
    currentRenderRoot = prev;
  }
}

/**
 * Render a value into a container, reusing DOM where possible.
 *
 * @param {unknown} value
 * @param {Element | DocumentFragment | ShadowRoot} container
 */
export function render(value, container) {
  const host = /** @type any */ (container);
  // Open the renderer-write window for the whole commit: every host-receiver
  // write below (and in createInstance / updateInstance / clearInstance / all
  // part commits they reach synchronously) then bypasses the slot interception
  // that is patched onto a light host. This is the single discriminator
  // between a renderer commit and an author write.
  const prevRendering = host[RENDERING];
  host[RENDERING] = true;
  const prevRenderRoot = currentRenderRoot;
  currentRenderRoot = container;
  try {
    const prev = host[INSTANCE];

    if (isTemplate(value)) {
      const tr = /** @type {import('./html.js').TemplateResult} */ (value);
      if (prev && prev.strings === tr.strings) {
        updateInstance(prev, tr.values);
        return;
      }
      if (prev) clearInstance(prev, container);

      // Light DOM hydration: if container has SSR content (marked by
      // <!--webjs-hydrate-->), remove the marker and proceed with normal
      // rendering. The content will be replaced with identical output -
      // no visible flash because SSR and client render produce the same HTML.
      const firstChild = container.firstChild;
      if (firstChild && firstChild.nodeType === 8 && /** @type {Comment} */ (firstChild).data === 'webjs-hydrate') {
        firstChild.remove();
      }

      // Pre-set the symbol to an explicit null BEFORE the commit,
      // UNCONDITIONALLY: if createInstance throws after its replaceChildren
      // (e.g. inside the slot-part apply loop), the finally-drain must see
      // "rendered, no instance" (discard the commit's records), never
      // "never rendered" (fold and corrupt) and never a STALE cleared prev
      // instance on the template-swap path (whose bookends would misclassify
      // the half-committed new roots as unowned and fold them).
      host[INSTANCE] = null;
      const inst = createInstance(tr, container);
      host[INSTANCE] = inst;
      return;
    }

    // Non-template value: treat as a single text child.
    if (prev) clearInstance(prev, container);
    host[INSTANCE] = null;
    container.replaceChildren();
    if (value == null || value === false || value === true) return;
    if (Array.isArray(value)) {
      for (const v of value) {
        const text = document.createTextNode(String(v ?? ''));
        container.appendChild(text);
      }
      return;
    }
    container.appendChild(document.createTextNode(String(value)));
  } finally {
    currentRenderRoot = prevRenderRoot;
    host[RENDERING] = prevRendering;
    // Outermost window closing: drain this commit's childList records off the
    // slot backstop (drainRendererBackstop processes them with a renderer-output
    // skip when an instance exists, else discards), so the backstop never folds
    // renderer output. Mirrors withRendererWrites, used by the async paths.
    if (!prevRendering) drainRendererBackstop(host);
  }
}

/* ================================================================
 * Template compilation
 * ================================================================ */

/** @param {import('./html.js').TemplateResult} tr */
function compile(tr) {
  const { strings } = tr;
  let cached = templateCache.get(strings);
  if (cached) return cached;

  /** @type {PartDescriptor[]} */
  const parts = [];
  let html = '';
  let state = 'text';
  let attrName = '';
  let attrStart = 0;
  let attrQuote = '';
  let commentDashes = 0;
  /** @type {{ name: string, firstPartIdx: number } | null} */
  let mixedAttr = null;
  let currentTag = '';
  let rawTail = '';

  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      switch (state) {
        case 'text':
          html += c;
          if (c === '<') state = 'tag-open';
          break;
        case 'tag-open':
          html += c;
          if (c === '!') state = 'bang-1';
          else if (c === '/') { state = 'tag-name'; currentTag = ''; }
          else if (/[a-zA-Z]/.test(c)) { state = 'tag-name'; currentTag = c.toLowerCase(); }
          else state = 'text';
          break;
        case 'bang-1':
          html += c;
          state = c === '-' ? 'bang-dash' : 'tag-name';
          break;
        case 'bang-dash':
          html += c;
          if (c === '-') { state = 'comment'; commentDashes = 0; }
          else state = 'tag-name';
          break;
        case 'comment':
          html += c;
          if (c === '-') commentDashes += 1;
          else if (c === '>' && commentDashes >= 2) { state = 'text'; commentDashes = 0; }
          else commentDashes = 0;
          break;
        case 'tag-name':
          html += c;
          if (c === '>') {
            state = (currentTag === 'script' || currentTag === 'style') ? 'rawtext' : 'text';
            if (state === 'rawtext') rawTail = '';
          } else if (/\s/.test(c)) state = 'in-tag';
          else currentTag += c.toLowerCase();
          break;
        case 'in-tag':
          html += c;
          if (c === '>') {
            state = (currentTag === 'script' || currentTag === 'style') ? 'rawtext' : 'text';
            if (state === 'rawtext') rawTail = '';
          } else if (!/\s/.test(c) && c !== '/') {
            state = 'attr-name';
            attrName = c;
            attrStart = html.length - 1;
          }
          break;
        case 'rawtext':
          html += c;
          rawTail = (rawTail + c.toLowerCase()).slice(-9);
          if (rawTail.endsWith('</script>') || rawTail.endsWith('</style>')) {
            state = 'text';
            rawTail = '';
            currentTag = '';
          }
          break;
        case 'attr-name':
          if (c === '=') { state = 'after-eq'; html += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; html += c; }
          else if (c === '>') { state = 'text'; attrName = ''; html += c; }
          else { attrName += c; html += c; }
          break;
        case 'after-eq':
          if (c === '"' || c === "'") { state = 'attr-quoted'; attrQuote = c; html += c; }
          else if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; html += c; }
          else if (c === '>') { state = 'text'; attrName = ''; html += c; }
          else { state = 'attr-unquoted'; html += c; }
          break;
        case 'attr-unquoted':
          if (/\s/.test(c)) { state = 'in-tag'; attrName = ''; html += c; }
          else if (c === '>') { state = 'text'; attrName = ''; html += c; }
          else html += c;
          break;
        case 'attr-quoted':
          html += c;
          if (c === attrQuote) { state = 'in-tag'; attrName = ''; }
          break;
        case 'skip-attr':
          // Consume mixed-attribute chars without appending to html.
          // The attribute was replaced with a sentinel on the first hole.
          if (c === attrQuote) {
            // Closing quote: finalize the attr-mixed part.
            if (mixedAttr) {
              const idx0 = mixedAttr.firstPartIdx;
              const group = [];
              for (let k = idx0; k < parts.length; k++) {
                if (parts[k].kind === 'noop' || parts[k].kind === 'attr-mixed') group.push(k);
              }
              // Build statics from the template strings array.
              // For `attr="a ${x} b ${y} c"`, group=[idx0,idx1].
              // statics[0] = tail of strings[idx0] after the `="`
              // statics[1] = strings[idx1] (between holes)
              // statics[n] = prefix of strings[last+1] up to closing quote
              const statics = [];
              const s0 = strings[group[0]];
              const qp = s0.lastIndexOf(attrQuote);
              statics.push(qp >= 0 ? s0.slice(qp + 1) : s0);
              for (let k = 1; k < group.length; k++) {
                statics.push(strings[group[k]]);
              }
              const sLast = strings[group[group.length - 1] + 1];
              const eq = sLast.indexOf(attrQuote);
              statics.push(eq >= 0 ? sLast.slice(0, eq) : sLast);

              parts[idx0] = {
                kind: 'attr-mixed',
                path: [],
                name: mixedAttr.name,
                statics,
                group,
              };
              // The mixed attribute is rebuilt from ALL its holes' values, but
              // it is anchored at a single part (group[0]). The later holes stay
              // `noop`, so a change confined to one of them would be skipped by
              // updateInstance's per-hole dirty-check and the attribute would go
              // stale. Point every non-anchor member back at the anchor so a
              // change to any hole re-applies the whole attribute.
              for (let m = 1; m < group.length; m++) {
                parts[group[m]] = { kind: 'noop', path: [], mixedAnchor: idx0 };
              }
              mixedAttr = null;
            }
            state = 'in-tag';
            attrName = '';
          }
          break;
      }
    }

    if (i < strings.length - 1) {
      const partIdx = parts.length;
      if (state === 'comment') {
        // Holes inside <!-- ... --> are dropped. Comments are inert and
        // the compile cache is keyed on `strings`, so per-render values
        // can't be baked in anyway.
        commentDashes = 0;
        parts.push({ kind: 'noop', path: [] });
        continue;
      }
      if (state === 'rawtext') {
        // Inside <script>/<style>: per-render interpolation isn't supported;
        // the compile cache would lock in whatever was first rendered. The
        // hole is dropped and authors should set body text via a child part
        // outside the raw-text container, or inline style/script directly.
        rawTail = '';
        parts.push({ kind: 'noop', path: [] });
        continue;
      }
      if (state === 'text') {
        // Child hole: insert a comment marker. Use bracketed markers so we can
        // later walk all comments and find ours without ambiguity.
        html += `<!--${MARKER}${partIdx}-->`;
        parts.push({ kind: 'child', path: [] });
      } else if (state === 'in-tag') {
        // Element-position hole: `<tag ${expr}>`. Used by the `ref` directive
        // (and any future element-bound directive). Emit a sentinel attribute
        // on the current open tag; at bind time the attribute is stripped
        // and the element is captured into the part.
        const sentinel = `data-${MARKER}${partIdx}`;
        html += `${sentinel}=""`;
        parts.push({ kind: 'element', path: [] });
      } else if (state === 'after-eq') {
        const prefix = attrName[0];
        const name = attrName.slice(1);
        if (isBindingPrefix(prefix)) {
          // Strip the attribute name+"=" from html and add a sentinel attr.
          html = html.slice(0, attrStart);
          const kind = BINDING_PREFIXES[prefix];
          const sentinel = `data-${MARKER}${partIdx}`;
          html += `${sentinel}=""`;
          parts.push({ kind, path: [], name });
        } else {
          // Regular attribute: rewrite to `attrName="__MARKER__"` and parse as attr.
          html = html.slice(0, attrStart);
          const sentinel = `data-${MARKER}${partIdx}`;
          html += `${sentinel}=""`;
          parts.push({ kind: 'attr', path: [], name: attrName });
        }
        state = 'in-tag';
        attrName = '';
      } else if (state === 'attr-quoted' || state === 'attr-unquoted') {
        // First hole inside a quoted attribute value: start mixed-attr tracking.
        // Replace the entire attribute with a sentinel (same as regular attr).
        html = html.slice(0, attrStart);
        const sentinel = `data-${MARKER}${partIdx}`;
        html += `${sentinel}=""`;
        mixedAttr = { name: attrName, firstPartIdx: partIdx };
        parts.push({ kind: 'noop', path: [] }); // patched to attr-mixed at close-quote
        state = 'skip-attr';
      } else if (state === 'skip-attr') {
        // Subsequent hole in the same mixed attribute.
        parts.push({ kind: 'noop', path: [] });
      }
    }
  }

  const templateEl = document.createElement('template');
  templateEl.innerHTML = html;

  // Mark every <slot> in the template for framework projection and
  // register a SLOT part for each so the slot-apply step can find them on
  // clones. This runs BEFORE assignPaths so the sentinel attributes the
  // discovery step adds are picked up in the same path-recording walk.
  discoverSlots(templateEl.content, parts);

  // Walk the parsed fragment and record DOM paths for each part. It also
  // returns the per-template form-action records (#1155), null when the
  // template contains no bound-form candidate, which is the overwhelmingly
  // common case and keeps the reconcile out of every other template's path.
  const formActions = assignPaths(templateEl.content, parts);

  cached = { templateEl, parts, formActions };
  templateCache.set(strings, cached);
  return cached;
}

/**
 * Walk the compiled template content for <slot> elements (the static ones
 * written into the template, not dynamically-inserted ones). For each:
 *   1. Add the `data-webjs-light` attribute so slot.js's polyfilled APIs
 *      recognise it as a framework-managed light-DOM slot.
 *   2. Add a sentinel attribute (`data-MARKER<idx>`) so the subsequent
 *      assignPaths walk records the slot's path into the new SLOT part.
 *   3. Move the slot's authored children into a `fallbackTemplate`
 *      DocumentFragment stored on the PartDescriptor. The slot in the
 *      cached template becomes empty, so every clone starts empty too.
 *      bindPart clones a fresh fallback fragment per instance from this
 *      template, giving each instance an independent fallback supply
 *      that slot.js swaps in via the SLOT_FALLBACK_FRAG symbol.
 *
 *   Fallback content with template holes (`<slot>fallback ${x}</slot>`)
 *   is captured as a static-HTML snapshot of the template state at
 *   compile time. Dynamic holes inside fallback content are not
 *   re-bound per instance in v1; authors should put dynamic content
 *   outside the slot.
 *
 * @param {DocumentFragment} root
 * @param {PartDescriptor[]} parts
 */
function discoverSlots(root, parts) {
  const slots = root.querySelectorAll('slot');
  for (const slot of slots) {
    slot.setAttribute(LIGHT_SLOT_ATTR, '');
    const partIdx = parts.length;
    slot.setAttribute(`data-${MARKER}${partIdx}`, '');
    parts.push({ kind: 'slot', path: [] });
  }
  // NOTE: fallback content stays IN the slot's children in the cached
  // template. Each clone gets its own copy. For shadow-DOM components,
  // native browser projection uses those children as fallback content
  // when no light child matches. For light-DOM components, the slot's
  // apply step (run after the cloned template is in the live tree)
  // moves the cloned fallback into a per-instance holding fragment
  // owned by slot.js, so the slot is empty and ready to receive
  // projected children. Doing the strip at apply time, not at compile
  // time, lets a single cached template serve both DOM modes.
}

/**
 * Walk the template fragment and record the path (chain of child indices) to
 * each part's anchor node. We use marker comments for child parts and sentinel
 * attributes for everything else.
 *
 * @param {DocumentFragment} root
 * @param {PartDescriptor[]} parts
 */
function assignPaths(root, parts) {
  /** @type {number[]} */
  const path = [];
  /** @type {FormActionRecord[]} */
  const formActions = [];
  /** @param {Node} node */
  function visit(node) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      path.push(i);
      // Comment marker?
      if (child.nodeType === 8) {
        const txt = /** @type Comment */ (child).data;
        if (txt.startsWith(MARKER)) {
          const idx = Number(txt.slice(MARKER.length));
          if (parts[idx] && parts[idx].kind === 'child') {
            parts[idx].path = path.slice();
          }
        }
      } else if (child.nodeType === 1) {
        const el = /** @type Element */ (child);
        // Sentinel attribute?
        const toRemove = [];
        /** Every part bound to THIS element, which only this walk can see. */
        /** @type {{ idx: number, kind: string, name: string }[]} */
        const onEl = [];
        for (const attr of el.attributes) {
          if (attr.name.startsWith(`data-${MARKER}`)) {
            const idx = Number(attr.name.slice(`data-${MARKER}`.length));
            if (parts[idx] && parts[idx].kind !== 'child') {
              parts[idx].path = path.slice();
              onEl.push({ idx, kind: parts[idx].kind, name: parts[idx].name || '' });
            }
            toRemove.push(attr.name);
          }
        }
        // #1155 / #1207: record what a bound form or submitter needs, while the
        // STATIC attributes and the element's part indices are both still
        // visible. This is the only point in compilation with that whole view,
        // and it runs once per template, so the record is a constant rather
        // than runtime memory that can drift out of step with the DOM. It is
        // also the only place a submitter's own `name` is still legible: by
        // reconcile time the renderer has written the identity over it.
        if (el.localName === 'form' || el.localName === 'button' || el.localName === 'input') {
          const rec = buildFormActionRecord(el, onEl, parts);
          if (rec) formActions.push(rec);
        }
        for (const a of toRemove) el.removeAttribute(a);
        visit(child);
      }
      path.pop();
    }
  }
  visit(root);
  return formActions.length ? formActions : null;
}

/**
 * Build the compile-time record for one `<form>` carrying an `action` hole, or
 * one submitter carrying a `formaction` hole.
 *
 * A CANDIDATE, not a decision: `<form action=${maybeString}>` compiles exactly
 * like a bound one, so whether the form is really bound is a runtime fact the
 * reconcile decides from the value. Everything recorded here is a property of
 * the TEMPLATE, which is why it cannot go stale the way remembering "did the
 * bind supply this attribute" at runtime did.
 *
 * `encoding` folds into `enctype` for a PROPERTY binding only: it is a legacy
 * IDL alias, so `.encoding=` writes the enctype content attribute. As a content
 * attribute `encoding=` is inert (a browser's `form.encoding` reads back
 * `enctype`), and SSR ignores it, so folding the attribute spelling too would
 * make the client honour a value the server never saw.
 *
 * The submitter fields (`authoredName` / `authoredValue` / `authoredForm`) are
 * read off the COMPILED template rather than the live element, for the same
 * reason: by reconcile time the renderer has written its own `name` / `value`
 * onto a bound submitter, so the live element can no longer say which of them
 * the author wrote. A hole-provided `name=${n}` leaves no attribute on the
 * compiled template at all, which is why `nameParts` is tracked separately.
 *
 * @param {Element} el
 * @param {{ idx: number, kind: string, name: string }[]} onEl parts bound to `el`
 * @param {PartDescriptor[]} parts
 * @returns {FormActionRecord | null}
 */
function buildFormActionRecord(el, onEl, parts) {
  const isForm = el.localName === 'form';
  const targetAttr = isForm ? 'action' : 'formaction';
  const actionParts = onEl.filter((p) => p.kind === 'attr' && p.name.toLowerCase() === targetAttr);
  if (!actionParts.length) return null;

  /** @type {FormAttrPart[]} */
  const methodParts = [];
  /** @type {FormAttrPart[]} */
  const enctypeParts = [];
  /** Prop bindings that cannot converge with SSR; refused when actually bound. */
  const propAttrs = [];
  // `name` holes on a submitter, recorded WITH their kind. Whether one occupies
  // the identity's channel is not a property of the hole alone: SSR emits
  // `name=""` for an attribute hole whatever it resolved to, but emits nothing
  // at all for a FALSY boolean hole and nothing for an `@name` listener. Asking
  // only "is there a part called name" therefore refused templates SSR renders
  // happily, which is the render-on-the-server-throw-on-hydration direction.
  // The kinds travel with the record and `reconcileFormActions` resolves them.
  const nameParts = isForm ? [] : onEl
    .filter((p) => p.name.toLowerCase() === 'name'
      && (p.kind === 'attr' || p.kind === 'attr-mixed' || p.kind === 'bool'))
    .map((p) => ({ i: p.idx, kind: p.kind }));
  const authoredName = !isForm && el.hasAttribute('name');
  const authoredForm = !isForm && el.hasAttribute('form');
  const authoredValue = !isForm && el.hasAttribute('value');
  // `value` holes, recorded with their kind for the same reason as `name`: a
  // FALSY boolean hole emits nothing at SSR, so counting the part's mere
  // presence refused a template the server renders happily.
  const valueParts = isForm ? [] : onEl
    .filter((p) => p.name.toLowerCase() === 'value'
      && (p.kind === 'attr' || p.kind === 'attr-mixed' || p.kind === 'bool'))
    .map((p) => ({ i: p.idx, kind: p.kind }));

  for (const p of onEl) {
    const name = String(p.name).toLowerCase();
    if (p.kind === 'prop') {
      // On a FORM, the reflected attributes that decide submittability. On a
      // SUBMITTER, the ones that carry the identity or override the submission
      // (#1207). Either way a `.prop` is dropped at SSR and written to the
      // attribute in the browser, so it can never converge.
      if (isForm) {
        if (name === 'method' || name === 'enctype' || name === 'encoding') propAttrs.push(p.name);
      } else if (isSubmitterReflectedProp(name)) {
        propAttrs.push(p.name);
      }
      continue;
    }
    if (name !== 'method' && name !== 'enctype') continue;
    if (p.kind !== 'attr' && p.kind !== 'attr-mixed' && p.kind !== 'bool') continue;
    const d = /** @type any */ (parts[p.idx]);
    /** @type {FormAttrPart} */
    const entry = { i: p.idx, kind: p.kind };
    // A mixed attribute's value is `statics[0] + v0 + statics[1] + ...`, so the
    // pieces have to travel with the record; reading the anchor's value alone
    // is right only when the statics are empty.
    if (p.kind === 'attr-mixed') { entry.statics = d.statics || []; entry.group = d.group || []; }
    (name === 'method' ? methodParts : enctypeParts).push(entry);
  }

  return {
    isForm,
    tag: el.localName,
    // EVERY action hole, not just the first. SSR refuses two holes whenever
    // ANY of them resolves to a bound action, so recording only the first would
    // let `<form action=${'/legacy'} action=${boundFn}>` slip through the
    // client's release path while SSR throws on the same template.
    actionIdxs: actionParts.map((p) => p.idx),
    duplicateAction: actionParts.length > 1,
    // A static `action="..."` / `formaction="..."` surviving alongside the hole.
    // The compiled template holds the hole as a sentinel attribute, so anything
    // read back under the real name here is the author's own second one.
    staticAction: el.getAttribute(targetAttr) != null,
    authoredName,
    authoredValue,
    authoredForm,
    propAttrs,
    nameParts,
    valueParts,
    staticMethod: el.getAttribute('method'),
    staticEnctype: el.getAttribute('enctype'),
    methodParts,
    enctypeParts,
  };
}

/**
 * Converge every candidate bound form and submitter in this template, after all
 * of its parts have committed. A no-op for the overwhelming majority of
 * templates, which carry no `<form action=${...}>` at all and therefore no
 * record.
 *
 * FORMS FIRST, submitters second, regardless of the order the records were
 * collected in. A submitter asks whether its enclosing form is bound, and the
 * cheapest true answer is the identity field the form's own reconcile just
 * inserted. Document order gets this right for a form and a button in the SAME
 * template, but not for a `<form>` whose submitter arrives through a nested
 * template, so the ordering is made explicit rather than relied upon.
 *
 * @param {FormActionRecord[] | null} formActions
 * @param {BoundPart[]} bound
 * @param {unknown[]} values
 */
function reconcileFormActions(formActions, bound, values) {
  if (!formActions) return;
  /** @type {HTMLFormElement[]} */
  const boundForms = [];
  for (const pass of [true, false]) {
    for (const rec of formActions) {
      if (rec.isForm !== pass) continue;
      // With more than one action hole, the BOUND one decides, whichever
      // position it is written in. Picking `actionIdxs[0]` blindly would send
      // `<form action=${'/url'} action=${boundFn}>` down the release path and
      // ship the broken form SSR refuses outright.
      let idx = rec.actionIdxs[0];
      const targetAttr = rec.isForm ? 'action' : 'formaction';
      for (const i of rec.actionIdxs) {
        if (isBoundFormAction(resolveHoleValue(values[i]), targetAttr, rec.tag)) { idx = i; break; }
      }
      const part = bound[idx];
      if (!part || !part.el) continue;
      const val = resolveHoleValue(values[idx]);
      if (rec.isForm) {
        reconcileFormAction(
          /** @type any */ (part.el),
          val,
          effectiveFormAttr(rec.methodParts, rec.staticMethod, values),
          effectiveFormAttr(rec.enctypeParts, rec.staticEnctype, values),
          rec,
        );
        if (typeof val === 'function' && formActionId(val)) {
          boundForms.push(/** @type any */ (part.el));
        }
      } else {
        // What SSR would have emitted for this pass. An attribute hole always
        // emits (even `name=${null}`, as `name=""`); a boolean hole emits only
        // when truthy. Both identity channels ask the same question, through
        // one predicate, so they cannot drift apart again.
        const emits = (parts) => parts.some((np) => (np.kind === 'bool'
          ? !!resolveHoleValue(values[np.i])
          : true));
        reconcileSubmitterAction(
          /** @type any */ (part.el), val, rec, emits(rec.nameParts), emits(rec.valueParts),
        );
      }
    }
  }
  // Part B (#1207), last, because it reads the DOM state every reconcile above
  // has finished writing. See `assertBoundFormSubmitters`.
  for (const form of boundForms) assertBoundFormSubmitters(form);
}

/**
 * Remove the identity channel previously injected into a submitter.
 *
 * Only ours is removed. `submitterActionBindings` remembers the elements this
 * renderer stamped, and the `name` check covers an SSR'd button meeting its
 * template for the first time on hydration. A button that never carried a
 * binding is left alone, so an author's own `name` / `value` survives a
 * re-render that happens to pass a non-action value.
 *
 * @param {Element} el
 */
function releaseSubmitterAction(el) {
  const injected = submitterActionBindings.has(el) || el.getAttribute('name') === FORM_ACTION_FIELD;
  if (!injected) return;
  if (el.getAttribute('name') === FORM_ACTION_FIELD) el.removeAttribute('name');
  el.removeAttribute('value');
  submitterActionBindings.delete(el);
}

/**
 * Find the enclosing `<form>` by walking parents.
 *
 * Deliberately a parent walk rather than `closest('form')`: the element may
 * still be inside a detached DocumentFragment when this runs, and the walk
 * gives the same answer there for a form and a button in the same template.
 * Returns null when the fragment's root is reached, which is the honest answer
 * for a nested template whose form lives in the parent.
 *
 * @param {Element} el
 * @returns {HTMLFormElement | null}
 */
function enclosingForm(el) {
  let node = el.parentNode;
  while (node) {
    if (node.nodeType === 1 && /** @type {Element} */ (node).localName === 'form') {
      return /** @type {HTMLFormElement} */ (node);
    }
    node = node.parentNode;
  }
  return null;
}

/**
 * Converge a live submitter on what SSR emitted for `<button formaction=${fn}>`
 * (#1207): the `formaction` attribute gone, and the identity in the button's
 * own `name` / `value` pair.
 *
 * The enclosing-form check is BEST EFFORT, and that is a deliberate asymmetry
 * with SSR rather than a gap. SSR reads a linear byte stream and always knows
 * whether the open form was bound, so it refuses an unbound one outright. The
 * client may be reconciling a fragment that is not in the tree yet (a submitter
 * inside a `repeat()` or an array item is built detached, by design, and its
 * form lives in the parent template), where the question has no answer. Asking
 * anyway and throwing on "no" would refuse the single most ordinary shape this
 * feature exists for, a per-row button in a list, on a page SSR renders
 * perfectly. So an UNRESOLVED form skips the assertion and the binding is
 * applied: the server is the renderer that sees every page, and a genuinely
 * unbound form is still refused there, loudly, before anything ships.
 *
 * @param {Element} el
 * @param {unknown} value
 * @param {FormActionRecord} rec
 * @param {boolean} emitsName whether SSR would emit a `name` attribute this pass
 * @param {boolean} emitsValue whether SSR would emit a `value` attribute this pass
 */
function reconcileSubmitterAction(el, value, rec, emitsName, emitsValue) {
  const id = typeof value === 'function' ? formActionId(value) : null;
  if (!id) {
    // A function that was MEANT as an action still refuses, so a button never
    // silently submits the form's action instead of its own.
    if (typeof value === 'function') assertIdentifiableAction(null, el.localName);
    releaseSubmitterAction(el);
    return;
  }
  // Template-shaped refusals first, from the compiled record, because the live
  // element may already carry this renderer's own `name` / `value`.
  assertSingleSubmitterAction(rec.duplicateAction, el.localName);
  assertConvergentSubmitter(rec.propAttrs, el.localName, true);
  if (rec.staticAction) assertSubmitterHasNoStaticFormAction(el.localName);
  if (rec.authoredValue || emitsValue) assertSubmitterHasNoValue(el.localName);
  if (rec.authoredName || emitsName) {
    // Judged on the PART, not on what it resolved to this pass. `name=${null}`
    // leaves no attribute here while SSR emits `name=""` beside the identity,
    // so reading the live value back returned '' and waved through a template
    // SSR refuses. The template supplying a `name` channel at all is the
    // conflict, whatever today's value happens to be.
    assertSubmitterHasNoName(el.getAttribute('name') || FORM_ACTION_FIELD, el.localName, false);
  }
  if (rec.authoredForm || el.hasAttribute('form')) assertSubmitterHasNoFormAttribute(el.localName);
  assertSubmitterType(el.localName, el.getAttribute('type'));

  const form = enclosingForm(el);
  // Asked ONCE per element. The answer depends on whether this element happened
  // to be in the tree when it reconciled, which differs between a first render
  // (fragment still detached, so `enclosingForm` finds nothing and the check is
  // skipped) and any later update (attached, so it resolves). Re-asking made the
  // SAME template with the SAME values bind on first paint and then throw on an
  // arbitrary later re-render, which is far worse to diagnose than a refusal at
  // first paint. Skipping for an element already stamped can only REMOVE a
  // throw, never add one, so it cannot refuse anything that used to render.
  if (form && !submitterActionBindings.has(el)) {
    // `formActionCandidates` covers the pass where the form's own action hole
    // has committed but its reconcile has not run yet; the identity field is
    // the settled answer, including for an SSR'd form on first hydration.
    const isFormBound = !!(form.querySelector(`input[name="${FORM_ACTION_FIELD}"]`)
      || formActionCandidates.has(form));
    assertSubmitterFormIsBound(isFormBound, el.localName);
  }
  assertSubmitterSubmission(
    el.localName,
    el.getAttribute('formmethod'),
    el.getAttribute('formenctype'),
    { bound: true },
  );
  el.removeAttribute('formaction');
  el.setAttribute('name', FORM_ACTION_FIELD);
  el.setAttribute('value', id);
  submitterActionBindings.set(el, id);
}

/* ================================================================
 * Instance lifecycle
 * ================================================================ */

/**
 * @param {import('./html.js').TemplateResult} tr
 * @param {Element | DocumentFragment | ShadowRoot} container
 */
function createInstance(tr, container) {
  const { templateEl, parts, formActions } = compile(tr);
  const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));

  // Bookend markers bound the instance so we can tear it down cleanly.
  const startNode = document.createComment(`${MARKER}s`);
  const endNode = document.createComment(`${MARKER}e`);

  const bound = parts.map((p) => bindPart(p, frag));
  const lastValues = [];
  for (let i = 0; i < tr.values.length; i++) {
    applyPart(bound[i], tr.values[i], undefined, tr.values);
    lastValues.push(tr.values[i]);
  }
  reconcileFormActions(formActions, bound, tr.values);

  /** @type any */ (container).replaceChildren(startNode, ...frag.childNodes, endNode);

  // Slot parts have no value-hole to drive applyPart from the loop above.
  // Apply them once now that the fragment is inserted into the live
  // container, so each slot can locate its host by walking parents and
  // schedule the first projection through slot.js. Stamp each slot with the
  // host whose TEMPLATE produced it (this container), so a FORWARDED slot
  // (rendered here but nested inside a child component) routes to this host
  // rather than to the child the structural walk would pick. Only an element
  // container is a host; a fragment/shadow container leaves the structural
  // path in place.
  const ownerHost =
    /** @type {any} */ (container).nodeType === 1 && /** @type {any} */ (container)[SLOT_STATE]
      ? container
      : null;
  for (const part of bound) {
    if (part.kind === 'slot') {
      if (ownerHost && part.slotEl) /** @type {any} */ (part.slotEl)[SLOT_OWNER] = ownerHost;
      applyPart(part, undefined, undefined, []);
    }
  }

  return { strings: tr.strings, bound, lastValues, startNode, endNode };
}

/**
 * @param {PartDescriptor} p
 * @param {DocumentFragment | Element} root
 * @returns {BoundPart}
 */
function bindPart(p, root) {
  if (p.kind === 'noop') return /** @type any */ ({ kind: 'noop', mixedAnchor: /** @type any */ (p).mixedAnchor });
  let node = /** @type Node */ (root);
  for (const i of p.path) node = node.childNodes[i];
  if (p.kind === 'child') {
    return { kind: 'child', marker: /** @type Comment */ (node) };
  }
  const el = /** @type Element */ (node);
  if (p.kind === 'event') {
    /** @type {BoundPart} */
    const part = {
      kind: 'event',
      el,
      name: p.name || '',
      handler: null,
      // The dispatcher is the registered listener; handler swaps behind it.
      dispatcher(ev) { part.handler?.(ev); },
    };
    el.addEventListener(part.name, part.dispatcher);
    return part;
  }
  if (p.kind === 'attr') return { kind: 'attr', el, name: p.name || '' };
  if (p.kind === 'attr-mixed') return { kind: 'attr-mixed', el, name: p.name || '', statics: p.statics || [], group: p.group || [] };
  if (p.kind === 'prop') return { kind: 'prop', el, name: p.name || '' };
  if (p.kind === 'bool') return { kind: 'bool', el, name: p.name || '' };
  if (p.kind === 'element') return { kind: 'element', el };
  if (p.kind === 'slot') {
    const slotEl = /** @type {HTMLSlotElement} */ (el);
    // Defer fallback-strip and SLOT_FALLBACK_FRAG installation to apply
    // time so we know whether the slot is light or shadow at the point
    // where the decision matters. At bind time the cloned slot still
    // holds its fallback content from the template clone; we just
    // record the slot ref.
    return { kind: 'slot', slotEl, applied: false };
  }
  throw new Error(`unknown part kind ${/** @type any */(p).kind}`);
}

/**
 * Sentinel parked in `lastValues` for a hole whose commit threw, so the next
 * render cannot mistake the un-advanced entry for "already applied". Never
 * equal (by `Object.is`) to anything an author can pass through a template.
 */
const COMMIT_FAILED = Symbol('webjs.commitFailed');

/**
 * @param {TemplateInstance} inst
 * @param {unknown[]} values
 */
function updateInstance(inst, values) {
  for (let i = 0; i < values.length; i++) {
    const next = values[i];
    if (Object.is(next, inst.lastValues[i])) continue;
    const bp = inst.bound[i];
    // A hole that belongs to a mixed attribute (`class="a ${x} b ${y}"`) is a
    // `noop` pointing at the attribute's anchor part; re-apply the anchor so the
    // whole attribute is rebuilt from every hole's current value, not just the
    // anchor hole's. Without this, a change confined to a non-anchor hole is
    // dropped (the attribute goes stale).
    const anchor = /** @type any */ (bp).mixedAnchor;
    try {
      if (bp.kind === 'noop' && anchor != null) {
        applyPart(inst.bound[anchor], values[anchor], inst.lastValues[anchor], values);
      } else {
        applyPart(bp, next, inst.lastValues[i], values);
      }
    } catch (err) {
      // A commit that throws leaves `lastValues` for THIS hole un-advanced,
      // still holding the value from before the throw. That is almost always
      // the value the recovering render supplies, so the `Object.is` skip at
      // the top of this loop would skip the hole FOREVER. Harmless for an
      // attribute (its commit stringifies before touching the DOM, so nothing
      // changed), and permanently destructive for a child position, whose
      // commit tears the old content down BEFORE the step that throws: the
      // region is left empty and never re-rendered.
      //
      // Poison the entry with a sentinel no author value can ever be, so the
      // next render always re-applies this hole. The value is deliberately
      // NOT advanced to `next` either, since `next` was never committed.
      inst.lastValues[i] = COMMIT_FAILED;
      if (bp.kind === 'noop' && anchor != null) inst.lastValues[anchor] = COMMIT_FAILED;
      throw err;
    }
    inst.lastValues[i] = next;
  }
  // Unconditional, and NOT inside the loop above: a form's correctness depends
  // on holes other than its own, and the `Object.is` skip means the action hole
  // may not have been re-applied at all this pass.
  reconcileFormActions(templateCache.get(inst.strings)?.formActions ?? null, inst.bound, values);
}

/**
 * @param {TemplateInstance} inst
 * @param {Element | DocumentFragment | ShadowRoot} container
 */
function clearInstance(inst, container) {
  // Dispose event listeners on event parts, unbind active refs on
  // element parts, and rescue any projected children sitting inside
  // slot parts so they survive teardown of a collapsing conditional
  // fragment.
  for (const p of inst.bound) {
    if (p.kind === 'event') p.el.removeEventListener(p.name, p.dispatcher);
    if (p.kind === 'element') {
      // Guarded for the same reason as the sibling in `disposeInstance`, and
      // the stakes are higher here: this is the container-level teardown
      // `render()` runs before a template swap, so a throw skips the rest of
      // this loop AND the `replaceChildren()` below, leaving the old DOM in
      // place with `host[INSTANCE]` never reassigned. Since `lastTarget` is
      // cleared only after the write, every later swap of that container
      // then throws at the same part, permanently.
      const prev = /** @type any */ (p).lastTarget;
      if (prev) {
        if (typeof prev === 'function') {
          try { prev(undefined); } catch { /* swallow */ }
        } else if (typeof prev === 'object') {
          try { prev.value = undefined; } catch { /* swallow */ }
        }
        /** @type any */ (p).lastTarget = undefined;
        /** @type any */ (p).__lastEl = undefined;
      }
    }
    if (p.kind === 'slot') {
      // Detach record-owned children before the teardown disposes the
      // slot subtree; the record keeps the refs, so a re-created slot
      // re-places the SAME nodes (children are values, #1015).
      const host = findSlotHost(p.slotEl);
      if (host) rescueAssignedNodes(host, p.slotEl);
    }
  }
  /** @type any */ (container).replaceChildren();
}

/* ================================================================
 * Part application
 * ================================================================ */


/**
 * Resolve what SSR would have emitted for one attribute of a candidate form.
 *
 * The per-kind rules mirror `render-server.js` exactly, which is the whole
 * point: a boolean hole emits nothing when falsy (`if (val) out += name+'=""'`)
 * while an attribute hole emits an EMPTY value for null (`String(val ?? '')`).
 * Those two produce the same DOM and opposite verdicts, so only the template
 * can tell them apart.
 *
 * @param {FormAttrPart[]} attrParts
 * @param {string | null} staticValue
 * @param {unknown[]} values
 * @returns {string | typeof ABSENT}
 */
function effectiveFormAttr(attrParts, staticValue, values) {
  for (const p of attrParts) {
    if (p.kind === 'bool') return resolveHoleValue(values[p.i]) ? '' : ABSENT;
    if (p.kind === 'attr') {
      const v = resolveHoleValue(values[p.i]);
      return v == null ? '' : String(v);
    }
    // A mixed attribute is the concatenation of its static pieces and EVERY one
    // of its holes, so the anchor's own value is only part of the answer.
    const statics = p.statics || [];
    const group = p.group || [];
    let out = statics[0] || '';
    for (let j = 0; j < group.length; j++) {
      out += String(resolveHoleValue(values[group[j]]) ?? '');
      out += statics[j + 1] || '';
    }
    return out;
  }
  return staticValue == null ? ABSENT : staticValue;
}

/**
 * Unwrap a hole's value the same way `applyPart` does, so the reconcile judges
 * what was actually committed. `live()` in particular wraps its value, and
 * reading the wrapper would make a bound action look like a plain object.
 *
 * @param {unknown} v
 * @returns {unknown}
 */
function resolveHoleValue(v) {
  return isLive(v) ? /** @type any */ (v).value : v;
}

/**
 * @param {BoundPart} part
 * @param {unknown} value
 * @param {unknown} _prev
 */
function applyPart(part, value, _prev, allValues) {
  // Unwrap live() to dirty-check against the live DOM value, not the
  // last rendered value. Essential for <input> two-way binding.
  if (isLive(value)) {
    const liveVal = /** @type any */ (value).value;
    if (part.kind === 'prop' && /** @type any */ (part.el)[part.name] === liveVal) return;
    if (part.kind === 'attr' && part.el.getAttribute(part.name) === String(liveVal)) return;
    if (part.kind === 'bool' && part.el.hasAttribute(part.name) === !!liveVal) return;
    value = liveVal;
  }

  switch (part.kind) {
    case 'child':
      applyChild(part, value);
      break;
    case 'attr': {
      // #1207: note a form whose action hole holds a function, so a submitter
      // reconciling BEFORE that form's own reconcile can still tell the form is
      // going to be bound. Recorded at commit time because that is the only
      // moment the hole's value is in hand for a form the submitter does not
      // own. Cleared on a non-function so a form that stops being bound does
      // not keep vouching for its buttons.
      if (part.el.localName === 'form' && part.name.toLowerCase() === 'action') {
        const candidate = resolveHoleValue(value);
        if (typeof candidate === 'function') formActionCandidates.set(part.el, candidate);
        else formActionCandidates.delete(part.el);
      }
      if (value == null || value === false) part.el.removeAttribute(part.name);
      else if (isBoundFormAction(value, part.name, part.el.localName)) {
        // #1155: the ONE supported form-action binding, applied to the live
        // form exactly as SSR wrote it. A component that ships re-renders its
        // whole template on hydration, so without this the SSR'd hidden field
        // would be replaced by an `action` attribute holding a stringified
        // function, and the form would post to a garbage url.
        //
        // Nothing happens here. The whole decision (identity, the submit
        // attributes, the hidden field) is made at the end of the pass by
        // `reconcileFormAction`, because it depends on holes that have not
        // committed yet when this one does.
      } else {
        // #1154: refuse to stringify a function into action=/formaction=
        // (mirrors the SSR guard, so a client re-render cannot write a
        // server action's source into the live DOM).
        assertNotFunctionActionAttr(value, part.name, part.el.localName);
        part.el.setAttribute(part.name, String(value));
      }
      break;
    }
    case 'prop':
      // `.action=${fn}` is a leak too, not just the attribute form, but only
      // where the property is a REFLECTED IDL attribute: assigning a function
      // to `form.action` (or `.formAction` on a button/input) stringifies it
      // into that element's own content attribute in a real browser. On any
      // other native tag it is a plain expando that reflects nothing, and on a
      // custom element it is an author-defined property, so a function is
      // legitimate in both. The helper owns that distinction.
      //
      // Not covered here, because it is not a commit: a custom element's prop
      // declared `reflect: true` reflects from its own setter. That path used
      // to write String(value) and leak the source. #1169 made it remove the
      // attribute instead (an array carrying one included, via the same
      // `carriesFunction` predicate this file's guard uses), so it is guarded
      // at the setter rather than here. One carve-out stays the author's call:
      // a prop supplying its own `converter.toAttribute` runs that converter
      // first and is left alone, so it still writes whatever the author
      // returns for a function.
      assertNotFunctionReflectedActionProp(value, part.name, part.el.localName);
      /** @type any */ (part.el)[part.name] = value;
      break;
    case 'bool':
      // #1154: never leaked (a boolean binding stringifies nothing), but
      // `?action=${fn}` is meaningless in every case, and refusing it keeps
      // this renderer agreeing with both SSR machines.
      assertNotFunctionActionAttr(value, part.name, part.el.localName);
      if (value) part.el.setAttribute(part.name, '');
      else part.el.removeAttribute(part.name);
      break;
    case 'event':
      // NOT guarded, deliberately. An event binding never stringifies its
      // value, and a function is the legitimate thing to pass one, so
      // `<my-el @action=${handler}>` has to keep working.
      part.handler = typeof value === 'function' ? /** @type any */ (value) : null;
      break;
    case 'element':
      applyElement(part, value);
      break;
    case 'attr-mixed': {
      // Reconstruct the attribute from static pieces + all dynamic values.
      const mp = /** @type {{ statics: string[], group: number[] }} */ (/** @type any */ (part));
      let val = mp.statics[0];
      for (let j = 0; j < mp.group.length; j++) {
        const piece = allValues ? allValues[mp.group[j]] : value;
        // #1154: same function guard for each piece of a mixed attribute.
        assertNotFunctionActionAttr(piece, part.name, part.el.localName);
        val += String(piece ?? '');
        val += mp.statics[j + 1] || '';
      }
      part.el.setAttribute(part.name, val);
      break;
    }
    case 'slot': {
      // Slot parts have no template-hole value to apply. The "apply" is
      // a one-shot trigger that runs after the template fragment has
      // been inserted into the host's render root. At this point the
      // slot's parent chain reveals whether it lives inside a shadow
      // root (browser native projection) or in light DOM (framework
      // projection). For shadow-DOM slots we leave the cloned fallback
      // in place. For light-DOM slots we move the fallback into a
      // per-slot holding fragment owned by slot.js (via the
      // SLOT_FALLBACK_FRAG symbol) so the slot can receive projected
      // children, and we kick off projection.
      //
      // For NESTED templates (a slot inside `${cond ? html`<slot/>` : ''}`),
      // the slot's parent chain at first apply may still lead through
      // an unattached fragment. findSlotHost returns null then; we
      // retry on the next microtask, by which point the outer's
      // replaceChildren has placed the entire tree into the host.
      if (part.applied) break;
      const slotEl = part.slotEl;
      const finalize = () => {
        const host = findSlotHost(slotEl);
        if (!host) {
          part.applied = true;
          return; // truly orphan slot (no owner, no structural host)
        }
        // A FORWARDED slot's owner is known immediately (the SLOT_OWNER
        // stamp) but the child component has not yet PLACED the slot into
        // the owner's subtree, so the owner's apply cannot find it yet.
        // Re-defer until the child places it (host.contains becomes true);
        // the child WILL place it, or the owner disconnects and the retries
        // stop. A normal own slot is already inside its host, so this passes
        // on the first call with no extra deferral.
        if (!host.contains(slotEl)) {
          if (host.isConnected) queueMicrotask(finalize);
          else part.applied = true;
          return;
        }
        part.applied = true;
        // Shadow DOM: native projection. Leave fallback in place.
        if (isInShadowRootEl(slotEl)) return;
        // Light DOM: harvest the cloned fallback into a holding
        // fragment, then place the host's slot record (#1015). The
        // application is deferred one microtask so the documented
        // lifecycle timing holds: firstUpdated() sees the <slot>
        // element itself, the populated content lands right after.
        const frag = document.createDocumentFragment();
        while (slotEl.firstChild) frag.appendChild(slotEl.firstChild);
        /** @type {any} */ (slotEl)[SLOT_FALLBACK_FRAG] = frag;
        queueMicrotask(() => applySlotAssignments(host));
      };
      const directHost = findSlotHost(slotEl);
      if (directHost && directHost.contains(slotEl)) {
        finalize();
      } else {
        queueMicrotask(finalize);
      }
      break;
    }
    case 'noop':
      // intentionally empty: used for holes inside HTML comments
      break;
  }
}

/**
 * Walk a slot element's parent chain looking for a WebComponent host
 * (an element that has slot state initialised). Used by the slot-part's
 * apply and teardown steps to coordinate with slot.js.
 *
 * @param {HTMLSlotElement} slotEl
 * @returns {Element | null}
 */
function findSlotHost(slotEl) {
  // Template-owner stamp wins (a forwarded slot's true host), else the
  // nearest SLOT_STATE ancestor structurally.
  const owner = /** @type any */ (slotEl)[SLOT_OWNER];
  if (owner && owner.isConnected) return owner;
  let p = slotEl.parentElement;
  while (p) {
    if (/** @type any */ (p)[SLOT_STATE]) return p;
    p = p.parentElement;
  }
  return null;
}

/**
 * True when an element is inside a shadow root (so native browser slot
 * projection applies). Mirrors slot.js's helper; duplicated here to
 * avoid the round trip through the slot.js public surface for this
 * hot path.
 * @param {Element} el
 * @returns {boolean}
 */
function isInShadowRootEl(el) {
  let n = /** @type {Node} */ (el);
  for (let depth = 0; depth < 128; depth++) {
    const parent = n.parentNode;
    if (!parent) return false;
    if (parent === n) return false;
    // A real ShadowRoot is a DocumentFragment (nodeType 11) exposing its
    // owner as `.host`. Checking `.host` truthiness ALONE misfires on
    // ordinary elements: HTMLAnchorElement/HTMLAreaElement expose a
    // URL-derived `.host` ('example.com'), so a slot nested inside an
    // <a> card was misread as shadow DOM and its light-DOM application
    // silently skipped (surfaced by #1015's removal of the redundant
    // observer repair paths that used to mask it).
    if (parent.nodeType === 11 && /** @type any */ (parent).host) return true;
    n = parent;
  }
  return false;
}

/**
 * Child (text-position) part. Replace the marker's surrounding nodes with the
 * new value's rendered form. Nested TemplateResults get an instance with its
 * own parts; we reuse on `strings` identity.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {unknown} value
 */
/**
 * Apply a value at an element-position part (`<tag ${expr}>`). The
 * sole supported directive here is `ref(refOrCallback)` and
 * `createRef()`. Other values are ignored so a stray non-ref hole
 * doesn't crash. Tracks the prior target so a change from one ref to
 * another correctly unsets the old target before binding the new one.
 *
 * @param {Extract<BoundPart, {kind:'element'}>} part
 * @param {unknown} value
 */
function applyElement(part, value) {
  // Matches lit-html's RefDirective.update():
  // 1. If the ref target changed since last render, unbind the prior one.
  // 2. If the ref target OR the element identity changed, bind the new
  //    (ref, element) pair. If both are stable, skip entirely.
  // For callback refs, an unset-before-bind cycle runs whenever the
  // same callback is now pointing at a different element.
  const partAny = /** @type any */ (part);
  const nextTarget = isRef(value) ? /** @type any */ (value).target : undefined;
  const prevTarget = partAny.__refTarget;
  const refChanged = nextTarget !== prevTarget;

  if (refChanged && prevTarget) {
    if (typeof prevTarget === 'function') {
      try { prevTarget(undefined); } catch { /* swallow */ }
    } else if (typeof prevTarget === 'object') {
      prevTarget.value = undefined;
    }
  }

  if (refChanged || partAny.__refElement !== part.el) {
    partAny.__refTarget = nextTarget;
    if (nextTarget) {
      if (typeof nextTarget === 'function') {
        // Same callback now pointing at a different element: deliver
        // an `undefined` cleanup for the prior element first.
        if (!refChanged && partAny.__refElement !== undefined) {
          try { nextTarget(undefined); } catch { /* swallow */ }
        }
        try { nextTarget(part.el); } catch { /* swallow */ }
      } else if (typeof nextTarget === 'object') {
        nextTarget.value = part.el;
      }
    }
    partAny.__refElement = part.el;
    // Keep the legacy `lastTarget` field in sync for clearInstance /
    // disposeInstance which read it for template-disposal cleanup.
    part.lastTarget = nextTarget;
  }
}

function applyChild(part, value) {
  // Drop directive state from prior renders when the new value is for a
  // different directive (or no directive at all). Keeps __untilState
  // from leaking across replacements, __guardDeps from causing a stale
  // short-circuit, etc. Done once per outermost applyChild call; the
  // directive handlers recurse via applyChildInner (no re-clear) so
  // their own state survives the recursion.
  clearStaleDirectiveState(part, value);
  return applyChildInner(part, value);
}

/**
 * Internal dispatch. Used both by `applyChild` (which first clears
 * stale per-part directive state) and by directive handlers that
 * recurse with a different value at the same part. Recursing via
 * `applyChild` would clear the directive state that was just set,
 * because the inner value almost always isn't itself a directive.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {unknown} value
 */
function applyChildInner(part, value) {
  // Open the renderer-write window around this commit. Most calls are
  // synchronous inside render() (the window is already open, this nests
  // harmlessly), but the async directive paths (until, watch, asyncAppend /
  // asyncReplace, streaming) re-enter here from a promise / microtask OUTSIDE
  // any render() window, so this is where those commits into a light host are
  // marked as renderer writes rather than authored content.
  return commitInto(part.marker && part.marker.parentNode, () =>
    applyChildInnerRaw(part, value),
  );
}

/**
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {unknown} value
 */
function applyChildInnerRaw(part, value) {
  const marker = part.marker;

  // unsafeHTML directive: inject raw HTML string as DOM nodes.
  if (isUnsafeHTML(value)) {
    teardownChild(part);
    const htmlStr = String(/** @type any */ (value).value ?? '');
    const template = document.createElement('template');
    template.innerHTML = htmlStr;
    const nodes = [...template.content.childNodes];
    const frag = document.createDocumentFragment();
    for (const n of nodes) frag.appendChild(n);
    marker.parentNode?.insertBefore(frag, marker);
    part.child = nodes;
    return;
  }

  // keyed directive: when key changes, tear down and remount fresh DOM.
  // When the key matches, recurse so the standard template-reconciliation
  // path can update the existing DOM in place.
  if (isKeyed(value)) {
    const v = /** @type any */ (value);
    const prevKey = /** @type any */ (part).__keyedKey;
    if (prevKey !== undefined && !Object.is(prevKey, v.key)) {
      teardownChild(part);
    }
    /** @type any */ (part).__keyedKey = v.key;
    applyChildInner(part, v.value);
    return;
  }

  // guard directive: skip re-evaluation when the deps array is shallow-
  // equal to the prior call. Stored deps live on the part so they
  // persist across renders that reuse the same template (and thus the
  // same part).
  if (isGuard(value)) {
    const v = /** @type any */ (value);
    const prevDeps = /** @type any */ (part).__guardDeps;
    const nextDeps = v.deps;
    // Accept any value for deps. When deps is an array, compare shallowly.
    // When it's a primitive (number, string, undefined), compare with
    // Object.is. Mirrors lit-html's tolerance for non-array deps so user
    // code like `guard(this.id, () => ...)` works without crashing.
    if (prevDeps !== undefined) {
      const equal = Array.isArray(prevDeps) && Array.isArray(nextDeps)
        ? shallowEqualArray(prevDeps, nextDeps)
        : Object.is(prevDeps, nextDeps);
      if (equal) return;
    }
    // Snapshot the deps BEFORE running `fn` (so a fn that mutates the array
    // it was handed cannot rewrite what we record), but RECORD them only
    // after the commit succeeds. Recording first meant a throw part-way
    // through the commit left the region torn down with the NEW deps already
    // stored, so every later render with the same deps hit the `equal`
    // short-circuit above and skipped the region forever. Renders are always
    // microtask-scheduled (`_scheduleUpdate`), so `fn()` cannot re-enter this
    // part synchronously and see the stale deps.
    const depsSnapshot = Array.isArray(nextDeps) ? nextDeps.slice() : nextDeps;
    applyChildInner(part, v.fn());
    /** @type any */ (part).__guardDeps = depsSnapshot;
    return;
  }

  // templateContent directive: clone the content of a <template> element.
  if (isTemplateContent(value)) {
    teardownChild(part);
    const tpl = /** @type any */ (value).template;
    if (tpl && tpl.content) {
      const frag = tpl.content.cloneNode(true);
      const nodes = [...frag.childNodes];
      marker.parentNode?.insertBefore(frag, marker);
      part.child = nodes;
    }
    return;
  }

  // ref directive in a child position: no DOM produced. Element-position
  // refs are bound via element parts; a stray ref() in a child position
  // is a no-op for compatibility.
  if (isRef(value)) {
    return;
  }

  // cache directive: real DOM retention. When the inner value changes
  // to a different template shape, detach (rather than destroy) the
  // current DOM and stash it keyed by its template strings. When a
  // previously-cached shape returns, re-attach it before the marker
  // and reconcile values. Preserves input state, scroll, focus across
  // toggles between sub-templates (e.g. tab interfaces).
  if (isCache(value)) {
    return applyCache(part, /** @type any */ (value).value);
  }

  // until directive: render the highest-priority resolved value among
  // the candidates. Synchronous values are rendered immediately; Promises
  // are awaited in the background and applied if no higher-priority
  // candidate has resolved yet. When the marker is torn down, in-flight
  // priorities are cleared so late resolves cannot overwrite later DOM.
  if (isUntil(value)) {
    return applyUntil(part, /** @type any */ (value).args);
  }

  // watch directive: bind a part to a signal. Reads the signal at
  // render time and subscribes the part to changes. When the signal
  // fires, only this part updates; the host component's render() does
  // not re-run. The signal read inside the watcher's observe is
  // tracked against the part's private Watcher, NOT the host's render
  // watcher (so the host doesn't subscribe to a full re-render too).
  if (isWatch(value)) {
    return applyWatch(part, /** @type any */ (value).signal);
  }

  // asyncAppend / asyncReplace: subscribe to the AsyncIterable. Each
  // yielded value is mapped (optional) and appended (asyncAppend) or
  // replaces (asyncReplace) the prior content. Teardown aborts the
  // iteration so leaked iterators do not keep references to detached
  // DOM.
  if (isAsyncAppend(value)) {
    return applyAsyncAppend(part, /** @type any */ (value));
  }
  if (isAsyncReplace(value)) {
    return applyAsyncReplace(part, /** @type any */ (value));
  }

  // Repeat directive: keyed reconciliation. Keep previous state when both
  // old and new are repeats; otherwise tear down and rebuild.
  if (isRepeat(value)) {
    if (part.child && /** @type any */ (part.child).kind === 'repeat') {
      reconcileRepeat(part, value);
      return;
    }
    teardownChild(part);
    const state = { kind: 'repeat', map: new Map() };
    part.child = state;
    applyRepeatFresh(marker, state, value);
    return;
  }

  // Plain array (a `.map()` / list interpolation): positional, non-keyed
  // reconciliation. Update each position's instance IN PLACE when its
  // template shape is unchanged, so DOM node identity survives an item
  // update (focus, selection, scroll, and an in-progress native drag all
  // survive). Mirrors lit-html's non-keyed array child part. Without this,
  // flipping one item's binding rebuilt the WHOLE list and detached every
  // node, which cancels a native drag mid-gesture. Use `repeat()` for keyed
  // reordering.
  if (Array.isArray(value)) {
    if (part.child && /** @type any */ (part.child).kind === 'array') {
      reconcileArray(part, value);
      return;
    }
    teardownChild(part);
    const arrState = { kind: 'array', items: [] };
    part.child = arrState;
    applyArrayFresh(marker, /** @type any */ (arrState), value);
    return;
  }

  // Remove previously rendered nodes between marker and its next sibling we own.
  if (part.child) {
    const c = /** @type any */ (part.child);
    if (c.kind === 'repeat') {
      teardownRepeat(c);
      part.child = undefined;
    } else if (c.kind === 'array') {
      teardownArray(/** @type any */ (c));
      part.child = undefined;
    } else if (c.kind === 'async-stream') {
      teardownAsyncStream(c);
      part.child = undefined;
    } else if ('strings' in /** @type any */ (part.child)) {
      // Previous was a TemplateInstance.
      const inst = /** @type TemplateInstance */ (part.child);
      if (isTemplate(value) && inst.strings === /** @type any */ (value).strings) {
        updateInstance(inst, /** @type any */ (value).values);
        return;
      }
      removeBetween(inst.startNode, inst.endNode);
      part.child = undefined;
    } else {
      // Previous was ChildNode[]: remove each node we inserted.
      for (const n of /** @type ChildNode[] */ (part.child)) {
        if (n.parentNode) n.parentNode.removeChild(n);
      }
      part.child = undefined;
    }
  }

  if (value == null || value === false || value === true) return;

  if (isTemplate(value)) {
    const tr = /** @type any */ (value);
    const { templateEl, parts, formActions } = compile(tr);
    const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));
    const startNode = document.createComment(`${MARKER}s`);
    const endNode = document.createComment(`${MARKER}e`);
    const bound = parts.map((p) => bindPart(p, frag));
    const lastValues = [];
    for (let i = 0; i < tr.values.length; i++) {
      applyPart(bound[i], tr.values[i], undefined, tr.values);
      lastValues.push(tr.values[i]);
    }
    reconcileFormActions(formActions, bound, tr.values);
    const nodes = [startNode, ...frag.childNodes, endNode];
    marker.parentNode?.insertBefore(nodesToFrag(nodes), marker);
    // Slot parts in this nested template need their one-shot apply just
    // like createInstance does for top-level templates. The slot is now
    // in the live tree (insertBefore above) so its parent walk can
    // reach the host. Without this loop, conditional / nested templates
    // with <slot> inside never trigger projection.
    for (const p of bound) {
      if (p.kind === 'slot') applyPart(p, undefined, undefined, []);
    }
    part.child = { strings: tr.strings, bound, lastValues, startNode, endNode };
    return;
  }

  const node = document.createTextNode(String(value));
  marker.parentNode?.insertBefore(node, marker);
  part.child = [node];
}

/** @param {ChildNode[]} nodes */
function nodesToFrag(nodes) {
  const frag = document.createDocumentFragment();
  for (const n of nodes) frag.appendChild(n);
  return frag;
}

/**
 * Remove a template instance's whole range, its bookend markers INCLUDED.
 *
 * Every caller discards the instance right after (the map entry or slot that
 * held it is dropped, and any replacement gets fresh markers from
 * `buildDetached`), so this is a REMOVE and never lit's clear-and-reuse. A
 * caller that wants to keep the bookends and render into them again needs its
 * OWN function, because the two want opposite answers for the end marker.
 *
 * `parent` is read BEFORE the walk because the walk removes `start` on its
 * first iteration, which nulls `start.parentNode`. Reading it afterwards
 * compared the end marker's live parent against `null`, so the guard could
 * never fire and every teardown left one `wjm-e` comment in the document,
 * unbounded for the life of the region.
 *
 * The terminator stays `end` ITSELF rather than an `end.nextSibling` stop
 * sentinel captured up front. `removeChild` runs a custom element's
 * `disconnectedCallback` synchronously, so a sentinel pointing at a sibling
 * this region does not own can be detached or moved mid-walk, and the walk
 * would then run off the end of the child list and take the part's own marker
 * with it. `end` is renderer-created and reachable only through the instance.
 *
 * The `end.parentNode === parent` comparison is a refusal, not a formality. A
 * marker moved under a different parent is not this region's to remove, and
 * `parent.removeChild(end)` on it throws NotFoundError from inside a teardown
 * that has to stay total.
 *
 * @param {Node} start @param {Node} end
 */
function removeBetween(start, end) {
  const parent = start.parentNode;
  if (!parent) return;
  let n = start;
  while (n && n !== end) {
    const next = n.nextSibling;
    n.parentNode?.removeChild(n);
    n = next;
  }
  if (end.parentNode === parent) parent.removeChild(end);
}

/* ================================================================
 * Keyed list (repeat) support
 * ================================================================ */

/**
 * Build a TemplateInstance whose nodes (including bookends) live in a
 * document fragment that the caller will insert wherever it wants.
 * @param {import('./html.js').TemplateResult} tr
 * @returns {{ inst: TemplateInstance, frag: DocumentFragment }}
 */
function buildDetached(tr) {
  const { templateEl, parts, formActions } = compile(tr);
  const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));
  const startNode = document.createComment(`${MARKER}s`);
  const endNode = document.createComment(`${MARKER}e`);
  const bound = parts.map((p) => bindPart(p, frag));
  const lastValues = [];
  for (let i = 0; i < tr.values.length; i++) {
    applyPart(bound[i], tr.values[i], undefined, tr.values);
    lastValues.push(tr.values[i]);
  }
  reconcileFormActions(formActions, bound, tr.values);
  // Slot parts need their one-shot apply exactly like createInstance and the
  // nested-template path. The fragment is still detached here, so the
  // slot-part's own deferred finalize (a one-microtask retry when the parent
  // walk cannot reach a host yet) carries it: every caller inserts the
  // returned fragment synchronously in the same task, so the retry lands in
  // the live tree. Without this loop a <slot> inside a repeat() / array item
  // never finalizes and its content is never placeable.
  for (const p of bound) {
    if (p.kind === 'slot') applyPart(p, undefined, undefined, []);
  }
  const outFrag = document.createDocumentFragment();
  outFrag.appendChild(startNode);
  while (frag.firstChild) outFrag.appendChild(frag.firstChild);
  outFrag.appendChild(endNode);
  return {
    inst: { strings: tr.strings, bound, lastValues, startNode, endNode },
    frag: outFrag,
  };
}

/** @param {TemplateInstance} inst */
function disposeInstance(inst) {
  for (const p of inst.bound) {
    if (p.kind === 'event') p.el.removeEventListener(p.name, p.dispatcher);
    if (p.kind === 'element') {
      // Unbind any active ref so the user observes the element being
      // removed (callback receives undefined / Ref.value cleared).
      // Mirrors lit-html's cleanup-on-disconnect for element parts.
      //
      // BOTH branches swallow, and lit is not the reason: lit's ref directive
      // guards neither, so a throw there propagates. The reason is that a
      // teardown has to be TOTAL. `lastTarget` is cleared only AFTER these
      // writes, so a throw leaves the part still pointing at the ref and
      // every later teardown of the same instance throws at the same line
      // forever. It also aborts the rest of this loop, so the remaining
      // parts keep their listeners and their refs bound. A teardown has no
      // retry either (a commit has the COMMIT_FAILED sentinel and a next
      // render; this does not), so there is nothing a propagated error could
      // usefully repair.
      //
      // The object branch is the one this adds. The callback branch was
      // already guarded here AND on the commit path (`applyElement` wraps
      // every `nextTarget(...)` / `prevTarget(undefined)` call), so a
      // throwing ref CALLBACK has always been swallowed everywhere. What was
      // inconsistent is the object ref, guarded on neither. This makes the
      // two agree on TEARDOWN, which is where the totality argument bites.
      // It does NOT touch the commit path, so `applyElement`'s object-ref
      // writes still propagate to the component boundary, which has a route
      // for the error and a next render to repair it.
      const prev = /** @type any */ (p).lastTarget;
      if (prev) {
        if (typeof prev === 'function') {
          try { prev(undefined); } catch { /* swallow */ }
        } else if (typeof prev === 'object') {
          try { prev.value = undefined; } catch { /* swallow */ }
        }
        /** @type any */ (p).lastTarget = undefined;
        /** @type any */ (p).__lastEl = undefined;
      }
    }
  }
}

/**
 * Initial fresh render of a repeat directive. Inserts all items' nodes
 * immediately before the part's marker comment.
 *
 * @param {Comment} marker
 * @param {{ kind: 'repeat', map: Map<any, TemplateInstance> }} state
 * @param {any} value
 */
function applyRepeatFresh(marker, state, value) {
  const { items, keyFn, templateFn } = value;
  const parent = marker.parentNode;
  if (!parent) return;
  const bulk = document.createDocumentFragment();
  for (let i = 0; i < items.length; i++) {
    const key = keyFn(items[i], i);
    const tr = templateFn(items[i], i);
    if (!isTemplate(tr)) continue;
    const { inst, frag } = buildDetached(/** @type any */ (tr));
    state.map.set(key, inst);
    bulk.appendChild(frag);
  }
  parent.insertBefore(bulk, marker);
}

/**
 * Keyed reconciliation. For each key in the new list:
 *   - hit: update the existing instance in place (if template shape matches),
 *     then move its nodes into position
 *   - miss: build a new instance and insert
 * Finally drop instances whose keys aren't in the new list.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {any} value
 */
function reconcileRepeat(part, value) {
  const marker = part.marker;
  const parent = marker.parentNode;
  if (!parent) return;
  const state = /** @type {{ kind: 'repeat', map: Map<any, TemplateInstance> }} */ (part.child);
  const { items, keyFn, templateFn } = value;

  const newMap = new Map();

  try {
    // Walk the new list and position each item's nodes immediately before the marker.
    for (let i = 0; i < items.length; i++) {
      const key = keyFn(items[i], i);
      const tr = templateFn(items[i], i);
      if (!isTemplate(tr)) continue;
      const existing = state.map.get(key);
      if (existing && existing.strings === /** @type any */ (tr).strings) {
        updateInstance(existing, /** @type any */ (tr).values);
        // Move nodes before marker preserving element identity.
        moveRange(existing.startNode, existing.endNode, parent, marker);
        newMap.set(key, existing);
        state.map.delete(key);
      } else {
        if (existing) {
          // Unmapped BEFORE the row is touched, for the reason spelled out
          // in the leftover loop below: a key kept across a refused removal
          // points at a half-removed row, and reusing that row later walks
          // the removal off the end of the region. Same ordering, same
          // trade, and the two have to agree or the invariant the catch
          // relies on holds on one branch and not the other.
          state.map.delete(key);
          disposeInstance(existing);
          removeBetween(existing.startNode, existing.endNode);
        }
        const { inst, frag } = buildDetached(/** @type any */ (tr));
        parent.insertBefore(frag, marker);
        newMap.set(key, inst);
      }
    }

    // Remove any keys that remain in the old map. The key leaves the map
    // BEFORE its row is touched and the removal is in a `finally`, so at any
    // throw point `state.map` holds exactly the leftovers this pass has not
    // reached, and a row whose dispose threw still leaves the document.
    // Iterating a snapshot keeps the delete obviously safe rather than
    // relying on the reader knowing that deleting during a Map iteration is
    // legal.
    for (const [k, inst] of [...state.map]) {
      state.map.delete(k);
      try {
        disposeInstance(inst);
      } finally {
        removeBetween(inst.startNode, inst.endNode);
      }
    }
    state.map = newMap;
  } catch (err) {
    // The walk moves DOM and drains `state.map` incrementally while the
    // replacement map is accumulated locally, so a throw part-way through
    // leaves NEITHER map describing what is on screen: the already-processed
    // keys sit only in `newMap`, which is about to be discarded, while their
    // nodes stay in the document tracked by nothing. The next (perfectly
    // valid) render then rebuilds those keys from scratch and the orphaned
    // originals are never removed, so the list shows duplicated rows forever
    // with nothing logged after the first throw.
    //
    // Re-unite every instance still in the document under `state.map` (the
    // two maps are disjoint: a key lands in `newMap` only after being deleted
    // from `state.map`), so the map describes the DOM again and nothing is
    // orphaned. That is the whole repair. The next render is then an ORDINARY
    // reconcile against a truthful map, which repositions every row and
    // re-applies whatever the throw skipped.
    //
    // That claim covers the REMOVAL loop as well as the walk, and only
    // because the loop was written to earn it. It drops each key before
    // touching that row and removes the nodes in a `finally`, so a throw
    // mid-removal cannot merge `newMap` over a `state.map` still holding
    // disposed, detached rows. That was the failure: the row the app DELETED
    // stayed on screen, the survivors reordered, and a later render that
    // re-added that key reinserted the detached instance. The invariant, at
    // any throw point on either branch: every instance this pass has not
    // destructively touched is described by exactly one of the two maps,
    // `newMap` for the processed new keys and `state.map` for the leftovers
    // not reached yet, which is what makes the merge below correct. The
    // exception is the row named in the residual just below, whose removal
    // refused part-way; that one is in neither map, by choice.
    //
    // The residual is a throw from `removeBetween` ITSELF, which only calls
    // `removeChild` on nodes the renderer owns, so it takes a throwing DOM to
    // reach. That row is already unmapped, so its remaining nodes stay in the
    // document tracked by nothing and a later re-add of that key builds a
    // second row beside them. Unmapping AFTER the removal instead would keep
    // that key, and it is measurably worse rather than better: the row is
    // half removed, its start marker gone and its end marker still in place,
    // so the re-add hits the reuse branch and `moveRange` re-attaches the
    // lone start marker AFTER the end marker. The next removal of that key
    // then walks forward from a start that never reaches its end, taking the
    // repeat part's own marker and every following sibling with it, and the
    // region is dead for good. One untracked row beats a destroyed list.
    //
    // Deliberately NOT a teardown-and-rebuild of the region. Rebuilding is
    // the obvious defensive move and it is measurably worse: it discards node
    // identity for every row, which is the exact cost keyed reconciliation
    // exists to avoid (see the plain-array note below, a rebuild cancels an
    // in-progress native drag). It is also unnecessary, because this map is
    // restored to the truth rather than left describing a DOM that moved, so
    // there is nothing to guess and no partial DOM move to unwind.
    //
    // That is only half of it, and the other half does NOT live here: the row
    // whose own commit threw is repaired by the COMMIT_FAILED sentinel in
    // `updateInstance`, not by anything below. Without it the failed hole
    // compares EQUAL on the next render (its `lastValues` entry never
    // advanced past the throw, so it still holds the value that render
    // supplies) and is skipped forever, which for a child position means the
    // row stays permanently blank. Do not remove the sentinel on the theory
    // that a half-updated instance heals itself; it does not.
    for (const [k, inst] of newMap) state.map.set(k, inst);
    throw err;
  }
}

/** @param {{ kind: 'repeat', map: Map<any, TemplateInstance> }} state */
function teardownRepeat(state) {
  // Same delete-as-you-go shape as the leftover loop in `reconcileRepeat`,
  // for the same reason: a throw part-way must not leave already-removed
  // instances in the map. The trailing `clear()` stays as a no-op safety net.
  for (const [k, inst] of [...state.map]) {
    state.map.delete(k);
    try {
      disposeInstance(inst);
    } finally {
      removeBetween(inst.startNode, inst.endNode);
    }
  }
  state.map.clear();
}

/* ================================================================
 * Plain array (.map) support: positional, non-keyed reconciliation
 * ================================================================ */

/**
 * One rendered slot of a plain array. A `tpl` carries a detached template
 * instance (bookended by its own markers), a `text` carries a single text
 * node, and an `empty` slot (a nullish / boolean element) renders nothing
 * but still holds the position so index-based reconciliation stays aligned.
 * @typedef {{ type: 'tpl', inst: TemplateInstance } | { type: 'text', node: Text } | { type: 'empty' }} ArrayItem
 */

/** @param {ArrayItem} item @returns {ChildNode | null} */
function arrayItemFirstNode(item) {
  if (item.type === 'tpl') return item.inst.startNode;
  if (item.type === 'text') return item.node;
  return null;
}

/** @param {ArrayItem} item */
function removeArrayItem(item) {
  if (item.type === 'tpl') {
    disposeInstance(item.inst);
    removeBetween(item.inst.startNode, item.inst.endNode);
  } else if (item.type === 'text') {
    item.node.parentNode?.removeChild(item.node);
  }
}

/**
 * Build the slot for one array element, plus the fragment to insert (null
 * for an empty slot). A TemplateResult becomes a detached instance, a
 * primitive becomes a text node, and nullish / boolean renders nothing.
 * @param {unknown} v
 * @returns {{ item: ArrayItem, frag: Node | null }}
 */
function buildArrayItem(v) {
  if (isTemplate(v)) {
    const { inst, frag } = buildDetached(/** @type any */ (v));
    return { item: { type: 'tpl', inst }, frag };
  }
  if (v != null && v !== false && v !== true) {
    const node = document.createTextNode(String(v));
    return { item: { type: 'text', node }, frag: node };
  }
  return { item: { type: 'empty' }, frag: null };
}

/**
 * Initial render of a plain array: insert every slot's nodes before the marker.
 * @param {Comment} marker
 * @param {{ kind: 'array', items: ArrayItem[] }} state
 * @param {unknown[]} value
 */
function applyArrayFresh(marker, state, value) {
  const parent = marker.parentNode;
  if (!parent) return;
  const bulk = document.createDocumentFragment();
  /** @type {ArrayItem[]} */
  const items = [];
  for (const v of value) {
    const { item, frag } = buildArrayItem(v);
    if (frag) bulk.appendChild(frag);
    items.push(item);
  }
  parent.insertBefore(bulk, marker);
  state.items = items;
}

/**
 * Positional (non-keyed) reconciliation. For each index, update the slot
 * in place when its shape is unchanged (preserving DOM node identity),
 * otherwise replace it; grow or shrink at the tail. There is no key
 * matching, so a reorder reduces to a series of in-place value updates;
 * reach for `repeat()` when element identity must follow a moved key.
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {unknown[]} value
 */
function reconcileArray(part, value) {
  const marker = part.marker;
  const parent = marker.parentNode;
  if (!parent) return;
  const state = /** @type {{ kind: 'array', items: ArrayItem[] }} */ (part.child);
  const old = state.items;
  /** @type {ArrayItem[]} */
  const next = [];
  // How many slots of `old` are fully processed. Tracked rather than inferred
  // from `next.length`, because the shrink loop below advances through `old`
  // while `next` stops growing, so the two part company there. The catch is
  // the only reader.
  let consumed = 0;

  try {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const o = old[i];
      if (isTemplate(v)) {
        const tr = /** @type any */ (v);
        if (o && o.type === 'tpl' && o.inst.strings === tr.strings) {
          updateInstance(o.inst, tr.values);
          next.push(o);
          consumed = i + 1;
          continue;
        }
      } else if (v != null && v !== false && v !== true) {
        if (o && o.type === 'text') {
          const str = String(v);
          if (o.node.data !== str) o.node.data = str;
          next.push(o);
          consumed = i + 1;
          continue;
        }
      } else {
        // Empty slot: drop any prior nodes that occupied this position.
        // Deliberately NOT reordered like the branch below. That reorder
        // exists to keep a slot that was already BUILT and INSERTED tracked,
        // and this branch builds and inserts nothing, so pushing first would
        // only mean a throw from the removal leaves a phantom empty slot at
        // this index AND `old[i]` spliced in at the next one, shifting every
        // later slot by one in a POSITIONAL reconciler. Removing first, a
        // throw here leaves `old[i]` describing its own position, which is
        // still exactly where its nodes are.
        if (o) removeArrayItem(o);
        next.push({ type: 'empty' });
        consumed = i + 1;
        continue;
      }
      // Shape changed, or the array grew past the old length. Build fresh,
      // insert at this position (before the current / next still-attached
      // old node, else the marker), then drop the old slot it replaced.
      // The push sits BEFORE the removal, which is a pure reordering on the
      // success path and means a slot that has already been built and
      // inserted is never untracked at any throw point.
      const { item, frag } = buildArrayItem(v);
      if (frag) parent.insertBefore(frag, nextArrayAnchor(old, i, marker));
      next.push(item);
      if (o) removeArrayItem(o);
      consumed = i + 1;
    }

    // Shrink: remove slots beyond the new length.
    for (let i = value.length; i < old.length; i++) {
      removeArrayItem(old[i]);
      consumed = i + 1;
    }
    state.items = next;
  } catch (err) {
    // `state.items` is committed only after the whole walk, so a throw part
    // way through discards `next` entirely: the map of slots keeps describing
    // positions whose nodes were already removed, while the freshly built and
    // inserted ones are in the document tracked by nothing. Nothing is logged
    // after the first throw, and the orphan outlives even a render of an EMPTY
    // array, because the only code that could remove it walks `state.items`.
    //
    // Splice the untouched tail of `old` onto what `next` accumulated, so the
    // bookkeeping describes the DOM again. The invariant that holds at any
    // throw point: every live node is described by exactly one slot, the
    // slots below `next.length` being the rebuilt or reused ones and the rest
    // the part of `old` this pass never reached. Index alignment survives
    // because this reconciler is POSITIONAL, so a slot's index IS its
    // identity, which is also why the boundary has to come from `consumed`
    // rather than `next.length`: during the shrink loop those differ, and
    // splicing from `next.length` would re-describe slots already removed.
    // A later render that grew the array would then match a live value
    // against a DETACHED slot with the same `strings`, update it in place,
    // and that row would silently never appear.
    //
    // Deliberately NOT a teardown-and-rebuild of the region, for the reason
    // recorded on `reconcileRepeat`'s catch above: it discards node identity
    // for every row, which cancels an in-progress native drag and drops focus
    // and scroll.
    //
    // The residual is a throw from the removal step itself, which takes a
    // throwing DOM to reach (the teardown it calls is total, so only
    // `removeBetween` is left, and that calls `removeChild` solely on nodes
    // the renderer owns). State it rather than deny it: `removeBetween`
    // takes the start marker first and then early-returns for good once that
    // marker is gone, so a row whose removal refused part-way can never be
    // removed afterwards. Its remaining nodes stay in the document, and an
    // EMPTY render will not clear them. Tracked or not, they are there for
    // the life of the region, the same residual `reconcileRepeat`'s catch
    // names. What this repair buys is that there is only ONE such row and
    // every other slot still reconciles, where before the whole pass was
    // discarded.
    state.items = next.concat(old.slice(consumed));
    throw err;
  }
}

/**
 * The node a freshly-built slot at index `i` inserts before: the first
 * node of the current or next still-attached old slot, else the part
 * marker (a tail append).
 * @param {ArrayItem[]} old @param {number} i @param {Comment} marker
 * @returns {ChildNode}
 */
function nextArrayAnchor(old, i, marker) {
  for (let j = i; j < old.length; j++) {
    const f = arrayItemFirstNode(old[j]);
    if (f && f.parentNode) return f;
  }
  return marker;
}

/** @param {{ kind: 'array', items: ArrayItem[] }} state */
function teardownArray(state) {
  for (const it of state.items) removeArrayItem(it);
  state.items = [];
}

/**
 * Collect [start .. end] (inclusive) and insert immediately before `anchor`.
 * Browsers treat insertBefore of an already-connected node as a move and
 * preserve element identity + focus.
 *
 * @param {Node} start
 * @param {Node} end
 * @param {Node} parent
 * @param {Node} anchor
 */
function moveRange(start, end, parent, anchor) {
  // No-op if the range is already immediately before the anchor.
  if (end.nextSibling === anchor && start.parentNode === parent) return;
  const frag = document.createDocumentFragment();
  let n = start;
  while (n) {
    const next = n.nextSibling;
    frag.appendChild(n);
    if (n === end) break;
    n = next;
  }
  parent.insertBefore(frag, anchor);
}

/**
 * Shallow array equality (Object.is on each element). Used by the
 * `guard` directive to skip re-evaluation when deps are unchanged.
 * @param {readonly unknown[]} a
 * @param {readonly unknown[]} b
 */
function shallowEqualArray(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/** @param {Extract<BoundPart, {kind:'child'}>} part */
function teardownChild(part) {
  // Always abort any in-flight directive state on the part, even if
  // `part.child` itself is something else (e.g. an `until` directive
  // installed __untilState but applyChild's recursion overwrote
  // part.child to the rendered fallback shape).
  const partAny = /** @type any */ (part);
  if (partAny.__untilState) {
    partAny.__untilState.aborted = true;
    partAny.__untilState = undefined;
  }
  if (partAny.__watchSub) {
    teardownWatch(partAny);
  }

  if (!part.child) return;
  const c = /** @type any */ (part.child);
  if (c.kind === 'repeat') {
    teardownRepeat(c);
  } else if (c.kind === 'array') {
    teardownArray(c);
  } else if (c.kind === 'async-stream') {
    teardownAsyncStream(c);
  } else if ('strings' in c) {
    const inst = /** @type TemplateInstance */ (part.child);
    disposeInstance(inst);
    removeBetween(inst.startNode, inst.endNode);
  } else {
    for (const n of /** @type ChildNode[] */ (part.child)) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }
  }
  part.child = undefined;
}

/**
 * Clear per-part directive state slots that don't apply to the value
 * currently being rendered. Prevents stale `__guardDeps` from short-
 * circuiting a render when the directive at this position is no longer
 * a guard, stale `__cacheMap` from accumulating across non-cache
 * renders, and stale `__untilState` from letting a prior Promise
 * resolution overwrite newer DOM.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {unknown} value
 */
function clearStaleDirectiveState(part, value) {
  const partAny = /** @type any */ (part);
  if (partAny.__untilState && !isUntil(value)) {
    partAny.__untilState.aborted = true;
    partAny.__untilState = undefined;
  }
  if (partAny.__guardDeps !== undefined && !isGuard(value)) {
    partAny.__guardDeps = undefined;
  }
  if (partAny.__cacheMap && !isCache(value)) {
    partAny.__cacheMap = undefined;
  }
  if (partAny.__keyedKey !== undefined && !isKeyed(value)) {
    partAny.__keyedKey = undefined;
  }
  if (partAny.__watchSub && !isWatch(value)) {
    teardownWatch(partAny);
  }
}

/* ================================================================
 * Cache directive: detach + retain prior template instances so that
 * toggling between sub-templates preserves their DOM state.
 * ================================================================ */

/**
 * Apply the `cache` directive at a child position. The cache is stored
 * on the part as `__cacheMap: Map<strings, { inst, holderFrag }>`.
 *
 * When the new inner value is a template whose `strings` already lives
 * in the cache map, re-attach the stashed nodes before the marker and
 * reconcile values against the new template. When the new inner is a
 * template whose strings aren't cached, stash the currently-attached
 * instance (if any) into the cache map before rendering the new one.
 *
 * Non-template inner values fall through to the generic applyChild path
 * (after first stashing any currently-attached cached instance).
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {unknown} inner
 */
function applyCache(part, inner) {
  const marker = part.marker;
  const partAny = /** @type any */ (part);
  /** @type {Map<TemplateStringsArray, { inst: TemplateInstance, holder: DocumentFragment }>} */
  let cacheMap = partAny.__cacheMap;
  if (!cacheMap) {
    cacheMap = new Map();
    partAny.__cacheMap = cacheMap;
  }

  const currentChild = /** @type any */ (part.child);
  const currentIsInstance = currentChild && 'strings' in currentChild;

  // If the currently-attached child IS a template instance, decide
  // whether to update-in-place, stash for later, or destroy.
  if (currentIsInstance) {
    const currentInst = /** @type TemplateInstance */ (currentChild);

    // Same template structure: reconcile values, no detach/re-attach.
    if (isTemplate(inner) && currentInst.strings === /** @type any */ (inner).strings) {
      updateInstance(currentInst, /** @type any */ (inner).values);
      return;
    }

    // Different shape: detach the current instance into a holder fragment
    // and store it in the cache map. We keep the existing instance, slot
    // markers, and rendered nodes; only the parent changes. moveRange's
    // null anchor means "append to parent".
    const holder = document.createDocumentFragment();
    moveRange(currentInst.startNode, currentInst.endNode, holder, null);
    cacheMap.set(currentInst.strings, { inst: currentInst, holder });
    part.child = undefined;
  }

  // Now part.child is either undefined or some non-instance shape (rare;
  // happens when prior render had a string / array / etc.). For non-
  // instance shapes, fall through to the generic teardown via applyChild.

  // If the new inner is a template AND we've cached an instance for its
  // strings, re-attach it.
  if (isTemplate(inner)) {
    const tr = /** @type any */ (inner);
    const cached = cacheMap.get(tr.strings);
    if (cached) {
      cacheMap.delete(tr.strings);
      // Tear down any non-instance child currently attached (a string /
      // array of text nodes from a prior cache(non-template) render).
      // Without this the prior nodes remain in the DOM alongside the
      // re-attached cached template.
      if (part.child) {
        teardownChild(part);
      }
      // Move the cached nodes back before the marker.
      moveRange(cached.inst.startNode, cached.inst.endNode, /** @type Node */ (marker.parentNode), marker);
      // Reconcile values so any state changes since detachment apply.
      updateInstance(cached.inst, tr.values);
      part.child = cached.inst;
      // A re-attached instance may carry ALREADY-APPLIED slot parts, whose
      // finalize will never fire again, while the host's record moved on
      // during the stash (content for these slots was parked when an apply
      // ran with the slot unreachable). Re-run the apply for each owning
      // host so parked content is pulled back out. The collection walks the
      // re-attached DOM RANGE (not the instance tree): slot parts live on
      // whatever template level contains the <slot> (nested holes, repeat /
      // array items, streamed chunks), so a structural DOM walk is the only
      // shape that covers every composition uniformly. moveRange already
      // ran, so the range is live and each slot's parent walk reaches its
      // host.
      const hosts = new Set();
      for (
        let n = cached.inst.startNode.nextSibling;
        n && n !== cached.inst.endNode;
        n = n.nextSibling
      ) {
        if (n.nodeType !== 1) continue;
        const el = /** @type {Element} */ (n);
        if (el.matches('slot[data-webjs-light]')) {
          const h = findSlotHost(el);
          if (h) hosts.add(h);
        }
        for (const s of el.querySelectorAll('slot[data-webjs-light]')) {
          const h = findSlotHost(s);
          if (h) hosts.add(h);
        }
      }
      for (const h of hosts) applySlotAssignments(h);
      return;
    }
  }

  // No cached instance available. Render the new inner value via the
  // standard applyChild path. The currentIsInstance branch already
  // handled detaching the prior instance; if part.child still holds a
  // non-instance shape, applyChild will tear it down generically.
  applyChildInner(part, inner);
}

/* ================================================================
 * Until directive: render highest-priority resolved candidate.
 * ================================================================ */

/**
 * Apply the `until` directive at a child position.
 *
 * Priority is left-to-right: args[0] has the highest priority. The
 * highest-priority synchronous candidate (if any) renders immediately.
 * Strictly-higher-priority Promises are awaited in the background; when
 * one resolves AND no higher-priority Promise has already resolved, its
 * result becomes the rendered value.
 *
 * The directive's state lives on `part.__untilState` (a stable slot
 * that survives `applyChild`'s overwrites of `part.child`). When a new
 * render replaces the directive, the prior state's `aborted` flag flips
 * to `true` so any in-flight Promise resolutions short-circuit instead
 * of overwriting newer DOM.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {readonly unknown[]} args
 */
function applyUntil(part, args) {
  // Carry forward the prior render's `highestResolved` ONLY when the
  // args list is unchanged. When any argument identity changes, prior
  // priorities no longer apply (a Promise that won at index 0 may now
  // sit at a different index, or have been replaced entirely); the
  // state must reset to Infinity so the new args' Promises can compete.
  //
  // For TemplateResult args, compare by `strings` array identity rather
  // than the wrapper object identity. `html\`loading...\`` evaluates to
  // a fresh TemplateResult on every call but the strings array is
  // interned per call site, so the conceptual value is unchanged.
  const partAny = /** @type any */ (part);
  // Same as applyWatch: the promise handlers below commit with no render on
  // the stack, so the owning component is recorded here while it is knowable.
  if (currentRenderRoot) partAny.__commitOwner = boundaryOwnerOf(currentRenderRoot);
  const prevState = partAny.__untilState;
  const prevArgs = partAny.__untilArgs;
  const argEq = (a, b) => {
    if (Object.is(a, b)) return true;
    if (isTemplate(a) && isTemplate(b)
        && /** @type any */ (a).strings === /** @type any */ (b).strings) return true;
    return false;
  };
  const argsEqual = prevArgs && prevArgs.length === args.length
    && prevArgs.every((a, i) => argEq(a, args[i]));
  const carriedHighest = argsEqual && prevState ? prevState.highestResolved : Infinity;
  if (prevState) prevState.aborted = true;
  partAny.__untilArgs = args.slice();

  /** @type {{aborted:boolean, highestResolved:number}} */
  const state = { aborted: false, highestResolved: carriedHighest };
  partAny.__untilState = state;

  // Highest-priority synchronous candidate. If found, render it now
  // and cap further Promise subscription to strictly-higher priorities.
  let firstSyncIdx = -1;
  let firstSyncVal = undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a || typeof (/** @type any */ (a).then) !== 'function') {
      firstSyncIdx = i;
      firstSyncVal = a;
      break;
    }
  }

  if (firstSyncIdx !== -1 && firstSyncIdx <= state.highestResolved) {
    // The sync candidate beats any previously-rendered Promise value
    // (when firstSyncIdx < state.highestResolved) OR re-renders the
    // sync fallback at the same priority slot (when ===), in case its
    // value changed between renders.
    applyChildInner(part, firstSyncVal);
    state.highestResolved = firstSyncIdx;
  } else if (firstSyncIdx === -1 && !partAny.__untilEverRendered) {
    // First-ever render of this part with all-Promise args: render
    // empty as the initial fallback while Promises settle.
    applyChildInner(part, '');
  }
  // Else: either there is no sync candidate but the part has rendered
  // before (preserve existing DOM until a Promise resolves), OR the
  // sync candidate is lower-priority than what's already rendered.
  // Either way: leave the existing DOM in place. This prevents the
  // "all-Promises wipes prior content" flash on re-renders.
  partAny.__untilEverRendered = true;

  // Subscribe to Promises with priority strictly less than what's
  // currently rendered. (Lower index = higher priority in lit's model.)
  // Each subscription wraps in Promise.resolve() so synchronous
  // thenables get a microtask boundary, matching lit's contract that
  // all Promise/thenable resolutions are deferred.
  const cap = firstSyncIdx === -1
    ? Math.min(args.length, state.highestResolved)
    : Math.min(firstSyncIdx, state.highestResolved);
  for (let i = 0; i < cap; i++) {
    const a = args[i];
    if (!a || typeof (/** @type any */ (a).then) !== 'function') continue;

    Promise.resolve(/** @type Promise<unknown> */ (a)).then(
      (resolved) => {
        if (state.aborted) return;
        if (i >= state.highestResolved) return;
        // Commit FIRST, record the new priority only once it succeeded.
        // Advancing `highestResolved` up front meant a commit throw left the
        // region torn down while the state claimed index `i` had won, so
        // every later resolution at a lower priority was refused and the
        // region stayed empty. Committing first also keeps the throw inside
        // the try, where it can reach the component boundary.
        try {
          commitOutOfBand(part, () => applyChildInner(part, resolved));
        } catch (err) {
          reportOutOfBandCommitError(part, err);
          return;
        }
        state.highestResolved = i;
      },
      () => {
        // Swallow rejection. A rejected Promise is treated as "no value";
        // the existing render stays in place.
      },
    );
  }
}

/**
 * Route a throw from an OUT-OF-BAND commit to the owning component's
 * render-error boundary.
 *
 * `watch`'s notify microtask and `until`'s Promise resolution commit from
 * outside `component.js`'s update cycle, so none of the boundaries that wrap
 * every other render path are on the stack. Left alone, a commit throw there
 * escapes as a window-level `error` / unhandled rejection instead of the
 * per-component `renderError()` the sync and async render paths both route
 * to, which breaks per-component error isolation for exactly these two
 * directives.
 *
 * Reads the owner stamped on the part when the directive was installed. See
 * the note in the body for why this is not a walk up the parent chain.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {unknown} error
 */
function reportOutOfBandCommitError(part, error) {
  let err;
  try {
    err = error instanceof Error ? error : new Error(String(error));
  } catch {
    // The thrown value's own `toString` threw. That is the exact class of
    // value that makes a commit throw in the first place, so it is reachable
    // here; do not let stringifying it mask the original failure.
    err = new Error('render error (unstringifiable thrown value)');
  }
  // The owner stamped when the directive was installed, which is the
  // component whose TEMPLATE holds this part. Never walk the parent chain
  // for this: `_handleRenderError` lives on WebComponent's prototype, so
  // every upgraded element on the way up carries one, and the FIRST one a
  // structural walk meets is the innermost element the part happens to sit
  // inside, not the template that owns it. Routing there is not merely the
  // wrong log line: a light-DOM component's renderError() commits into the
  // component itself, which would replace the very children holding this
  // part's markers and silently kill every later update through it.
  const owner = /** @type any */ (part).__commitOwner;
  if (owner && typeof owner._handleRenderError === 'function') {
    owner._handleRenderError(err);
    return;
  }
  // No component boundary owns this part (a bare `render()` into a plain
  // container). Nothing can contain the error, so surface it rather than
  // swallow it.
  throw err;
}

/**
 * Abort an `until` directive's in-flight Promise tracking. Called from
 * `teardownChild` when the part is being reset.
 * @param {{aborted:boolean}} state
 */
function teardownUntil(state) {
  state.aborted = true;
}

/* ================================================================
 * watch (signal binding): fine-grained reactive part.
 * ================================================================ */

/**
 * Bind a child part to a signal. Reads the signal once and writes its
 * value into the part. Installs a per-part `Signal.subtle.Watcher`
 * that, on signal change, re-reads and re-applies the value WITHOUT
 * re-running the host component's render(). When the part is torn
 * down (teardownChild) the watcher is disposed.
 *
 * The signal read happens inside the watcher's `observe()`, so the
 * dependency edge connects the signal to THIS watcher. The host's
 * own render watcher is outside the active stack here, so the host
 * does not also subscribe to the signal (which would double-fire as
 * both a full re-render and a watch update).
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {{ get: () => unknown, __isSignal: true }} sig
 */
function applyWatch(part, sig) {
  const partAny = /** @type any */ (part);
  // Record the owning component while we are still inside its render(), the
  // only moment it is knowable. The notify microtask below commits with no
  // render on the stack and no way to derive it. Keep a prior stamp if this
  // somehow runs outside a render, rather than clearing a good owner.
  if (currentRenderRoot) partAny.__commitOwner = boundaryOwnerOf(currentRenderRoot);
  // Same signal as last render: refresh dep tracking via observe (the
  // spec-aligned Watcher fires once per arm, so re-observing re-arms).
  if (partAny.__watchSig === sig && partAny.__watchSub) {
    let value;
    partAny.__watchSub.observe(() => { value = sig.get(); });
    applyChildInner(part, value);
    return;
  }
  // Signal changed (or first render). Tear down any prior watcher.
  if (partAny.__watchSub) {
    partAny.__watchSub.dispose();
    partAny.__watchSub = undefined;
  }
  partAny.__watchSig = sig;
  // Notify defers to a microtask because the spec forbids signal reads
  // inside the notify itself. The microtask re-observes (re-arms + re-
  // records the dep) and applies the new value to the part.
  const watcher = new Signal.subtle.Watcher(() => {
    queueMicrotask(() => {
      if (partAny.__watchSub !== watcher) return; // disposed mid-flight
      let v;
      // Nothing above this microtask catches: it runs outside the host's
      // update cycle, so a commit throw here would surface at the window
      // instead of the component's renderError(). Route it explicitly.
      try {
        watcher.observe(() => { v = sig.get(); });
        commitOutOfBand(part, () => applyChildInner(part, v));
      } catch (err) {
        reportOutOfBandCommitError(part, err);
      }
    });
  });
  partAny.__watchSub = watcher;
  let initial;
  watcher.observe(() => { initial = sig.get(); });
  applyChildInner(part, initial);
}

/**
 * Dispose a `watch` directive's per-part watcher. Called from
 * `teardownChild` and from `clearStaleDirectiveState` when the value
 * at the part is no longer a watch.
 * @param {any} partAny
 */
function teardownWatch(partAny) {
  if (partAny.__watchSub) {
    partAny.__watchSub.dispose();
    partAny.__watchSub = undefined;
    partAny.__watchSig = undefined;
  }
}

/* ================================================================
 * asyncAppend / asyncReplace: stream from AsyncIterable.
 * ================================================================ */

/**
 * Apply `asyncAppend(iterable, mapper?)` at a child position.
 *
 * Iterates the AsyncIterable in the background. Each yielded value is
 * mapped (optional) and rendered as a node group, appended before the
 * marker. The state is stored on `part.child` so `teardownChild` can
 * abort the iteration when the part is reset.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {{ iterable: AsyncIterable<unknown>, mapper?: (v: unknown, i: number) => unknown }} dir
 */
function applyAsyncAppend(part, dir) {
  const partAny = /** @type any */ (part);
  // Record the owning component while we are still inside its render(), the
  // only moment it is knowable, exactly as `applyWatch` / `applyUntil` do.
  // Chunks commit from an async loop with no render on the stack, so without
  // this both the chunk's own commit throw and any directive nested inside a
  // chunk have no owner to route to. Stamped ABOVE the short-circuit so a
  // re-render that returns early still refreshes the owner, and guarded so a
  // re-install outside a render keeps a previously good one.
  if (currentRenderRoot) partAny.__commitOwner = boundaryOwnerOf(currentRenderRoot);
  // Same-iterable short-circuit: if the prior render's iterable identity
  // matches, the existing iterator is still consuming it. Re-subscribing
  // would start a fresh iterator that misses already-yielded values.
  // Matches lit-html's behavior.
  const currentChild = /** @type any */ (part.child);
  if (currentChild && currentChild.kind === 'async-stream'
      && currentChild.mode === 'append'
      && currentChild.iterable === dir.iterable) {
    return;
  }

  teardownChild(part);

  const iterator = /** @type AsyncIterator<unknown> */ (
    dir.iterable[Symbol.asyncIterator]()
  );
  /** @type {AsyncStreamState} */
  const state = {
    kind: 'async-stream',
    mode: 'append',
    aborted: false,
    iterable: dir.iterable,
    iterator,
    /** @type {ChildNode[]} */ nodes: [],
  };
  part.child = state;

  consumeAsyncStream(state, part, dir);
}

/**
 * Apply `asyncReplace(iterable, mapper?)` at a child position. Same as
 * `applyAsyncAppend` but each new value replaces the previous content.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {{ iterable: AsyncIterable<unknown>, mapper?: (v: unknown, i: number) => unknown }} dir
 */
function applyAsyncReplace(part, dir) {
  const partAny = /** @type any */ (part);
  // Owner stamp: see comment in applyAsyncAppend. Above the short-circuit.
  if (currentRenderRoot) partAny.__commitOwner = boundaryOwnerOf(currentRenderRoot);
  // Same-iterable short-circuit: see comment in applyAsyncAppend.
  const currentChild = /** @type any */ (part.child);
  if (currentChild && currentChild.kind === 'async-stream'
      && currentChild.mode === 'replace'
      && currentChild.iterable === dir.iterable) {
    return;
  }

  teardownChild(part);

  const iterator = /** @type AsyncIterator<unknown> */ (
    dir.iterable[Symbol.asyncIterator]()
  );
  /** @type {AsyncStreamState} */
  const state = {
    kind: 'async-stream',
    mode: 'replace',
    aborted: false,
    iterable: dir.iterable,
    iterator,
    /** @type {ChildNode[]} */ nodes: [],
  };
  part.child = state;

  consumeAsyncStream(state, part, dir);
}

/**
 * @typedef {{
 *   kind: 'async-stream',
 *   mode: 'append' | 'replace',
 *   aborted: boolean,
 *   iterable: AsyncIterable<unknown>,
 *   iterator: AsyncIterator<unknown>,
 *   nodes: ChildNode[],
 * }} AsyncStreamState
 */

/**
 * Consume an AsyncIterable for `asyncAppend` / `asyncReplace`. Drives
 * the iterator with an explicit `.next()` loop (rather than `for await`)
 * so that `teardownAsyncStream` can call `iterator.return()` to break
 * a generator parked on an `await`. The `aborted` flag is also checked
 * after every `next()` resolve to short-circuit if abortion happened
 * while the iterator was suspended.
 *
 * Each pass carries TWO try spans, and which failure lands in which is the
 * load-bearing part. SPAN A is the author's own code, the iterable AND the
 * `mapper` it was given, and a throw from either is logged to the console and
 * ends the stream, on the long-standing reasoning that an author's iterable
 * should handle its own errors. SPAN B is the chunk COMMIT, which is a render
 * failure of the component whose template holds the binding, so it routes to
 * that component's `renderError()` and stops the stream.
 *
 * Scope note: only a throw from the COMMIT can stop the stream from here. A
 * directive nested INSIDE a committed chunk (a `watch` whose signal changes
 * later) throws from its own handler, outside this loop entirely, so it
 * reaches the boundary but this loop knows nothing about it and keeps
 * pulling. That is the same for any directive nested anywhere else. lit is no authority
 * either way here (it has no per-component boundary, and both failures become
 * unhandled rejections at the window), so this follows the
 * per-component error isolation WebJs has instead.
 *
 * @param {AsyncStreamState} state
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {{ iterable: AsyncIterable<unknown>, mapper?: (v: unknown, i: number) => unknown }} dir
 */
async function consumeAsyncStream(state, part, dir) {
  const marker = part.marker;
  let i = 0;
  while (!state.aborted) {
    /** @type {IteratorResult<unknown>} */
    let result;
    /** @type {unknown} */
    let mapped;
    // SPAN A, the author's iterable. A throw here is the author's generator
    // failing, not a render, so it keeps the long-standing console.error and
    // ends the stream. It is a separate span from the commit below on purpose
    // rather than a flag the one catch inspects, because the distinction is
    // the whole point: `reportOutOfBandCommitError` RETHROWS for a part with
    // no owner, and a single enclosing try would hand that rethrow straight
    // back to this swallow, which is the escape this split exists to stop.
    try {
      result = await state.iterator.next();
      if (state.aborted) break;
      if (result.done) break;
      mapped = dir.mapper ? dir.mapper(result.value, i) : result.value;
    } catch (err) {
      // Note this ENDS the stream, and always has: the catch used to sit
      // outside the loop, so there has never been a resume path here.
      if (typeof console !== 'undefined') console.error('[webjs] asyncStream error:', err);
      return;
    }

    // SPAN B, the chunk commit. This is a render of the component whose
    // TEMPLATE holds the binding, so a throw is that component's render
    // failure and routes to its `renderError()`, the same as `watch` and
    // `until` already do from their own out-of-band commits. `renderToNodes`
    // is INSIDE the wrap because that is where a nested directive is
    // installed and reads `currentRenderRoot`; without it, a `watch()` inside
    // a chunk is stamped with no owner and its later throw escapes.
    // `commitInto` is a different concern (the renderer-write window for a
    // light slot host), so the two nest rather than replace each other.
    try {
      commitOutOfBand(part, () => {
        const newNodes = renderToNodes(mapped);

        // This chunk commit runs in an async loop OUTSIDE any render() window,
        // so open the renderer-write window explicitly: without it, committing a
        // stream chunk into a light slot host would hit the patched insertBefore /
        // removeChild and fold the renderer's own output into `authored`.
        commitInto(marker.parentNode, () => {
          if (state.mode === 'replace') {
            for (const n of state.nodes) {
              if (n.parentNode) n.parentNode.removeChild(n);
            }
            state.nodes = [];
          }

          const frag = document.createDocumentFragment();
          for (const n of newNodes) frag.appendChild(n);
          marker.parentNode?.insertBefore(frag, marker);
          state.nodes.push(...newNodes);
        });
      });
    } catch (err) {
      // Stop the stream. The boundary is about to render an error state, and
      // appending later chunks into a region it may have replaced is not a
      // recovery. The rendered nodes are left alone: blanking the region is a
      // separate decision, and `teardownAsyncStream` is for the part being
      // reset, not for this.
      state.aborted = true;
      try { state.iterator.return?.()?.catch?.(() => {}); } catch { /* best effort */ }
      // Rethrows when nothing can receive the error, which for a bare
      // `render()` into a plain container is an owner that carries no
      // `_handleRenderError` (the stamp records the container itself, so the
      // owner is present, just not a component). Surfacing beats swallowing
      // there, and it matches `watch` and `until`, which rethrow from their
      // own out-of-band handlers for the same reason. The exact shape differs
      // by site rather than being one thing: this rejects the loop's
      // promise, `until` rejects from its `.then`, and `watch` throws inside
      // a `queueMicrotask`, which is an uncaught error rather than a
      // rejection.
      reportOutOfBandCommitError(part, err);
      return;
    }

    i++;
  }
}

/**
 * Render a single value into a flat list of DOM nodes for insertion via
 * insertBefore. Handles strings, numbers, TemplateResult, and arrays.
 * @param {unknown} value
 * @returns {ChildNode[]}
 */
function renderToNodes(value) {
  if (value == null || value === false || value === true) return [];
  if (isTemplate(value)) {
    const tr = /** @type any */ (value);
    const { templateEl, parts, formActions } = compile(tr);
    const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));
    const bound = parts.map((p) => bindPart(p, frag));
    for (let i = 0; i < tr.values.length; i++) {
      applyPart(bound[i], tr.values[i], undefined, tr.values);
    }
    reconcileFormActions(formActions, bound, tr.values);
    // Slot parts need their one-shot apply here too (same contract as
    // createInstance / nested templates / buildDetached): the caller
    // (consumeAsyncStream) inserts these nodes synchronously in the same
    // task, so the slot-part's one-microtask finalize retry lands in the
    // live tree. Without this, a <slot> inside streamed chunk content never
    // finalizes and its name suppresses parking forever.
    for (const p of bound) {
      if (p.kind === 'slot') applyPart(p, undefined, undefined, []);
    }
    return [...frag.childNodes];
  }
  if (Array.isArray(value)) {
    const nodes = [];
    for (const v of value) nodes.push(...renderToNodes(v));
    return nodes;
  }
  return [document.createTextNode(String(value))];
}

/**
 * Abort an async-stream directive. Sets `aborted = true` (so the next
 * `await iterator.next()` resolution short-circuits), removes all nodes
 * rendered so far, and explicitly calls `iterator.return()` so a
 * generator parked on `await` can unwind via its `finally` blocks
 * instead of leaking.
 * @param {AsyncStreamState} state
 */
function teardownAsyncStream(state) {
  state.aborted = true;
  for (const n of state.nodes) {
    if (n.parentNode) n.parentNode.removeChild(n);
  }
  state.nodes = [];
  // Best-effort iterator cleanup. `.return()` is optional on AsyncIterators;
  // generators built via `async function*` provide it and run their
  // `finally` blocks. Swallow any rejection so teardown can't throw.
  try {
    state.iterator.return?.()?.catch?.(() => {});
  } catch {
    // ignore
  }
}
