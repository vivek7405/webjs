/**
 * Assignment commit: placing assigned nodes, restoring fallback content
 * and firing slotchange.
 *
 * Moved verbatim out of the pre-split `slot.js`; see that barrel for the
 * runtime's full contract.
 *
 * @module
 */
import { inBrowser } from './polyfills.js';
import { ensureSlotState, hasSlotState, keyOfName } from './state.js';
import { FRAMEWORK_DETACHED, LIGHT_SLOT_ATTR, PROJECTION_ACTUAL, PROJECTION_ATTR, PROJECTION_FALLBACK, SLOT_FALLBACK_FRAG, SLOT_OWNER, SLOT_OWNER_ATTR } from './symbols.js';

/**
 * True when this host's current markup is FRAMEWORK-RENDERED output rather
 * than author-written children: a rendered light template carries the
 * framework's own `slot[data-webjs-light]` elements, an attribute only the
 * renderer / SSR ever stamps (own-slot filtered so a nested serialized
 * component inside genuinely-authored children does not misfire; and
 * `data-wj-host` is NOT usable here, since connectedCallback stamps it on
 * every light host before this check runs). The connectedCallback branch
 * chooser uses this STRUCTURAL signal to pick adopt-not-capture for a
 * framework-rendered subtree, so a back/forward snapshot restore
 * (post-hydration HTML, no `webjs-hydrate` marker) adopts the projected
 * children instead of hoovering the rendered tree into `authored` (the #1006
 * duplication shape on the restore path).
 *
 * @param {Element} host
 * @returns {boolean}
 */
export function hasFrameworkRenderedSubtree(host) {
  if (!inBrowser) return false;
  // BOTH attributes are required. data-webjs-light alone is stamped at
  // TEMPLATE COMPILE time on every <slot> in every html template, including a
  // slot FORWARDED as an authored child of a nested component tag
  // (html`<inner-shell><slot>fallback</slot></inner-shell>`), so matching it
  // alone would misfire on the forwarding shape at a client-side first mount
  // and adopt (discard) the forwarded slot. data-projection is stamped only
  // when the framework has PLACED the slot (SSR substitution or the apply
  // step), so light + projection together mean genuinely rendered output.
  for (const el of host.querySelectorAll(`slot[${LIGHT_SLOT_ATTR}][${PROJECTION_ATTR}]`)) {
    if (isOwnSlot(host, el)) return true;
  }
  return false;
}

/**
 * True when `slot` belongs to `host` directly: no OTHER custom element
 * sits between them. A slot nested inside a child custom element belongs
 * to THAT component and is applied from its own record.
 *
 * SUBTLETY: for a slot in a fully DETACHED chain the walk ends at null
 * without reaching `host` and returns vacuously true. Callers that must not
 * treat a FOREIGN detached slot as owned (the prune rule, isVirtualChild)
 * pair this with a `host.contains(p)` gate; adopted-SSR children in the
 * detached old chain survive pruning via their FRAMEWORK_DETACHED mark, not
 * via this walk.
 *
 * @param {Element} host
 * @param {Element} slot
 * @returns {boolean}
 */
export function isOwnSlot(host, slot) {
  // Template-ownership is authoritative when known: a forwarded slot sits
  // physically inside a child component but belongs to the host whose
  // template rendered it. Two carriers of the SAME fact, consulted in order:
  //   1. the SLOT_OWNER symbol, stamped by the client renderer at render
  //      time (createInstance) and thus present once this host has rendered;
  //   2. the data-wj-slot-owner attribute, the SSR carrier, which is the
  //      ACTIVE resolver on the adopt/hydration path (adoptSSRAssignments
  //      runs in connectedCallback, before the deferred first render stamps
  //      the symbol), resolved by nearest-matching-tag ancestor.
  const owner = /** @type {any} */ (slot)[SLOT_OWNER];
  if (owner) return owner === host;
  const ownerTag =
    typeof slot.getAttribute === 'function' ? slot.getAttribute(SLOT_OWNER_ATTR) : null;
  if (ownerTag) {
    const resolved = ownerHostFor(slot, ownerTag);
    if (resolved) return resolved === host;
    // Unresolvable (a detached chain the owner is no longer an ancestor of):
    // fall through to the structural walk rather than falsely denying.
  }
  // Structural fallback: no OTHER custom element sits between slot and host.
  for (let p = slot.parentElement; p && p !== host; p = p.parentElement) {
    if (p.tagName.includes('-')) return false;
  }
  return true;
}

