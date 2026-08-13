/**
 * Native slot API capture and the light-DOM implementations behind it
 * (assignedNodes / assignedElements / assignedSlot / assign).
 *
 * Moved verbatim out of the pre-split `slot.js`; see that barrel for the
 * runtime's full contract.
 *
 * @module
 */
import { isOwnSlot } from './assignment.js';
import { applySlotAssignments } from './project.js';
import { ensureSlotState, repartition } from './state.js';
import { FLATTEN_MAX_DEPTH, LIGHT_SLOT_ATTR, PROJECTION_ACTUAL, PROJECTION_ATTR, SLOT_STATE } from './symbols.js';

function detectBrowser() {
  return typeof HTMLElement !== 'undefined' && typeof HTMLSlotElement !== 'undefined';
}

export let inBrowser = detectBrowser();

let NATIVE_assignedNodes = null;
let NATIVE_assignedElements = null;
let NATIVE_assignedSlot_desc = null;
let NATIVE_assign = null;
let polyfillsInstalled = false;

/**
 * Install the slot DOM-API polyfills on HTMLSlotElement.prototype and
 * Element.prototype if the current realm has those globals. Idempotent.
 * No-op when the realm has no DOM (server-side import-only path).
 */
export function installSlotPolyfills() {
  if (polyfillsInstalled) return;
  inBrowser = detectBrowser();
  if (!inBrowser) return;
  NATIVE_assignedNodes = HTMLSlotElement.prototype.assignedNodes;
  NATIVE_assignedElements = HTMLSlotElement.prototype.assignedElements;
  NATIVE_assignedSlot_desc = Object.getOwnPropertyDescriptor(Element.prototype, 'assignedSlot');

  HTMLSlotElement.prototype.assignedNodes = function patchedAssignedNodes(options) {
    // Two conditions must both hold for the polyfill to take over:
    //   1. The slot carries the framework's data-webjs-light marker.
    //   2. The slot is NOT currently inside a shadow root.
    // Slots that end up in a shadow tree (their host has a ShadowRoot)
    // delegate to native projection, which the browser performs from the
    // host's light-DOM children. discoverSlots cannot tell at template
    // compile time whether the template will be cloned into a light or
    // shadow render root (templates cache by strings identity), so the
    // shadow-vs-light determination has to happen on every API call.
    if (this.hasAttribute(LIGHT_SLOT_ATTR) && !isInShadowRoot(this)) {
      return lightAssignedNodes(this, options);
    }
    return NATIVE_assignedNodes ? NATIVE_assignedNodes.call(this, options) : [];
  };

  HTMLSlotElement.prototype.assignedElements = function patchedAssignedElements(options) {
    if (this.hasAttribute(LIGHT_SLOT_ATTR) && !isInShadowRoot(this)) {
      return lightAssignedNodes(this, options).filter((n) => n.nodeType === 1);
    }
    return NATIVE_assignedElements ? NATIVE_assignedElements.call(this, options) : [];
  };

  Object.defineProperty(Element.prototype, 'assignedSlot', {
    configurable: true,
    enumerable: true,
    get: function patchedAssignedSlot() {
      const native =
        NATIVE_assignedSlot_desc && NATIVE_assignedSlot_desc.get
          ? NATIVE_assignedSlot_desc.get.call(this)
          : null;
      if (native) return native;
      return findLightAssignedSlot(this);
    },
  });

  // Native `assignedSlot` lives on the Slottable mixin, which covers Text as
  // well as Element: a projected text child reports its slot in shadow DOM,
  // so the light parity read must answer for Text too.
  const NATIVE_text_assignedSlot_desc = Object.getOwnPropertyDescriptor(
    Text.prototype,
    'assignedSlot',
  );
  Object.defineProperty(Text.prototype, 'assignedSlot', {
    configurable: true,
    enumerable: true,
    get: function patchedTextAssignedSlot() {
      const native =
        NATIVE_text_assignedSlot_desc && NATIVE_text_assignedSlot_desc.get
          ? NATIVE_text_assignedSlot_desc.get.call(this)
          : null;
      if (native) return native;
      return findLightAssignedSlot(this);
    },
  });

  NATIVE_assign = HTMLSlotElement.prototype.assign;
  HTMLSlotElement.prototype.assign = function patchedAssign(...nodes) {
    if (this.hasAttribute(LIGHT_SLOT_ATTR) && !isInShadowRoot(this)) {
      // Manual slot assignment (imperative, overrides attribute mode). Bound
      // to THIS slot element (native binds slottables to the receiving
      // element, not its name), held via WeakRef (native holds manually
      // assigned slottables weakly), honored by repartition through
      // effectiveKeyOf and by the placement step's per-element routing.
      // NOTE this is a deliberate EXTENSION of native: real manual mode
      // requires slotAssignment 'manual' on the whole shadow root and turns
      // name matching off; here assign() overlays per-node while name
      // matching keeps working for everything else.
      const host = hostOfSlot(this);
      if (host) {
        const state = ensureSlotState(host);
        if (!state.manualAssign) state.manualAssign = new Map();
        const list = nodes.filter(Boolean);
        // LAST-assign-wins: a node handed to this slot leaves any other
        // slot's manual list.
        for (const [slotEl, refs] of state.manualAssign) {
          if (slotEl === this) continue;
          const kept = refs.filter((r) => {
            const n = r.deref();
            return n !== undefined && list.indexOf(n) === -1;
          });
          if (kept.length !== refs.length) {
            if (kept.length) state.manualAssign.set(slotEl, kept);
            else state.manualAssign.delete(slotEl);
          }
        }
        if (list.length) {
          state.manualAssign.set(this, list.map((n) => new WeakRef(n)));
        } else {
          state.manualAssign.delete(this);
        }
        if (state.applying && state.pendingRecordNodes) {
          for (const n of list) state.pendingRecordNodes.add(n);
        } else {
          state.pendingRecordNodes = new Set(list);
        }
        repartition(state);
        applySlotAssignments(host);
      }
      return undefined;
    }
    return NATIVE_assign ? NATIVE_assign.apply(this, nodes) : undefined;
  };
  polyfillsInstalled = true;
}

