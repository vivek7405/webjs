/**
 * Inert `ElementInternals`-shaped object returned by the server shim's `attachInternals()`.
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
 * Server-side stand-in for `HTMLElement`.
 */
export class ServerElement {
  constructor() {
    /** @type {Map<string, string>} */
    this.__ssrAttrs = new Map();
    /** @type {any} */
    this.__internals = null;
  }

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

  /** @param {string} selector */
  closest(selector) {
    const sel = String(selector).trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(sel)) return null;
    if (this.__ssrTag === sel) return this;
    const chain = this.__ssrAncestors;
    if (!Array.isArray(chain)) return null;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i] && chain[i].__ssrTag === sel) return chain[i];
    }
    return null;
  }

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

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }

  /** @returns {any} */
  attachInternals() {
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
