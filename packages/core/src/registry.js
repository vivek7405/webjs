/**
 * Isomorphic custom element registry.
 *
 * On the server it's a plain Map used by renderToString to inject
 * Declarative Shadow DOM for known components + emit `modulepreload`
 * hints. On the browser we also call customElements.define so the tag
 * upgrades after hydration.
 *
 * @typedef {{ cls: typeof import('./component.js').WebComponent, moduleUrl: string | null, lazy: boolean }} RegistryEntry
 */

/** @type {Map<string, RegistryEntry>} */
const registry = new Map();

const isBrowser = typeof window !== 'undefined' && typeof customElements !== 'undefined';

/**
 * Register a tag → component class mapping.
 *
 * Module URLs (used by SSR to emit `<link rel="modulepreload">` hints
 * so first paint doesn't wait on a fresh fetch for each component) are
 * derived server-side by scanning the app tree at boot — see
 * `primeModuleUrl`. Callers don't pass URLs here anymore.
 *
 * @param {string} tag
 * @param {typeof import('./component.js').WebComponent} cls
 */
export function register(tag, cls) {
  const lazy = /** @type {any} */ (cls).lazy === true;
  const entry = registry.get(tag);
  if (entry) {
    // Keep the existing moduleUrl if present (set via primeModuleUrl
    // before this call); just update the class pointer.
    entry.cls = cls;
    entry.lazy = lazy;
    return;
  }
  registry.set(tag, { cls, moduleUrl: null, lazy });
  if (isBrowser && !customElements.get(tag)) {
    customElements.define(tag, /** @type {any} */ (cls));
  }
}

/**
 * Server-side: record the browser-visible URL for a component's module
 * BEFORE the module is imported. Populated at server boot by scanning
 * the app tree for `class … extends WebComponent { static tag = '…' }`
 * declarations. The SSR pipeline reads these via `lookupModuleUrl`
 * when emitting `modulepreload` hints.
 *
 * Safe to call before `register()` — the tag entry is created lazily
 * and later merged with the class pointer when the module evaluates.
 *
 * @param {string} tag
 * @param {string} moduleUrl
 */
export function primeModuleUrl(tag, moduleUrl) {
  if (isBrowser) return;
  const entry = registry.get(tag);
  if (entry) {
    entry.moduleUrl = moduleUrl;
    return;
  }
  registry.set(tag, {
    cls: /** @type any */ (null),
    moduleUrl,
    lazy: false,
  });
}

/** @param {string} tag */
export function lookup(tag) {
  return registry.get(tag)?.cls;
}

/** @param {string} tag */
export function lookupModuleUrl(tag) {
  return registry.get(tag)?.moduleUrl || null;
}

/** @param {string} tag */
export function isLazy(tag) {
  return registry.get(tag)?.lazy === true;
}

export function allTags() {
  return [...registry.keys()];
}
