/**
 * Inert `ElementInternals`-shaped object returned by the server shim's
 * `attachInternals()`. Modeled on `@lit-labs/ssr-dom-shim`'s
 * `ElementInternalsShim` (lit repo, `packages/labs/ssr-dom-shim/src/lib/
 * element-internals.ts`): form-association, validity, and custom-state
 * calls are no-ops at SSR (no form, no constraint validation, no `:state()`
 * matching server-side), so a component that calls `this.attachInternals()`
 * in its constructor renders instead of crashing. The browser runs the real
 * `attachInternals()` on hydration.
 *
 * Deliberate deviation from lit: lit's `checkValidity` / `reportValidity`
 * THROW on the server. WebJs returns `true` instead, to keep SSR
 * progressive-enhancement-safe (a stray validity call in a constructor must
 * not 500 the page); the browser does the real validation.
 * @returns {any}
 */
export function makeServerInternals() {
  return {
    states: new Set(),
    shadowRoot: null,
    form: null,
    labels: [],
    role: '',
    willValidate: true,
    validity: /** @type {any} */ ({}),
    validationMessage: '',
    setFormValue() {},
    setValidity() {},
    checkValidity() { return true; },
    reportValidity() { return true; },
  };
}

/**
 * Server-side stand-in for `HTMLElement`. The SSR pipeline constructs
 * component instances in Node, where `HTMLElement` does not exist, so the
 * base class is this shim. It is modeled on `@lit-labs/ssr-dom-shim`'s
 * `ElementShim` (lit repo, `packages/labs/ssr-dom-shim/src/index.ts`): the
 * attribute methods (`getAttribute` / `setAttribute` / `hasAttribute` /
 * `removeAttribute` / `toggleAttribute`, the `attributes` getter) are backed
 * by a Map, so lit muscle-memory patterns that read attributes in `render()`
 * or set them while deriving state work server-side; the SSR walker seeds
 * the Map from the element's source attributes and reads it back to surface
 * reflected/added attributes in the output. Event methods are no-ops (no
 * server event loop), and `attachInternals()` returns the inert object
 * above. The genuinely browser-only surface (`querySelector`, layout reads,
 * `attachShadow`, `focus`) is deliberately absent and still throws at SSR,
 * which the `no-browser-globals-in-render` rule and the SSR crash hint flag.
 *
 * Deliberate deviation from lit: this shim lowercases attribute names so
 * `getAttribute('Foo')` after `setAttribute('foo', x)` resolves, matching how
 * a real browser treats HTML attribute names as case-insensitive. lit's shim
 * keys the Map by the raw name (a known fidelity gap in lit-labs).
 */
export class ServerElement {
  constructor() {
    /**
     * Backing store for the attribute methods. Keys are lowercased
     * attribute names (HTML attributes are case-insensitive). Seeded by the
     * SSR walker from the element's source attributes.
     * @type {Map<string, string>}
     */
    this.__ssrAttrs = new Map();
    /** @type {any} */
    this.__internals = null;
  }

  /** Mirrors `Element.attributes`: an array of `{ name, value }`. */
  get attributes() {
    return [...this.__ssrAttrs].map(([name, value]) => ({ name, value }));
  }

  /** @param {string} name */
  getAttribute(name) {
    const v = this.__ssrAttrs.get(String(name).toLowerCase());
    return v === undefined ? null : v;
  }

  /** @param {string} name @param {unknown} value */
  setAttribute(name, value) {
    // Emulate the browser casting all values to string (lit does the same).
    this.__ssrAttrs.set(String(name).toLowerCase(), String(value));
  }

  /** @param {string} name */
  removeAttribute(name) {
    this.__ssrAttrs.delete(String(name).toLowerCase());
  }

  /** @param {string} name */
  hasAttribute(name) {
    return this.__ssrAttrs.has(String(name).toLowerCase());
  }

  /** @param {string} name @param {boolean} [force] */
  toggleAttribute(name, force) {
    // Steps mirror https://dom.spec.whatwg.org/#dom-element-toggleattribute
    const key = String(name).toLowerCase();
    const present = this.__ssrAttrs.has(key);
    const next = force === undefined ? !present : force;
    if (next) {
      this.__ssrAttrs.set(key, '');
      return true;
    }
    this.__ssrAttrs.delete(key);
    return false;
  }

  /** @returns {string[]} */
  getAttributeNames() {
    return [...this.__ssrAttrs.keys()];
  }

