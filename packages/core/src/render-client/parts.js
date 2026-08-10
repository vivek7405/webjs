import { isTemplate, MARKER } from '../html.js';
import {
  assertNotFunctionActionAttr, assertNotFunctionReflectedActionProp,
  isBoundFormAction, formActionId, assertIdentifiableAction, FORM_ACTION_FIELD,
} from '../form-action.js';
import { isRepeat } from '../repeat.js';
import {
  isUnsafeHTML, isLive, isKeyed, isGuard, isTemplateContent, isRef, isCache, isUntil, isAsyncAppend, isAsyncReplace, isWatch
} from '../directives.js';
import { Signal } from '../signal.js';
import {
  LIGHT_SLOT_ATTR,
  SLOT_FALLBACK_FRAG,
  SLOT_STATE,
  SLOT_OWNER,
  RENDERING,
  applySlotAssignments,
  rescueAssignedNodes,
  withRendererWrites,
} from '../slot.js';
import { compile, templateCache, submitterActionBindings, INSTANCE } from './template-compiler.js';

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
export let currentRenderRoot = null;

export function setCurrentRenderRoot(root) {
  currentRenderRoot = root;
}

/**
 * Open the renderer-write window on a light-DOM host while `fn` commits into
 * it, so the host's patched slot-interception methods delegate to native and
 * a renderer commit is never mistaken for authored content. A no-op (just runs
 * `fn`) when `node` is not a slot host, so nested and non-host commits pay
 * nothing. Covers the ASYNC commit paths (async directives, streaming) that
 * run outside a synchronous render() call.
 */
