/**
 * Projection: placing authored children into their slots, and resyncing
 * after a re-render.
 *
 * Moved verbatim out of the pre-split `slot.js`; see that barrel for the
 * runtime's full contract.
 *
 * @module
 */
import { applyActualAssignment, applyFallback, arraysEqual, isOwnSlot, queueSlotChange } from './assignment.js';
import { EMPTY_NODE_SET, isInsideAuthored, parkFor } from './interception.js';
import { inBrowser, manualSlotFor } from './polyfills.js';
import { N_appendChild, N_removeChild, processBackstop, withRendererWrites } from './sensors.js';
import { effectiveKeyOf, ensureSlotState, keyOfName, repartition } from './state.js';
import { FRAMEWORK_DETACHED, LIGHT_SLOT_ATTR, PARK, PROJECTION_ACTUAL, PROJECTION_ATTR, SLOT_FALLBACK_FRAG, SLOT_STATE } from './symbols.js';

/**
 * Replace the authored content assigned to slot `name` with `nodes`, in place
 * of the old slice's position (a new name appends). The ONE public seam the
 * client router uses to reconcile a reused light host's projected content
 * during a same-route morph (replacing the deleted `setSlotContent`): the
 * router never touches `authored` / `assignedByName` / `lastSnapshot` directly,
 * and this is the same record-then-place primitive the interception layer runs.
 *
 * @param {Element} host
 * @param {string | null} name
 * @param {Node[] | Node | null} nodes
 */
export function projectAuthored(host, name, nodes) {
  const state = ensureSlotState(host);
  const key = keyOfName(name);
  const list = Array.isArray(nodes) ? nodes.filter(Boolean) : nodes ? [nodes] : [];
  // Evict the old slice by the node's EFFECTIVE key (the manual assign()
  // overlay when present, else the slot= attribute): filtering on the raw
  // attribute would evict a manually-assigned attribute-less node from the
  // default slice and silently drop another slot's content.
  let at = state.authored.findIndex((n) => effectiveKeyOf(state, n) === key);
  const evicted = state.authored.filter((n) => effectiveKeyOf(state, n) === key);
  state.authored = state.authored.filter((n) => effectiveKeyOf(state, n) !== key);
  if (at === -1 || at > state.authored.length) at = state.authored.length;
  for (const n of list) {
    // Stamp the slice key onto element nodes so the derived partition
    // matches the projection, EXCEPT nodes with a live manual assign()
    // entry: their routing is element-bound (the overlay outranks the
    // attribute), and the attribute is the author's latent intent that must
    // survive the overlay's release.
    if (n.nodeType === 1 && !manualSlotFor(state, n)) {
      if (key == null) /** @type {Element} */ (n).removeAttribute('slot');
      else /** @type {Element} */ (n).setAttribute('slot', key);
    }
    FRAMEWORK_DETACHED.add(n); // prune-exempt until placed
  }
  state.authored.splice(at, 0, ...list);
  if (state.applying && state.pendingRecordNodes) {
    for (const n of evicted) state.pendingRecordNodes.add(n);
    for (const n of list) state.pendingRecordNodes.add(n);
  } else {
    state.pendingRecordNodes = new Set([...evicted, ...list]);
  }
  // Scope the adoption-clear to THIS call's nodes: under the latch the
  // pending set may carry a co-pending nested op's nodes, whose adoptions
  // are not this projection's to end.
  if (state.adoptedKey) {
    for (const n of evicted) state.adoptedKey.delete(n);
    for (const n of list) state.adoptedKey.delete(n);
  }
  repartition(state);
  applySlotAssignments(host);
}

// ---------------------------------------------------------------------------
// Native-write window + host interception (native slot-API liveness)
// ---------------------------------------------------------------------------

