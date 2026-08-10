/**
 * Client router: dom-differ.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { LIGHT_SLOT_ATTR, PROJECTION_ACTUAL, PROJECTION_ATTR, SLOT_STATE, isAuthoredContentSlot, keyOfName, projectAuthored } from '../slot.js';
import { collectBoundaries } from './boundaries.js';
import { LIVE_ATTRS } from './constants.js';
import { fetchAndApply } from './fetch-apply.js';
import { buildHaveHeader, navigate } from './navigator.js';
import { prefetch, prefetchTake } from './prefetch.js';
import { currentNavigationToken } from './state.js';
import { activateSwappedRange } from './upgrade.js';
import { regraftPermanentInSlice } from './view-transition.js';

/**
 * After a swap, blur whatever element the user activated to trigger the
 * navigation (the clicked sidenav link, the submitted form button, etc.).
 *
 * Why: browsers paint `:focus-visible` rings when the window regains
 * focus on whatever has focus at that moment. A click leaves focus on
 * the clicked element, so without this blur the user sees a stuck focus
 * ring on the sidenav link every time they switch workspaces and come
 * back: even though they navigated minutes ago.
 *
 * We do NOT programmatically move focus to the new page's h1/h2.
 * That'd just relocate the same problem (focus ring on the heading
 * after a workspace switch) and steals focus from sighted users.
 * Screen-reader users navigate by heading via their own shortcuts
 * (`h` in NVDA/JAWS), so they don't need us to do it for them.
 *
 * No-op when focus is on `<body>` (browser default after `removeChild`
 * of a focused node) or when the active element survived the swap and
 * was inside the new content (means the swap was internal to a region
 * the user was already interacting with: don't fight them).
 */
export function blurOutgoingFocus() {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return;
  if (typeof (/** @type any */ (a).blur) !== 'function') return;
  /** @type any */ (a).blur();
}

/**
 * Wholesale-REPLACE the contents of a boundary range (#1015): remove every
 * live node between `target.start` and `target.end` (exclusive) and insert a
 * fresh import of the incoming range. This is the REMOUNT tier: the boundary's
 * route-key changed (a param change, or a different page under a shared static
 * layout), so Next.js parity demands fresh component instances, not a keyed
 * reuse of old-page DOM. The only nodes that survive by identity are
 * `data-webjs-permanent` elements, regrafted into the imported slice before
 * insertion so a playing `<audio>`/widget keeps running.
 *
 * @param {{ start: Comment, end: Comment }} target  The live boundary.
 * @param {{ start: Comment, end: Comment }} source  The incoming boundary.
 */
export function replaceBoundaryRange(target, source) {
  const liveParent = target.start.parentNode;
  if (!liveParent) return;
  /** @type {Node[]} */
  const liveSlice = [];
  for (let n = target.start.nextSibling; n && n !== target.end; n = n.nextSibling) {
    liveSlice.push(n);
  }
  /** @type {Node[]} */
  const incomingSlice = [];
  for (let n = source.start.nextSibling; n && n !== source.end; n = n.nextSibling) {
    incomingSlice.push(document.importNode(n, true));
  }
  regraftPermanentInSlice(liveSlice, incomingSlice);
  for (const n of liveSlice) {
    if (n.parentNode === liveParent) liveParent.removeChild(n);
  }
  for (const n of incomingSlice) {
    liveParent.insertBefore(n, target.end);
  }
  activateSwappedRange(target);
}

/**
 * MORPH the contents of a boundary range (#1015): reconcile the nodes between
 * `target.start` and `target.end` (exclusive) in the live document against the
 * nodes between `source.start` and `source.end` in the parsed Document, using
 * a keyed reconciler that preserves DOM identity for matched elements + their
 * live attributes (scroll, value, etc.). This is the state-preserving tier for
 * a searchParams-only / refresh nav, where the route-key is unchanged and
 * hydrated component state must survive.
 *
 * Boundaries are strictly paired by the scanner (#1015), so `end` is always a
 * real close comment here (the null-orphan tolerance of the deleted #994
 * recovery is gone with it).
 *
 * @param {{ start: Comment, end: Comment } | undefined} target
 * @param {{ start: Comment, end: Comment } | undefined} source
 * @param {Document} _doc
 */