export function commitInto(node, fn) {
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

/**
 * The element carrying the error boundary for a render root. A ShadowRoot has
 * no boundary of its own; its `.host` is the component.
 * @param {any} root
 * @returns {any}
 */
export function boundaryOwnerOf(root) {
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
export function commitOutOfBand(part, fn) {
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
 * @param {PartDescriptor} p
 * @param {DocumentFragment | Element} root
 * @returns {BoundPart}
 */
export function bindPart(p, root) {
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
 * @param {BoundPart} part
 * @param {unknown} value
 * @param {unknown} _prev
 */
export function applyPart(part, value, _prev, allValues, reconcileFormActionsCb) {
  if (isLive(value)) {
    const liveVal = /** @type any */ (value).value;
    if (part.kind === 'prop' && /** @type any */ (part.el)[part.name] === liveVal) return;
    if (part.kind === 'attr' && part.el.getAttribute(part.name) === String(liveVal)) return;
    if (part.kind === 'bool' && part.el.hasAttribute(part.name) === !!liveVal) return;
    value = liveVal;
  }

  switch (part.kind) {
    case 'child':
      applyChild(part, value, reconcileFormActionsCb);
      break;
    case 'attr': {
      if (value == null || value === false) part.el.removeAttribute(part.name);
      else if (isBoundFormAction(value, part.name, part.el.localName)) {
      } else {
        assertNotFunctionActionAttr(value, part.name, part.el.localName);
        part.el.setAttribute(part.name, String(value));
      }
      break;
    }
    case 'prop':
      assertNotFunctionReflectedActionProp(value, part.name, part.el.localName);
      /** @type any */ (part.el)[part.name] = value;
      break;
    case 'bool':
      assertNotFunctionActionAttr(value, part.name, part.el.localName);
      if (value) part.el.setAttribute(part.name, '');
      else part.el.removeAttribute(part.name);
      break;
    case 'event':
      part.handler = typeof value === 'function' ? /** @type any */ (value) : null;
      break;
    case 'element':
      applyElement(part, value);
      break;
    case 'attr-mixed': {
      const mp = /** @type {{ statics: string[], group: number[] }} */ (/** @type any */ (part));
      let val = mp.statics[0];
      for (let j = 0; j < mp.group.length; j++) {
        const piece = allValues ? allValues[mp.group[j]] : value;
        assertNotFunctionActionAttr(piece, part.name, part.el.localName);
        val += String(piece ?? '');
        val += mp.statics[j + 1] || '';
      }
      part.el.setAttribute(part.name, val);
      break;
    }
    case 'slot': {
      if (part.applied) break;
      const slotEl = part.slotEl;
      const finalize = () => {
        const host = findSlotHost(slotEl);
        if (!host) {
          part.applied = true;
          return;
        }
        if (!host.contains(slotEl)) {
          if (host.isConnected) queueMicrotask(finalize);
          else part.applied = true;
          return;
        }
        part.applied = true;
        if (isInShadowRootEl(slotEl)) return;
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
export function findSlotHost(slotEl) {
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
export function isInShadowRootEl(el) {
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
 * Apply a value at an element-position part (`<tag ${expr}>`). The
 * sole supported directive here is `ref(refOrCallback)` and
 * `createRef()`. Other values are ignored so a stray non-ref hole
 * doesn't crash. Tracks the prior target so a change from one ref to
 * another correctly unsets the old target before binding the new one.
 *
 * @param {Extract<BoundPart, {kind:'element'}>} part
 * @param {unknown} value
 */
export function applyElement(part, value) {
  const partAny = /** @type any */ (part);
  const nextTarget = isRef(value) ? /** @type any */ (value).target : undefined;
  const prevTarget = partAny.__refTarget;
  const refChanged = nextTarget !== prevTarget;

  if (refChanged && prevTarget) {
    if (typeof prevTarget === 'function') {
      try { prevTarget(undefined); } catch {}
    } else if (typeof prevTarget === 'object') {
      prevTarget.value = undefined;
    }
  }

  if (refChanged || partAny.__refElement !== part.el) {
    partAny.__refTarget = nextTarget;
    if (nextTarget) {
      if (typeof nextTarget === 'function') {
        if (!refChanged && partAny.__refElement !== undefined) {
          try { nextTarget(undefined); } catch {}
        }
        try { nextTarget(part.el); } catch {}
      } else if (typeof nextTarget === 'object') {
        nextTarget.value = part.el;
      }
    }
    partAny.__refElement = part.el;
    part.lastTarget = nextTarget;
  }
}

export function applyChild(part, value, reconcileFormActionsCb) {
  clearStaleDirectiveState(part, value);
  return applyChildInner(part, value, reconcileFormActionsCb);
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
export function applyChildInner(part, value, reconcileFormActionsCb) {
  return commitInto(part.marker && part.marker.parentNode, () =>
    applyChildInnerRaw(part, value, reconcileFormActionsCb),
  );
}

/**
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {unknown} value
 */
export function applyChildInnerRaw(part, value, reconcileFormActionsCb) {
  const marker = part.marker;

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

  if (isKeyed(value)) {
    const v = /** @type any */ (value);
    const prevKey = /** @type any */ (part).__keyedKey;
    if (prevKey !== undefined && !Object.is(prevKey, v.key)) {
      teardownChild(part);
    }
    /** @type any */ (part).__keyedKey = v.key;
    applyChildInner(part, v.value, reconcileFormActionsCb);
    return;
  }

  if (isGuard(value)) {
    const v = /** @type any */ (value);
    const prevDeps = /** @type any */ (part).__guardDeps;
    const nextDeps = v.deps;
    if (prevDeps !== undefined) {
      const equal = Array.isArray(prevDeps) && Array.isArray(nextDeps)
        ? shallowEqualArray(prevDeps, nextDeps)
        : Object.is(prevDeps, nextDeps);
      if (equal) return;
    }
    const depsSnapshot = Array.isArray(nextDeps) ? nextDeps.slice() : nextDeps;
    applyChildInner(part, v.fn(), reconcileFormActionsCb);
    /** @type any */ (part).__guardDeps = depsSnapshot;
    return;
  }

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

  if (isRef(value)) {
    return;
  }

  if (isCache(value)) {
    return applyCache(part, /** @type any */ (value).value, reconcileFormActionsCb);
  }

  if (isUntil(value)) {
    return applyUntil(part, /** @type any */ (value).args, reconcileFormActionsCb);
  }

  if (isWatch(value)) {
    return applyWatch(part, /** @type any */ (value).signal, reconcileFormActionsCb);
  }

  if (isAsyncAppend(value)) {
    return applyAsyncAppend(part, /** @type any */ (value), reconcileFormActionsCb);
  }
  if (isAsyncReplace(value)) {
    return applyAsyncReplace(part, /** @type any */ (value), reconcileFormActionsCb);
  }

  if (isRepeat(value)) {
    if (part.child && /** @type any */ (part.child).kind === 'repeat') {
      reconcileRepeat(part, value, reconcileFormActionsCb);
      return;
    }
    teardownChild(part);
    const state = { kind: 'repeat', map: new Map() };
    part.child = state;
    applyRepeatFresh(marker, state, value, reconcileFormActionsCb);
    return;
  }

  if (Array.isArray(value)) {
    if (part.child && /** @type any */ (part.child).kind === 'array') {
      reconcileArray(part, value, reconcileFormActionsCb);
      return;
    }
    teardownChild(part);
    const arrState = { kind: 'array', items: [] };
    part.child = arrState;
    applyArrayFresh(marker, /** @type any */ (arrState), value, reconcileFormActionsCb);
    return;
  }

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
      const inst = /** @type any */ (part.child);
      if (isTemplate(value) && inst.strings === /** @type any */ (value).strings) {
        updateInstance(inst, /** @type any */ (value).values, reconcileFormActionsCb);
        return;
      }
      removeBetween(inst.startNode, inst.endNode);
      part.child = undefined;
    } else {
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
      applyPart(bound[i], tr.values[i], undefined, tr.values, reconcileFormActionsCb);
      lastValues.push(tr.values[i]);
    }
    if (reconcileFormActionsCb) reconcileFormActionsCb(formActions, bound, tr.values);
    const nodes = [startNode, ...frag.childNodes, endNode];
    marker.parentNode?.insertBefore(nodesToFrag(nodes), marker);
    for (const p of bound) {
      if (p.kind === 'slot') applyPart(p, undefined, undefined, [], reconcileFormActionsCb);
    }
    part.child = { strings: tr.strings, bound, lastValues, startNode, endNode };
    return;
  }

  const node = document.createTextNode(String(value));
  marker.parentNode?.insertBefore(node, marker);
  part.child = [node];
}

function updateInstance(inst, values, reconcileFormActionsCb) {
  for (let i = 0; i < values.length; i++) {
    const next = values[i];
    if (Object.is(next, inst.lastValues[i])) continue;
    const bp = inst.bound[i];
    const anchor = /** @type any */ (bp).mixedAnchor;
    try {
      if (bp.kind === 'noop' && anchor != null) {
        applyPart(inst.bound[anchor], values[anchor], inst.lastValues[anchor], values, reconcileFormActionsCb);
      } else {
        applyPart(bp, next, inst.lastValues[i], values, reconcileFormActionsCb);
      }
    } catch (err) {
      inst.lastValues[i] = COMMIT_FAILED;
      if (bp.kind === 'noop' && anchor != null) inst.lastValues[anchor] = COMMIT_FAILED;
      throw err;
    }
    inst.lastValues[i] = next;
  }
  if (reconcileFormActionsCb) reconcileFormActionsCb(templateCache.get(inst.strings)?.formActions ?? null, inst.bound, values);
}

/**
 * Sentinel parked in `lastValues` for a hole whose commit threw, so the next
 * render cannot mistake the un-advanced entry for "already applied". Never
 * equal (by `Object.is`) to anything an author can pass through a template.
 */
const COMMIT_FAILED = Symbol('webjs.commitFailed');

/**
 * Remove a template instance's whole range, its bookend markers INCLUDED.
 *
 * Every caller discards the instance right after: the map entry or slot that
 * held it is dropped, and a replacement, where there is one, is built with
 * markers of its own. So this is a REMOVE, never lit's clear-and-reuse. A
 * caller that wants to keep the bookends and render into them again needs its
 * OWN function, because the two want opposite answers for the end marker.
 *
 * `parent` is read BEFORE the walk because the walk removes `start` on its
 * first iteration, which nulls `start.parentNode`. Reading it afterwards
 * compared the end marker's live parent against `null`, so the guard could
 * never fire and every teardown left one `wjm-e` comment in the document,
 * unbounded for the life of the region.
 *
 * The `end.parentNode === parent` comparison is a refusal, not a formality. A
 * marker moved under a different parent is not this region's to remove, and
 * `parent.removeChild(end)` on it throws NotFoundError from inside a teardown
 * that has to stay total.
 *
 * The walk assumes the range is INTACT: it steps `nextSibling` from `start`
 * and stops on `end`, so a range whose end no longer follows its start runs
 * off the child list and takes the part's own marker with it. That is not
 * something this function defends against, before or after the parent capture,
 * and the consequence is spelled out where it bites, on `reconcileRepeat`'s
 * catch below. The guard is the narrower promise: whatever the walk did, a
 * marker that is somewhere else is left alone.
 *
 * @param {Node} start @param {Node} end
 */
export function removeBetween(start, end) {
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

/** @param {ChildNode[]} nodes */
export function nodesToFrag(nodes) {
  const frag = document.createDocumentFragment();
  for (const n of nodes) frag.appendChild(n);
  return frag;
}

/**
 * Build a TemplateInstance whose nodes (including bookends) live in a
 * document fragment that the caller will insert wherever it wants.
 * @param {import('./html.js').TemplateResult} tr
 * @returns {{ inst: TemplateInstance, frag: DocumentFragment }}
 */
export function buildDetached(tr, reconcileFormActionsCb) {
  const { templateEl, parts, formActions } = compile(tr);
  const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));
  const startNode = document.createComment(`${MARKER}s`);
  const endNode = document.createComment(`${MARKER}e`);
  const bound = parts.map((p) => bindPart(p, frag));
  const lastValues = [];
  for (let i = 0; i < tr.values.length; i++) {
    applyPart(bound[i], tr.values[i], undefined, tr.values, reconcileFormActionsCb);
    lastValues.push(tr.values[i]);
  }
  if (reconcileFormActionsCb) reconcileFormActionsCb(formActions, bound, tr.values);
  for (const p of bound) {
    if (p.kind === 'slot') applyPart(p, undefined, undefined, [], reconcileFormActionsCb);
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

export function disposeInstance(inst) {
  for (const p of inst.bound) {
    if (p.kind === 'event') p.el.removeEventListener(p.name, p.dispatcher);
    if (p.kind === 'element') {
      const prev = /** @type any */ (p).lastTarget;
      if (prev) {
        if (typeof prev === 'function') {
          try { prev(undefined); } catch {}
        } else if (typeof prev === 'object') {
          try { prev.value = undefined; } catch {}
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
function applyRepeatFresh(marker, state, value, reconcileFormActionsCb) {
  const { items, keyFn, templateFn } = value;
  const parent = marker.parentNode;
  if (!parent) return;
  const bulk = document.createDocumentFragment();
  for (let i = 0; i < items.length; i++) {
    const key = keyFn(items[i], i);
    const tr = templateFn(items[i], i);
    if (!isTemplate(tr)) continue;
    const { inst, frag } = buildDetached(/** @type any */ (tr), reconcileFormActionsCb);
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
function reconcileRepeat(part, value, reconcileFormActionsCb) {
  const marker = part.marker;
  const parent = marker.parentNode;
  if (!parent) return;
  const state = /** @type {{ kind: 'repeat', map: Map<any, any> }} */ (part.child);
  const { items, keyFn, templateFn } = value;
  const newMap = new Map();

  try {
    for (let i = 0; i < items.length; i++) {
      const key = keyFn(items[i], i);
      const tr = templateFn(items[i], i);
      if (!isTemplate(tr)) continue;
      const existing = state.map.get(key);
      if (existing && existing.strings === /** @type any */ (tr).strings) {
        updateInstance(existing, /** @type any */ (tr).values, reconcileFormActionsCb);
        moveRange(existing.startNode, existing.endNode, parent, marker);
        newMap.set(key, existing);
        state.map.delete(key);
      } else {
        if (existing) {
          state.map.delete(key);
          disposeInstance(existing);
          removeBetween(existing.startNode, existing.endNode);
        }
        const { inst, frag } = buildDetached(/** @type any */ (tr), reconcileFormActionsCb);
        parent.insertBefore(frag, marker);
        newMap.set(key, inst);
      }
    }

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
function buildArrayItem(v, reconcileFormActionsCb) {
  if (isTemplate(v)) {
    const { inst, frag } = buildDetached(/** @type any */ (v), reconcileFormActionsCb);
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
function applyArrayFresh(marker, state, value, reconcileFormActionsCb) {
  const parent = marker.parentNode;
  if (!parent) return;
  const bulk = document.createDocumentFragment();
  const items = [];
  for (const v of value) {
    const { item, frag } = buildArrayItem(v, reconcileFormActionsCb);
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
function reconcileArray(part, value, reconcileFormActionsCb) {
  const marker = part.marker;
  const parent = marker.parentNode;
  if (!parent) return;
  const state = /** @type {{ kind: 'array', items: any[] }} */ (part.child);
  const old = state.items;
  const next = [];
  let consumed = 0;

  try {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const o = old[i];
      if (isTemplate(v)) {
        const tr = /** @type any */ (v);
        if (o && o.type === 'tpl' && o.inst.strings === tr.strings) {
          updateInstance(o.inst, tr.values, reconcileFormActionsCb);
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
        if (o) removeArrayItem(o);
        next.push({ type: 'empty' });
        consumed = i + 1;
        continue;
      }
      const { item, frag } = buildArrayItem(v, reconcileFormActionsCb);
      if (frag) parent.insertBefore(frag, nextArrayAnchor(old, i, marker));
      next.push(item);
      if (o) removeArrayItem(o);
      consumed = i + 1;
    }

    for (let i = value.length; i < old.length; i++) {
      removeArrayItem(old[i]);
      consumed = i + 1;
    }
    state.items = next;
  } catch (err) {
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
export function moveRange(start, end, parent, anchor) {
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

export function teardownChild(part) {
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
    const inst = /** @type any */ (part.child);
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
export function clearStaleDirectiveState(part, value) {
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
function applyCache(part, inner, reconcileFormActionsCb) {
  const marker = part.marker;
  const partAny = /** @type any */ (part);
  let cacheMap = partAny.__cacheMap;
  if (!cacheMap) {
    cacheMap = new Map();
    partAny.__cacheMap = cacheMap;
  }

  const currentChild = /** @type any */ (part.child);
  const currentIsInstance = currentChild && 'strings' in currentChild;

  if (currentIsInstance) {
    const currentInst = /** @type any */ (currentChild);
    if (isTemplate(inner) && currentInst.strings === /** @type any */ (inner).strings) {
      updateInstance(currentInst, /** @type any */ (inner).values, reconcileFormActionsCb);
      return;
    }
    const holder = document.createDocumentFragment();
    moveRange(currentInst.startNode, currentInst.endNode, holder, null);
    cacheMap.set(currentInst.strings, { inst: currentInst, holder });
    part.child = undefined;
  }

  if (isTemplate(inner)) {
    const tr = /** @type any */ (inner);
    const cached = cacheMap.get(tr.strings);
    if (cached) {
      cacheMap.delete(tr.strings);
      if (part.child) {
        teardownChild(part);
      }
      moveRange(cached.inst.startNode, cached.inst.endNode, /** @type Node */ (marker.parentNode), marker);
      updateInstance(cached.inst, tr.values, reconcileFormActionsCb);
      part.child = cached.inst;
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

  applyChildInner(part, inner, reconcileFormActionsCb);
}

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
function applyUntil(part, args, reconcileFormActionsCb) {
  const partAny = /** @type any */ (part);
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

  const state = { aborted: false, highestResolved: carriedHighest };
  partAny.__untilState = state;

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
    applyChildInner(part, firstSyncVal, reconcileFormActionsCb);
    state.highestResolved = firstSyncIdx;
  } else if (firstSyncIdx === -1 && !partAny.__untilEverRendered) {
    applyChildInner(part, '', reconcileFormActionsCb);
  }
  partAny.__untilEverRendered = true;

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
        try {
          commitOutOfBand(part, () => applyChildInner(part, resolved, reconcileFormActionsCb));
        } catch (err) {
          reportOutOfBandCommitError(part, err);
          return;
        }
        state.highestResolved = i;
      },
      () => {},
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
export function reportOutOfBandCommitError(part, error) {
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
function applyWatch(part, sig, reconcileFormActionsCb) {
  const partAny = /** @type any */ (part);
  if (currentRenderRoot) partAny.__commitOwner = boundaryOwnerOf(currentRenderRoot);
  if (partAny.__watchSig === sig && partAny.__watchSub) {
    let value;
    partAny.__watchSub.observe(() => { value = sig.get(); });
    applyChildInner(part, value, reconcileFormActionsCb);
    return;
  }
  if (partAny.__watchSub) {
    partAny.__watchSub.dispose();
    partAny.__watchSub = undefined;
  }
  partAny.__watchSig = sig;
  const watcher = new Signal.subtle.Watcher(() => {
    queueMicrotask(() => {
      if (partAny.__watchSub !== watcher) return;
      let v;
      try {
        watcher.observe(() => { v = sig.get(); });
        commitOutOfBand(part, () => applyChildInner(part, v, reconcileFormActionsCb));
      } catch (err) {
        reportOutOfBandCommitError(part, err);
      }
    });
  });
  partAny.__watchSub = watcher;
  let initial;
  watcher.observe(() => { initial = sig.get(); });
  applyChildInner(part, initial, reconcileFormActionsCb);
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
function applyAsyncAppend(part, dir, reconcileFormActionsCb) {
  const partAny = /** @type any */ (part);
  if (currentRenderRoot) partAny.__commitOwner = boundaryOwnerOf(currentRenderRoot);
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
  const state = {
    kind: 'async-stream',
    mode: 'append',
    aborted: false,
    iterable: dir.iterable,
    iterator,
    nodes: [],
  };
  part.child = state;

  consumeAsyncStream(state, part, dir, reconcileFormActionsCb);
}

/**
 * Apply `asyncReplace(iterable, mapper?)` at a child position. Same as
 * `applyAsyncAppend` but each new value replaces the previous content.
 *
 * @param {Extract<BoundPart, {kind:'child'}>} part
 * @param {{ iterable: AsyncIterable<unknown>, mapper?: (v: unknown, i: number) => unknown }} dir
 */
function applyAsyncReplace(part, dir, reconcileFormActionsCb) {
  const partAny = /** @type any */ (part);
  if (currentRenderRoot) partAny.__commitOwner = boundaryOwnerOf(currentRenderRoot);
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
  const state = {
    kind: 'async-stream',
    mode: 'replace',
    aborted: false,
    iterable: dir.iterable,
    iterator,
    nodes: [],
  };
  part.child = state;

  consumeAsyncStream(state, part, dir, reconcileFormActionsCb);
}

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
async function consumeAsyncStream(state, part, dir, reconcileFormActionsCb) {
  const marker = part.marker;
  let i = 0;
  while (!state.aborted) {
    let result;
    let mapped;
    try {
      result = await state.iterator.next();
      if (state.aborted) break;
      if (result.done) break;
      mapped = dir.mapper ? dir.mapper(result.value, i) : result.value;
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[webjs] asyncStream error:', err);
      return;
    }

    try {
      commitOutOfBand(part, () => {
        const newNodes = renderToNodes(mapped, reconcileFormActionsCb);

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
      state.aborted = true;
      try { state.iterator.return?.()?.catch?.(() => {}); } catch {}
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
function renderToNodes(value, reconcileFormActionsCb) {
  if (value == null || value === false || value === true) return [];
  if (isTemplate(value)) {
    const tr = /** @type any */ (value);
    const { templateEl, parts, formActions } = compile(tr);
    const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));
    const bound = parts.map((p) => bindPart(p, frag));
    for (let i = 0; i < tr.values.length; i++) {
      applyPart(bound[i], tr.values[i], undefined, tr.values, reconcileFormActionsCb);
    }
    if (reconcileFormActionsCb) reconcileFormActionsCb(formActions, bound, tr.values);
    for (const p of bound) {
      if (p.kind === 'slot') applyPart(p, undefined, undefined, [], reconcileFormActionsCb);
    }
    return [...frag.childNodes];
  }
  if (Array.isArray(value)) {
    const nodes = [];
    for (const v of value) nodes.push(...renderToNodes(v, reconcileFormActionsCb));
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
  try {
    state.iterator.return?.()?.catch?.(() => {});
  } catch {}
}
