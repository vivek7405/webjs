/**
 * Per-host slot state: the authored-children capture, the name to node
 * partition, and SSR assignment adoption.
 *
 * Moved verbatim out of the pre-split `slot.js`; see that barrel for the
 * runtime's full contract.
 *
 * @module
 */
import { isOwnSlot } from './assignment.js';
import { isInsideAuthored } from './interception.js';
import { manualSlotFor } from './polyfills.js';
import { applySlotAssignments } from './project.js';
import { reconnectSweep } from './sensors.js';
import { FRAMEWORK_DETACHED, LIGHT_SLOT_ATTR, PARK, PROJECTION_ACTUAL, PROJECTION_ATTR, SLOT_STATE } from './symbols.js';

/**
 * Lazily create and return the slot state for a host element.
 *
 * @param {Element} host
 * @returns {SlotState}
 */
export function ensureSlotState(host) {
  /** @type {any} */
  const h = host;
  let state = h[SLOT_STATE];
  if (!state) {
    state = {
      host,
      authored: [],
      assignedByName: new Map(),
      lastSnapshot: new WeakMap(),
    };
    h[SLOT_STATE] = state;
  }
  return state;
}

/** True when the host has slot state initialised. */
export function hasSlotState(host) {
  return Boolean(/** @type {any} */ (host)[SLOT_STATE]);
}

// ---------------------------------------------------------------------------
// Capture: once per host lifetime
// ---------------------------------------------------------------------------

/**
 * Move every authored child of `host` into the slot record, partitioning
 * by each child's `slot=""` attribute. After this runs, `host` has no
 * children; the renderer re-inserts them at slot-apply time inside the
 * correct <slot> elements. Runs ONCE per host lifetime (first mount, no
 * SSR); there is no later re-capture, so rendered nodes can never be
 * misclassified as authored children (#1006, closed by construction).
 *
 * @param {Element} host
 */
export function captureAuthoredChildren(host) {
  const state = ensureSlotState(host);
  while (host.firstChild) {
    const node = host.firstChild;
    state.authored.push(node);
    // Detached by the framework, awaiting placement at slot-apply time: the
    // prune rule must not treat this parentless window as an author removal.
    FRAMEWORK_DETACHED.add(node);
    host.removeChild(node);
  }
  repartition(state);
}

/**
 * Rebuild `assignedByName` from `authored`: group every authored node by its
 * current `slot=""` attribute (default = null key). Pure and idempotent, the
 * single place a node's slot assignment is decided. Called after any change
 * to `authored` and at the top of `applySlotAssignments`.
 *
 * @param {SlotState} state
 */
export function repartition(state) {
  const byName = state.assignedByName;
  byName.clear();
  for (const node of state.authored) {
    appendToMap(byName, effectiveKeyOf(state, node), node);
  }
}

/**
 * The slot key a node is ASSIGNED under: the manual `HTMLSlotElement.assign()`
 * overlay when the node is named in one, else the node's `slot=""` attribute.
 * The ONE key rule, shared by `repartition`, the park step, and the router
 * seam, so a manually-assigned node is never judged by its overlay in one
 * place and its raw attribute in another (which parked an assigned node out
 * of its own slot).
 *
 * @param {SlotState} state
 * @param {Node} node
 * @returns {string | null}
 */
export function effectiveKeyOf(state, node) {
  const m = manualSlotFor(state, node);
  if (m) return keyOfName(m.getAttribute('name'));
  // A node a NON-record writer placed inside a NAMED slot (folded by the
  // self-heal resync) keeps the key of the container it was written into;
  // deriving from its (absent or different) slot= attribute would teleport
  // it to the default slot on the next apply. An explicit later slot=
  // change clears the adoption (the flip sensor owns that).
  if (state.adoptedKey) {
    const adopted = state.adoptedKey.get(node);
    if (adopted !== undefined) return adopted;
  }
  return slotNameOf(node);
}

/**
 * After SSR + hydration, projected children already live inside their
 * <slot data-webjs-light> elements. Walk the host's render tree and
 * record those existing assignments in the record without moving DOM.
 * The capture-once counterpart for the hydration path.
 *
 * @param {Element} host
 */
