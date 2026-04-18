import { render as clientRender } from './render-client.js';
import { isCSS, adoptStyles } from './css.js';
import { register } from './registry.js';

const isBrowser = typeof window !== 'undefined' && typeof HTMLElement !== 'undefined';

/**
 * @typedef {Object} ReactiveController
 * A controller is a reusable piece of lifecycle logic that plugs into a
 * WebComponent host. Controllers let you extract cross-cutting concerns
 * (timers, intersection observers, media queries, form validation, fetch
 * caching) out of the component class and share them across unrelated
 * components.
 *
 * **When to use:** any time two or more components need the same
 * `connectedCallback` / `disconnectedCallback` / pre-render / post-render
 * behaviour. Instead of a mixin or base-class hierarchy, attach a controller.
 *
 * **Why it exists:** mirrors Lit's `ReactiveController` protocol so
 * ecosystem controllers are interoperable.
 *
 * @property {() => void} [hostConnected]
 *   Called when the host element is inserted into the DOM
 *   (`connectedCallback`). Use for subscriptions, observers, timers.
 * @property {() => void} [hostDisconnected]
 *   Called when the host element is removed from the DOM
 *   (`disconnectedCallback`). Use for cleanup: unsubscribe, disconnect
 *   observers, clear timers.
 * @property {() => void} [hostUpdate]
 *   Called just before the host renders (inside `_performRender`, after
 *   `willUpdate` but before `render()`). Use for reading layout or
 *   preparing data that the render depends on.
 * @property {() => void} [hostUpdated]
 *   Called after the host has rendered and the DOM is up to date. Use for
 *   post-render side effects that depend on the new DOM (measuring,
 *   focusing, scrolling).
 */

/**
 * @typedef {Object} PropertyDeclaration
 * Declares how a single reactive property behaves. Used inside
 * `static properties = { propName: { …declaration } }`.
 *
 * @property {Function} [type]
 *   Constructor used for attribute → property coercion.
 *   Supported built-ins: `String`, `Number`, `Boolean`, `Object`, `Array`.
 *   Default: `String`.
 *
 * @property {boolean} [reflect]
 *   When `true`, writing to the property also sets the corresponding
 *   HTML attribute on the element (kebab-cased). Useful when you want
 *   CSS attribute selectors like `my-el[mode="dark"]` to work.
 *
 * @property {boolean} [state]
 *   When `true`, the property is *internal-only*: it is NOT exposed as an
 *   HTML attribute (excluded from `observedAttributes`) and never reflects.
 *   It still triggers a re-render when changed via the generated setter.
 *   Use for private reactive state that shouldn't leak into the DOM.
 *
 * @property {(newValue: unknown, oldValue: unknown) => boolean} [hasChanged]
 *   Custom dirty-check function. Called by the generated setter before
 *   scheduling an update. Return `true` to trigger a re-render, `false`
 *   to skip. Default: strict inequality `(a, b) => a !== b`.
 *
 * @property {{ fromAttribute: (value: string|null, type?: Function) => unknown, toAttribute: (value: unknown, type?: Function) => string|null }} [converter]
 *   Custom serialization/deserialization pair for the HTML attribute.
 *   `fromAttribute` is called in `attributeChangedCallback`;
 *   `toAttribute` is called when reflecting back to the attribute.
 *   If omitted, the built-in type-based coercion is used.
 */

