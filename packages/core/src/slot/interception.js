/**
 * Interception of the native insertion API on a slotted host, so an
 * authored write lands in the authored list rather than the rendered tree.
 *
 * Moved verbatim out of the pre-split `slot.js`; see that barrel for the
 * runtime's full contract.
 *
 * @module
 */
import { applyActualAssignment, isOwnSlot } from './assignment.js';
import { inBrowser } from './polyfills.js';
import { applySlotAssignments } from './project.js';
import { INNER_HTML_DESC, N_append, N_appendChild, N_insertBefore, N_prepend, N_removeChild, N_replaceChild, N_replaceChildren, TEXT_CONTENT_DESC, captureNatives, withRendererWrites } from './sensors.js';
import { ensureSlotState, repartition } from './state.js';
import { FRAMEWORK_DETACHED, INTERCEPTED, LIGHT_SLOT_ATTR, PARK, RENDERING, SLOT_STATE } from './symbols.js';

/**
 * True when `node` is renderer-owned: it is one of the instance's bookend
 * markers (`wjm-s` / `wjm-e`) or sits between them. Object-identity check
 * against the marker refs the instance holds, never comment-text sniffing.
 */
export function instanceOwns(inst, node) {
  if (!inst || !inst.startNode || !inst.endNode) return false;
  if (node === inst.startNode || node === inst.endNode) return true;
  for (let n = inst.startNode.nextSibling; n && n !== inst.endNode; n = n.nextSibling) {
    if (n === node) return true;
  }
  return false;
}

/** The host's hidden park element, created + attached lazily. */
export function parkFor(host) {
  const h = /** @type {any} */ (host);
  let park = h[PARK];
  if (!park || !park.isConnected) {
    if (!park) {
      park = host.ownerDocument.createElement('wj-slot-park');
      park.setAttribute('hidden', '');
      park.style.display = 'none';
      h[PARK] = park;
    }
    // Attach inside the host, after the rendered output, via the native path
    // (never through the patched appendChild).
    withRendererWrites(host, () => N_appendChild.call(host, park));
  }
  return park;
}

/**
 * True for a REAL platform Node from any realm: a same-realm Node passes
 * instanceof; a cross-realm Node passes via its own realm's constructor.
 * KNOWN EDGE: a node from a DISCARDED iframe realm (defaultView null) and
 * any cross-realm DOCUMENT (ownerDocument is null on a Document by spec)
 * fail both arms where native would adopt or HierarchyRequestError:
 * appendChild-shaped calls throw TypeError, and the variadic
 * string-accepting calls stringify to text. Both outcomes are strictly
 * safer than admitting an unverifiable object into the record.
 *
 * @param {any} n
 * @returns {boolean}
 */
function isRealmNode(n) {
  return (
    n instanceof Node ||
    Boolean(
      n &&
        typeof n === 'object' &&
        /** @type {any} */ (n).ownerDocument &&
        /** @type {any} */ (n).ownerDocument.defaultView &&
        n instanceof /** @type {any} */ (n).ownerDocument.defaultView.Node,
    )
  );
}

/**
 * Expand one argument of a DOM insertion call into a flat node list. A
 * DocumentFragment is DRAINED (native contract: the fragment ends empty) and
 * its children returned; a string becomes a Text node when `allowString`
 * (append / prepend / replaceChildren accept strings, appendChild does not).
 *
 * @param {Element} host
 * @param {any} arg
 * @param {boolean} allowString
 * @returns {Node[]}
 */
