/**
 * Client router: view-transition.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */

/**
 * Whether the current page opts into the native View Transitions API for
 * client-router swaps. OFF by default (no animation surprise, no
 * regression for browsers without the API): a transition is purely
 * opt-in via a `<meta name="view-transition" content="same-origin">` in
 * the document head, mirroring Turbo's `<meta name="view-transition">`
 * convention. The accepted opt-in value is `same-origin` (every
 * client-router swap is same-origin by construction, so it reads as "yes,
 * animate these in-app navigations"). Any other value, or the meta being
 * absent, keeps transitions off.
 *
 * Re-read per navigation rather than cached: the meta can be added or
 * removed by a swap (the head merge brings in the new page's head), so a
 * page can turn transitions on or off as the user navigates.
 *
 * @returns {boolean}
 */
export function viewTransitionsEnabled() {
  if (typeof document === 'undefined') return false;
  const meta = document.querySelector('meta[name="view-transition"]');
  if (!meta) return false;
  const content = (meta.getAttribute('content') || '').trim().toLowerCase();
  return content === 'same-origin';
}

/**
 * Run a synchronous DOM-mutation thunk, wrapping it in
 * `document.startViewTransition()` when the page has opted in AND the
 * browser supports the API. Otherwise the thunk runs synchronously,
 * byte-identical to the pre-View-Transitions behaviour (no flash, no
 * regression). The thunk is the SAME swap code in both branches; the
 * transition only captures the before/after around the mutation (the
 * fetch already happened, so it is never inside the callback).
 *
 * @param {() => void} thunk  The synchronous DOM swap to perform.
 * @param {() => void} [afterFinished]  Optional post-transition work
 *   (e.g. re-upgrade custom elements) run when the transition settles; for
 *   the synchronous fallback it runs immediately after the thunk.
 */
export function runWithTransition(thunk, afterFinished) {
  const start = typeof document !== 'undefined'
    ? /** @type any */ (document).startViewTransition
    : undefined;
  if (viewTransitionsEnabled() && typeof start === 'function') {
    const t = start.call(document, thunk);
    if (t && t.finished && typeof t.finished.then === 'function') {
      t.finished.then(() => { if (afterFinished) afterFinished(); }).catch(() => {});
    } else if (afterFinished) {
      afterFinished();
    }
    // Resolve when the DOM MUTATION (the thunk) has actually committed, NOT when
    // the animation finishes. Under `startViewTransition` the thunk is deferred a
    // frame, so anything that reads the swapped-in DOM (a progressively-streamed
    // Suspense resolve, #1048) must await this, or it runs against the pre-swap
    // DOM and drops. `updateCallbackDone` is that signal; fall back to a resolved
    // promise if the browser does not expose it.
    return (t && t.updateCallbackDone && typeof t.updateCallbackDone.then === 'function')
      ? t.updateCallbackDone.catch(() => {})
      : Promise.resolve();
  }
  thunk();
  if (afterFinished) afterFinished();
  return Promise.resolve();
}

/**
 * Live nodes a regraft actually moved into the incoming tree, so they
 * survived the swap BY IDENTITY. Membership is strictly narrower than
 * "carries `data-webjs-permanent`": the regrafts have a both-exist guard, so
 * a permanent element arriving for the first time is a freshly imported node
 * that was never preserved and is not in here. `reactivateScripts` reads this
 * to decide whether a script inside a permanent element is a script the
 * author kept alive (skip it) or one that has never run (run it).
 *
 * Weak and keyed by node identity, so a destroyed node drops out on its own
 * and a later element reusing the same `#id` is a different object that
 * correctly re-runs. Never cleared per navigation: a node preserved across
 * several navigations must keep its exemption on every one of them.
 *
 * @type {WeakSet<Element>}
 */
export const regraftedPermanents = new WeakSet();