export function swapMarkerRange(target, source, _doc) {
  if (!target || !source) return;

  // Build a parent-with-matching-children pair for the keyed differ.
  // The differ wants two parents: synthesize a transient parent for
  // the slice of `source` so we can diff in-place against `target.start`
  // / `target.end` siblings on the live document.
  const liveParent = target.start.parentNode;
  if (!liveParent) return;

  // Collect current children (nodes between start and end, exclusive).
  /** @type {Node[]} */
  const liveSlice = [];
  for (let n = target.start.nextSibling; n && n !== target.end; n = n.nextSibling) {
    liveSlice.push(n);
  }

  // Collect incoming children, importing into the live document.
  /** @type {Node[]} */
  const incomingSlice = [];
  for (let n = source.start.nextSibling; n && n !== source.end; n = n.nextSibling) {
    incomingSlice.push(document.importNode(n, true));
  }

  // Persist permanent elements by node identity: regraft each live
  // [data-webjs-permanent][id] node into the matching position in the
  // imported incoming slice, replacing the freshly-imported copy, so the
  // keyed reconciler adopts the live node instead of destroying it.
  regraftPermanentInSlice(liveSlice, incomingSlice);

  // Run the keyed diff.
  reconcileSiblings(liveParent, target.start, target.end, liveSlice, incomingSlice);

  // Upgrade + activate scripts in the just-swapped range. A top-level script
  // here is usually one the keyed reconciler REUSED (`keyOf` reads
  // `data-key || id`), so it re-executes on every soft nav that morphs this
  // boundary. That is deliberate: a descendant script inside a reused
  // container has always re-run through this same pass, and a script's
  // position in the range is not a reason to treat it differently (#1102).
  activateSwappedRange(target);
}

/**
 * Coarse keyed reconciliation between liveSlice and incomingSlice,
 * positioned in liveParent between `startMarker` and `endMarker`.
 *
 * Algorithm (Remix v3 inspired, pared down):
 *   - Match elements by (tagName + key) where key = data-key || id.
 *   - For each pair: diff attributes, recurse into children.
 *   - Unmatched live elements: remove.
 *   - Unmatched incoming elements: insert in the right slot.
 *   - Live attributes (value, checked, open, scroll-position) are
 *     preserved on matched elements regardless of server HTML.
 *
 * This is intentionally simple: when no keys are present, the diff
 * matches by position only and falls back to replaceChildren-like
 * semantics for the unkeyed range. Apps that want stronger
 * preservation add `data-key` to elements they care about.
 *
 * @param {Node} parent
 * @param {Comment} startMarker
 * @param {Comment | null} endMarker  Null (recovered orphan, #994) appends at the parent end.
 * @param {Node[]} live
 * @param {Node[]} incoming
 */
export function reconcileSiblings(parent, startMarker, endMarker, live, incoming) {
  // Index live elements by (tag + key) for keyed match.
  /** @type {Map<string, Element>} */
  const keyedLive = new Map();
  for (const n of live) {
    if (n.nodeType !== 1) continue;
    const k = keyOf(/** @type {Element} */ (n));
    if (k) keyedLive.set(k, /** @type {Element} */ (n));
  }

  // Walk incoming, placing nodes in order between markers.
  /** @type {Node} */
  let insertBefore = endMarker;
  // First pass: build the final ordered list of nodes (reusing matched live).
  /** @type {Node[]} */
  const finalNodes = [];
  for (const inc of incoming) {
    if (inc.nodeType === 1) {
      const k = keyOf(/** @type {Element} */ (inc));
      if (k && keyedLive.has(k)) {
        const reused = keyedLive.get(k);
        diffElementInPlace(reused, /** @type {Element} */ (inc));
        finalNodes.push(reused);
        keyedLive.delete(k);
        continue;
      }
    }
    finalNodes.push(inc);
  }

  // Remove live nodes that weren't reused.
  for (const n of live) {
    if (n.parentNode === parent) {
      if (n.nodeType === 1 && finalNodes.includes(n)) continue;
      parent.removeChild(n);
    }
  }

  // Insert final nodes in order before the end marker.
  for (const n of finalNodes) {
    parent.insertBefore(n, insertBefore);
  }
}

/**
 * Diff one matched element in place: copy attributes from `src` to `dst`,
 * preserve live attributes, recurse into children.
 *
 * @param {Element} dst  The element to update (live DOM).
 * @param {Element} src  The element to copy from (incoming HTML).
 */