function expandArg(host, arg, allowString) {
  // WebIDL (Node or DOMString) coercion: append/prepend/replaceChildren
  // stringify ANY argument that is not a real platform Node (a number, null,
  // an object, even a duck-typed fake with a numeric nodeType); native
  // host.append(42) appends the text "42" and host.append({}) appends
  // "[object Object]".
  if (allowString && !isRealmNode(arg)) {
    // A template literal performs exactly ES ToString (ToPrimitive with hint
    // "string": toString before valueOf, and a Symbol THROWS TypeError),
    // matching WebIDL DOMString conversion; '' + x would use hint "default"
    // (valueOf first) and diverge for objects overriding both.
    return [host.ownerDocument.createTextNode(`${/** @type {any} */ (arg)}`)];
  }
  // Non-string path (appendChild / insertBefore / replaceChild): reject any
  // non-platform-node BEFORE the fragment branch, or a duck-typed
  // {nodeType: 11} fake would bypass guardInsertable entirely.
  if (!isRealmNode(arg)) {
    throw new TypeError('Failed to execute insertion on the host: parameter is not of type Node.');
  }
  if (arg && arg.nodeType === 11) {
    const kids = Array.from(arg.childNodes);
    // Guard BEFORE draining: a cycle error must leave the fragment intact
    // (native throws with the fragment untouched).
    guardInsertable(host, kids);
    for (const k of kids) N_removeChild.call(arg, k);
    return kids;
  }
  guardInsertable(host, [/** @type {Node} */ (arg)]);
  return [/** @type {Node} */ (arg)];
}

/**
 * Throw `HierarchyRequestError` (native parity) if any node would create a
 * cycle: the host itself, or an ancestor of the host. Checked BEFORE the record
 * is mutated, so a bad insert leaves `authored` untouched, like native.
 *
 * @param {Element} host
 * @param {Node[]} nodes
 */
function guardInsertable(host, nodes) {
  guardCycle(host, nodes);
  for (const n of nodes) {
    // Node-TYPE validity is DOM pre-insert step 4, AFTER the ref's
    // NotFoundError (step 3): callers run this via expandArg once the ref
    // checks passed. A non-insertable type (an Attr, a Document, a doctype)
    // is a HierarchyRequestError. Realm validity (TypeError for a
    // duck-typed fake, which would otherwise mutate the record and wedge
    // every later apply) is checked by callers BEFORE any DOM step, per
    // WebIDL argument conversion.
    if (!isRealmNode(n)) {
      throw new TypeError('Failed to execute insertion on the host: parameter is not of type Node.');
    }
    const t = n.nodeType;
    if (t !== 1 && t !== 3 && t !== 4 && t !== 7 && t !== 8 && t !== 11) {
      throw new DOMException(
        'Failed to execute insertion on the host: the node type may not be inserted here.',
        'HierarchyRequestError',
      );
    }
  }
}

/**
 * DOM pre-insert step 2, the cycle check: run after ALL WebIDL argument
 * conversions and before the ref's NotFoundError (step 3).
 *
 * @param {Element} host
 * @param {Node[]} nodes
 */
function guardCycle(host, nodes) {
  for (const n of nodes) {
    if (n === host || (n.nodeType === 1 && /** @type {Element} */ (n).contains(host))) {
      throw new DOMException(
        'Failed to execute insertion on the host: the new child contains the parent.',
        'HierarchyRequestError',
      );
    }
  }
}

/**
 * Splice `nodes` into `authored` before `ref` (a node already in authored) or
 * at the end when `ref` is null. Nodes already present are removed from their
 * current position first (native move semantics for a re-inserted child).
 *
 * @param {SlotState} state
 * @param {Node[]} nodes
 * @param {Node | null} ref
 */
function authoredSplice(state, nodes, ref) {
  const a = state.authored;
  for (const n of nodes) {
    const i = a.indexOf(n);
    if (i !== -1) a.splice(i, 1);
  }
  let at = ref == null ? a.length : a.indexOf(ref);
  if (at === -1) at = a.length;
  a.splice(at, 0, ...nodes);
}

/**
 * True when `el` is, or sits inside, an AUTHORED node of this host: such an
 * element is CONTENT (a chunk the author wrote or moved in), never one of
 * the host's own rendered slots, no matter what attributes it carries.
 *
 * Exported for the router's own-slot collection, which must apply the SAME
 * invariant when picking reprojection targets.
 *
 * @param {Element} host
 * @param {Element} el
 * @returns {boolean}
 */