/**
 * The slot ELEMENT a node is manually assigned to via `assign()`, or null.
 * Dead WeakRefs are compacted on the way through.
 *
 * @param {SlotState} state
 * @param {Node} node
 * @returns {HTMLSlotElement | null}
 */
export function manualSlotFor(state, node) {
  const manual = state.manualAssign;
  if (!manual || !manual.size) return null;
  for (const [slotEl, refs] of manual) {
    let found = false;
    const live = refs.filter((r) => {
      const n = r.deref();
      if (n === undefined) return false;
      if (n === node) found = true;
      return true;
    });
    if (live.length !== refs.length) {
      if (live.length) manual.set(slotEl, live);
      else manual.delete(slotEl);
    }
    if (found) {
      // A manual entry is honoured only while its RECEIVING element is still
      // part of this host's tree. A torn-down (conditionally re-rendered)
      // slot element leaves the entry DORMANT: the node falls back to its
      // slot= attribute (routed by name or parked, native's
      // unassigned-but-connected behaviour) instead of being excluded from
      // every slot and lost. The entry is kept, not deleted, so a re-attached
      // element (the cache directive) resumes its assignment, matching
      // native's element-bound persistence.
      const hostEl = state.host;
      if (hostEl && (slotEl === hostEl || hostEl.contains(slotEl))) return slotEl;
      return null;
    }
  }
  return null;
}

