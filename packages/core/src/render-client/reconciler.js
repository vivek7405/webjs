import { isTemplate, MARKER } from '../html.js';
import {
  reconcileFormAction, isBoundFormAction, ABSENT, assertSubmitterHasNoName, assertSubmitterType,
  assertSubmitterHasNoValue, assertSubmitterHasNoStaticFormAction,
  assertSubmitterHasNoFormAttribute, assertSingleSubmitterAction, resolveBoundSubmitterAttrs,
  applyResolvedAttr, releaseSubmitterAttrs, assertConvergentSubmitter, formActionId,
  assertIdentifiableAction, FORM_ACTION_FIELD,
} from '../form-action.js';
import { isLive } from '../directives.js';
import { RENDERING, SLOT_OWNER, SLOT_STATE, drainRendererBackstop, rescueAssignedNodes } from '../slot.js';
import { compile, submitterActionBindings, INSTANCE } from './template-compiler.js';
import {
  applyPart, bindPart, currentRenderRoot, findSlotHost, setCurrentRenderRoot, updateInstance,
} from './parts.js';

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
  setCurrentRenderRoot(container);
  try {
    const prev = host[INSTANCE];

    if (isTemplate(value)) {
      const tr = /** @type {import('../html.js').TemplateResult} */ (value);
      if (prev && prev.strings === tr.strings) {
        updateInstance(prev, tr.values, reconcileFormActions);
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
    setCurrentRenderRoot(prevRenderRoot);
    host[RENDERING] = prevRendering;
    // Outermost window closing: drain this commit's childList records off the
    // slot backstop (drainRendererBackstop processes them with a renderer-output
    // skip when an instance exists, else discards), so the backstop never folds
    // renderer output. Mirrors withRendererWrites, used by the async paths.
    if (!prevRendering) drainRendererBackstop(host);
  }
}

/**
 * Converge every candidate bound form and submitter in this template, after all
 * of its parts have committed. A no-op for the overwhelming majority of
 * templates, which carry no `<form action=${...}>` at all and therefore no
 * record.
 *
 * FORMS FIRST, submitters second, regardless of the order the records were
 * collected in. Nothing reads an enclosing form's boundness any more (#1307
 * made a bound submitter self-sufficient), but the ordering still makes a
 * form's RELEASE run before its submitters reconcile, so it is kept rather
 * than churned. See the note in the body.
 *
 * @param {FormActionRecord[] | null} formActions
 * @param {BoundPart[]} bound
 * @param {unknown[]} values
 */
function reconcileFormActions(formActions, bound, values) {
  if (!formActions) return;
  // Forms first, then submitters. The original motivation was a boundness read
  // that is gone with #1307, but the ordering still makes a form's RELEASE run
  // before its submitters reconcile, so it is kept rather than churned.
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
      } else {
        // What SSR would have emitted for this pass. An attribute hole always
        // emits (even `name=${null}`, as `name=""`); a boolean hole emits only
        // when truthy. Both identity channels ask the same question, through
        // one predicate, so they cannot drift apart again.
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
 * Converge a live submitter on what SSR emitted for `<button formaction=${fn}>`
 * (#1207, #1307): the `formaction` attribute gone, the identity in the button's
 * own `name` / `value` pair, and the submission the framework supplies in its
 * own `formmethod` / `formenctype`.
 *
 * There is no enclosing-form question here any more. It used to be the hard
 * part of this function, asked once per element and BEST EFFORT because a
 * fragment reconciling detached (a submitter inside a `repeat()` or an array
 * item, whose form lives in the parent template) has no answer to give. With
 * the submission attributes now on the button itself (#1307) the button needs
 * nothing from the form, so the question stopped mattering and the whole
 * asymmetry with SSR went with it.
 *
 * @param {Element} el
 * @param {unknown} value
 * @param {FormActionRecord} rec
 * @param {boolean} emitsName whether SSR would emit a `name` attribute this pass
 * @param {boolean} emitsValue whether SSR would emit a `value` attribute this pass
 * @param {string | typeof ABSENT} authoredFormMethod what the template supplies for `formmethod`
 * @param {string | typeof ABSENT} authoredFormEnctype what the template supplies for `formenctype`
 */
function reconcileSubmitterAction(
  el, value, rec, emitsName, emitsValue, authoredFormMethod, authoredFormEnctype,
) {
  const id = typeof value === 'function' ? formActionId(value) : null;
  if (!id) {
    // A function that was MEANT as an action still refuses, so a button never
    // silently submits the form's action instead of its own.
    if (typeof value === 'function') assertIdentifiableAction(null, el.localName);
    releaseSubmitterAction(el);
    // The submission attributes the framework supplied go with the identity, or
    // a released button keeps a `formmethod` / `formenctype` SSR does not emit
    // for the same template (#1307).
    releaseSubmitterAttrs(el, authoredFormMethod, authoredFormEnctype, rec.propAttrs);
    return;
  }
  // Template-shaped refusals first, from the compiled record, because the live
  // element may already carry this renderer's own `name` / `value`.
  assertSingleSubmitterAction(rec.duplicateAction, el.localName);
  assertConvergentSubmitter(rec.propAttrs, el.localName);
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

  // The submission decision, made from the TEMPLATE rather than by reading the
  // DOM back, exactly as `reconcileFormAction` makes it for a bound form. The
  // distinction the DOM cannot preserve is the same one: `?formmethod=${false}`
  // and `formmethod=${null}` both leave no attribute, and SSR resolves them to
  // opposite answers.
  const resolved = resolveBoundSubmitterAttrs(
    el.localName, authoredFormMethod, authoredFormEnctype,
  );
  el.removeAttribute('formaction');
  el.setAttribute('name', FORM_ACTION_FIELD);
  el.setAttribute('value', id);
  // AFTER the identity, matching SSR's byte order: the identity replaces the
  // `formaction=` hole in place and the submission pair is appended at the `>`.
  // The differential parity suite compares these two renderers byte for byte,
  // so the order is part of the contract, not a detail.
  applyResolvedAttr(el, 'formmethod', authoredFormMethod, resolved.formMethod);
  applyResolvedAttr(el, 'formenctype', authoredFormEnctype, resolved.formEnctype);
  submitterActionBindings.set(el, id);
}

/* ================================================================
 * Instance lifecycle
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
 * @param {import('../html.js').TemplateResult} tr
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
          try { prev(undefined); } catch {}
        } else if (typeof prev === 'object') {
          try { prev.value = undefined; } catch {}
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
