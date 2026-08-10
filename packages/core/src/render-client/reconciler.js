import { isTemplate } from '../html.js';
import {
  reconcileFormAction, isBoundFormAction, ABSENT, assertSubmitterHasNoName,
  assertSubmitterType, assertSubmitterHasNoValue, assertSubmitterHasNoStaticFormAction,
  assertSubmitterHasNoFormAttribute, assertSingleSubmitterAction,
  resolveBoundSubmitterAttrs, applyResolvedAttr, releaseSubmitterAttrs,
  assertConvergentSubmitter, isSubmitterReflectedProp,
  formActionId, assertIdentifiableAction, FORM_ACTION_FIELD,
} from '../form-action.js';
import { isLive } from '../directives.js';
import { RENDERING, SLOT_OWNER, SLOT_STATE, drainRendererBackstop } from '../slot.js';
import { compile, templateCache, submitterActionBindings, INSTANCE } from './template-compiler.js';
import {
  applyPart, bindPart, currentRenderRoot, setCurrentRenderRoot,
} from './parts.js';

export function render(value, container) {
  const host = /** @type any */ (container);
  const prevRendering = host[RENDERING];
  host[RENDERING] = true;
  const prevRenderRoot = currentRenderRoot;
  setCurrentRenderRoot(container);
  try {
    const prev = host[INSTANCE];

    if (isTemplate(value)) {
      const tr = /** @type {import('../html.js').TemplateResult} */ (value);
      if (prev && prev.strings === tr.strings) {
        updateInstance(prev, tr.values);
        return;
      }
      if (prev) clearInstance(prev, container);

      const firstChild = container.firstChild;
      if (firstChild && firstChild.nodeType === 8 && /** @type {Comment} */ (firstChild).data === 'webjs-hydrate') {
        firstChild.remove();
      }

      host[INSTANCE] = null;
      const inst = createInstance(tr, container);
      host[INSTANCE] = inst;
      return;
    }

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
    setCurrentRenderRoot(prevRenderRoot);
    host[RENDERING] = prevRendering;
    if (!prevRendering) drainRendererBackstop(host);
  }
}

function reconcileFormActions(formActions, bound, values) {
  if (!formActions) return;
  for (const pass of [true, false]) {
    for (const rec of formActions) {
      if (rec.isForm !== pass) continue;
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
      } else {
        const emits = (parts) => parts.some((np) => (np.kind === 'bool'
          ? !!resolveHoleValue(values[np.i])
          : true));
        reconcileSubmitterAction(
          /** @type any */ (part.el), val, rec,
          emits(rec.nameParts), emits(rec.valueParts),
          effectiveFormAttr(rec.methodParts, rec.staticMethod, values),
          effectiveFormAttr(rec.enctypeParts, rec.staticEnctype, values),
        );
      }
    }
  }
}

function releaseSubmitterAction(el) {
  const injected = submitterActionBindings.has(el) || el.getAttribute('name') === FORM_ACTION_FIELD;
  if (!injected) return;
  if (el.getAttribute('name') === FORM_ACTION_FIELD) el.removeAttribute('name');
  el.removeAttribute('value');
  submitterActionBindings.delete(el);
}

