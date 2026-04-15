/**
 * Isomorphic custom element registry.
 *
 * On the server it's a plain Map used by renderToString to inject
 * Declarative Shadow DOM for known components + emit `modulepreload`
 * hints. On the browser we also call customElements.define so the tag
 * upgrades after hydration.
 *
 * @typedef {{ cls: typeof import('./component.js').WebComponent, moduleUrl: string | null }} RegistryEntry
 */

/** @type {Map<string, RegistryEntry>} */
const registry = new Map();

const isBrowser = typeof window !== 'undefined' && typeof customElements !== 'undefined';

/**
 * Register a tag → component class mapping.
 * Passing `moduleUrl` (typically `import.meta.url` from the component file)
 * lets the SSR shell emit a `<link rel="modulepreload">` for the module —
 * eliminating a round-trip on first paint without a bundler.
 *
 * @param {string} tag
 * @param {typeof import('./component.js').WebComponent} cls
 * @param {string} [moduleUrl]
 */
export function register(tag, cls, moduleUrl) {
  const entry = registry.get(tag);
  if (entry) {
    if (!entry.moduleUrl && moduleUrl) entry.moduleUrl = moduleUrl;
    return;
  }
  registry.set(tag, { cls, moduleUrl: moduleUrl || null });
  if (isBrowser && !customElements.get(tag)) {
    customElements.define(tag, /** @type {any} */ (cls));
  }
}

/** @param {string} tag */
export function lookup(tag) {
  return registry.get(tag)?.cls;
}

/** @param {string} tag */
export function lookupModuleUrl(tag) {
  return registry.get(tag)?.moduleUrl || null;
}

export function allTags() {
  return [...registry.keys()];
}
