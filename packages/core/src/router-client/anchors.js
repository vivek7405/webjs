/**
 * Finding the anchor an event happened inside, across shadow boundaries.
 *
 * A leaf: both helpers are pure DOM walks over their argument. They lived in
 * events.js, which made prefetch.js and upgrade.js import the router's event
 * layer just to resolve an anchor, and that was one of the edges holding the
 * directory in a cycle.
 */

/**
 * Find the nearest <a> in the event's composed path. composedPath() crosses
 * shadow DOM boundaries: essential because nav links typically live inside
 * the layout shell's shadow root.
 *
 * @param {MouseEvent} e
 * @returns {HTMLAnchorElement | null}
 */
export function findAnchorInPath(e) {
  for (const el of e.composedPath()) {
    if (el instanceof HTMLAnchorElement) return el;
  }
  return null;
}
/**
 * Nearest enclosing <a>, crossing shadow boundaries, from an event
 * target. composedPath is click-only, so walk getRootNode().host here.
 *
 * @param {EventTarget | null} target
 * @returns {HTMLAnchorElement | null}
 */
export function closestAnchor(target) {
  let node = /** @type {Node | null} */ (target);
  while (node) {
    if (node instanceof HTMLAnchorElement) return node;
    const el = node.nodeType === 1 ? /** @type {Element} */ (node) : null;
    if (el) {
      const a = el.closest && el.closest('a');
      if (a instanceof HTMLAnchorElement) return a;
    }
    const root = node.getRootNode ? node.getRootNode() : null;
    node = root && /** @type any */ (root).host ? /** @type any */ (root).host : null;
  }
  return null;
}