/**
 * The host a `data-wj-slot-owner="<tag>"` attribute resolves to: the nearest
 * ANCESTOR whose tag matches, by tag alone (NOT gated on SLOT_STATE). The
 * gate would be wrong during the connect-time chooser, where an inner host
 * has not upgraded yet, so a forwarded slot would fail to resolve to its
 * outer owner and the outer would wrongly capture-hoover the SSR subtree.
 * One-level forwarding resolves cleanly; same-tag-nested forwarding picks
 * the nearest (the accepted edge, no worse than the structural walk it
 * replaces).
 *
 * @param {Element} slot
 * @param {string} ownerTag
 * @returns {Element | null}
 */
function ownerHostFor(slot, ownerTag) {
  const want = ownerTag.toLowerCase();
  for (let p = slot.parentElement; p; p = p.parentElement) {
    if (p.tagName.toLowerCase() === want) return p;
  }
  return null;
}

/**
 * Set a slot to actual-assignment mode and move the given nodes into it.
 * Preserves DOM identity by re-using the same Node references when they
 * are already inside the slot in the same order.
 *
 * @param {SlotState} state
 * @param {HTMLSlotElement} slot
 * @param {Node[]} assigned
 * @returns {boolean} True if the slot's assignment changed compared to
 *   its last snapshot (so slotchange should fire).
 */
export function applyActualAssignment(state, slot, assigned) {
  // These nodes are being placed into an own actual slot, so they are
  // author-live now: clear the prune exemption on EVERY path (including the
  // unchanged and in-place fast paths below, which the router's morph hits).
  // Missing this leaves a reprojected node permanently exempt, so a later
  // el.remove() / cross-host move on it would not be pruned (zombie / theft).
  for (const n of assigned) FRAMEWORK_DETACHED.delete(n);
  const wasFallback = slot.getAttribute(PROJECTION_ATTR) !== PROJECTION_ACTUAL;
  const prev = state.lastSnapshot.get(slot) || [];
  const setChanged = wasFallback || !arraysEqual(prev, assigned);

  // Physical fast path: the assigned nodes are ALREADY the slot's children in
  // the same order (the idempotent no-change pass, and the router's morph
  // which reconciles in place then syncs the record). Settle the snapshot;
  // slotchange reflects the SET change vs the previous snapshot. Verifying
  // physically (never trusting the snapshot alone) also makes the apply
  // self-repairing after a bypass move pulled a node out of the slot.
  if (!wasFallback && arraysEqual(Array.from(slot.childNodes), assigned)) {
    state.lastSnapshot.set(slot, assigned.slice());
    return setChanged;
  }

  // Preserve fallback content. If the slot currently holds fallback nodes
  // (either because we just hydrated from SSR's data-projection="fallback"
  // or because the slot-part placed them there at bind time), move them
  // back into the part-owned holding fragment so they survive for a later
  // transition. Identified via the SLOT_FALLBACK_FRAG symbol that the
  // slot-part wrote to the element.
  const fallbackFrag = /** @type {DocumentFragment | undefined} */ (
    /** @type {any} */ (slot)[SLOT_FALLBACK_FRAG]
  );
  if (wasFallback && fallbackFrag) {
    while (slot.firstChild) fallbackFrag.appendChild(slot.firstChild);
  }

  // Incremental reconcile, native parity: an assignment change must never
  // reparent a SURVIVING assigned node (native shadow assignment does not
  // move host children), or appending one sibling would bounce every nested
  // custom element through disconnect/connect, drop focus, and reload an
  // <iframe>/<video> in the projected content. Remove departures, then
  // position each assigned node touching ONLY the new, departing, or
  // out-of-order ones.
  const want = new Set(assigned);
  for (const c of Array.from(slot.childNodes)) {
    if (!want.has(c)) slot.removeChild(c);
  }
  let cursor = slot.firstChild;
  for (const node of assigned) {
    if (node === cursor) {
      cursor = cursor.nextSibling;
      continue;
    }
    slot.insertBefore(node, cursor);
  }
  slot.setAttribute(PROJECTION_ATTR, PROJECTION_ACTUAL);
  state.lastSnapshot.set(slot, assigned.slice());
  return setChanged;
}