/**
 * Place the slot record into the host's OWN light-DOM slots (#1015). The
 * renderer's slot parts call this after the template commits, and the
 * interception + sensors call it after an authored mutation. Idempotent and cheap on
 * no-change passes.
 *
 *   1. Collect the host's OWN slots (no other custom element between the
 *      slot and the host; a nested component's slots belong to it).
 *   2. Group by `name`, first-wins: the first slot of each name shows the
 *      record content, later duplicates show fallback.
 *   3. `data-projection` is stamped "actual" or "fallback" accordingly;
 *      fallback content swaps through the part-owned holding fragment.
 *   4. `slotchange` fires on slots whose assigned set actually changed.
 *
 * @param {Element} host
 */
export function applySlotAssignments(host) {
  if (!inBrowser) return;
  const state = /** @type {SlotState | undefined} */ (
    /** @type {any} */ (host)[SLOT_STATE]
  );
  if (!state) return;

  // Re-entrancy latch: a custom-element reaction fired by a placement or
  // fallback removal (a disconnectedCallback doing host.appendChild) can
  // author-write while THIS pass is mid-flight; running a nested pass
  // would let the outer loop destroy the inner placements and desync
  // data-projection from the snapshot. The nested call returns after
  // flagging a re-run (its record splice already happened in the
  // interceptor), and the outer pass repeats until a full pass runs with
  // no re-entrant write. The end-of-pass source drain also rides this
  // loop instead of recursing.
  if (state.applying) {
    state.reapply = true;
    return;
  }
  state.applying = true;
  try {
    do {
      state.reapply = false;

      // 0. Self-heal, prune, re-derive, in that order. First fold in what a
      //    NON-record writer wrote inside our own actual slots (a parent
      //    component's hole committed within projected content, or a library
      //    operating on the assigned container): the apply step is the only
      //    record writer, so physical-vs-snapshot divergence means someone else
      //    wrote there, and destroying their nodes on this pass would be the
      //    one-writer violation in reverse. Then prune the record of nodes the
      //    author detached out from under us (an `el.remove()` on a projected
      //    child, or a re-parent elsewhere): their parent is no longer one of our
      //    own slots / the park, and we did not detach them ourselves. Then
      //    re-derive from the surviving `authored` so a `slot=` change (or any
      //    authored mutation) is reflected before placement.
      const pendingNodes = state.pendingRecordNodes || EMPTY_NODE_SET;
      state.pendingRecordNodes = undefined;
      resyncActualSlots(host, state, pendingNodes);
      pruneAuthored(host, state);
      repartition(state);

      // 1. The host's own slots, document order. A slot that is BOUND but not yet
      //    FINALIZED (its slot-part deferred finalize to a microtask: it carries
      //    data-webjs-light from compile time but has neither a data-projection
      //    stamp nor a harvested fallback frag) is EXCLUDED from placement this
      //    pass: treating it as fallback-mode would destroy its un-harvested
      //    fallback clone, and the finalize's own queued apply covers it one
      //    microtask later. Its NAME still counts as rendered (pendingNames) so
      //    the park step does not spuriously park (and bounce) its content.
      /** @type {HTMLSlotElement[]} */
      const slots = [];
      /** @type {Set<string|null>} */
      const pendingNames = new Set();
      for (const el of host.querySelectorAll(`slot[${LIGHT_SLOT_ATTR}]`)) {
        if (!isOwnSlot(host, el)) continue;
        // An own slot can NEVER live inside AUTHORED content: a slot element the
        // author moved or wrote into the host (another component's chunk, a
        // spoofed stamp) is inert content, exactly like a <slot> outside a
        // shadow tree natively. Collecting it would hand it assignments whose
        // nodes can CONTAIN it (HierarchyRequestError at placement).
        if (isInsideAuthored(state, host, el)) continue;
        if (
          !el.hasAttribute(PROJECTION_ATTR) &&
          !(SLOT_FALLBACK_FRAG in /** @type {any} */ (el))
        ) {
          pendingNames.add(keyOfName(el.getAttribute('name')));
          continue;
        }
        slots.push(/** @type {HTMLSlotElement} */ (el));
      }

      // 2. Group by current `name` attribute in document order.
      /** @type {Map<string|null, HTMLSlotElement[]>} */
      const groups = new Map();
      for (const slot of slots) {
        const name = keyOfName(slot.getAttribute('name'));
        let arr = groups.get(name);
        if (!arr) {
          arr = [];
          groups.set(name, arr);
        }
        arr.push(slot);
      }

      // 3. Assign per the first-wins rule; a node manually bound via `assign()`
      //    routes to ITS slot element (native binds slottables to the receiving
      //    element), everything else to the first slot of its name.
      /** @type {HTMLSlotElement[]} */
      const slotsChanged = [];
      for (const [name, group] of groups) {
        const assigned = state.assignedByName.get(name) || [];
        for (let i = 0; i < group.length; i++) {
          const slot = group[i];
          let own = assigned.filter((n) => {
            const m = manualSlotFor(state, n);
            return m ? m === slot : i === 0;
          });
          // Placement-time cycle shield (skip, never throw): a reaction
          // fired by an EARLIER slice's departure removal can reparent the
          // HOST into a node this slice is about to place; inserting it
          // would throw a native HierarchyRequestError out of the whole
          // apply pass. The filter runs BEFORE the actual/fallback
          // decision, so a fully poisoned slice correctly degrades to
          // FALLBACK instead of an actual-stamped empty slot, and the
          // poisoned nodes' prune exemptions are CLEARED so the next pass's
          // prune reaps them by their (outside-the-host) parent chain.
          const poisoned = own.filter(
            (n) => n === host || (n.nodeType === 1 && /** @type {Element} */ (n).contains(host)),
          );
          if (poisoned.length) {
            for (const n of poisoned) FRAMEWORK_DETACHED.delete(n);
            own = own.filter((n) => poisoned.indexOf(n) === -1);
          }
          if (own.length > 0) {
            if (applyActualAssignment(state, slot, own)) {
              slotsChanged.push(slot);
            }
          } else {
            if (applyFallback(state, slot)) slotsChanged.push(slot);
          }
        }
      }

      // 4. Queue slotchange on slots whose assignment actually changed. Native
      //    timing: assignment recomputes synchronously (placement above already
      //    ran) but the slotchange EVENT is async and coalesced (one per slot per
      //    microtask). Synchronous dispatch here would let an author mutation
      //    inside a slotchange handler recurse into this writer mid-loop, and
      //    would fire N events for an N-node loop; coalescing matches the spec.
      for (const slot of slotsChanged) queueSlotChange(state, slot);

      // 5. Park authored nodes whose name matches no rendered own-slot. Native
      //    shadow keeps an unassigned child connected but unrendered (a nested
      //    custom element still upgrades and runs connectedCallback); a hidden
      //    holding element inside the host reproduces that. Parked nodes have
      //    parentNode === park, so the prune rule keeps them. The park is
      //    RECONCILED to exactly the current unmatched set: a node that left the
      //    record (or now matches a slot) is detached from the park, so a removed
      //    parked child ends up isConnected === false like native removeChild.
      const matched = new Set(groups.keys());
      for (const name of pendingNames) matched.add(name);
      const shouldPark = new Set();
      for (const n of state.authored) {
        if (!matched.has(effectiveKeyOf(state, n))) shouldPark.add(n);
      }
      const existingPark = /** @type {any} */ (host)[PARK];
      if (existingPark) {
        for (const n of Array.from(existingPark.childNodes)) {
          if (!shouldPark.has(n)) N_removeChild.call(existingPark, n);
        }
      }
      if (shouldPark.size) {
        const park = parkFor(host);
        for (const n of shouldPark) {
          if (n.parentNode !== park) {
            FRAMEWORK_DETACHED.delete(n);
            withRendererWrites(host, () => N_appendChild.call(park, n));
          }
        }
      }

      // LAST step: consume the records this apply's own placements generated,
      // while their containment evidence is still fresh. A host-to-slot
      // placement removal processed now sees contains === true and is retained
      // trivially, so it can never age into a stale record that a later rescue
      // makes indistinguishable from an author removal (the retention conjuncts
      // in processBackstop stay as a second line for any record that still
      // straddles). Running at the END keeps any recursive fold's inner apply
      // from racing this pass's park bookkeeping; recursion terminates because
      // a pure-placement batch marks nothing dirty and an inner apply leaves an
      // empty queue behind.
      // DEFENSE-IN-DEPTH, empirically not required by any suite-constructible
      // interleaving at this head (deleting it stays green): the window-close
      // drains and the retention conjuncts cover every reproduced sequence.
      // It stays because the stale-placement-record race was independently
      // traced by two reviews, is O(pending records) cheap, provably
      // terminates under the latch, and processing placement records with
      // fresh containment can only ever retain correctly.
      if (state.backstop) {
        const placementRecords = state.backstop.takeRecords();
        if (placementRecords.length) processBackstop(host, state, placementRecords);
      }
    } while (state.reapply);
  } finally {
    state.applying = false;
  }
}