export function diffElementInPlace(dst, src) {
  // A regrafted `data-webjs-permanent` node is the SAME node on both
  // sides (the live node was moved into the incoming tree). Diffing it
  // against itself would recurse into its own children and re-import
  // them; instead leave it exactly as the user left it (that is the whole
  // point of permanence).
  if (dst === src) return;
  if (dst.tagName !== src.tagName) {
    dst.replaceWith(src);
    return;
  }
  // Update attributes from src; remove ones not in src.
  const srcAttrs = new Set();
  for (const attr of src.attributes) {
    srcAttrs.add(attr.name);
    if (LIVE_ATTRS.has(attr.name)) continue;
    // The serialized-restore stamp is a message to a NOT-YET-UPGRADED
    // element's connectedCallback; copying it onto a live reused host would
    // leave a consume-once marker lingering in the live DOM forever. Note
    // the REMOVAL loop below never strips an existing stamp either (the
    // stamp is in srcAttrs, added before this skip) and that retention is
    // load-bearing: a not-yet-upgraded `static lazy` host must KEEP its
    // stamp across an intervening morph so its late upgrade still adopts.
    if (attr.name === 'data-wj-serialized') continue;
    if (dst.getAttribute(attr.name) !== attr.value) {
      dst.setAttribute(attr.name, attr.value);
    }
  }
  for (const attr of [...dst.attributes]) {
    if (LIVE_ATTRS.has(attr.name)) continue;
    if (!srcAttrs.has(attr.name)) dst.removeAttribute(attr.name);
  }
  // For form-control-like elements, preserve live IDL state.
  // (`value`, `checked`, `open`, etc.: see LIVE_ATTRS below for full list.)
  // The attribute version is skipped above; we deliberately do nothing
  // here so the user's typing / checking is never blown away.

  // A hydrated component OWNS its rendered subtree. The client renderer
  // stashes the live template instance (lit-html parts holding DIRECT
  // references to the rendered nodes) on the host under
  // `Symbol.for('webjs.instance')`. Recursing into those children would
  // import/remove/reorder the very nodes the parts still point at, so the
  // component's next reactive update would write into detached nodes and
  // silently do nothing (a dead click after a soft nav, #906). Treat the
  // component as opaque: the attribute sync above already drove any reactive
  // property change through `attributeChangedCallback`, so the component
  // re-renders ITSELF; the router must not touch its internals. This mirrors
  // Turbo/morphdom, which leave custom elements alone by default.
  //
  // One carve-out (#908): a light-DOM component's projected <slot> content is
  // page-authored (moved into the slot by the slot runtime), NOT render-owned,
  // so a reused component would otherwise keep showing STALE slotted content
  // when the nav supplies different content. Re-project ONLY those slot
  // children; the render-owned nodes stay untouched, so #906 does not regress.
  if (isHydratedComponent(dst)) {
    reprojectSlottedContent(dst, src);
    return;
  }

  // Recurse into children: collect both sides, run reconcileSiblings on
  // them with synthetic boundary markers. Cheap implementation: use
  // virtual ranges instead of inserting real comment markers.
  reconcileChildren(dst, src);
}

/**
 * True when `el` carries a live client-side render instance, i.e. a webjs
 * component whose `render()` produced the current children and owns them via
 * lit-html parts. The router must not reconcile INTO such an element (#906).
 *
 * Detected via the render-client instance symbol rather than a `customElements`
 * lookup so it fires only for elements that have actually rendered client-side:
 * a not-yet-upgraded or purely display-only custom element (no client render,
 * no parts to corrupt) stays fully reconcilable.
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isHydratedComponent(el) {
  // Opaque to the router when it has rendered (INSTANCE) OR merely has slot
  // state installed but has not yet run its deferred first render (SLOT_STATE):
  // in that window a same-task morph would otherwise reconcile INTO the host
  // through the slot interception.
  const a = /** @type {any} */ (el);
  return a[Symbol.for('webjs.instance')] != null || a[SLOT_STATE] != null;
}

/**
 * True when `slot` belongs directly to `host`, i.e. no OTHER custom element
 * sits between them. A slot nested inside a child custom element belongs to
 * THAT component (its own slot state owns it), so the host must not touch it.
 *
 * @param {Element} slot
 * @param {Element} host
 * @returns {boolean}
 */
function isOwnLightSlot(slot, host) {
  for (let p = slot.parentElement; p && p !== host; p = p.parentElement) {
    if (p.tagName.includes('-')) return false;
  }
  return true;
}