/**
 * Set a slot to fallback mode: clear any actual-assignment children and
 * restore the part-owned fallback fragment. The record keeps the nodes
 * (they are values now), so a later authored write or slot re-creation
 * re-places them.
 *
 * @param {SlotState} state
 * @param {HTMLSlotElement} slot
 * @returns {boolean} True if the slot transitioned from actual to
 *   fallback this pass.
 */
export function applyFallback(state, slot) {
  const wasActual = slot.getAttribute(PROJECTION_ATTR) === PROJECTION_ACTUAL;
  slot.setAttribute(PROJECTION_ATTR, PROJECTION_FALLBACK);
  if (!wasActual) {
    // Already fallback. Make sure the fallback content is materialised
    // in the slot if the slot-part has a holding fragment with nodes.
    restoreFallbackInto(slot);
    return false;
  }

  // Slot transitioning from actual to fallback (the record no longer has
  // content for this name).
  state.lastSnapshot.delete(slot);
  while (slot.firstChild) slot.removeChild(slot.firstChild);
  restoreFallbackInto(slot);
  return true;
}

/**
 * Move the slot-part's holding fragment back into the slot. No-op if no
 * fragment is attached or it is already empty.
 *
 * @param {HTMLSlotElement} slot
 */
function restoreFallbackInto(slot) {
  const frag = /** @type {DocumentFragment | undefined} */ (
    /** @type {any} */ (slot)[SLOT_FALLBACK_FRAG]
  );
  if (!frag || frag.childNodes.length === 0) return;
  slot.appendChild(frag);
}

// ---------------------------------------------------------------------------
// Renderer teardown hook (called from render-client.js)
// ---------------------------------------------------------------------------

/**
 * Detach a slot's record-owned children from the slot element before the
 * renderer's template teardown disposes the slot's subtree (a conditional
 * fragment collapsing). The RECORD keeps the node references, so when a
 * re-render re-creates the slot, `applySlotAssignments` re-places the very
 * same nodes: children are values, teardown never disposes consumer nodes.
 *
 * @param {Element} host
 * @param {HTMLSlotElement} slot
 */
export function rescueAssignedNodes(host, slot) {
  if (!hasSlotState(host)) return;
  const state = ensureSlotState(host);
  const name = keyOfName(slot.getAttribute('name'));
  const assigned = state.assignedByName.get(name);
  if (assigned) {
    for (const node of assigned) {
      if (node.parentNode === slot) {
        // Framework-detached on teardown: the record keeps the ref (children
        // are values), so the prune rule must not drop it while it is parked
        // out of the tree waiting for a re-created slot to re-place it.
        FRAMEWORK_DETACHED.add(node);
        slot.removeChild(node);
      }
    }
  }
  state.lastSnapshot.delete(slot);
}

// ---------------------------------------------------------------------------
// slotchange event dispatch
// ---------------------------------------------------------------------------

/** Fire a `slotchange` event on the slot (bubbles, not composed; per spec). */
export function fireSlotChange(slot) {
  slot.dispatchEvent(new Event('slotchange', { bubbles: true, composed: false }));
}

/**
 * Queue a coalesced `slotchange` for a slot. The event is dispatched on a
 * microtask, and a slot that changes more than once before the flush fires
 * exactly once (native `slotchange` timing: async and coalesced per slot).
 * A slot detached before the flush is skipped.
 *
 * @param {SlotState} state
 * @param {HTMLSlotElement} slot
 */
export function queueSlotChange(state, slot) {
  if (!state.pendingSlotChanges) state.pendingSlotChanges = new Set();
  state.pendingSlotChanges.add(slot);
  if (state.slotChangeScheduled) return;
  state.slotChangeScheduled = true;
  queueMicrotask(() => {
    state.slotChangeScheduled = false;
    const pending = state.pendingSlotChanges || new Set();
    state.pendingSlotChanges = new Set();
    // Fire regardless of connectivity: native slot assignment (and its
    // slotchange) works in disconnected trees, and dropping the event here
    // would lose it forever for a detached-then-reused host.
    for (const s of pending) fireSlotChange(s);
  });
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/** Strict per-index equality on two arrays. */
export function arraysEqual(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
