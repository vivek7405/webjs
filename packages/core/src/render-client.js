import { isTemplate, MARKER } from './html.js';
import { escapeAttr } from './escape.js';
import { isRepeat } from './repeat.js';
import { isUnsafeHTML, isLive } from './directives.js';

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
 *     survive `setState`.
 *   - Event listeners are attached once and retargeted when the handler
 *     reference changes (swap-in-place via a dispatch closure, so `addEventListener`
 *     isn't churned every render).
 *   - This is a conservative implementation; no keyed list diffing yet — array
 *     changes rebuild the whole text part.
 */

/** @type {WeakMap<TemplateStringsArray | string[], { templateEl: HTMLTemplateElement, parts: PartDescriptor[] }>} */
const templateCache = new WeakMap();
const INSTANCE = Symbol.for('webjs.instance');

/**
 * @typedef {{
 *   kind: 'child' | 'attr' | 'attr-mixed' | 'event' | 'prop' | 'bool' | 'noop',
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
 * } BoundPart
 */

/**
 * Render a value into a container, reusing DOM where possible.
 *
 * @param {unknown} value
 * @param {Element | DocumentFragment | ShadowRoot} container
 */
export function render(value, container) {
  const host = /** @type any */ (container);
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
    // rendering. The content will be replaced with identical output —
    // no visible flash because SSR and client render produce the same HTML.
    const firstChild = container.firstChild;
    if (firstChild && firstChild.nodeType === 8 && /** @type {Comment} */ (firstChild).data === 'webjs-hydrate') {
      firstChild.remove();
    }

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
            // Closing quote — finalize the attr-mixed part.
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
        // Holes inside <!-- ... --> bake in at compile time: comments are inert.
        html += String(values[i] ?? '');
        commentDashes = 0;
        parts.push({ kind: 'noop', path: [] });
        continue;
      }
      if (state === 'rawtext') {
        // Inside <script>/<style>: bake the value verbatim. Fine-grained
        // updates of script/style bodies aren't meaningful in v1.
        html += String(values[i] ?? '');
        rawTail = '';
        parts.push({ kind: 'noop', path: [] });
        continue;
      }
      if (state === 'text') {
        // Child hole: insert a comment marker. Use bracketed markers so we can
        // later walk all comments and find ours without ambiguity.
        html += `<!--${MARKER}${partIdx}-->`;
        parts.push({ kind: 'child', path: [] });
      } else if (state === 'after-eq') {
        const prefix = attrName[0];
        const name = attrName.slice(1);
        if (prefix === '@' || prefix === '.' || prefix === '?') {
          // Strip the attribute name+"=" from html and add a sentinel attr.
          html = html.slice(0, attrStart);
          const kind = prefix === '@' ? 'event' : prefix === '.' ? 'prop' : 'bool';
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
        // First hole inside a quoted attribute value — start mixed-attr tracking.
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

  // Walk the parsed fragment and record DOM paths for each part.
  assignPaths(templateEl.content, parts);

  cached = { templateEl, parts };
  templateCache.set(strings, cached);
  return cached;
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
        for (const attr of el.attributes) {
          if (attr.name.startsWith(`data-${MARKER}`)) {
            const idx = Number(attr.name.slice(`data-${MARKER}`.length));
            if (parts[idx] && parts[idx].kind !== 'child') {
              parts[idx].path = path.slice();
            }
            toRemove.push(attr.name);
          }
        }
        for (const a of toRemove) el.removeAttribute(a);
        visit(child);
      }
      path.pop();
    }
  }
  visit(root);
}

/* ================================================================
 * Instance lifecycle
 * ================================================================ */

/**
 * @param {import('./html.js').TemplateResult} tr
 * @param {Element | DocumentFragment | ShadowRoot} container
 */
function createInstance(tr, container) {
  const { templateEl, parts } = compile(tr);
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

  /** @type any */ (container).replaceChildren(startNode, ...frag.childNodes, endNode);
  return { strings: tr.strings, bound, lastValues, startNode, endNode };
}

/**
 * @param {PartDescriptor} p
 * @param {DocumentFragment | Element} root
 * @returns {BoundPart}
 */
function bindPart(p, root) {
  if (p.kind === 'noop') return /** @type any */ ({ kind: 'noop' });
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
  throw new Error(`unknown part kind ${/** @type any */(p).kind}`);
}

/**
 * @param {TemplateInstance} inst
 * @param {unknown[]} values
 */
function updateInstance(inst, values) {
  for (let i = 0; i < values.length; i++) {
    const next = values[i];
    if (Object.is(next, inst.lastValues[i])) continue;
    applyPart(inst.bound[i], next, inst.lastValues[i], values);
    inst.lastValues[i] = next;
  }
}

/**
 * @param {TemplateInstance} inst
 * @param {Element | DocumentFragment | ShadowRoot} container
 */
function clearInstance(inst, container) {
  // Dispose event listeners on event parts.
  for (const p of inst.bound) {
    if (p.kind === 'event') p.el.removeEventListener(p.name, p.dispatcher);
  }
  /** @type any */ (container).replaceChildren();
}

/* ================================================================
 * Part application
 * ================================================================ */

/**
 * @param {BoundPart} part
 * @param {unknown} value
 * @param {unknown} _prev
 */