/**
 * Default change detection: strict inequality.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function defaultHasChanged(a, b) {
  return a !== b;
}

/**
 * A minimal base for HTML Custom Elements that mirrors Lit's ergonomics
 * while staying JSDoc-only and no-build.
 *
 * Subclasses declare:
 *  - `static tag` — the custom element name (e.g. `'my-counter'`)
 *  - `static properties` — attribute/property declarations with type info,
 *    reflection, custom converters, and internal-state mode
 *  - `static styles` — CSSResult or array thereof
 *  - `static shadow` — set false to render into light DOM instead of shadow
 *  - `render()` — returns a TemplateResult
 *
 * Lifecycle (called in order during each update cycle):
 *  1. controllers' `hostUpdate()`
 *  2. `render()` + DOM commit (with error boundary)
 *  3. controllers' `hostUpdated()`
 *  4. `firstUpdated()` — once, after the very first render
 *
 * "Less is more" — only hooks with no native workaround are included.
 * Use `render()` for derived state. Use `firstUpdated()` for one-time
 * DOM setup. Use `this.shadowRoot.querySelector()` for element refs.
 *
 * Usage:
 * ```js
 * class MyCounter extends WebComponent {
 *   static tag = 'my-counter';
 *   static properties = { count: { type: Number, reflect: true } };
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

  /** Whether to use shadow DOM. Default: false (light DOM). @type {boolean} */
  static shadow = false;

  /**
   * Hydration strategy for this component.
   *
   * **AI hint:** Set `static hydrate = 'visible'` to defer client-side
   * hydration until the element scrolls into (or near) the viewport. The
   * server-rendered Declarative Shadow DOM content stays visible the whole
   * time — users see the SSR HTML immediately while JavaScript activation
   * is deferred. This is useful for below-the-fold components that don't
   * need interactivity right away.
   *
   * - `undefined` (default): hydrate immediately on `connectedCallback`.
   * - `'visible'`: hydrate when the element enters the viewport
   *   (with a 200 px root margin).
   *
   * @type {'visible' | undefined}
   */
  static hydrate = undefined;

  /**
   * Attribute/property declarations.
   *
   * Each key is a property name; the value is a {@link PropertyDeclaration}.
   *
   * Properties declared here get auto-generated accessors (getter/setter)
   * that trigger re-renders on change, coerce attribute values by type,
   * and optionally reflect back to attributes.
   *
   * Properties with `state: true` are excluded from `observedAttributes`
   * and never reflect — they behave like private reactive state.
   *
   * @type {Record<string, PropertyDeclaration>}
   */
  static properties = {};

  /**
   * Styles to adopt into the shadow root.
   * @type {import('./css.js').CSSResult | import('./css.js').CSSResult[] | null}
   */
  static styles = null;

  /**
   * Register this class with the element registry.
   *
   *     MyCounter.register();
   *
   * Module URLs (used by SSR to emit `<link rel="modulepreload">` hints)
   * are derived server-side at boot by scanning the app tree for
   * `class … extends WebComponent { static tag = '…' }` declarations.
   * No per-component argument is needed.
   */
  static register() {
    if (!this.tag) throw new Error('WebComponent subclass is missing a static `tag`');
    register(this.tag, this);
  }

  /**
   * Returns the list of attribute names the browser should observe.
   * Properties with `state: true` are excluded — they are internal-only
   * and do not correspond to any HTML attribute.
   *
   * @returns {string[]}
   */
  static get observedAttributes() {
    const props = this.properties || {};
    return Object.keys(props)
      .filter((k) => !props[k].state)
      .map(hyphenate);
  }

  constructor() {
    super();
    /** @type {Record<string, unknown>} */
    this.state = {};
    this._renderRoot = null;
    this._scheduled = false;
    this._connected = false;

    /**
     * Set of attached reactive controllers.
     * @type {Set<ReactiveController>}
     */
    this.__controllers = new Set();

    /**
     * Whether the component has completed its first render.
     * Used to gate the one-time `firstUpdated()` call.
     * @type {boolean}
     */
    this.__firstRendered = false;

    // Install reactive property accessors for `static properties` declarations.
    this._initializeProperties();
  }

  /**
   * For every key in `static properties`, create a getter/setter pair on
   * the instance that coerces values, runs `hasChanged`, schedules updates,
   * and optionally reflects to the HTML attribute.
   *
   * This is called once from the constructor. The backing store is a plain
   * object (`this.__propValues`) so accessors don't collide with the
   * prototype.
   * @private
   */
  _initializeProperties() {
    const Ctor = /** @type {any} */ (this.constructor);
    const props = Ctor.properties;
    if (!props || typeof props !== 'object') return;

    /** @type {Record<string, unknown>} */
    this.__propValues = {};

    for (const [propName, decl] of Object.entries(props)) {
      const d = typeof decl === 'object' ? decl : { type: decl };
      // Capture any value set before the accessor was installed (e.g. via
      // attribute or property assignment before `super()` returns).
      const initial = /** @type {any} */ (this)[propName];

      Object.defineProperty(this, propName, {
        configurable: true,
        enumerable: true,
        get: () => this.__propValues[propName],
        set: (newVal) => {
          const oldVal = this.__propValues[propName];
          const changed = (d.hasChanged || defaultHasChanged)(newVal, oldVal);
          if (!changed) return;
          this.__propValues[propName] = newVal;

          // Reflect to attribute if requested (and not internal state).
          if (d.reflect && !d.state && this._connected) {
            this._reflectAttribute(propName, newVal, d);
          }

          if (this._connected) this.requestUpdate();
        },
      });

      if (initial !== undefined) {
        this.__propValues[propName] = initial;
      }
    }
  }

  /**
   * Write a property value back to its corresponding HTML attribute.
   * Uses a custom `converter.toAttribute` if provided, otherwise the
   * built-in type-based serialization.
   *
   * @param {string} propName
   * @param {unknown} value
   * @param {PropertyDeclaration} decl
   * @private
   */
  _reflectAttribute(propName, value, decl) {
    const attrName = hyphenate(propName);
    // Guard against re-entrant loops: attributeChangedCallback fires when
    // we call setAttribute, which would call the setter again.
    if (this.__reflectingAttribute) return;
    this.__reflectingAttribute = true;
    try {
      if (decl.converter && decl.converter.toAttribute) {
        const serialized = decl.converter.toAttribute(value, decl.type);
        if (serialized == null) this.removeAttribute(attrName);
        else this.setAttribute(attrName, serialized);
      } else if (decl.type === Boolean) {
        if (value) this.setAttribute(attrName, '');
        else this.removeAttribute(attrName);
      } else if (value == null) {
        this.removeAttribute(attrName);
      } else if (decl.type === Object || decl.type === Array) {
        this.setAttribute(attrName, JSON.stringify(value));
      } else {
        this.setAttribute(attrName, String(value));
      }
    } finally {
      this.__reflectingAttribute = false;
    }
  }

  connectedCallback() {
    if (!isBrowser) return;
    const Ctor = /** @type any */ (this.constructor);

    // Selective hydration: defer activation until the element scrolls into
    // (or near) the viewport. The DSD content from SSR stays visible the
    // whole time — the user sees the server-rendered HTML.
    if (
      Ctor.hydrate === 'visible' &&
      typeof IntersectionObserver !== 'undefined' &&
      !this.__hydrationActivated
    ) {
      this.__hydrationActivated = false;
      this.__hydrationObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              this.__hydrationObserver.unobserve(this);
              this.__hydrationObserver.disconnect();
              this.__hydrationObserver = null;
              this.__hydrationActivated = true;
              this._activate();
              return;
            }
          }
        },
        { rootMargin: '200px' }
      );
      this.__hydrationObserver.observe(this);
      return;
    }

    this._activate();
  }

  /**
   * Internal activation method that performs the actual connectedCallback
   * work: setting up the render root, adopting styles, notifying
   * controllers, and performing the first render.
   *
   * Called directly from `connectedCallback()` for normal components, or
   * deferred via IntersectionObserver when `static hydrate = 'visible'`.
   *
   * @private
   */
  _activate() {
    this._connected = true;
    const Ctor = /** @type any */ (this.constructor);
    if (Ctor.shadow === true) {
      const hadSSRShadow = !!this.shadowRoot;
      if (!this.shadowRoot) {
        /** @type any */ (this).attachShadow({ mode: 'open' });
      }
      this._renderRoot = this.shadowRoot;
      const styles = Ctor.styles;
      const list = Array.isArray(styles) ? styles : isCSS(styles) ? [styles] : [];
      if (list.length) {
        // If the shadow root came from Declarative Shadow DOM (SSR), it
        // contains an inline <style> tag. Remove it before switching to
        // adoptedStyleSheets to avoid duplicate styles.
        if (hadSSRShadow) {
          const ssrStyle = this.shadowRoot.querySelector('style');
          if (ssrStyle) ssrStyle.remove();
        }
        adoptStyles(this._renderRoot, list);
      }
    } else {
      this._renderRoot = this;
      // Light DOM: static styles is not supported (no shadow root for
      // adoptedStyleSheets). Warn if the developer set both.
      if (Ctor.styles) {
        console.warn(
          `[webjs] <${Ctor.tag}> has static shadow = false AND static styles. ` +
          `static styles only works with shadow DOM (adoptedStyleSheets). ` +
          `For light DOM, use global CSS or <style> in render().`
        );
      }
    }

    // Notify all controllers that the host is connected.
    for (const c of this.__controllers) {
      if (c.hostConnected) c.hostConnected();
    }

    // For both shadow and light DOM: proceed with _performRender().
    // The client renderer detects SSR content (<!--webjs-hydrate--> for
    // light DOM, existing shadow root for shadow DOM) and hydrates
    // instead of replacing — binding events without touching the DOM.
    this._performRender();
  }


  /**
   * Called when the element is removed from the DOM.
   *
   * Notifies all attached {@link ReactiveController}s so they can clean up
   * subscriptions, timers, and observers. If you override this in a
   * subclass, always call `super.disconnectedCallback()`.
   */
  disconnectedCallback() {
    this._connected = false;
    // Clean up the hydration observer if the element is removed before
    // it became visible.
    if (this.__hydrationObserver) {
      this.__hydrationObserver.disconnect();
      this.__hydrationObserver = null;
    }
    for (const c of this.__controllers) {
      if (c.hostDisconnected) c.hostDisconnected();
    }
  }

  /**
   * @param {string} name  Kebab-cased attribute name
   * @param {string|null} _old
   * @param {string|null} value
   */
  attributeChangedCallback(name, _old, value) {
    // When we are reflecting a property back to an attribute, ignore the
    // resulting attributeChangedCallback to avoid infinite loops.
    if (this.__reflectingAttribute) return;

    const Ctor = /** @type any */ (this.constructor);
    const propName = camelCase(name);
    const def = Ctor.properties && (Ctor.properties[propName] || Ctor.properties[name]);
    if (!def) return;

    let v;
    if (def.converter && def.converter.fromAttribute) {
      v = def.converter.fromAttribute(value, def.type);
    } else if (def.type === Number) {
      v = value == null ? null : Number(value);
    } else if (def.type === Boolean) {
      v = value != null && value !== 'false';
    } else if (def.type === Object || def.type === Array) {
      try { v = value == null ? null : JSON.parse(value); } catch { v = value; }
    } else {
      v = value;
    }

    if (this[propName] !== v) {
      this[propName] = v;
      if (this._connected) this.requestUpdate();
    }
  }

  /**
   * Shallow-merge new state and schedule a re-render.
   *
   * @param {Record<string, unknown>} patch
   */
  setState(patch) {
    this.state = { ...this.state, ...patch };
    if (this._scheduled || !this._connected) return;
    this._scheduled = true;
    queueMicrotask(() => {
      this._scheduled = false;
      this._performRender();
    });
  }

  /**
   * Manually schedule a re-render. Used by controllers to trigger
   * host updates from external events.
   */
  requestUpdate() {
    this.setState({});
  }

  /**
   * Core update cycle:
   *   1. Controllers' hostUpdate()
   *   2. render() + DOM commit (with error boundary)
   *   3. Controllers' hostUpdated()
   *   4. firstUpdated() — once, on the first render only
   */
  _performRender() {
    if (!this._renderRoot) return;

    // --- 1. hostUpdate ---
    for (const c of this.__controllers) {
      if (c.hostUpdate) c.hostUpdate();
    }

    // --- 2. render + DOM commit (with error boundary) ---
    try {
      const tpl = this.render();
      clientRender(tpl, this._renderRoot);
    } catch (error) {
      console.error(`[webjs] render error in <${/** @type any */ (this.constructor).tag || this.tagName}>:`, error);
      try {
        const fallback = this.renderError(/** @type {Error} */ (error));
        if (fallback !== undefined) clientRender(fallback, this._renderRoot);
      } catch (fallbackError) {
        console.error(`[webjs] renderError() also threw:`, fallbackError);
      }
    }

    // --- 3. hostUpdated ---
    for (const c of this.__controllers) {
      if (c.hostUpdated) c.hostUpdated();
    }

    // --- 4. firstUpdated (once) ---
    if (!this.__firstRendered) {
      this.__firstRendered = true;
      this.firstUpdated();
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks — override in subclasses
  // ---------------------------------------------------------------------------

  /**
   * Called exactly once, after the component's very first render completes
   * and the DOM is live.
   *
   * **When to use:** one-time post-render setup that requires DOM access —
   * auto-focusing an input, measuring layout, initializing a third-party
   * library on a DOM node. `connectedCallback` fires before the first
   * render, so querying shadow children there yields nothing.
   *
   * ```js
   * firstUpdated() {
   *   this.shadowRoot.querySelector('input')?.focus();
   * }
   * ```
   */
  firstUpdated() {}

  // ---------------------------------------------------------------------------
  // Reactive controllers
  // ---------------------------------------------------------------------------

  /**
   * Register a {@link ReactiveController} with this component.
   *
   * **When to use:** call this from your controller's constructor (which
   * typically receives the host as its first argument) or from the
   * component's constructor / `connectedCallback`.
   *
   * **Why it exists:** controllers decouple reusable lifecycle behaviour
   * from the class hierarchy. Instead of extending a base class or using
   * a mixin, you compose controllers:
   *
   * ```js
   * class MouseController {
   *   constructor(host) {
   *     this.host = host;
   *     host.addController(this);
   *   }
   *   hostConnected() { window.addEventListener('mousemove', this._onMove); }
   *   hostDisconnected() { window.removeEventListener('mousemove', this._onMove); }
   * }
   * ```
   *
   * If the host is already connected when the controller is added, the
   * controller's `hostConnected()` is called immediately.
   *
   * @param {ReactiveController} controller
   */
  addController(controller) {
    this.__controllers.add(controller);
    if (this._connected && controller.hostConnected) {
      controller.hostConnected();
    }
  }

  /**
   * Unregister a previously added {@link ReactiveController}.
   *
   * **When to use:** call this when a controller's lifetime is shorter
   * than the component's — e.g. a controller that tracks a specific
   * resource and should be swapped out when the resource changes.
   *
   * The controller's `hostDisconnected()` is NOT called by `removeController`;
   * if cleanup is needed, call it yourself before removing.
   *
   * @param {ReactiveController} controller
   */
  removeController(controller) {
    this.__controllers.delete(controller);
  }

  /**
   * Override in subclasses to return a TemplateResult.
   * @returns {unknown}
   */
  render() {
    return '';
  }

  /**
   * Called when `render()` throws an error on the client side.
   *
   * **When to override (AI hint):** Override this to show a fallback UI
   * when a component's render fails. Without this, the error is logged
   * and the component renders nothing. The default implementation returns
   * `undefined` (empty render).
   *
   * **Why it exists:** Client-side error boundary. Prevents one broken
   * component from crashing the entire page. Similar to React's
   * `componentDidCatch` / Error Boundaries.
   *
   * ```js
   * renderError(error) {
   *   return html`<p style="color:red">Something went wrong: ${error.message}</p>`;
   * }
   * ```
   *
   * @param {Error} error  The error thrown by render().
   * @returns {unknown}  A TemplateResult fallback, or undefined for empty.
   */
  renderError(error) {
    return undefined;
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