export function isAuthoredContentSlot(host, el) {
  const state = /** @type {SlotState | undefined} */ (
    /** @type {any} */ (host)[SLOT_STATE]
  );
  if (!state) return false;
  return isInsideAuthored(state, host, el);
}

/** @param {SlotState} state @param {Element} host @param {Element} el */
export function isInsideAuthored(state, host, el) {
  for (let p = /** @type {Node | null} */ (el); p && p !== host; p = p.parentNode) {
    if (state.authored.indexOf(p) !== -1) return true;
  }
  return false;
}

/**
 * True when an authored node is still VIRTUALLY a child of the host: it
 * physically sits in one of the host's own slots, the park, or the host
 * itself, or the framework holds it detached as a record value (a rescued
 * closed-slot child). A node the author moved elsewhere out-of-band (into a
 * fragment, another element) is NOT a child anymore even while the record
 * still lists it, and native removeChild / replaceChild / insertBefore-ref
 * answer that with NotFoundError.
 *
 * @param {Element} host
 * @param {Node} node
 * @returns {boolean}
 */
export function isVirtualChild(host, node) {
  if (FRAMEWORK_DETACHED.has(node)) return true;
  const p = node.parentNode;
  if (p == null) return false;
  if (p === host) return true;
  if (p === /** @type {any} */ (host)[PARK]) return true;
  const state = /** @type {SlotState | undefined} */ (
    /** @type {any} */ (host)[SLOT_STATE]
  );
  // lastSnapshot membership proves ownership on its own (a detached forwarded
  // slot's structural isOwnSlot would wrongly veto it); a contained slot still
  // needs isOwnSlot so a foreign torn-down slot is not claimed.
  return (
    p.nodeType === 1 &&
    /** @type {Element} */ (p).tagName === 'SLOT' &&
    /** @type {Element} */ (p).hasAttribute(LIGHT_SLOT_ATTR) &&
    ((state && state.lastSnapshot.has(/** @type {HTMLSlotElement} */ (p))) ||
      (host.contains(p) && isOwnSlot(host, /** @type {Element} */ (p))))
  );
}

/** The empty set handed to resync when no record op is pending. */
export const EMPTY_NODE_SET = new Set();

/**
 * WebIDL for the variadic insertion methods converts EVERY argument before
 * any node is moved: phase 1 validates each argument (a Symbol or fake
 * throws with every fragment still intact), phase 2 drains fragments and
 * builds the flat node list.
 *
 * @param {Element} host
 * @param {any[]} args
 * @returns {Node[]}
 */
