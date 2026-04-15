/**
 * Isomorphic custom element registry.
 *
 * On the server it's a plain Map used by renderToString to inject
 * Declarative Shadow DOM for known components. On the browser we also
 * call customElements.define so the tag upgrades after hydration.
 */

/** @type {Map<string, typeof import('./component.js').WebComponent>} */
const registry = new Map();

const isBrowser = typeof window !== 'undefined' && typeof customElements !== 'undefined';

/**
 * @param {string} tag
 * @param {typeof import('./component.js').WebComponent} cls
 */
export function register(tag, cls) {
  if (registry.has(tag)) return;
  registry.set(tag, cls);
  if (isBrowser && !customElements.get(tag)) {
    customElements.define(tag, /** @type {any} */ (cls));
  }
}

/** @param {string} tag */
export function lookup(tag) {
  return registry.get(tag);
}

export function allTags() {
  return [...registry.keys()];
}