function reconcileSubmitterAction(
  el, value, rec, emitsName, emitsValue, authoredFormMethod, authoredFormEnctype,
) {
  const id = typeof value === 'function' ? formActionId(value) : null;
  if (!id) {
    if (typeof value === 'function') assertIdentifiableAction(null, el.localName);
    releaseSubmitterAction(el);
    releaseSubmitterAttrs(el, authoredFormMethod, authoredFormEnctype, rec.propAttrs);
    return;
  }
  assertSingleSubmitterAction(rec.duplicateAction, el.localName);
  assertConvergentSubmitter(rec.propAttrs, el.localName);
  if (rec.staticAction) assertSubmitterHasNoStaticFormAction(el.localName);
  if (rec.authoredValue || emitsValue) assertSubmitterHasNoValue(el.localName);
  if (rec.authoredName || emitsName) {
    assertSubmitterHasNoName(el.getAttribute('name') || FORM_ACTION_FIELD, el.localName, false);
  }
  if (rec.authoredForm || el.hasAttribute('form')) assertSubmitterHasNoFormAttribute(el.localName);
  assertSubmitterType(el.localName, el.getAttribute('type'));

  const resolved = resolveBoundSubmitterAttrs(
    el.localName, authoredFormMethod, authoredFormEnctype,
  );
  el.removeAttribute('formaction');
  el.setAttribute('name', FORM_ACTION_FIELD);
  el.setAttribute('value', id);
  applyResolvedAttr(el, 'formmethod', authoredFormMethod, resolved.formMethod);
  applyResolvedAttr(el, 'formenctype', authoredFormEnctype, resolved.formEnctype);
  submitterActionBindings.set(el, id);
}



function effectiveFormAttr(attrParts, staticValue, values) {
  for (const p of attrParts) {
    if (p.kind === 'bool') return resolveHoleValue(values[p.i]) ? '' : ABSENT;
    if (p.kind === 'attr') {
      const v = resolveHoleValue(values[p.i]);
      return v == null ? '' : String(v);
    }
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

function resolveHoleValue(v) {
  return isLive(v) ? /** @type any */ (v).value : v;
}

function createInstance(tr, container) {
  const { templateEl, parts, formActions } = compile(tr);
  const frag = /** @type DocumentFragment */ (templateEl.content.cloneNode(true));
  const startNode = document.createComment(`${MARKER}s`);
  const endNode = document.createComment(`${MARKER}e`);

  const bound = parts.map((p) => bindPart(p, frag));
  const lastValues = [];
  for (let i = 0; i < tr.values.length; i++) {
    applyPart(bound[i], tr.values[i], undefined, tr.values, reconcileFormActions);
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
  //
  // These MUST be the symbols slot.js created. They are `Symbol(...)`, which
  // is unique per call, not `Symbol.for(...)`, which looks one up in the
  // global registry by string. Reaching for the registry produces a different
  // symbol that no host carries, so `ownerHost` is always null, the stamp
  // never lands, and a forwarded slot silently routes to the wrong host.
  const ownerHost =
    /** @type {any} */ (container).nodeType === 1 && /** @type {any} */ (container)[SLOT_STATE]
      ? container
      : null;
  for (const part of bound) {
    if (part.kind === 'slot') {
      if (ownerHost && part.slotEl) /** @type {any} */ (part.slotEl)[SLOT_OWNER] = ownerHost;
      applyPart(part, undefined, undefined, [], reconcileFormActions);
    }
  }

  return { strings: tr.strings, bound, lastValues, startNode, endNode };
}

const MARKER = 'wjm-';

function updateInstance(inst, values) {
  for (let i = 0; i < values.length; i++) {
    const next = values[i];
    if (Object.is(next, inst.lastValues[i])) continue;
    const bp = inst.bound[i];
    const anchor = /** @type any */ (bp).mixedAnchor;
    try {
      if (bp.kind === 'noop' && anchor != null) {
        applyPart(inst.bound[anchor], values[anchor], inst.lastValues[anchor], values, reconcileFormActions);
      } else {
        applyPart(bp, next, inst.lastValues[i], values, reconcileFormActions);
      }
    } catch (err) {
      inst.lastValues[i] = Symbol('webjs.commitFailed');
      if (bp.kind === 'noop' && anchor != null) inst.lastValues[anchor] = Symbol('webjs.commitFailed');
      throw err;
    }
    inst.lastValues[i] = next;
  }
  reconcileFormActions(templateCache.get(inst.strings)?.formActions ?? null, inst.bound, values);
}

function clearInstance(inst, container) {
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
    if (p.kind === 'slot') {
    }
  }
  /** @type any */ (container).replaceChildren();
}