/**
 * Group a component's own `data-projection="actual"` light slots by name,
 * first-wins (mirroring the slot runtime + SSR first-wins rule). Slots nested
 * inside a child custom element are excluded (they belong to that child).
 *
 * @param {Element} host
 * @returns {Map<string|null, HTMLSlotElement>}
 */
function ownActualLightSlots(host) {
  /** @type {Map<string|null, HTMLSlotElement>} */
  const byName = new Map();
  const sel = `slot[${LIGHT_SLOT_ATTR}][${PROJECTION_ATTR}="${PROJECTION_ACTUAL}"]`;
  for (const slot of host.querySelectorAll(sel)) {
    const s = /** @type {HTMLSlotElement} */ (slot);
    if (!isOwnLightSlot(s, host)) continue;
    // The runtime's invariant applies here too: a slot inside AUTHORED
    // content (an author-relocated rendered chunk, a spoofed stamp) is
    // inert content, never a reprojection target; collecting it would
    // project into (or evict from) a slot the apply refuses to place.
    if (isAuthoredContentSlot(host, s)) continue;
    // Src-side (parsed doc) hosts have no record, so the authored test is
    // inert there; the SERIALIZED shape of content is structural instead: a
    // slot nested inside an ACTUAL-mode light slot of the same host is
    // content (an SSR'd forwarded slot rides inside the inner host's own
    // actual slot), never a reprojection target. A slot inside a
    // FALLBACK-mode container stays collectable: fallback content is
    // template markup, and a slot there is legitimate.
    let nestedInActual = false;
    for (let a = s.parentElement; a && a !== host; a = a.parentElement) {
      if (
        a.tagName === 'SLOT' &&
        a.hasAttribute(LIGHT_SLOT_ATTR) &&
        a.getAttribute(PROJECTION_ATTR) === PROJECTION_ACTUAL
      ) {
        nestedInActual = true;
        break;
      }
    }
    if (nestedInActual) continue;
    const name = keyOfName(s.getAttribute('name'));
    if (!byName.has(name)) byName.set(name, s);
  }
  return byName;
}

/**
 * Re-project the page-authored slotted content of a REUSED hydrated light-DOM
 * component across a soft nav (#908), without touching its render-owned
 * subtree.
 *
 * The #906 guard treats a hydrated component as opaque so the router never
 * corrupts its lit-html-owned nodes. But the projected children inside a
 * light-DOM `<slot data-webjs-light data-projection="actual">` are
 * page-authored (moved there by the slot runtime), NOT held by lit-html parts,
 * so reconciling ONLY those children is safe and cannot reintroduce #906. Both
 * the live DOM and the incoming SSR HTML carry the same slot markers
 * (render-server emits them), so slots pair up by name + document order.
 *
 * Three cases, by how a slot's projection state changes across the nav:
 *   - actual->actual (content changed): identity-preserving `reconcileChildren`
 *     on the page-authored slot children, exactly as #908 shipped.
 *   - actual->fallback (content REMOVED) and fallback->actual (content ADDED):
 *     a slot's fallback is RENDER-OWNED (the compiled fallback template held by
 *     the slot-part), so these are NOT a raw reconcile. All three cases route
 *     through `projectAuthored`, the record seam, whose apply pass restores or
 *     swaps the render-owned fallback without reconciling any lit-html part
 *     (#912). The #906 one-level-down hazard (this component's assignment
 *     reaching a nested child's same-named slot) is answered by the apply
 *     pass's own-slot filtering (`isOwnSlot` + the authored-content
 *     exclusion), not by surgical single-slot application.
 *
 * @param {Element} dst  Live hydrated component host.
 * @param {Element} src  Incoming SSR copy of the same component.
 */
/**
 * After a boundary swap, if the swapped range's parent is a light-DOM slot,
 * resync the owning host's slot record from the slot's REAL children through
 * the one public seam (`projectAuthored`). The router's raw range write is the
 * one sanctioned write into a region the slot runtime also places (a layout's
 * `${children}` rendered inside a slotted shell puts the `wj:children` markers
 * INSIDE that shell's slot), so without this sync the record goes stale and
 * the host's next apply would wipe the swapped-in page content and restore the
 * pruned old list. Walking up from the slot, the owner is the nearest
 * `SLOT_STATE` host with no other custom element in between; anything else
 * (a nested stateless component, a shadow slot) bails.
 *
 * @param {Comment} startMarker
 */