function convertVariadicArgs(host, args) {
  // Phase 1 is PURE WebIDL conversion, left to right, with NO DOM validity
  // interleaved: native converts every argument (running ToString side
  // effects, throwing on a Symbol) before any operation-body step, so a
  // later argument's conversion TypeError must preempt an earlier
  // argument's HierarchyRequestError.
  /** @type {Array<{ text?: string, frag?: DocumentFragment, node?: Node }>} */
  const converted = [];
  for (const arg of args) {
    if (!isRealmNode(arg)) {
      converted.push({ text: `${arg}` }); // Symbol throws here, nothing drained
    } else if (arg.nodeType === 11) {
      converted.push({ frag: /** @type {DocumentFragment} */ (arg) });
    } else {
      converted.push({ node: arg });
    }
  }
  // Phase 2: DOM validity for every converted argument, THEN the build.
  for (const c of converted) {
    if (c.frag) guardCycle(host, Array.from(c.frag.childNodes));
    else if (c.node) guardInsertable(host, [c.node]);
  }
  // The build mirrors native's "converting nodes into a node": append each
  // converted item to a SCRATCH fragment in argument order. Appending a
  // plain-node argument detaches it from wherever it currently sits,
  // INCLUDING a later fragment argument, so append(a, fragContaining(a))
  // nets [a, ...fragRest] exactly like native; a repeated Node argument is
  // physically moved, netting keep-LAST order; and the record can never
  // receive a duplicate entry (scratch children are unique by construction).
  // ACCEPTED DIVERGENCE, documented here as its canonical spot: detaching a
  // connected argument fires its [CEReactions] callbacks MID-call, where
  // native defers them to the end of the outer variadic operation (a
  // userland polyfill has no reactions queue). The net DOM converges
  // through the latch + record ops; the one observable divergence is a
  // same-host-mutating disconnect callback racing replaceChildren's
  // wholesale displacement. (Connected variadic arguments also fire their
  // disconnect reactions on detach, matching native's own per-node moves.)
  const scratch = host.ownerDocument.createDocumentFragment();
  for (const c of converted) {
    if (c.text !== undefined) {
      N_appendChild.call(scratch, host.ownerDocument.createTextNode(c.text));
    } else if (c.frag) {
      const kids = Array.from(c.frag.childNodes);
      guardInsertable(host, kids);
      for (const k of kids) N_appendChild.call(scratch, k);
    } else if (c.node) {
      // DEFENSE-IN-DEPTH early throw (the LOAD-BEARING check is the final
      // assembled guard below): a reaction fired by an earlier argument's
      // detach can reparent the HOST into this one; catching it here just
      // surfaces the error before this arg enters the scratch.
      guardCycle(host, [c.node]);
      N_appendChild.call(scratch, c.node);
    }
  }
  const nodes = Array.from(scratch.childNodes);
  // The LOAD-BEARING assembled-validity check (DOM pre-insert runs validity
  // AFTER the conversion step): whatever mid-conversion reactions did,
  // including a LATER argument's reaction poisoning an EARLIER scratch
  // child, the returned list never contains a host-containing node, so the
  // CONVERSION window cannot feed one into the record. (The record-to-
  // placement window is separately shielded by the placement-time skip in
  // applyActualAssignment.)
  guardCycle(host, nodes);
  for (const n of nodes) N_removeChild.call(scratch, n);
  return nodes;
}

/**
 * Commit an authored mutation: record it, re-derive, re-place. `touched`
 * lists the nodes this op inserted, moved, or removed, so the resync step
 * honours the record's position for exactly those nodes (an expressed move)
 * while adopting physical order for everything else.
 *
 * @param {Element} host
 * @param {SlotState} state
 * @param {Node[]} [touched]
 */
function commitAuthored(host, state, touched) {
  // UNION under the latch: a nested record op cannot run its own pass, so
  // its touched set must survive until the outer loop's next iteration; a
  // second nested op must not clobber the first one's order authority.
  if (state.applying && state.pendingRecordNodes) {
    for (const n of touched || []) state.pendingRecordNodes.add(n);
  } else {
    state.pendingRecordNodes = new Set(touched || []);
  }
  // An author record op on a node ends its self-heal adoption: once the
  // author takes over, the node routes by its own attribute again (also
  // covers an attribute change made while the sensors were down).
  if (state.adoptedKey && touched) {
    for (const n of touched) state.adoptedKey.delete(n);
  }
  repartition(state);
  applySlotAssignments(host);
}

/**
 * Install the per-instance interception on a LIGHT-DOM host so native DOM
 * writes drive the slot record. Own data properties / accessors shadow the
 * prototype methods; installed once, never removed (so a mutation while the
 * host is disconnected still updates the record). No-op in shadow DOM.
 *
 * @param {Element} host
 */