/**
 * Self-heal `authored` against a NON-record writer that wrote INSIDE one of
 * the host's own actual slots. Two such writers are legitimate: a parent
 * component whose hole was authored as this host's content (its child-part
 * marker projects into the slot, so a later array / template commit inserts
 * or removes nodes there with no interceptor in the way), and a third-party
 * library operating on the assigned container (the documented target for
 * generic DOM code). The apply step is the ONLY record-driven DOM writer, so
 * a slot whose physical childNodes diverge from its `lastSnapshot` was
 * written by someone else since the last apply; destroying those nodes on
 * this pass (the pre-fix behaviour) is the one-writer violation in reverse
 * and detaches DOM a live renderer part still points at.
 *
 * Reconciliation rule, per diverged slot. Order authority is NODE-scoped,
 * never pass-scoped (a pass-scoped rule made the outcome depend on which
 * trigger happened to run the apply):
 * - The PHYSICAL order of the slice is the base: a renderer part reordering
 *   a keyed list inside the slot is never fought back, regardless of what
 *   triggered this apply.
 * - Nodes the current record op TOUCHED (`pendingNodes`: inserted, moved, or
 *   removed by the interceptor / assign() / router splice that triggered
 *   this apply) are taken OUT of the base and re-anchored at their
 *   record-implied position, so an author's expressed move (appendChild of
 *   an existing child = move to end) is honoured; an op-REMOVED node is in
 *   `pendingNodes` but no longer in the record, so it simply drops.
 * - Record nodes missing from the slot (a bypass move onto the host, a
 *   genuine author detach) are also re-anchored; `pruneAuthored`, which runs
 *   right after, decides their fate structurally by their current parent
 *   (re-place vs drop), so no zombie is resurrected.
 *
 * @param {Element} host
 * @param {SlotState} state
 * @param {Set<Node>} pendingNodes
 */