function resyncEnclosingSlotRecord(startMarker) {
  const p = startMarker.parentNode;
  if (!p || p.nodeType !== 1) return;
  const slotEl = /** @type {Element} */ (p);
  if (slotEl.tagName !== 'SLOT' || !slotEl.hasAttribute(LIGHT_SLOT_ATTR)) return;
  let host = null;
  for (let a = slotEl.parentElement; a; a = a.parentElement) {
    if (/** @type {any} */ (a)[SLOT_STATE]) { host = a; break; }
    if (a.tagName.includes('-')) return; // belongs to a stateless nested element
  }
  if (!host) return;
  projectAuthored(host, keyOfName(slotEl.getAttribute('name')), [...slotEl.childNodes]);
}

/**
 * Resync the ENCLOSING HOST's slots after a boundary swap whose markers live
 * inside a light-DOM slot (a layout whose `${children}` render inside a
 * slotted shell). The boundary swap only rewrites the DEFAULT slice (the
 * `wj:children` markers always partition to the default slot), so a page that
 * emits top-level `slot=`-attributed children left the shell's NAMED slots
 * showing the previous page's content (#1024). This resyncs the enclosing
 * (default) slot from its just-swapped LIVE children, then reprojects the
 * sibling NAMED slots from the INCOMING parsed host.
 *
 * @param {Comment} liveStart
 * @param {Comment} incStart
 */
export function resyncEnclosingHostSlots(liveStart, incStart) {
  const lp = liveStart.parentNode;
  if (!lp || lp.nodeType !== 1) return;
  const liveSlot = /** @type {Element} */ (lp);
  if (liveSlot.tagName !== 'SLOT' || !liveSlot.hasAttribute(LIGHT_SLOT_ATTR)) return;
  let liveHost = null;
  for (let a = liveSlot.parentElement; a; a = a.parentElement) {
    if (/** @type {any} */ (a)[SLOT_STATE]) { liveHost = a; break; }
    if (a.tagName.includes('-')) return; // enclosing slot belongs to a stateless nested element
  }
  if (!liveHost) return;
  const enclosingName = keyOfName(liveSlot.getAttribute('name'));
  // 1. The enclosing (boundary) slot, from its own just-swapped live children.
  projectAuthored(liveHost, enclosingName, [...liveSlot.childNodes]);

  // 2. The sibling NAMED slots, from the incoming parsed host. Find the
  //    incoming host structurally (the parsed copy is not upgraded, so no
  //    SLOT_STATE): the nearest custom-element ancestor of the incoming
  //    boundary marker's enclosing slot.
  const ip = incStart.parentNode;
  if (!ip || ip.nodeType !== 1) return;
  const incSlot = /** @type {Element} */ (ip);
  if (incSlot.tagName !== 'SLOT') return;
  let incHost = null;
  for (let a = incSlot.parentElement; a; a = a.parentElement) {
    if (a.tagName.includes('-')) { incHost = a; break; }
  }
  if (!incHost || incHost.tagName !== liveHost.tagName) return;

  const liveSlots = ownActualLightSlots(liveHost);
  const incSlots = ownActualLightSlots(incHost);
  for (const name of new Set([...liveSlots.keys(), ...incSlots.keys()])) {
    if (name === enclosingName) continue; // handled in (1); never re-reconcile the swapped range
    const inc = incSlots.get(name);
    if (inc) {
      projectAuthored(
        liveHost,
        name,
        [...inc.childNodes].map((n) => document.importNode(n, true)),
      );
    } else if (liveSlots.get(name)) {
      projectAuthored(liveHost, name, null); // dropped by the incoming page: revert to fallback
    }
  }
}