export function adoptSSRAssignments(host) {
  const state = ensureSlotState(host);
  // Record the connect branch: reconnectSweep's pre-render fold gate keys on
  // this flag (an adopted host's children ARE rendered markup; a captured
  // host's are only bypass writes).
  state.adopted = true;
  /** @type {Set<string|null>} first-wins per name across the host's own slots */
  const seen = new Set();
  const slots = host.querySelectorAll(`slot[${LIGHT_SLOT_ATTR}]`);
  for (const slot of slots) {
    /** @type {HTMLSlotElement} */
    const s = /** @type {any} */ (slot);
    // Only the host's OWN slots. A nested component's slot (another custom
    // element sits between it and the host) belongs to THAT component and is
    // adopted from its own record. Without this filter, a nested actual slot
    // that precedes the outer host's same-named slot in document order wins
    // the first-wins `has(name)` check below, so the outer record adopts the
    // inner component's children and the outer's first apply physically steals
    // them. `applySlotAssignments` and the router both filter; this path must
    // too.
    if (!isOwnSlot(host, s)) continue;
    if (s.getAttribute(PROJECTION_ATTR) !== PROJECTION_ACTUAL) continue;
    // The authored-content invariant applies at adopt time too: a slot
    // sitting inside ALREADY-ADOPTED children (an SSR'd forwarded slot
    // serialized as content of an earlier own slot) is content, not an own
    // slot; adopting it would first-wins-collide with a later legitimate
    // same-named own slot and destroy that slot's children. Document order
    // guarantees a container slot precedes its descendants, so the check
    // sees the container's children in `authored` by the time a nested slot
    // is tested.
    if (isInsideAuthored(state, host, s)) continue;
    const name = keyOfName(s.getAttribute('name'));
    if (!seen.has(name)) {
      seen.add(name);
      const children = Array.from(s.childNodes);
      // The SSR'd projected children retain their own `slot=` attribute, so
      // pushing them into `authored` and re-deriving reproduces the same
      // per-name grouping without moving any DOM (no flash). Note: `authored`
      // is rebuilt in slot-document order, not the original interleaved
      // host-child order, which SSR did not preserve. Per-name grouping (all
      // that placement uses) is exact; the only observable difference from a
      // fresh mount is the cross-name ordering a post-hydration `insertBefore`
      // with a ref in a DIFFERENT named slot would resolve against.
      // A child whose OWN attribute keys elsewhere (a snapshot-restored
      // adoption or manual assignment, provenance the HTML cannot carry) is
      // re-adopted under the container's key, so the first client render
      // never relocates a node out of the slot the restored markup showed it
      // in.
      for (const child of children) {
        state.authored.push(child);
        // No prune-exemption mark here: when createInstance detaches the old
        // SSR subtree, these children still sit in the OLD slot, which this
        // adopt just recorded in lastSnapshot, so the prune gate keeps them
        // through the detach window. Skipping the mark also means an author
        // removing an adopted child BEFORE the first apply (child.remove()
        // in another component's boot hook) is honoured instead of the node
        // being resurrected by the resync.
        if (slotNameOf(child) !== name) {
          if (!state.adoptedKey) state.adoptedKey = new WeakMap();
          state.adoptedKey.set(child, name);
        }
      }
      state.lastSnapshot.set(s, children.slice());
    }
  }
  // A serialized snapshot (back/forward restore) also carries the PARK: an
  // authored child whose slot name matched no rendered slot at snapshot time
  // sits inside <wj-slot-park>. Sweep its children into the record and drop
  // the serialized park element itself (a fresh park is created on demand),
  // so a parked node survives the restore and a later render that DOES emit
  // its slot pulls it back out.
  for (const oldPark of host.querySelectorAll('wj-slot-park')) {
    if (!isOwnSlot(host, oldPark)) continue;
    for (const child of Array.from(oldPark.childNodes)) {
      // The children keep the DETACHED oldPark as parent until placement;
      // the FRAMEWORK_DETACHED mark is what shields them from the prune
      // rule across that window.
      FRAMEWORK_DETACHED.add(child);
      state.authored.push(child);
    }
    oldPark.remove();
  }
  repartition(state);
}

/**
 * Normalise a slot name to the record key, applied at EVERY name read
 * (capture, adopt, application, rescue, and the public API) so the record
 * key is uniform end to end. The default slot is stored under `null`;
 * `''` and `'default'` are aliases for it. Consequence: `default` is a
 * RESERVED slot name (a literal `name="default"` slot addresses the
 * default slot); the SSR substitution applies the same rule.
 *
 * @param {string | null | undefined} name
 * @returns {string | null}
 */
export function keyOfName(name) {
  return name == null || name === '' || name === 'default' ? null : name;
}

/**
 * Read the slot="" attribute on an element child. Text and comment nodes
 * always route to the default slot (key = null).
 *
 * @param {Node} node
 * @returns {string | null}
 */
function slotNameOf(node) {
  if (node.nodeType !== 1) return null;
  const el = /** @type {Element} */ (node);
  return keyOfName(el.getAttribute('slot'));
}

/** Append a value to a Map<K, V[]>, creating the array on first hit. */
function appendToMap(map, key, value) {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(value);
}

// ---------------------------------------------------------------------------
// Router coordination seam
// ---------------------------------------------------------------------------