export function installSlotInterception(host) {
  if (!inBrowser) return;
  const h = /** @type {any} */ (host);
  if (h[INTERCEPTED]) return;
  captureNatives();
  h[INTERCEPTED] = true;
  const state = ensureSlotState(host);

  h.appendChild = function (node) {
    if (h[RENDERING]) return N_appendChild.call(this, node);
    const nodes = expandArg(host, node, false);
    for (const n of nodes) FRAMEWORK_DETACHED.add(n); // prune-exempt until placed
    authoredSplice(state, nodes, null);
    commitAuthored(host, state, nodes);
    return node;
  };

  h.insertBefore = function (node, ref) {
    if (h[RENDERING]) return N_insertBefore.call(this, node, ref);
    // WebIDL converts arguments LEFT TO RIGHT and DOM pre-insert validity
    // runs the cycle (HierarchyRequestError) step before the ref
    // (NotFoundError) step: validate parameter 1's type and insertability
    // FIRST, without draining a fragment (the drain happens in expandArg
    // only after every validity check passed, so an error leaves the
    // fragment intact like native).
    if (!isRealmNode(node)) {
      throw new TypeError('Failed to execute insertBefore on the host: parameter 1 is not of type Node.');
    }
    if (ref != null && !isRealmNode(ref)) {
      throw new TypeError('Failed to execute insertBefore on the host: parameter 2 is not of type Node.');
    }
    // Both conversions done; now DOM validity in step order (cycle, then the
    // ref's NotFoundError below, then node-type inside expandArg).
    guardCycle(host, node.nodeType === 11 ? Array.from(node.childNodes) : [node]);
    // A non-null ref MUST be an assigned child (native throws NotFoundError
    // otherwise), checked before the self-ref no-op so insertBefore(x, x) on
    // a NON-child still throws like native.
    if (
      ref != null &&
      (state.authored.indexOf(ref) === -1 || !isVirtualChild(host, ref))
    ) {
      throw new DOMException(
        'insertBefore: reference node is not an assigned child of this host',
        'NotFoundError',
      );
    }
    // insertBefore(n, n) with n an existing child is a native no-op.
    if (node === ref) return node;
    const nodes = expandArg(host, node, false);
    for (const n of nodes) FRAMEWORK_DETACHED.add(n); // prune-exempt until placed
    authoredSplice(state, nodes, ref || null);
    commitAuthored(host, state, nodes);
    return node;
  };

  h.removeChild = function (node) {
    if (h[RENDERING]) return N_removeChild.call(this, node);
    const i = state.authored.indexOf(node);
    if (i === -1) return N_removeChild.call(this, node);
    // Record-listed but physically moved elsewhere out-of-band: native
    // answers "not a child" (the record heals on the next apply).
    if (!isVirtualChild(host, node)) {
      throw new DOMException(
        'removeChild: the node is not an assigned child of this host',
        'NotFoundError',
      );
    }
    state.authored.splice(i, 1);
    commitAuthored(host, state, [node]);
    return node;
  };

  h.replaceChild = function (newNode, oldNode) {
    if (h[RENDERING]) return N_replaceChild.call(this, newNode, oldNode);
    const i = state.authored.indexOf(oldNode);
    if (i === -1) return N_replaceChild.call(this, newNode, oldNode);
    // WebIDL converts parameters left to right and the cycle check precedes
    // the NotFound check: validate parameter 1 first, without draining.
    if (!isRealmNode(newNode)) {
      throw new TypeError('Failed to execute replaceChild on the host: parameter 1 is not of type Node.');
    }
    guardCycle(host, newNode.nodeType === 11 ? Array.from(newNode.childNodes) : [newNode]);
    if (!isVirtualChild(host, oldNode)) {
      throw new DOMException(
        'replaceChild: the node to be replaced is not an assigned child of this host',
        'NotFoundError',
      );
    }
    if (newNode === oldNode) return oldNode; // native no-op
    const nodes = expandArg(host, newNode, false); // guards cycle before draining
    for (const n of nodes) FRAMEWORK_DETACHED.add(n); // prune-exempt until placed
    // Remove any incoming node already authored (so it MOVES to the new slot),
    // but never oldNode itself: it is the replacement target, so skipping it
    // keeps `at` valid even for the pathological replaceChild(fragmentWithOld,
    // old) input, avoiding a splice(-1) that would corrupt an unrelated sibling.
    for (const n of nodes) {
      if (n === oldNode) continue;
      const j = state.authored.indexOf(n);
      if (j !== -1) state.authored.splice(j, 1);
    }
    const at = state.authored.indexOf(oldNode);
    state.authored.splice(at, 1, ...nodes);
    commitAuthored(host, state, [...nodes, oldNode]);
    return oldNode;
  };

  h.append = function (...args) {
    if (h[RENDERING]) return N_append.apply(this, args);
    const nodes = convertVariadicArgs(host, args);
    for (const n of nodes) FRAMEWORK_DETACHED.add(n); // prune-exempt until placed
    authoredSplice(state, nodes, null);
    commitAuthored(host, state, nodes);
  };

  h.prepend = function (...args) {
    if (h[RENDERING]) return N_prepend.apply(this, args);
    const nodes = convertVariadicArgs(host, args);
    for (const n of nodes) FRAMEWORK_DETACHED.add(n); // prune-exempt until placed
    // Remove any incoming node from its current position, then insert at the
    // FRONT via unshift. Passing `authored[0]` as an authoredSplice ref would be
    // wrong, because that ref is captured before the incoming-removal, so
    // prepending the current first child loses the ref and appends at the end.
    for (const n of nodes) {
      const j = state.authored.indexOf(n);
      if (j !== -1) state.authored.splice(j, 1);
    }
    state.authored.unshift(...nodes);
    commitAuthored(host, state, nodes);
  };

  h.replaceChildren = function (...args) {
    if (h[RENDERING]) return N_replaceChildren.apply(this, args);
    const nodes = convertVariadicArgs(host, args);
    for (const n of nodes) FRAMEWORK_DETACHED.add(n); // prune-exempt until placed
    const displaced = state.authored;
    state.authored = nodes.slice();
    commitAuthored(host, state, [...displaced, ...nodes]);
  };

  Object.defineProperty(h, 'innerHTML', {
    configurable: true,
    get() {
      return INNER_HTML_DESC.get.call(this);
    },
    set(str) {
      if (h[RENDERING]) {
        INNER_HTML_DESC.set.call(this, str);
        return;
      }
      // Parse in a DIV (the "in body" fragment context a custom-element host
      // gets natively): a <template> retains table-section tokens (<td>,
      // <tr>) that the real host context drops to text.
      const tmp = host.ownerDocument.createElement('div');
      // innerHTML IS [LegacyNullToEmptyString]: null maps to the empty
      // string (the common clear idiom must clear, not insert the text
      // "null"); undefined stringifies; a Symbol throws (ToString).
      INNER_HTML_DESC.set.call(tmp, str === null ? '' : `${str}`);
      const nodes = Array.from(tmp.childNodes);
      for (const n of nodes) FRAMEWORK_DETACHED.add(n); // prune-exempt until placed
      const displaced = state.authored;
      state.authored = nodes;
      commitAuthored(host, state, [...displaced, ...nodes]);
    },
  });

  Object.defineProperty(h, 'textContent', {
    configurable: true,
    get() {
      return TEXT_CONTENT_DESC.get.call(this);
    },
    set(str) {
      if (h[RENDERING]) {
        TEXT_CONTENT_DESC.set.call(this, str);
        return;
      }
      // Node.textContent is a NULLABLE DOMString? (LegacyNullToEmptyString
      // belongs to innerHTML, not here): WebIDL converts undefined to null
      // for nullable types, so BOTH null and undefined EMPTY, verified
      // against all three engines. A Symbol still throws (ToString).
      const nodes =
        str == null || str === ''
          ? []
          : [host.ownerDocument.createTextNode(`${str}`)];
      for (const n of nodes) FRAMEWORK_DETACHED.add(n); // prune-exempt until placed
      const displaced = state.authored;
      state.authored = nodes;
      commitAuthored(host, state, [...displaced, ...nodes]);
    },
  });
}

// ---------------------------------------------------------------------------
// Render-owned slot application
// ---------------------------------------------------------------------------
