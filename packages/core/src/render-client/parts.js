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

export let currentRenderRoot = null;

export function setCurrentRenderRoot(root) {
  currentRenderRoot = root;
}

export function commitInto(node, fn) {
  const host = node && /** @type {any} */ (node)[SLOT_STATE] ? node : null;
  if (!host) return fn();
  return withRendererWrites(host, fn);
}

export function boundaryOwnerOf(root) {
  if (!root) return null;
  if (root.nodeType === 11 && root.host) return root.host;
  return root;
}

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

export function bindPart(p, root) {
  if (p.kind === 'noop') return /** @type any */ ({ kind: 'noop', mixedAnchor: /** @type any */ (p).mixedAnchor });
  let node = /** @type Node */ (root);
  for (const i of p.path) node = node.childNodes[i];
  if (p.kind === 'child') {
    return { kind: 'child', marker: /** @type Comment */ (node) };
  }
  const el = /** @type Element */ (node);
  if (p.kind === 'event') {
    /** @type {any} */
    const part = {
      kind: 'event',
      el,
      name: p.name || '',
      handler: null,
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
    return { kind: 'slot', slotEl, applied: false };
  }
  throw new Error(`unknown part kind ${/** @type any */(p).kind}`);
}

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

export function findSlotHost(slotEl) {
  const owner = /** @type any */ (slotEl)[SLOT_OWNER];
  if (owner && owner.isConnected) return owner;
  let p = slotEl.parentElement;
  while (p) {
    if (/** @type any */ (p)[SLOT_STATE]) return p;
    p = p.parentElement;
  }
  return null;
}

export function isInShadowRootEl(el) {
  let n = /** @type {Node} */ (el);
  for (let depth = 0; depth < 128; depth++) {
    const parent = n.parentNode;
    if (!parent) return false;
    if (parent === n) return false;
    if (parent.nodeType === 11 && /** @type any */ (parent).host) return true;
    n = parent;
  }
  return false;
}

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

export function applyChildInner(part, value, reconcileFormActionsCb) {
  return commitInto(part.marker && part.marker.parentNode, () =>
    applyChildInnerRaw(part, value, reconcileFormActionsCb),
  );
}

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

const COMMIT_FAILED = Symbol('webjs.commitFailed');

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

export function nodesToFrag(nodes) {
  const frag = document.createDocumentFragment();
  for (const n of nodes) frag.appendChild(n);
  return frag;
}

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

function teardownRepeat(state) {
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

function arrayItemFirstNode(item) {
  if (item.type === 'tpl') return item.inst.startNode;
  if (item.type === 'text') return item.node;
  return null;
}

function removeArrayItem(item) {
  if (item.type === 'tpl') {
    disposeInstance(item.inst);
    removeBetween(item.inst.startNode, item.inst.endNode);
  } else if (item.type === 'text') {
    item.node.parentNode?.removeChild(item.node);
  }
}

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

function nextArrayAnchor(old, i, marker) {
  for (let j = i; j < old.length; j++) {
    const f = arrayItemFirstNode(old[j]);
    if (f && f.parentNode) return f;
  }
  return marker;
}

function teardownArray(state) {
  for (const it of state.items) removeArrayItem(it);
  state.items = [];
}

export function moveRange(start, end, parent, anchor) {
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

export function reportOutOfBandCommitError(part, error) {
  let err;
  try {
    err = error instanceof Error ? error : new Error(String(error));
  } catch {
    err = new Error('render error (unstringifiable thrown value)');
  }
  const owner = /** @type any */ (part).__commitOwner;
  if (owner && typeof owner._handleRenderError === 'function') {
    owner._handleRenderError(err);
    return;
  }
  throw err;
}

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

function teardownWatch(partAny) {
  if (partAny.__watchSub) {
    partAny.__watchSub.dispose();
    partAny.__watchSub = undefined;
    partAny.__watchSig = undefined;
  }
}

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