/**
 * Walk up from a light slot to its owning host: the nearest SLOT_STATE
 * ancestor that actually OWNS the slot. A slot separated from that ancestor
 * by another custom element (a forwarded slot inside a foreign / elided
 * component) is nobody's here: attributing it to the outer host would
 * redirect the outer host's own same-named slot, so `assign()` on such a
 * slot is inert instead (the same carve-out as every other elided-component
 * write).
 */
function hostOfSlot(slot) {
  for (let p = slot.parentElement; p; p = p.parentElement) {
    if (/** @type {any} */ (p)[SLOT_STATE]) {
      return isOwnSlot(p, slot) ? p : null;
    }
  }
  return null;
}

// First-chance install at module load.
installSlotPolyfills();

/**
 * True when the given node lives inside a shadow root (so native browser
 * slot projection applies). A ShadowRoot exposes its owning element as
 * `host`; the document does not. Walks the parentNode chain manually
 * with a depth cap to avoid hangs on accidentally cyclic DOMs (e.g.,
 * test fixtures that wire two slots into each other).
 *
 * @param {Node} node
 * @returns {boolean}
 */
function isInShadowRoot(node) {
  let n = node;
  for (let depth = 0; depth < 128; depth++) {
    const parent = n.parentNode;
    if (!parent) return false;
    if (parent === n) return false;
    // A real ShadowRoot is a DocumentFragment (nodeType 11) exposing its
    // owner as `.host`. `.host` truthiness ALONE misfires on ordinary
    // elements: HTMLAnchorElement/HTMLAreaElement expose a URL-derived
    // `.host`, so a slot inside an <a> card read as "in shadow DOM".
    if (parent.nodeType === 11 && /** @type {any} */ (parent).host) return true;
    n = parent;
  }
  return false;
}

/**
 * Resolve assigned nodes for a light-DOM slot. Per spec, returns []
 * when the slot is displaying fallback content.
 *
 * @param {HTMLSlotElement} slot
 * @param {{ flatten?: boolean }} [options]
 * @returns {Node[]}
 */
function lightAssignedNodes(slot, options) {
  // Only an APPLIED actual slot has assigned nodes. A fallback slot reports
  // [], and so does a slot with NO data-projection at all (an orphan slot
  // rendered outside any host, or one not yet placed): its children are
  // cloned fallback content, and native returns [] for a slot outside a
  // shadow tree.
  if (slot.getAttribute(PROJECTION_ATTR) !== PROJECTION_ACTUAL) return [];
  const direct = Array.from(slot.childNodes);
  if (!options || !options.flatten) return direct;
  return flattenAssignedNodes(direct, new Set(), 0);
}

/**
 * Walk a node list, expanding any data-webjs-light slot into its assigned
 * nodes recursively. Native shadow slots encountered in the chain delegate
 * to their native assignedNodes({flatten: true}).
 *
 * @param {Node[]} nodes
 * @param {Set<HTMLSlotElement>} visited
 * @param {number} depth
 * @returns {Node[]}
 */
function flattenAssignedNodes(nodes, visited, depth) {
  if (depth >= FLATTEN_MAX_DEPTH) return nodes.slice();
  const out = [];
  for (const node of nodes) {
    if (node.nodeType === 1 && /** @type {Element} */ (node).tagName === 'SLOT') {
      const slot = /** @type {HTMLSlotElement} */ (node);
      if (visited.has(slot)) continue;
      visited.add(slot);
      if (slot.hasAttribute(LIGHT_SLOT_ATTR)) {
        const inner = lightAssignedNodes(slot, { flatten: false });
        if (inner.length > 0) {
          for (const n of flattenAssignedNodes(inner, visited, depth + 1)) out.push(n);
        } else {
          // Fallback content contributes its children.
          for (const n of flattenAssignedNodes(Array.from(slot.childNodes), visited, depth + 1)) {
            out.push(n);
          }
        }
      } else if (NATIVE_assignedNodes) {
        const inner = NATIVE_assignedNodes.call(slot, { flatten: true });
        for (const n of inner) out.push(n);
      } else {
        out.push(node);
      }
    } else {
      out.push(node);
    }
  }
  return out;
}