function reprojectSlottedContent(dst, src) {
  // Only a light-DOM component that tracks slot assignments has placed
  // page-authored content to update. No slot state (no <slot>, or a shadow-DOM
  // component whose slotted nodes are ordinary light children) means nothing
  // to update here.
  if (!(/** @type {any} */ (dst)[SLOT_STATE])) return;

  const liveSlots = ownActualLightSlots(dst);
  const incSlots = ownActualLightSlots(src);
  if (liveSlots.size === 0 && incSlots.size === 0) return;

  // #1015: slotted children are VALUES pushed through the ONE public seam,
  // projectAuthored (no cross-module state surgery; the slot runtime owns the
  // record, fires slotchange on a genuine set change, and re-applies). The
  // union walk covers boundary transitions (a name present on only one side).
  const names = new Set([...liveSlots.keys(), ...incSlots.keys()]);
  for (const name of names) {
    const liveSlot = liveSlots.get(name);
    const incSlot = incSlots.get(name);
    if (liveSlot && incSlot) {
      // actual->actual: reconcile IN PLACE first so page-authored slotted
      // nodes keep DOM identity where they match (#908: a nested live
      // component survives; an in-place text edit reuses the same node),
      // then push the resulting set through the public API. The runtime's
      // set-equality check makes slotchange fire exactly on an
      // add/remove/replace and stay silent on a pure text edit (#912).
      reconcileChildren(liveSlot, incSlot);
      projectAuthored(dst, name, [...liveSlot.childNodes]);
    } else if (incSlot) {
      // fallback->actual: incoming ADDED content. Import and push.
      projectAuthored(dst, name, [...incSlot.childNodes].map((n) => document.importNode(n, true)));
    } else {
      // actual->fallback: incoming DROPPED the content. Reset to fallback.
      projectAuthored(dst, name, null);
    }
  }
}

/**
 * Reconcile dst's children to match src's children, in-place.
 *
 * @param {Element} dst
 * @param {Element} src
 */
export function reconcileChildren(dst, src) {
  const liveChildren = [...dst.childNodes];
  const incomingChildren = [...src.childNodes].map((n) => document.importNode(n, true));

  // Persist `data-webjs-permanent` elements by node identity: regraft each
  // live permanent node into the matching position in the freshly-imported
  // incoming children (replacing the imported copy), so the keyed match
  // below adopts the LIVE node and the reconciler never recreates it. This
  // is the in-region (frame + nested) counterpart of the full-body and
  // marker-range regrafts; running it here covers permanents nested below
  // the top keyed level too.
  regraftPermanentInSlice(liveChildren, incomingChildren);

  // Build keyed map of live children for reuse.
  /** @type {Map<string, Element>} */
  const keyedLive = new Map();
  for (const n of liveChildren) {
    if (n.nodeType !== 1) continue;
    const k = keyOf(/** @type {Element} */ (n));
    if (k) keyedLive.set(k, /** @type {Element} */ (n));
  }

  /** @type {Node[]} */
  const finalNodes = [];
  for (let i = 0; i < incomingChildren.length; i++) {
    const inc = incomingChildren[i];
    if (inc.nodeType === 1) {
      const k = keyOf(/** @type {Element} */ (inc));
      if (k && keyedLive.has(k)) {
        const reused = keyedLive.get(k);
        diffElementInPlace(reused, /** @type {Element} */ (inc));
        finalNodes.push(reused);
        keyedLive.delete(k);
        continue;
      }
      // Positional match: same tag, same index, neither has a key.
      const livePeer = liveChildren[i];
      if (livePeer && livePeer.nodeType === 1 &&
          !keyOf(/** @type {Element} */ (livePeer)) &&
          /** @type {Element} */ (livePeer).tagName === /** @type {Element} */ (inc).tagName) {
        diffElementInPlace(/** @type {Element} */ (livePeer), /** @type {Element} */ (inc));
        finalNodes.push(livePeer);
        continue;
      }
    } else if (inc.nodeType === 3) {
      // Text node: positional reuse for stable identity.
      const livePeer = liveChildren[i];
      if (livePeer && livePeer.nodeType === 3) {
        if (livePeer.nodeValue !== inc.nodeValue) livePeer.nodeValue = inc.nodeValue;
        finalNodes.push(livePeer);
        continue;
      }
    } else if (inc.nodeType === 8) {
      // Comment: positional reuse.
      const livePeer = liveChildren[i];
      if (livePeer && livePeer.nodeType === 8) {
        if (livePeer.nodeValue !== inc.nodeValue) livePeer.nodeValue = inc.nodeValue;
        finalNodes.push(livePeer);
        continue;
      }
    }
    finalNodes.push(inc);
  }

  // Mutate dst to contain finalNodes in order, preserving reused references.
  // Walk forward, inserting each node before the (potentially moved) next sibling.
  const finalSet = new Set(finalNodes);
  for (const n of liveChildren) {
    if (!finalSet.has(n) && n.parentNode === dst) dst.removeChild(n);
  }
  for (let i = 0; i < finalNodes.length; i++) {
    const n = finalNodes[i];
    if (n.parentNode !== dst || dst.childNodes[i] !== n) {
      dst.insertBefore(n, dst.childNodes[i] || null);
    }
  }
}

