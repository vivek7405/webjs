/**
 * Isomorphic custom element registry.
 *
 * The authoring pattern is the web-standard one:
 *
 *   class Counter extends WebComponent { … }
 *   customElements.define('my-counter', Counter);
 *
 * On the browser `customElements` is the native registry; we attach a
 * thin wrapper that mirrors each registration into our own map so SSR
 * / router / lazy-loading code can look up `tag → Class` without
 * dipping into the platform registry.
 *
 * On the server there is no native `customElements`; we install a
 * minimal shim on `globalThis` that just records the registration.
 *
 * @typedef {{ cls: typeof import('./component.js').WebComponent, moduleUrl: string | null, lazy: boolean, tag: string }} RegistryEntry
 */

/** @type {Map<string, RegistryEntry>} */
const registry = new Map();
/** @type {WeakMap<Function, string>} */
const classToTag = new WeakMap();

const isBrowser =
  typeof window !== 'undefined' && typeof customElements !== 'undefined';

/* ------------------------------------------------------------------
 * define(tag, cls): called internally by the server-side customElements
 * shim AND by the browser wrapper below. Populates our bookkeeping and,
 * on the browser, delegates to the native customElements.define.
 * ------------------------------------------------------------------ */

/**
 * @param {string} tag
 * @param {typeof import('./component.js').WebComponent} cls
 */
function registerInternal(tag, cls) {
  if (!tag || typeof tag !== 'string' || !tag.includes('-')) {
    throw new Error(
      `customElements.define: tag "${tag}" must contain a hyphen (HTML spec)`,
    );
  }
  const lazy = /** @type {any} */ (cls).lazy === true;
  const entry = registry.get(tag);
  if (entry) {
    entry.cls = cls;
    entry.lazy = lazy;
  } else {
    registry.set(tag, { cls, moduleUrl: null, lazy, tag });
  }
  classToTag.set(cls, tag);
}

/* ------------------------------------------------------------------
 * Browser: wrap native customElements.define so every registration
 * also lands in our map. The native behaviour (upgrading matching
 * elements + preventing double-define) is preserved.
 * ------------------------------------------------------------------ */

if (isBrowser) {
  const native = customElements.define.bind(customElements);
  /** @type {any} */ (customElements).define = function (tag, cls, options) {
    if (!customElements.get(tag)) native(tag, cls, options);
    registerInternal(tag, cls);
  };
}

/* ------------------------------------------------------------------
 * Server: install a minimal customElements shim on globalThis so
 * `customElements.define('x', X)` at the bottom of a component module
 * is a legal no-op that populates our registry. Idempotent.
 * ------------------------------------------------------------------ */

if (!isBrowser) {
  const g = /** @type {any} */ (globalThis);
  if (!g.customElements) {
    g.customElements = {
      define(tag, cls) {
        registerInternal(tag, cls);
      },
      get(tag) {
        return registry.get(tag)?.cls;
      },
      /** No-op: server never upgrades real elements. */
      upgrade() {},
      /** Resolves immediately — SSR never waits for upgrade. */
      whenDefined(tag) {
        const e = registry.get(tag);
        return Promise.resolve(e?.cls);
      },
    };
  }
}

/* ------------------------------------------------------------------
 * Public API — unchanged signature surface.
 * ------------------------------------------------------------------ */

/**
 * @deprecated Low-level internal — prefer `customElements.define(tag, cls)`.
 * Kept as a minimal wrapper for back-compat with any framework code that
 * calls it directly.
 *
 * @param {string} tag
 * @param {typeof import('./component.js').WebComponent} cls
 */
export function register(tag, cls) {
  if (isBrowser) {
    /** @type any */ (customElements).define(tag, cls);
  } else {
    registerInternal(tag, cls);
  }
}

/**
 * Server-side: record the browser-visible URL for a component's module
 * BEFORE the module is imported. Populated at server boot by the
 * component scanner so `lookupModuleUrl` works for modulepreload hints
 * without forcing every component file to be eagerly imported.
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
    tag,
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

/** Reverse lookup: class → tag. Used for framework warnings / logs. */
export function tagOf(cls) {
  return classToTag.get(cls);
}

export function allTags() {
  return [...registry.keys()];
}