function resyncActualSlots(host, state, pendingNodes) {
  // lastSnapshot is a WeakMap (not iterable): walk the host's own APPLIED
  // actual slots instead, which are exactly the elements a snapshot exists
  // for.
  for (const el of host.querySelectorAll(
    `slot[${LIGHT_SLOT_ATTR}][${PROJECTION_ATTR}="${PROJECTION_ACTUAL}"]`,
  )) {
    if (!isOwnSlot(host, el)) continue;
    if (isInsideAuthored(state, host, el)) continue; // authored content, not a slot
    const slot = /** @type {HTMLSlotElement} */ (el);
    const snapshot = state.lastSnapshot.get(slot);
    if (!snapshot) continue;
    const physical = Array.from(slot.childNodes);
    if (arraysEqual(physical, snapshot)) continue;
    const a = state.authored;
    const key = keyOfName(slot.getAttribute('name'));

    // Base: the slice in PHYSICAL order, minus op-touched nodes (re-anchored
    // below or op-removed). A physical node unknown to the record is a true
    // addition (renderer hole / library write) and folds in at its physical
    // position; when the container is a NAMED slot and the node's own
    // attribute would key it elsewhere, remember the container's key as the
    // node's ADOPTED key so repartition does not teleport it out of the
    // container it was written into.
    const merged = physical.filter((n) => !pendingNodes.has(n));
    for (const n of merged) {
      if (a.indexOf(n) !== -1) continue; // known to the record already
      if (effectiveKeyOf(state, n) !== key) {
        if (!state.adoptedKey) state.adoptedKey = new WeakMap();
        state.adoptedKey.set(n, key);
      }
    }

    // Re-anchor every record node of this slice that is not already in the
    // base, in record order, each after the LAST base member that precedes
    // it in the record (start when none). Covers op-inserted/moved nodes and
    // record nodes missing from the slot (prune settles those right after).
    for (const n of a) {
      if (merged.indexOf(n) !== -1) continue;
      if (effectiveKeyOf(state, n) !== key) continue;
      const nIdx = a.indexOf(n);
      let at = 0;
      for (let i = 0; i < merged.length; i++) {
        const mIdx = a.indexOf(merged[i]);
        if (mIdx !== -1 && mIdx < nIdx) at = i + 1;
      }
      merged.splice(at, 0, n);
    }

    // Replace the old slice with the merged one at the old slice's position.
    const involved = new Set(merged);
    for (const n of snapshot) involved.add(n);
    let at = -1;
    let seen = 0;
    for (const n of a) {
      if (involved.has(n)) {
        if (at === -1) at = seen;
        continue;
      }
      seen += 1;
    }
    const rest = a.filter((n) => !involved.has(n));
    if (at === -1 || at > rest.length) at = rest.length;
    rest.splice(at, 0, ...merged);
    state.authored = rest;
    // The snapshot itself is settled by the placement step this pass.
  }
}

