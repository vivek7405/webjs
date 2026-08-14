import { MARKER } from '../html.js';
import { BINDING_PREFIXES, isBindingPrefix } from '../binding-prefixes.js';
import { isSubmitterReflectedProp } from '../form-action.js';
import { LIGHT_SLOT_ATTR } from '../slot.js';

/** @type {WeakMap<TemplateStringsArray | string[], { templateEl: HTMLTemplateElement, parts: PartDescriptor[], formActions: FormActionRecord[] | null }>} */
export const templateCache = new WeakMap();
/**
 * Submitters this renderer stamped with an identity, so a later release removes
 * only the framework's own `name` / `value` and never an author's.
 * @type {WeakMap<Element, string>}
 */
export const submitterActionBindings = new WeakMap();
export const INSTANCE = Symbol.for('webjs.instance');

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

/** @param {import('../html.js').TemplateResult} tr */
export function compile(tr) {
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

        for (const name of toRemove) {
          el.removeAttribute(name);
        }
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
  // The submission pair, named per element (#1307). A form declares `method` /
  // `enctype`; a submitter declares `formmethod` / `formenctype`, and a bound
  // one receives them from the renderer exactly as a bound form does.
  const methodAttr = isForm ? 'method' : 'formmethod';
  const enctypeAttr = isForm ? 'enctype' : 'formenctype';
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
    // #1307: a bound submitter carries its OWN submission attributes, so the
    // pair to capture depends on the element. `formmethod` / `formenctype` on a
    // button are exactly what `method` / `enctype` are on a form, and they flow
    // through the same resolution below untouched.
    if (name !== methodAttr && name !== enctypeAttr) continue;
    if (p.kind !== 'attr' && p.kind !== 'attr-mixed' && p.kind !== 'bool') continue;
    const d = /** @type any */ (parts[p.idx]);
    /** @type {FormAttrPart} */
    const entry = { i: p.idx, kind: p.kind };
    // A mixed attribute's value is `statics[0] + v0 + statics[1] + ...`, so the
    // pieces have to travel with the record; reading the anchor's value alone
    // is right only when the statics are empty.
    if (p.kind === 'attr-mixed') { entry.statics = d.statics || []; entry.group = d.group || []; }
    // Compared against `methodAttr`, NOT the literal 'method'. On a submitter
    // the pair is `formmethod` / `formenctype`, so a literal comparison sent
    // every hole-provided `formmethod` into `enctypeParts`: the client then
    // resolved it as the enctype, refused `formenctype="post"`, and threw on
    // hydration for a template SSR renders happily. That is the
    // render-on-the-server, crash-in-the-browser direction this module treats
    // as the one unacceptable failure.
    (name === methodAttr ? methodParts : enctypeParts).push(entry);
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
    staticMethod: el.getAttribute(methodAttr),
    staticEnctype: el.getAttribute(enctypeAttr),
    methodParts,
    enctypeParts,
  };
}