/**
 * Consult a node's DIRECT parent to find a data-webjs-light slot it is
 * currently projected into. Returns null if the element is in a fallback
 * slot or no light slot at all.
 *
 * @param {Element} el
 * @returns {HTMLSlotElement | null}
 */
function findLightAssignedSlot(el) {
  // Native `assignedSlot` answers only for a SLOTTABLE itself. In the light
  // parity model, assigned nodes are exactly the slot element's DIRECT
  // children, so only the immediate parent is consulted: a DESCENDANT of
  // assigned content correctly reads null, matching shadow DOM (where only
  // the host's direct children are slottables).
  const p = el.parentElement;
  if (p && p.tagName === 'SLOT' && p.hasAttribute(LIGHT_SLOT_ATTR)) {
    return p.getAttribute(PROJECTION_ATTR) === PROJECTION_ACTUAL
      ? /** @type {HTMLSlotElement} */ (p)
      : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-host state: the slot record
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SlotState
 * @property {Element} host The owning host element (back-reference so
 *   state-only helpers can test containment).
 * @property {Node[]} authored The ordered source of truth: every authored
 *   child of the host, in host-child order. `assignedByName` is DERIVED from
 *   this by `repartition` (grouping each node by its current `slot=`
 *   attribute), so there is one place a node's assignment is decided.
 * @property {Map<string|null, Node[]>} assignedByName The DERIVED slot record:
 *   `authored` grouped per slot name (null is the default slot). Never mutated
 *   directly; always rebuilt by `repartition`.
 * @property {WeakMap<HTMLSlotElement, Node[]>} lastSnapshot Per-slot
 *   record of the previous assigned-node set for slotchange equality.
 * @property {Set<HTMLSlotElement>} [pendingSlotChanges] Slots whose
 *   assignment changed since the last microtask flush (coalesced slotchange).
 * @property {boolean} [slotChangeScheduled] True while a coalesced
 *   slotchange flush is queued for this host.
 * @property {MutationObserver} [backstop] Sensor for raw direct-child writes
 *   that bypass the patched methods (never moves nodes; folds into `authored`).
 * @property {MutationObserver} [flipSensor] Sensor for `slot=` / `name=`
 *   attribute flips (never moves nodes; re-derives + re-places).
 * @property {Set<Node> | undefined} [pendingRecordNodes] The nodes the
 *   current record op touched (inserted, moved, or removed by an interceptor
 *   / assign() / router splice), consumed by the next apply pass: the resync
 *   step honours record positions for exactly these nodes and adopts
 *   physical order for everything else (node-scoped order authority).
 * @property {boolean} [applying] Re-entrancy latch: true while an apply
 *   pass runs; a nested call flags `reapply` and returns.
 * @property {boolean} [reapply] Set by a nested apply attempt; the outer
 *   pass loops until a full pass completes without it.
 * @property {boolean} [adopted] True when this state was populated by the
 *   ADOPT connect branch (SSR hydration / serialized restore): the host's
 *   pre-first-render children are rendered markup, so the reconnect fold
 *   must not hoover them.
 * @property {WeakMap<Node, string|null>} [adoptedKey] The slot key a
 *   self-heal fold ADOPTED for a node a non-record writer placed inside a
 *   named slot (its own attribute would key it elsewhere); cleared when the
 *   author explicitly changes the node's slot= attribute.
 * @property {Map<HTMLSlotElement, WeakRef<Node>[]>} [manualAssign] Overlay for
 *   `HTMLSlotElement.assign()` manual assignment, keyed by the RECEIVING slot
 *   element (native binds slottables to the element, so a rename follows the
 *   element and duplicates route correctly); nodes held via WeakRef (native
 *   holds manually assigned slottables weakly). A node here goes to its
 *   assigned slot regardless of its `slot=` attribute.
 */