/**
 * Prune `authored` of nodes the author detached out from under the record: a
 * node whose parent is neither one of the host's own actual slots nor the park,
 * and which the framework did not itself detach (capture / teardown rescue mark
 * such nodes so they survive the parentless window before (re)placement). This
 * closes the zombie-child resurrection (`el.remove()` on a projected node) and
 * cross-host theft: the ownership question is answered structurally by the
 * node's real parent, never by stale bookkeeping.
 *
 * @param {Element} host
 * @param {SlotState} state
 */
function pruneAuthored(host, state) {
  const park = /** @type {any} */ (host)[PARK];
  state.authored = state.authored.filter((n) => {
    if (FRAMEWORK_DETACHED.has(n)) return true;
    const p = n.parentNode;
    if (p == null) return false;
    // A DIRECT host child is still ours: a raw bypass move pulled it out of
    // its slot onto the host (native: a host child stays assigned), and the
    // physically-verifying placement step re-places it this same pass.
    if (p === host) return true;
    if (p === park) return true;
    // The slot-parent keep requires the slot to be recognizably OURS.
    // lastSnapshot membership is DIRECT proof this host applied that slot,
    // so it stands alone (covering our own detached slots: a cache()-stashed
    // branch, a torn-down conditional, or a FORWARDED slot the re-render
    // detached, whose structural isOwnSlot walk would wrongly hit the child
    // component between it and this host). A merely-CONTAINED slot still
    // needs isOwnSlot, so the apply never steals a node back from an
    // unrelated component's torn-down slot the author moved it into (the
    // bare isOwnSlot walk is vacuously true on any fully detached chain).
    if (
      p.nodeType === 1 &&
      /** @type {Element} */ (p).tagName === 'SLOT' &&
      /** @type {Element} */ (p).hasAttribute(LIGHT_SLOT_ATTR) &&
      (state.lastSnapshot.has(/** @type {HTMLSlotElement} */ (p)) ||
        (host.contains(p) && isOwnSlot(host, /** @type {Element} */ (p))))
    ) {
      return true;
    }
    return false;
  });
  // The manual-assignment overlay needs no pruning here: it holds nodes via
  // WeakRef (native holds manually assigned slottables weakly), so a removed
  // node is not leaked, and an entry for a node assigned BEFORE it becomes a
  // host child stays honoured when the node is later appended (the native
  // assign-first, append-later ordering).
}