  /**
   * Minimal `Element.closest()` for SSR. The SSR walker threads the chain
   * of enclosing custom-element instances into each instance
   * (`__ssrAncestors`); this walks self-then-ancestors and returns the
   * nearest whose tag matches. Only bare tag-name selectors are supported
   * server-side (`closest('ui-tabs')`), which is what compound components
   * need to read parent state for a correct first paint; anything more
   * specific (class, attribute, or descendant selectors) returns null,
   * matching the pre-shim behaviour. The browser runs the real `closest()`
   * on hydration.
   * @param {string} selector
   * @returns {any}
   */
  closest(selector) {
    const sel = String(selector).trim().toLowerCase();
    // Tag-name selectors only at SSR; bail (null) on anything else.
    if (!/^[a-z][a-z0-9-]*$/.test(sel)) return null;
    if (this.__ssrTag === sel) return this;
    const chain = this.__ssrAncestors;
    if (!Array.isArray(chain)) return null;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i] && chain[i].__ssrTag === sel) return chain[i];
    }
    return null;
  }

  /**
   * `HTMLElement.dataset`: a live view over the element's `data-*`
   * attributes, backed by the SSR attribute Map. Reading / writing
   * `el.dataset.fooBar` maps to the `data-foo-bar` attribute (camelCase
   * to kebab-case), so a `render()` that sets `this.dataset.state = 'on'`
   * surfaces `data-state="on"` in the SSR'd host tag instead of crashing
   * on an undefined `dataset`.
   * @returns {Record<string, string>}
   */
  get dataset() {
    if (this.__dataset) return this.__dataset;
    const el = this;
    const toAttr = (p) => 'data-' + String(p).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    this.__dataset = new Proxy(/** @type {Record<string,string>} */ ({}), {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        const v = el.getAttribute(toAttr(prop));
        return v === null ? undefined : v;
      },
      set(_t, prop, value) {
        if (typeof prop === 'string') el.setAttribute(toAttr(prop), value);
        return true;
      },
      has(_t, prop) {
        return typeof prop === 'string' && el.hasAttribute(toAttr(prop));
      },
      deleteProperty(_t, prop) {
        if (typeof prop === 'string') el.removeAttribute(toAttr(prop));
        return true;
      },
      ownKeys() {
        return el.getAttributeNames()
          .filter((n) => n.startsWith('data-'))
          .map((n) => n.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase()));
      },
      getOwnPropertyDescriptor(_t, prop) {
        if (typeof prop === 'string' && el.hasAttribute(toAttr(prop))) {
          return { enumerable: true, configurable: true, value: el.getAttribute(toAttr(prop)) };
        }
        return undefined;
      },
    });
    return this.__dataset;
  }

  // IDL properties that reflect to a content attribute. A render() that
  // mutates these on the host (a light-DOM compound-component pattern, e.g.
  // `this.className = ...`, `this.hidden = !active`) then surfaces the
  // matching attribute in the SSR'd host tag, matching the browser.
  get className() { return this.getAttribute('class') ?? ''; }
  set className(v) { this.setAttribute('class', v); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { this.toggleAttribute('hidden', !!v); }
  get id() { return this.getAttribute('id') ?? ''; }
  set id(v) { this.setAttribute('id', v); }
  get title() { return this.getAttribute('title') ?? ''; }
  set title(v) { this.setAttribute('title', v); }
  get slot() { return this.getAttribute('slot') ?? ''; }
  set slot(v) { this.setAttribute('slot', v); }
  get role() { return this.getAttribute('role'); }
  set role(v) { v == null ? this.removeAttribute('role') : this.setAttribute('role', v); }
  get tabIndex() { const v = this.getAttribute('tabindex'); return v === null ? -1 : (Number.parseInt(v, 10) || 0); }
  set tabIndex(v) { this.setAttribute('tabindex', String(v)); }

  // No server event loop: listeners never fire at SSR. The no-op keeps a
  // constructor that wires delegated listeners (a common lit pattern) from
  // crashing; the browser re-runs the constructor on hydration where the
  // real HTMLElement methods apply.
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }

  /** @returns {any} */
  attachInternals() {
    // Match the browser (and lit's shim): a second attach is an error.
    if (this.__internals !== null) {
      throw new Error(
        "Failed to execute 'attachInternals' on 'HTMLElement': " +
          'ElementInternals for the specified element was already attached.',
      );
    }
    this.__internals = makeServerInternals();
    return this.__internals;
  }
}

// ARIAMixin IDL reflections (`el.ariaPressed = 'true'` writes aria-pressed).
// A render() that sets ARIA state via the IDL properties then surfaces the
// matching aria-* attribute in the SSR'd host tag, matching the browser. The
// IDL name maps to the content attribute by lowercasing the part after
// `aria` and prefixing `aria-` (ariaPressed -> aria-pressed).
const ARIA_IDL_PROPS = [
  'ariaAtomic', 'ariaAutoComplete', 'ariaBusy', 'ariaChecked', 'ariaColCount',
  'ariaColIndex', 'ariaColSpan', 'ariaCurrent', 'ariaDescription', 'ariaDisabled',
  'ariaExpanded', 'ariaHasPopup', 'ariaHidden', 'ariaInvalid', 'ariaKeyShortcuts',
  'ariaLabel', 'ariaLevel', 'ariaLive', 'ariaModal', 'ariaMultiLine',
  'ariaMultiSelectable', 'ariaOrientation', 'ariaPlaceholder', 'ariaPosInSet',
  'ariaPressed', 'ariaReadOnly', 'ariaRequired', 'ariaRoleDescription',
  'ariaRowCount', 'ariaRowIndex', 'ariaRowSpan', 'ariaSelected', 'ariaSetSize',
  'ariaSort', 'ariaValueMax', 'ariaValueMin', 'ariaValueNow', 'ariaValueText',
];
for (const idl of ARIA_IDL_PROPS) {
  const attr = 'aria-' + idl.slice(4).toLowerCase();
  Object.defineProperty(ServerElement.prototype, idl, {
    configurable: true,
    get() { return this.getAttribute(attr); },
    set(v) { v == null ? this.removeAttribute(attr) : this.setAttribute(attr, String(v)); },
  });
}