function applyPart(part, value, _prev, allValues) {
  // Unwrap live() — dirty-check against the live DOM value, not the
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
      if (value == null || value === false) part.el.removeAttribute(part.name);
      else part.el.setAttribute(part.name, String(value));
      break;
    }
    case 'prop':
      /** @type any */ (part.el)[part.name] = value;
      break;
    case 'bool':
      if (value) part.el.setAttribute(part.name, '');
      else part.el.removeAttribute(part.name);
      break;
    case 'event':
      part.handler = typeof value === 'function' ? /** @type any */ (value) : null;
      break;
    case 'attr-mixed': {
      // Reconstruct the attribute from static pieces + all dynamic values.
      const mp = /** @type {{ statics: string[], group: number[] }} */ (/** @type any */ (part));
      let val = mp.statics[0];
      for (let j = 0; j < mp.group.length; j++) {
        val += String((allValues ? allValues[mp.group[j]] : value) ?? '');
        val += mp.statics[j + 1] || '';
      }
      part.el.setAttribute(part.name, val);
      break;
    }
    case 'noop':
      // intentionally empty — used for holes inside HTML comments
      break;
  }
}

/**
 * Child (text-position) part. Replace the marker's surrounding nodes with the
 * new value's rendered form. Nested TemplateResults get an instance with its
 * own parts; we reuse on `strings` identity.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {unknown} value
 */
function applyChild(part, value) {
  const marker = part.marker;

  // unsafeHTML directive — inject raw HTML string as DOM nodes.
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

  // Repeat directive — keyed reconciliation. Keep previous state when both
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

  // Remove previously rendered nodes between marker and its next sibling we own.
  if (part.child) {
    if (/** @type any */ (part.child).kind === 'repeat') {
      teardownRepeat(/** @type any */ (part.child));
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
      // Previous was ChildNode[] — remove each node we inserted.
      for (const n of /** @type ChildNode[] */ (part.child)) {
        if (n.parentNode) n.parentNode.removeChild(n);
      }
      part.child = undefined;
    }
  }

  if (value == null || value === false || value === true) return;

  if (isTemplate(value)) {
    const tr = /** @type any */ (value);
    const { templateEl, parts } = compile(tr);
    const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));
    const startNode = document.createComment(`${MARKER}s`);
    const endNode = document.createComment(`${MARKER}e`);
    const bound = parts.map((p) => bindPart(p, frag));
    const lastValues = [];
    for (let i = 0; i < tr.values.length; i++) {
      applyPart(bound[i], tr.values[i], undefined, tr.values);
      lastValues.push(tr.values[i]);
    }
    const nodes = [startNode, ...frag.childNodes, endNode];
    marker.parentNode?.insertBefore(nodesToFrag(nodes), marker);
    part.child = { strings: tr.strings, bound, lastValues, startNode, endNode };
    return;
  }

  if (Array.isArray(value)) {
    const list = [];
    for (const v of value) {
      if (isTemplate(v)) {
        // Create an inline instance. No keyed reconciliation yet.
        const tr = /** @type any */ (v);
        const { templateEl, parts } = compile(tr);
        const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));
        const bound = parts.map((p) => bindPart(p, frag));
        for (let i = 0; i < tr.values.length; i++) {
          applyPart(bound[i], tr.values[i], undefined, tr.values);
        }
        list.push(...frag.childNodes);
      } else if (v != null && v !== false && v !== true) {
        list.push(document.createTextNode(String(v)));
      }
    }
    const frag = nodesToFrag(list);
    marker.parentNode?.insertBefore(frag, marker);
    part.child = list;
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

/** @param {Node} start @param {Node} end */
function removeBetween(start, end) {
  if (!start.parentNode) return;
  let n = start;
  while (n && n !== end) {
    const next = n.nextSibling;
    n.parentNode?.removeChild(n);
    n = next;
  }
  if (end.parentNode === start.parentNode) end.parentNode?.removeChild(end);
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
  const { templateEl, parts } = compile(tr);
  const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));
  const startNode = document.createComment(`${MARKER}s`);
  const endNode = document.createComment(`${MARKER}e`);
  const bound = parts.map((p) => bindPart(p, frag));
  const lastValues = [];
  for (let i = 0; i < tr.values.length; i++) {
    applyPart(bound[i], tr.values[i], undefined, tr.values);
    lastValues.push(tr.values[i]);
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
        disposeInstance(existing);
        removeBetween(existing.startNode, existing.endNode);
        state.map.delete(key);
      }
      const { inst, frag } = buildDetached(/** @type any */ (tr));
      parent.insertBefore(frag, marker);
      newMap.set(key, inst);
    }
  }

  // Remove any keys that remain in the old map.
  for (const inst of state.map.values()) {
    disposeInstance(inst);
    removeBetween(inst.startNode, inst.endNode);
  }
  state.map = newMap;
}

/** @param {{ kind: 'repeat', map: Map<any, TemplateInstance> }} state */
function teardownRepeat(state) {
  for (const inst of state.map.values()) {
    disposeInstance(inst);
    removeBetween(inst.startNode, inst.endNode);
  }
  state.map.clear();
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

/** @param {Extract<BoundPart, {kind:'child'}>} part */
function teardownChild(part) {
  if (!part.child) return;
  if (/** @type any */ (part.child).kind === 'repeat') {
    teardownRepeat(/** @type any */ (part.child));
  } else if ('strings' in /** @type any */ (part.child)) {
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