/**
 * Persist `data-webjs-permanent` elements across a swap by NODE IDENTITY.
 *
 * Mirrors Turbo's permanent-element behaviour: an element the author
 * marks `data-webjs-permanent` (and which carries an `id`) survives a
 * destructive swap as the SAME live DOM node, so a playing
 * `<audio>` / `<video>`, a live widget, an open menu, or any element with
 * accumulated JS state keeps running across the navigation instead of
 * being destroyed and re-created from the incoming HTML.
 *
 * The mechanism runs BEFORE the destructive `replaceChildren` / range
 * delete: for each `[data-webjs-permanent][id]` in the CURRENT subtree, if
 * the INCOMING tree has a matching `#id`, the live current node is MOVED
 * into the incoming tree's position (replacing the incoming placeholder).
 * The subsequent swap then ADOPTS the live node (it is already part of the
 * incoming tree) rather than destroying the current one. The keyed
 * reconciler matches it by id afterwards and leaves it in place.
 *
 * Guards (correctness):
 *   - both-exist: only regraft an id present in BOTH the current and
 *     incoming subtree. An id in the current but NOT the incoming is being
 *     removed; leave it (do not force it to persist).
 *   - current-is-permanent: only move when the CURRENT node actually
 *     carries `data-webjs-permanent` (an incoming `#id` that resolves to a
 *     non-permanent current element is left untouched).
 *   - boundary-respecting: the live node is placed exactly where the
 *     incoming document puts it, so it never escapes a frame/region.
 *
 * @param {ParentNode} currentRoot   The live subtree being swapped out.
 * @param {ParentNode} incomingRoot  The incoming subtree being swapped in.
 */
export function regraftPermanentElements(currentRoot, incomingRoot) {
  if (!currentRoot || !incomingRoot) return;
  if (typeof currentRoot.querySelectorAll !== 'function') return;
  const permanents = currentRoot.querySelectorAll('[data-webjs-permanent][id]');
  for (const live of permanents) {
    const id = live.id;
    if (!id) continue;
    // both-exist guard: the incoming subtree must carry a matching #id.
    let placeholder = null;
    try {
      placeholder = incomingRoot.querySelector(`#${CSS.escape(id)}`);
    } catch { placeholder = null; }
    if (!placeholder) continue;
    // current-is-permanent guard is implicit in the selector above, but
    // re-assert defensively (the live node is the one we move).
    if (!live.hasAttribute || !live.hasAttribute('data-webjs-permanent')) continue;
    const parent = placeholder.parentNode;
    if (!parent) continue;
    // Move the LIVE node into the incoming tree's position, replacing the
    // incoming placeholder. The swap then adopts the live node.
    if (placeholder === live) continue;
    parent.replaceChild(live, placeholder);
    regraftedPermanents.add(live);
  }
}

/**
 * Permanent-element regraft for the marker-range path, where the two
 * sides are ARRAYS of sibling nodes (the live slice between markers, and
 * the imported-but-detached incoming slice) rather than single roots.
 *
 * For each `[data-webjs-permanent][id]` reachable from the LIVE slice, if
 * a matching `#id` exists anywhere in the INCOMING slice, replace the
 * incoming (freshly-imported) copy with the LIVE node so the reconciler
 * adopts the live node by identity. Searches both top-level slice members
 * and their descendants. The same both-exist + current-is-permanent
 * guards as `regraftPermanentElements` apply.
 *
 * @param {Node[]} liveSlice
 * @param {Node[]} incomingSlice
 */
export function regraftPermanentInSlice(liveSlice, incomingSlice) {
  /** @type {Element[]} */
  const livePermanents = [];
  for (const n of liveSlice) {
    if (n.nodeType !== 1) continue;
    const el = /** @type {Element} */ (n);
    if (el.hasAttribute && el.hasAttribute('data-webjs-permanent') && el.id) {
      livePermanents.push(el);
    }
    if (typeof el.querySelectorAll === 'function') {
      for (const d of el.querySelectorAll('[data-webjs-permanent][id]')) livePermanents.push(d);
    }
  }
  if (!livePermanents.length) return;

  for (const live of livePermanents) {
    const id = live.id;
    if (!id) continue;
    const placeholder = findInSlice(incomingSlice, id);
    if (!placeholder) continue; // both-exist guard
    if (placeholder === live) continue;
    const parent = placeholder.parentNode;
    if (parent) {
      parent.replaceChild(live, placeholder);
      regraftedPermanents.add(live);
    } else {
      // Placeholder is a top-level slice member with no parent (detached):
      // replace it in the incomingSlice array so the reconciler inserts the
      // live node in that position.
      const idx = incomingSlice.indexOf(placeholder);
      if (idx !== -1) {
        incomingSlice[idx] = live;
        regraftedPermanents.add(live);
      }
    }
  }
}

/**
 * Find an element with `#id` within an array of (possibly detached)
 * sibling nodes, searching each member and its descendants.
 *
 * @param {Node[]} slice
 * @param {string} id
 * @returns {Element | null}
 */
function findInSlice(slice, id) {
  for (const n of slice) {
    if (n.nodeType !== 1) continue;
    const el = /** @type {Element} */ (n);
    if (el.id === id) return el;
    if (typeof el.querySelector === 'function') {
      let match = null;
      try { match = el.querySelector(`#${CSS.escape(id)}`); } catch { match = null; }
      if (match) return match;
    }
  }
  return null;
}