/**
 * Get the diff key for an element: `data-key` if present, else `id`.
 * Returns null for elements with no stable key.
 *
 * @param {Element} el
 * @returns {string | null}
 */
export function keyOf(el) {
  const k = el.getAttribute('data-key');
  if (k) return `${el.tagName}:k:${k}`;
  if (el.id) return `${el.tagName}:i:${el.id}`;
  return null;
}

/**
 * Look for `<template id="wj-loading:<deepest-current-path>">` in the
 * document; if present, clone its content into the deepest current
 * children-slot. Returns state needed to restore on fetch failure.
 *
 * The returned state carries the nav-token in effect at swap time;
 * `restoreOptimistic` verifies the token still matches before reverting,
 * so a slow nav A's late failure cannot revert a faster nav B's
 * already-settled state.
 *
 * @returns {{ slot: { start: Comment, end: Comment }, oldChildren: Node[], token: number } | null}
 */
export function applyOptimisticLoading() {
  const slots = collectBoundaries(document.body);
  if (!slots || slots.size === 0) return null;
  // Walk boundaries deepest-first and use the first whose segment has a
  // loading template. Loading templates are keyed by LAYOUT segment
  // (loading.ts files live next to layouts), while the deepest boundary is
  // usually the PAGE's own (#1015), which has no template: skipping over it
  // finds the innermost layout skeleton, matching the pre-#1015 behaviour.
  const bySegment = [...slots.keys()].sort((a, b) => b.length - a.length);
  let deepest = null;
  let tpl = null;
  for (const p of bySegment) {
    const t = document.getElementById(`wj-loading:${p}`);
    if (t instanceof HTMLTemplateElement) { deepest = p; tpl = t; break; }
  }
  if (deepest === null || tpl === null) return null;

  const slot = slots.get(deepest);
  // Snapshot the boundary keys BEFORE the skeleton wipes them (#1114). The
  // range below deletes everything between this slot's markers, which includes
  // every NESTED boundary comment, so `buildHaveHeader()` afterwards is
  // legitimately shorter than the page really is. `prefetchTake` validates a
  // cached fragment's anchor against the live boundaries, and without this it
  // would judge against the skeleton's truncated view: on an app whose only
  // loading.{js,ts} sits at the root, every deeper anchor vanishes and NO
  // prefetch is ever consumable. Carried on the state that already threads to
  // fetchAndApply, so nothing new has to be plumbed.
  const haveKeys = buildHaveHeader();
  /** @type {Node[]} */
  const oldChildren = [];
  for (let n = slot.start.nextSibling; n && n !== slot.end; n = n.nextSibling) {
    oldChildren.push(n);
  }
  // Replace slot contents with the loading template.
  const range = document.createRange();
  range.setStartAfter(slot.start);
  range.setEndBefore(slot.end);
  range.deleteContents();
  slot.start.parentNode.insertBefore(tpl.content.cloneNode(true), slot.end);
  return { slot, oldChildren, token: currentNavigationToken, haveKeys };
}

/** @param {{ slot: { start: Comment, end: Comment }, oldChildren: Node[], token: number, haveKeys?: string } | null} state */
export function restoreOptimistic(state) {
  if (!state) return;
  // A newer nav superseded the one that captured this state: don't
  // revert; that newer nav owns the page now.
  if (state.token !== currentNavigationToken) return;
  const { slot, oldChildren } = state;
  if (slot.start.parentNode !== slot.end.parentNode) return;
  const range = document.createRange();
  range.setStartAfter(slot.start);
  range.setEndBefore(slot.end);
  range.deleteContents();
  for (const n of oldChildren) slot.start.parentNode.insertBefore(n, slot.end);
}

/* ====================================================================
 * Diff helper for the webjs-frame escape hatch
 * ==================================================================== */

/**
 * Diff children of two elements (used by the webjs-frame swap path).
 *
 * @param {Element} dst
 * @param {Element} src
 */
export function diffChildren(dst, src) {
  reconcileChildren(dst, src);
}

/* ====================================================================
 * Head merge
 * ==================================================================== */

/**
 * Add-only head merge for partial (marker + frame) swaps. Updates the
 * title and adds new elements (modulepreloads, scripts) without
 * removing existing ones: runtime-generated content like Tailwind's
 * injected CSS must survive across navigations that keep the outer
 * layout mounted.
 *
 * @param {HTMLHeadElement} newHead
 */
