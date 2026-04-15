import { render as clientRender } from './render-client.js';
import { isCSS, adoptStyles } from './css.js';
import { register } from './registry.js';

const isBrowser = typeof window !== 'undefined' && typeof HTMLElement !== 'undefined';

/**
 * A minimal base for HTML Custom Elements that mirrors Lit's ergonomics
 * while staying JSDoc-only and no-build.
 *
 * Subclasses declare:
 *  - `static tag` — the custom element name (e.g. `'my-counter'`)
 *  - `static properties` — attribute → property mapping with type info
 *  - `static styles` — CSSResult or array thereof
 *  - `static shadow` — set false to render into light DOM instead of shadow
 *  - `render()` — returns a TemplateResult
 *
 * Usage:
 * ```js
 * class MyCounter extends WebComponent {
 *   static tag = 'my-counter';
 *   static properties = { count: { type: Number } };
 *   state = { count: 0 };
 *   render() { return html`<button @click=${() => this.setState({ count: this.state.count + 1 })}>${this.state.count}</button>`; }
 * }
 * MyCounter.register();
 * ```
 */

// Base class choice: real HTMLElement on the browser, a dummy on the server.
const Base = isBrowser ? HTMLElement : /** @type {any} */ (class {});

export class WebComponent extends Base {
  /** Custom element tag name. Subclasses must override. @type {string} */
  static tag = '';

  /** Whether to use shadow DOM. @type {boolean} */
  static shadow = true;

  /**
   * Attribute/property declarations.
   * @type {Record<string, { type: Function, reflect?: boolean }>}
   */
  static properties = {};

  /**
   * Styles to adopt into the shadow root.
   * @type {import('./css.js').CSSResult | import('./css.js').CSSResult[] | null}
   */
  static styles = null;

  /** Register this class with the element registry. */
  static register() {
    if (!this.tag) throw new Error('WebComponent subclass is missing a static `tag`');
    register(this.tag, this);
  }

  /** @returns {string[]} */
  static get observedAttributes() {
    return Object.keys(this.properties || {}).map(hyphenate);
  }

  constructor() {
    super();
    /** @type {Record<string, unknown>} */
    this.state = {};
    this._renderRoot = null;
    this._scheduled = false;
    this._connected = false;
  }

  connectedCallback() {
    if (!isBrowser) return;
    this._connected = true;
    const Ctor = /** @type any */ (this.constructor);
    if (Ctor.shadow !== false) {
      if (!this.shadowRoot) {
        /** @type any */ (this).attachShadow({ mode: 'open' });
      }
      this._renderRoot = this.shadowRoot;
      const styles = Ctor.styles;
      const list = Array.isArray(styles) ? styles : isCSS(styles) ? [styles] : [];
      if (list.length) adoptStyles(this._renderRoot, list);
    } else {
      this._renderRoot = this;
    }
    this._performRender();
  }

  /** @param {string} name @param {string|null} _old @param {string|null} value */
  attributeChangedCallback(name, _old, value) {
    const Ctor = /** @type any */ (this.constructor);
    const propName = camelCase(name);
    const def = Ctor.properties && (Ctor.properties[propName] || Ctor.properties[name]);
    if (!def) return;
    let v;
    if (def.type === Number) v = value == null ? null : Number(value);
    else if (def.type === Boolean) v = value != null && value !== 'false';
    else if (def.type === Object || def.type === Array) {
      try { v = value == null ? null : JSON.parse(value); } catch { v = value; }
    } else v = value;
    if (this[propName] !== v) {
      this[propName] = v;
      if (this._connected) this.requestUpdate();
    }
  }

  /**
   * Shallow-merge new state and schedule a re-render.
   * @param {Record<string, unknown>} patch
   */
  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.requestUpdate();
  }

  requestUpdate() {
    if (this._scheduled || !this._connected) return;
    this._scheduled = true;
    queueMicrotask(() => {
      this._scheduled = false;
      this._performRender();
    });
  }

  _performRender() {
    if (!this._renderRoot) return;
    const tpl = this.render();
    clientRender(tpl, this._renderRoot);
  }

  /**
   * Override in subclasses to return a TemplateResult.
   * @returns {unknown}
   */
  render() {
    return '';
  }
}

/** @param {string} s */
function hyphenate(s) {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}
/** @param {string} s */
function camelCase(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
