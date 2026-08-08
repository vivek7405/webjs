import { render as clientRender } from './render-client.js';
import { setActiveActionSignal } from './action-abort-client.js';
import { carriesFunction } from './form-action.js';
import { isCSS, adoptStyles } from './css.js';
import { register, tagOf } from './registry.js';
import { parse as deserializeProp } from './serialize.js';
import { Signal } from './signal.js';
import {
  captureAuthoredChildren,
  adoptSSRAssignments,
  ensureSlotState,
  hasSlotState,
  hasFrameworkRenderedSubtree,
  installSlotInterception,
  installSlotSensors,
  teardownSlotSensors,
  reconnectSweep,
} from './slot.js';

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
 *   Note: this fires on the FIRST assignment too, with `oldValue` set
 *   to `undefined`. Numeric comparators that subtract against undefined
 *   produce `NaN`, which evaluates to `false`, silently rejecting the
 *   constructor's initial assignment. Treat `oldValue === undefined` as
 *   "always changed" in custom comparators so the initial value lands.
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
 * `String(v)` that cannot itself throw.
 *
 * A rejection reason is whatever the author rejected with, and not every value
 * converts to a primitive: `Object.create(null)` has no `toString`, and a
 * revoked Proxy throws on any operation. Coercing one in an error-reporting
 * path turned a reportable failure into a second, unreported one.
 *
 * @param {unknown} v
 * @returns {string}
 */
function safeString(v) {
  try {
    return String(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

/**
 * Warn that a function value was dropped rather than reflected (#1169).
 *
 * A silently missing attribute is its own confusion, so say what went and why.
 * The message deliberately does NOT include the value: printing the source is
 * the leak this guard exists to prevent, and a server log is not always a
 * private place.
 *
 * UNCONDITIONAL, matching the `.prop=${fn}` unserializable-value drop in
 * `render-server.js`, which is the sibling path this guard mirrors. Two
 * reasons not to gate it on a dev flag. It fires only on a genuine mistake (a
 * function is never a meaningful attribute value), so there is no volume to
 * suppress, and reflection runs per assignment rather than per frame.
 *
 * More decisively, a `NODE_ENV` gate does not survive the dist build.
 * `scripts/build-framework-dist.js` runs esbuild with `platform: 'browser'`
 * and `minify: true`, which substitutes `process.env.NODE_ENV` with
 * `"production"` and folds the check to a constant. The SSR half of the
 * warning would then be unreachable in every published build, which is how
 * every installed app runs, and SSR is the half that matters most, since that
 * is where the leaked source reached visitors.
 *
 * @param {{ constructor: unknown, tagName?: string }} host
 * @param {string} propName
 * @param {string} attrName
 */
function warnFunctionReflection(host, propName, attrName) {
  if (typeof console === 'undefined' || !console.warn) return;
  const tag = tagOf(/** @type any */ (host.constructor)) || host.tagName?.toLowerCase() || 'unknown';
  console.warn(
    `[webjs] reflect:true property "${propName}" on <${tag}> holds a function `
    + `(or an array carrying one), which has no HTML attribute representation. `
    + `Removing "${attrName}" instead of stringifying it (a stringified function `
    + `writes its source into the page, so a server action's body would ship to `
    + `the browser). Pass a string, or drop reflect on this property.`
  );
}

/**
 * Warn that a value with no JSON representation was dropped rather than
 * reflected (#1253).
 *
 * `JSON.stringify` throws for three reasons an app hits in practice: a cycle,
 * a `BigInt`, and an author `toJSON()` that throws. All three mean the same
 * thing here, that there is no string to put in the attribute, so all three
 * get the same answer as a function does.
 *
 * The caught message IS included, unlike `warnFunctionReflection`, which
 * withholds its value on purpose. A function's string form is its source,
 * which is the leak that guard exists to prevent; `JSON.stringify`'s own
 * message names the property path rather than a value, and the sibling
 * `.prop=${val}` SSR drop in `render-server.js` already ends the same way.
 *
 * UNCONDITIONAL, for the reason recorded on `warnFunctionReflection` above: a
 * `NODE_ENV` gate is folded to a constant by the dist build, which would make
 * the SSR half unreachable in every published build, and the SSR half is where
 * the component silently vanishes.
 *
 * @param {{ constructor: unknown, tagName?: string }} host
 * @param {string} propName
 * @param {string} attrName
 * @param {string} [detail] the message `JSON.stringify` threw
 */
function warnUnserializableReflection(host, propName, attrName, detail) {
  if (typeof console === 'undefined' || !console.warn) return;
  const tag = tagOf(/** @type any */ (host.constructor)) || host.tagName?.toLowerCase() || 'unknown';
  console.warn(
    `[webjs] reflect:true property "${propName}" on <${tag}> holds a value `
    + `JSON.stringify cannot serialize (a cycle, a BigInt, or a throwing `
    + `toJSON), so it has no HTML attribute representation. Removing `
    + `"${attrName}" instead. Detail: ${detail}`
  );
}

/**
 * A minimal base for HTML Custom Elements that mirrors Lit's ergonomics
 * while staying JSDoc-only and no-build.
 *
 * Subclasses declare:
 *  - `static properties`: attribute/property declarations with type info,
 *    reflection, custom converters, and internal-state mode
 *  - `static styles`: CSSResult or array thereof (only meaningful with
 *    `static shadow = true`; light-DOM components inherit global CSS)
 *  - `static shadow`: set `true` to opt in to shadow DOM (default: `false`
 *    → light DOM, so Tailwind / global CSS apply directly)
 *  - `render()`: returns a TemplateResult
 *
 * The tag name is not a static field: pass it to `.register('tag-name')`
 * at the bottom of the file. Tag must contain a hyphen (HTML spec).
 *
 * Lifecycle (lit-aligned, called in order during each update cycle):
 *  1. `shouldUpdate(changedProperties)`. Skip update if false.
 *  2. `willUpdate(changedProperties)`. Safe to set properties; folds into this cycle.
 *  3. controllers' `hostUpdate()`
 *  4. `update(changedProperties)`. Default impl calls `render()` + commits.
 *  5. controllers' `hostUpdated()`
 *  6. `firstUpdated(changedProperties)`: once, on the first render only
 *  7. `updated(changedProperties)`: every render commit
 *  8. `updateComplete` promise resolves
 *
 * `changedProperties` is a `Map<string, unknown>` where each entry maps
 * a property name to its previous value.
 *
 * MAINTAINER NOTE. Adding a new overridable lifecycle hook here means
 * the display-only component elision analyser must learn about it too,
 * or it will wrongly elide a component that now does client work. Add
 * the hook name to `CLIENT_LIFECYCLE_HOOKS` in
 * `packages/server/src/component-elision.js`. The guard test at
 * `packages/server/test/elision/lifecycle-coverage.test.js` introspects
 * this prototype and fails until you do.
 *
 * Usage:
 * ```js
 * import { signal } from '@webjsdev/core';
 *
 * const count = signal(0);
 *
 * class MyCounter extends WebComponent {
 *   render() {
 *     return html`<button @click=${() => count.set(count.get() + 1)}>${count.get()}</button>`;
 *   }
 * }
 * MyCounter.register('my-counter');
 * ```
 */

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
function makeServerInternals() {
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
class ServerElement {
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

// Base class choice: real HTMLElement on the browser, the shim on the server.
const Base = isBrowser ? HTMLElement : /** @type {any} */ (ServerElement);

/**
 * Marker stamped on the anonymous subclass the `WebComponent({...})` factory
 * produces. It lets `_assertFactoryProperties` tell the framework's own
 * factory-generated `static properties` (allowed) apart from a `static
 * properties` a user wrote by hand in a class body (no longer allowed).
 */
const FACTORY_PROPS = Symbol('webjs.factoryProps');

// Per-class memo so the constructor-time enforcement walk runs once per class.
const _propsChecked = new WeakSet();

class WebComponentBase extends Base {
  /** Whether to use shadow DOM. Default: false (light DOM). @type {boolean} */
  static shadow = false;

  /**
   * Hydration strategy for this component.
   *
   * **AI hint:** Set `static hydrate = 'visible'` to defer client-side
   * hydration until the element scrolls into (or near) the viewport. The
   * server-rendered Declarative Shadow DOM content stays visible the whole
   * time: users see the SSR HTML immediately while JavaScript activation
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
   * and never reflect: they behave like private reactive state.
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
   * Register this class as a custom element under `tag`.
   *
   *     class Counter extends WebComponent { … }
   *     Counter.register('my-counter');
   *
   * Delegates to `customElements.define` (or the server-side shim) via the
   * internal registry. The module URL for `<link rel="modulepreload">`
   * hints is derived server-side by scanning the app tree: no need to
   * pass `import.meta.url`.
   *
   * @param {string} tag  Must contain a hyphen (HTML spec).
   */
  static register(tag) {
    register(tag, this);
  }

  /**
   * Returns the list of attribute names the browser should observe.
   * Properties with `state: true` are excluded: they are internal-only
   * and do not correspond to any HTML attribute.
   *
   * @returns {string[]}
   */
  static get observedAttributes() {
    const props = this.properties || {};
    return Object.keys(props)
      .filter((k) => !(typeof props[k] === 'object' && props[k].state))
      .map((k) => (typeof props[k] === 'object' && props[k].attribute) || hyphenate(k));
  }

  constructor() {
    super();
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

    /**
     * Map of changed properties accumulated since the last render. Keys are
     * property names; values are the previous value before the change. Passed
     * to `shouldUpdate`, `willUpdate`,
     * `update`, `firstUpdated`, and `updated`. Cleared at the start of each
     * render cycle so accumulations during hooks queue for the next cycle.
     * @type {Map<string, unknown>}
     */
    this._changedProperties = new Map();

    /**
     * Resolver for the currently-pending updateComplete promise. `null` when
     * no update is pending.
     * @type {((value: boolean) => void) | null}
     * @private
     */
    this._updateResolve = null;

    /**
     * Promise that resolves after the next render commit. Resolves to `true`
     * when there are no further pending updates, `false` otherwise.
     * @type {Promise<boolean>}
     * @private
     */
    this._updatePromise = Promise.resolve(true);

    /**
     * Set while the component is inside the update phase (between
     * `shouldUpdate` and `updated`). Property assignments during this window
     * fold into the CURRENT `changedProperties` Map without scheduling a
     * new microtask render. Assignments during `updated()` (after the flag
     * clears) queue a fresh cycle.
     * @type {boolean}
     * @private
     */
    this._isUpdating = false;

    // Enforce the declare-free factory DX: a hand-written `static properties`
    // in a class body is a hard error (use `extends WebComponent({ … })`).
    this._assertFactoryProperties();

    // Install reactive property accessors for `static properties` declarations.
    this._initializeProperties();
  }

  /**
   * Throw if a class in this instance's constructor chain declares its own
   * `static properties`. Reactive properties must be declared via the
   * `extends WebComponent({ … })` factory, which stamps {@link FACTORY_PROPS}
   * on the subclass it generates; a `static properties` written by hand in a
   * class body carries no such marker and is rejected here (issue #598).
   *
   * The walk stops at {@link WebComponentBase} (whose `static properties = {}`
   * default is internal) and is memoized per class so it runs once.
   * @private
   */
  _assertFactoryProperties() {
    const Ctor = /** @type {any} */ (this.constructor);
    if (_propsChecked.has(Ctor)) return;
    let C = Ctor;
    while (C && C !== WebComponentBase) {
      if (Object.hasOwn(C, 'properties') && !Object.hasOwn(C, FACTORY_PROPS)) {
        const name = C.name || 'a component';
        throw new Error(
          `${name}: \`static properties\` is no longer supported. Declare reactive ` +
            `properties via the factory instead: \`class ${name} extends WebComponent({ ` +
            `count: Number })\`. Use the \`prop()\` helper for options ` +
            `(\`prop(Number, { reflect: true })\`) and set defaults in the ` +
            `constructor after \`super()\`. See https://webjs.dev/docs/components.`,
        );
      }
      C = Object.getPrototypeOf(C);
    }
    _propsChecked.add(Ctor);
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

          // requestUpdate records the (name, oldValue) entry AND schedules
          // a render. When called during the update phase (willUpdate /
          // hostUpdate / update / hostUpdated), the scheduler short-circuits
          // and the entry folds into the current cycle's changedProperties.
          this.requestUpdate(propName, oldVal);
        },
      });

      if (initial !== undefined) {
        this.__propValues[propName] = initial;
      } else if (d.default !== undefined) {
        // Declarative `default` option (lit-parity). A function default is
        // CALLED per instance, so an object / array default is a fresh value
        // per element. Written straight to the backing store; an applied
        // attribute (attributeChangedCallback runs later) overrides it.
        this.__propValues[propName] =
          typeof d.default === 'function' ? d.default() : d.default;
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
    // A custom `attribute` option wins over the kebab-cased property name.
    const attrName = decl.attribute || hyphenate(propName);
    // Guard against re-entrant loops: attributeChangedCallback fires when
    // we call setAttribute, which would call the setter again.
    if (this.__reflectingAttribute) return;
    this.__reflectingAttribute = true;
    try {
      if (decl.converter && decl.converter.toAttribute) {
        const serialized = decl.converter.toAttribute(value, decl.type);
        if (serialized == null) this.removeAttribute(attrName);
        else this.setAttribute(attrName, serialized);
      } else if (typeof value === 'function') {
        // #1169: the value IS a function, and no branch below has a
        // meaningful serialization for one. `String(fn)` is the function's
        // SOURCE, so a reflected `'use server'` action would ship its whole
        // body, closure secrets included, to every visitor, and
        // `JSON.stringify(fn)` is `undefined`, which `setAttribute` writes as
        // the literal string "undefined". Treat it like `null` and remove the
        // attribute, matching what the `.prop=${fn}` SSR binding already does
        // for an unserializable value.
        //
        // Placed AFTER the converter branch on purpose: a custom
        // `toAttribute` is author-controlled, so its author has taken
        // responsibility for serializing whatever they are handed.
        this.removeAttribute(attrName);
        warnFunctionReflection(this, propName, attrName);
      } else if (decl.type === Boolean) {
        if (value) this.setAttribute(attrName, '');
        else this.removeAttribute(attrName);
      } else if (value == null) {
        this.removeAttribute(attrName);
      } else if (decl.type === Object || decl.type === Array) {
        // One rule about an unserializable reflected value, in two halves.
        //
        // A JSON-typed prop CARRYING a function is safe and stays whole:
        // `JSON.stringify` drops a function to `null` in an array and omits
        // the key in an object, so `[1, 2, fn]` serializes to `[1,2,null]`
        // with no source and no data loss. Refusing here would discard the
        // `1` and the `2` on a path that never leaked.
        //
        // A value `JSON.stringify` cannot serialize AT ALL is the other half
        // (#1253): a cycle, a `BigInt`, or an author `toJSON()` that throws.
        // The throw used to escape reflection entirely, so a property
        // assignment threw from the setter, a client upgrade threw out of
        // `connectedCallback` before the first render, and an SSR render was
        // swallowed by per-component isolation and emitted the component
        // EMPTY at a 200. There is no string to put in the attribute, so the
        // attribute goes, exactly as it does for a function. The `catch` IS
        // the detection: `JSON.stringify` already walks the value, so its own
        // failure covers all three causes, where a cycle-only pre-walk would
        // miss the other two and pay a full traversal per reflection.
        let serialized;
        let serializable = true;
        try {
          serialized = JSON.stringify(value);
        } catch (e) {
          serializable = false;
          this.removeAttribute(attrName);
          warnUnserializableReflection(this, propName, attrName, e && e.message);
        }
        // Outside the `try` on purpose, so a genuine `setAttribute` failure
        // (an invalid attribute name) still surfaces instead of being folded
        // into the unserializable path.
        if (serializable) this.setAttribute(attrName, serialized);
      } else if (carriesFunction(value)) {
        // The string fall-through is the one place a CARRIED function still
        // leaks. `String([fn])` is `Array.prototype.join`, which runs
        // `String()` on every element, so `[serverAction]` writes the same
        // source `serverAction` does. Hence the recursive predicate the
        // form-action guard already uses, rather than a bare `typeof`, but
        // scoped to this branch rather than applied above, where JSON
        // handles the same shape losslessly.
        this.removeAttribute(attrName);
        warnFunctionReflection(this, propName, attrName);
      } else {
        this.setAttribute(attrName, String(value));
      }
    } finally {
      this.__reflectingAttribute = false;
    }
  }

  connectedCallback() {
    if (!isBrowser) return;

    // Apply any `data-webjs-prop-*` attributes emitted by SSR. The server
    // emits these for `.prop=${val}` bindings in parent templates so
    // rich-typed values (Array, Object, Date, Map, Set, BigInt, cycles)
    // round-trip through the rendered HTML. Once applied, the attributes
    // are stripped so the settled DOM matches what the user would expect
    // from the JS source: no framework artifacts left on the element.
    // One-time per element. Subsequent reconnections do nothing.
    if (!this.__webjsPropsHydrated) {
      this.__webjsPropsHydrated = true;
      this._hydratePropAttrs();
    }

    const Ctor = /** @type any */ (this.constructor);

    // Selective hydration: defer activation until the element scrolls into
    // (or near) the viewport. The DSD content from SSR stays visible the
    // whole time: the user sees the server-rendered HTML.
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
  /**
   * Read `data-webjs-prop-*` attributes (emitted by SSR for `.prop=${val}`
   * bindings in parent templates), decode each via the wire serializer,
   * assign the decoded value to the corresponding camelCase property on
   * this instance, and remove the attribute from the DOM. After this
   * runs, inspecting the element shows the same attributes the developer
   * would expect from the JS source.
   *
   * @private
   */
  _hydratePropAttrs() {
    /** @type {string[]} */
    const names = [];
    const attrs = this.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const n = attrs[i].name;
      if (n.startsWith('data-webjs-prop-')) names.push(n);
    }
    for (const fullName of names) {
      const raw = this.getAttribute(fullName);
      this.removeAttribute(fullName);
      if (raw == null) continue;
      const propName = camelCase(fullName.slice('data-webjs-prop-'.length));
      try {
        /** @type any */ (this)[propName] = deserializeProp(raw);
      } catch (err) {
        console.warn(
          `[webjs] failed to decode ${fullName} on <${this.tagName.toLowerCase()}>: ${err && err.message}`
        );
      }
    }
  }

  _activate() {
    this._connected = true;
    // Reflect declared reflect:true properties from their current value now
    // that the element is connected. Constructor / willUpdate defaults were
    // set while disconnected (the setter skips reflection then), so this is
    // what makes a freshly-created client element carry the same reflected
    // attributes the SSR walker emitted. Same-value reflects are no-ops, so a
    // hydrated element (whose attribute already arrived from SSR) is unchanged.
    this._reflectDeclaredAttributes();
    const Ctor = /** @type any */ (this.constructor);
    // Mark LIGHT-DOM component hosts so the framework default host rule
    // (`@layer webjs-host { :where([data-wj-host]) { display: block } }`)
    // applies. SSR already stamps this on server-rendered light hosts
    // (idempotent here); this also covers a client-only light component (never
    // SSR'd) so it does not collapse. Shadow hosts are NOT marked: a document
    // rule would override the shadow author's own `:host { display: … }`, so
    // shadow components control their host display via `:host` in `static styles`.
    if (Ctor.shadow !== true && !this.hasAttribute('data-wj-host')) {
      this.setAttribute('data-wj-host', '');
    }
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
          `[webjs] <${tagOf(Ctor) || this.tagName?.toLowerCase()}> has static shadow = false AND static styles. ` +
          `static styles only works with shadow DOM (adoptedStyleSheets). ` +
          `For light DOM, use global CSS or <style> in render().`
        );
      }
      // Light-DOM slot capture: ONCE per host lifetime (#1015). Three
      // sub-paths, all of which resolve to "the record is populated
      // exactly once and never re-captured":
      //
      // a. Reconnection. The record already exists from a prior mount.
      //    The host still carries the rendered template DOM (plus
      //    placed slot children) from before the disconnect. Skip
      //    capture (would wrongly hoover up rendered nodes) and skip
      //    SSR adoption. clientRender will see the existing INSTANCE
      //    and updateInstance instead of recreating; the DOM stays.
      //
      // b. SSR hydration (first mount, <!--webjs-hydrate--> marker
      //    present). Children are already inside their
      //    <slot data-webjs-light data-projection="actual"> elements
      //    (injectDSD placed them). Adopt those assignments BEFORE
      //    _performRender so we retain references to the SSR'd nodes;
      //    the renderer's createInstance().replaceChildren() will
      //    detach them, but the slot-apply step re-attaches the same
      //    Node refs into the freshly-cloned slot. DOM identity
      //    preserved through the hydration round-trip.
      //
      // c. First mount, no SSR. Partition authored children into the
      //    record before _performRender wipes the host.
      //
      // After capture, installSlotInterception + installSlotSensors below make
      // native DOM writes on a mounted host live (appendChild, slot= flips,
      // innerHTML, HTMLSlotElement.assign), so light-DOM slots match shadow DOM
      // through the standard API.
      if (hasSlotState(this)) {
        // (a) Reconnection. Record already populated. Sweep any direct child
        //     added by a raw bypass write while the host was disconnected (no
        //     sensor was live to catch it), then re-arm the sensors below.
        reconnectSweep(this);
      } else if (
        this.__isHydrating() ||
        this.hasAttribute('data-wj-serialized') ||
        hasFrameworkRenderedSubtree(this)
      ) {
        // (b) Framework-rendered markup, from any of three signals: boot-time
        //     SSR hydration (the webjs-hydrate marker), the router's
        //     data-wj-serialized stamp (applySwap marks every host in a parsed
        //     doc, covering a snapshot restore whose serialized shape has no
        //     projected slot to detect), or the structural detector (own
        //     data-webjs-light[data-projection] slots, attributes only the
        //     renderer / SSR stamps). Adopt-not-capture: capturing restored
        //     post-hydration HTML would hoover the rendered tree into the
        //     record and duplicate content on the next render (the #1006
        //     shape, on the restore path).
        this.removeAttribute('data-wj-serialized');
        ensureSlotState(this);
        adoptSSRAssignments(this);
      } else {
        // (c) First mount with author-written children. Capture them.
        captureAuthoredChildren(this);
      }
      // Install native-write interception AFTER capture (capture uses the
      // host's still-native methods), then arm the sensors. Together they make
      // appendChild / insertBefore / removeChild / innerHTML / slot= flips on a
      // mounted light host drive the slot record, restoring full shadow-DOM
      // parity through the standard DOM API. Interception installs once;
      // sensors are armed on every connect and torn down on disconnect.
      installSlotInterception(this);
      installSlotSensors(this);
    }

    // Notify all controllers that the host is connected.
    for (const c of this.__controllers) {
      if (c.hostConnected) c.hostConnected();
    }

    // First render is deferred to a microtask, matching lit's
    // performUpdate scheduling. The user's connectedCallback override
    // body runs synchronously to completion BEFORE the first render,
    // so subclass setup that needs to inspect attributes / state / etc.
    // observes consistent timing whether SSR-hydrating or first mount.
    // Render-root setup (shadow attachment, light-DOM SSR adoption,
    // controller hostConnected, _connected=true) all stay synchronous
    // above; only the template commit + post-commit slot observers
    // defer. Authoring contract: post-render DOM setup goes in
    // firstUpdated(), NOT connectedCallback().
    //
    // The scheduling matches `_scheduleUpdate`'s wrapper so lifecycle
    // throws are surfaced as console errors instead of bricking the
    // element.
    if (this._updateResolve === null) {
      this._updatePromise = new Promise((resolve) => {
        this._updateResolve = resolve;
      });
    }
    this._scheduled = true;
    queueMicrotask(() => {
      this._scheduled = false;
      try {
        this._performRender();
      } catch (err) {
        console.error(`[webjs] lifecycle hook threw during initial render:`, err);
      }
      // The renderer's slot parts place the record content as part of the
      // commit; native DOM writes on the host (appendChild, slot= flips,
      // innerHTML) drive the record live through the interception + sensors
      // installed on connect. There is no WebJs-specific slot API.
    });
  }

  /**
   * True when this host's first child is the framework's hydration
   * marker, meaning the SSR pipeline already rendered the template's
   * shape (including <slot data-webjs-light> elements with their
   * projected children inside) and the client should bind events
   * without re-creating DOM. Sets __hydratedAtActivate as a side
   * effect so the post-render path picks up the SSR assignment table.
   *
   * @returns {boolean}
   * @private
   */
  __isHydrating() {
    const first = this.firstChild;
    const isHydrate =
      first != null &&
      first.nodeType === 8 &&
      /** @type {Comment} */ (first).data === 'webjs-hydrate';
    if (isHydrate) this.__hydratedAtActivate = true;
    return isHydrate;
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
    // Tear down the slot sensors, processing any queued records first (a bare
    // disconnect() drops them). The per-host slot record + interception are
    // preserved so a reconnection picks up where it left off (sensors re-arm in
    // connectedCallback).
    teardownSlotSensors(this);
    // Dispose the signal watcher so dependency edges drop. Without
    // this the element holds references to module-scope signals
    // (and vice versa) forever.
    if (this.__signalWatcher) {
      this.__signalWatcher.dispose();
      this.__signalWatcher = undefined;
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
    const allProps = (Ctor.properties || {});
    // Resolve the incoming attribute name to its property. A custom
    // `attribute` option wins; otherwise the kebab-cased property name. Falls
    // back to the camelCase of the attribute for the common (kebab) case.
    let propName, raw;
    for (const [k, decl] of Object.entries(allProps)) {
      const d = typeof decl === 'object' ? decl : { type: decl };
      if ((d.attribute || hyphenate(k)) === name) { propName = k; raw = decl; break; }
    }
    if (raw === undefined) { propName = camelCase(name); raw = allProps[propName] || allProps[name]; }
    if (raw === undefined) return;
    // A declaration is either a full descriptor (`{ type: Number, … }`) or the
    // bare-constructor shorthand the factory accepts (`count: Number`), in which
    // case the value IS the type. Normalise so type-based coercion fires either
    // way (matches `_initializeProperties`).
    const def = typeof raw === 'object' ? raw : { type: raw };

    let v;
    if (def.converter && def.converter.fromAttribute) {
      v = def.converter.fromAttribute(value, def.type);
    } else if (def.type === Number) {
      v = value == null ? null : Number(value);
    } else if (def.type === Boolean) {
      v = value != null && value !== 'false';
    } else if (def.type === Object || def.type === Array) {
      // An attribute that is not parseable JSON is treated exactly like an
      // ABSENT one (#1253). The reason is not that the writer can only ever
      // produce valid JSON: `JSON.stringify` RETURNS `undefined` without
      // throwing for a `Symbol` and for a `toJSON()` that returns nothing, and
      // `setAttribute` writes that as the literal string, so `cfg="undefined"`
      // is still reachable and is deliberately left alone as a separate defect.
      // The reason is that a STRING is never a valid value for a property the
      // author declared `Object` or `Array`, whatever put it there. `null` is
      // what an unset property holds and what an absent attribute already
      // yields through the `value == null` arm on this same line, so it is the
      // one answer that does not invent a value. `applyAttrsToInstance` in
      // `render-server.js` is the SSR counterpart of THIS branch and falls back
      // identically; the two must agree or an element SSRs holding one value
      // and re-renders holding another. That pairing covers the default
      // converter only: a prop supplying its own `converter.fromAttribute` is
      // handled by the arm above, and the SSR reader has no converter arm at
      // all, so the two sides already read such a prop differently. That gap
      // predates #1253. lit's `defaultConverter.fromAttribute`
      // lands on the same `null`, for the reason its own comment gives: an
      // element does not complain about being mis-configured.
      try { v = value == null ? null : JSON.parse(value); } catch { v = null; }
    } else {
      v = value;
    }

    if (this[propName] !== v) {
      this[propName] = v;
      if (this._connected) this.requestUpdate();
    }
  }

  /**
   * Schedule a re-render. Optionally record a property change in
   * `changedProperties` so hooks can branch on what changed.
   *
   * @param {string} [name]      Property name that changed
   * @param {unknown} [oldValue] Previous value of the property
   */
  requestUpdate(name, oldValue) {
    if (name !== undefined && !this._changedProperties.has(name)) {
      this._changedProperties.set(name, oldValue);
    }
    this._scheduleUpdate();
  }

  /**
   * Internal scheduler driven by reactive-property setters, the signal
   * watcher, and explicit `requestUpdate()` calls. Coalesces multiple
   * changes in the same tick into a single microtask render.
   * Manages the `updateComplete` promise lifecycle. Short-circuits when
   * the component is mid-update (assignments during `willUpdate` / `update`
   * fold into the current cycle's `changedProperties` Map).
   * @private
   */
  _scheduleUpdate() {
    if (this._updateResolve === null) {
      this._updatePromise = new Promise((resolve) => {
        this._updateResolve = resolve;
      });
    }
    if (this._isUpdating) return;
    if (this._scheduled || !this._connected) return;
    this._scheduled = true;
    queueMicrotask(() => {
      this._scheduled = false;
      try {
        this._performRender();
      } catch (err) {
        // _performRender wraps the update phase in try/finally so this
        // catches throws from shouldUpdate / willUpdate / hostUpdate /
        // hostUpdated / firstUpdated / updated. The component is not
        // left in a bad state (the finally blocks reset _isUpdating and
        // resolve updateComplete). Surface the error for visibility.
        console.error(`[webjs] lifecycle hook threw during update cycle:`, err);
      }
    });
  }

  /**
   * Core update cycle, lit-aligned:
   *   1. Snapshot + clear `changedProperties`
   *   2. `shouldUpdate(changedProperties)`. If false, resolve updateComplete and return.
   *   3. `willUpdate(changedProperties)`. Safe to set properties without re-triggering.
   *   4. Controllers' `hostUpdate()`
   *   5. `update(changedProperties)`. Default impl calls `render()` + commits.
   *      Wrapped in error boundary that falls back to `renderError(error)`.
   *   6. Controllers' `hostUpdated()`
   *   7. `firstUpdated(changedProperties)` runs once, on the first render only
   *   8. `updated(changedProperties)` runs after every commit
   *   9. Resolve `updateComplete` promise
   * @private
   */
  _performRender() {
    if (!this._renderRoot) return;

    // Hold a stable reference to the current Map so all hooks see the same
    // snapshot. During the update phase (steps 3-6) the Map is mutated in
    // place when property setters fire, folding those changes into THIS
    // cycle. The Map is replaced with a fresh empty one only after a
    // successful commit so post-commit assignments queue the NEXT cycle.
    // On `shouldUpdate=false` or hook errors, the Map is preserved so the
    // accumulated changes survive into the next render.
    const changedProperties = this._changedProperties;

    // --- 1. Mark we're inside an update cycle ---
    this._isUpdating = true;
    let didCommit = false;
    // Set when render() was async: the DOM commit lands when this settles,
    // so the post-commit half of the cycle defers until then (#469).
    let pendingCommit = null;

    // --- 2-6. Update phase. Lifecycle-hook throws are logged and
    // swallowed so the component is not left in a deadlocked state
    // (`_isUpdating` stuck true, `updateComplete` never resolves).
    try {
      if (this.shouldUpdate(changedProperties)) {
        // --- 3. willUpdate (may mutate properties; folds into this cycle) ---
        this.willUpdate(changedProperties);

        // --- 4. controllers' hostUpdate ---
        for (const c of this.__controllers) {
          if (c.hostUpdate) c.hostUpdate();
        }

        // --- 5. update + DOM commit (with render-error boundary) ---
        // Stamp a fresh render token for THIS commit, sync or async. A later
        // cycle that reaches here bumps it, so an in-flight async render whose
        // token no longer matches drops its now-stale resolution. Stamping
        // here (not inside _commitAsync) is what guards the async-superseded-
        // by-sync case (#469); a shouldUpdate=false cycle never reaches here,
        // so it does not invalidate an in-flight async render.
        this.__renderToken = (this.__renderToken || 0) + 1;
        // Abort the superseded render's in-flight action fetches (#492), start a
        // fresh controller for this render, and bind it as the active signal so
        // the RPC stub ties its fetches to this render. A superseded fetch's
        // AbortError is dropped by the render-token guard in _commitAsync.
        if (this.__renderAbort) this.__renderAbort.abort();
        this.__renderAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        setActiveActionSignal(this.__renderAbort ? this.__renderAbort.signal : null);
        try {
          const r = this.update(changedProperties);
          if (r && typeof r.then === 'function') pendingCommit = r;
        } catch (error) {
          this._handleRenderError(/** @type {Error} */ (error));
        } finally {
          // The synchronous portion of render() has run; actions invoked there
          // already captured the signal. Clear it so a later event handler is
          // not bound to a stale render's controller.
          setActiveActionSignal(null);
        }

        if (!pendingCommit) {
          // --- 6. controllers' hostUpdated (sync commit) ---
          for (const c of this.__controllers) {
            if (c.hostUpdated) c.hostUpdated();
          }
          didCommit = true;
        }
      }
      // shouldUpdate=false: preserve _changedProperties so the next
      // requestUpdate keeps accumulating on top of the entries that
      // didn't render this cycle.
    } catch (preCommitError) {
      console.error(`[webjs] lifecycle hook threw during update phase:`, preCommitError);
    } finally {
      this._isUpdating = false;
      // The snapshot is consumed once the commit is DISPATCHED. For an async
      // render it resets here too, so a property change during the in-flight
      // fetch starts a fresh cycle (whose render token supersedes this one).
      if (didCommit || pendingCommit) {
        this._changedProperties = new Map();
      }
    }

    // --- Async render: finish the cycle when the pending commit settles. ---
    if (pendingCommit) {
      const token = this.__renderToken;
      // Count this in-flight async commit so a non-committing cycle
      // (shouldUpdate=false) running during the fetch does NOT resolve
      // updateComplete early: the pending commit owns the resolution.
      this.__pendingAsyncCommits = (this.__pendingAsyncCommits || 0) + 1;
      const settle = () => {
        // Always decrement first, even when superseded, so the in-flight
        // count never leaks (a superseded cycle returns below without
        // committing, but it is no longer pending).
        this.__pendingAsyncCommits--;
        // A newer render superseded this one; let the newer cycle finish.
        if (token !== this.__renderToken) return;
        // --- 6. controllers' hostUpdated (after the async commit) ---
        for (const c of this.__controllers) {
          if (c.hostUpdated) c.hostUpdated();
        }
        // --- 7-8 + updateComplete ---
        this._postCommit(changedProperties);
      };
      // A rejection has to settle the cycle too, or the counter stays >= 1
      // forever: that both wedges `updateComplete` for this instance and
      // disables the `!this.__pendingAsyncCommits` escape below for every
      // later non-committing cycle. `_commitAsync` is written not to reject,
      // but it is not the only thenable that reaches here: `update()` is a
      // documented override point and may return one, so the handler belongs
      // at this site rather than only at the one implementation of it.
      pendingCommit.then(settle, (error) => {
        // The token check gates the DOM write, NOT the release. A superseded
        // cycle rejecting late (a discarded fetch, or the #492 abort of its own
        // in-flight action surfacing as an AbortError) must not commit its
        // error state over the newer render that already replaced it, which is
        // the same rule both handlers inside _commitAsync follow. `settle()`
        // still runs either way: it does its own token check before touching
        // anything, and the decrement it owns has to happen regardless or the
        // counter wedges exactly as it did before this handler existed.
        // `finally`, not a trailing statement: the release must survive
        // anything the reporting path throws. `String(error)` is evaluated in
        // the argument expression, OUTSIDE _handleRenderError's own try/catch,
        // so a rejection reason that cannot be coerced (a null-prototype
        // object, a revoked Proxy) threw a TypeError straight out of this
        // handler and skipped the decrement, wedging the counter in exactly
        // the way this handler exists to prevent.
        try {
          if (token === this.__renderToken) {
            this._handleRenderError(error instanceof Error ? error : new Error(safeString(error)));
          }
        } finally {
          settle();
        }
      });
      return;
    }

    // --- 7-8. Post-commit hooks (sync path). Errors are caught so the
    // updateComplete promise always resolves.
    if (didCommit) {
      this._postCommit(changedProperties);
    } else if (!this.__pendingAsyncCommits) {
      // A non-committing cycle resolves updateComplete only when no async
      // commit is in flight; otherwise the pending commit resolves it once it
      // lands, so `await el.updateComplete` never returns before that DOM.
      this._resolveUpdate();
    }
  }

  /**
   * Resolve the pending updateComplete promise. Value reflects whether any
   * further updates were queued during the current cycle: `true` means the
   * component has settled, `false` means another render will run.
   * @private
   */
  _resolveUpdate() {
    if (this._updateResolve) {
      const settled = this._changedProperties.size === 0;
      this._updateResolve(settled);
      this._updateResolve = null;
    }
  }

  /**
   * Run the pre-render half of the update cycle synchronously for SSR.
   *
   * The SSR walker constructs the instance, applies attributes/props, then
   * calls this BEFORE `render()`. It mirrors how lit drives the update
   * lifecycle server-side: `willUpdate` runs so derived state computed there
   * is correct in the SSR'd HTML, then reactive controllers' `hostUpdate`
   * runs, then reflect:true properties are written to attributes so they
   * appear in the serialized output. It deliberately does NOT run
   * `shouldUpdate` (SSR always produces the first paint, there is no prior
   * render to skip), `update` (the walker commits by calling `render`
   * itself), or the post-commit hooks `firstUpdated` / `updated` (browser-only
   * DOM work).
   *
   * `_isUpdating` is set so a property assignment inside `willUpdate` folds
   * into the current `changedProperties` snapshot instead of scheduling a
   * fresh cycle (the SSR scheduler short-circuits anyway, since the element
   * is not connected). Hook throws propagate to the walker's per-component
   * try/catch, which logs an actionable hint and skips DSD for that element,
   * the same as a throwing `render()`.
   */
  performServerUpdate() {
    const changedProperties = this._changedProperties;
    this._isUpdating = true;
    try {
      this.willUpdate(changedProperties);
      for (const c of this.__controllers) {
        if (c.hostUpdate) c.hostUpdate();
      }
      this._reflectDeclaredAttributes();
    } finally {
      this._isUpdating = false;
    }
  }

  /**
   * Reflect every reflect:true (non-state) property to its attribute from its
   * CURRENT value, regardless of whether the value arrived via the setter.
   *
   * The property setter only reflects on a connected change, so a value set
   * in the constructor (a default) or in `willUpdate` is not reflected by the
   * setter alone. This syncs those: the SSR walker calls it in
   * `performServerUpdate` (writing into the server attribute shim, which the
   * walker reads back into the rendered HTML), and `_activate` calls it on
   * the client's first connected render. Running it on both sides is what
   * keeps a server-rendered element and a freshly-created client element
   * agree on their reflected attributes (matching lit, which reflects during
   * the first update). `_reflectAttribute`'s re-entrancy guard makes a
   * same-value reflect a no-op, so re-reflecting an attribute that already
   * arrived from SSR does not churn.
   * @private
   */
  _reflectDeclaredAttributes() {
    const props = /** @type {any} */ (this.constructor).properties || {};
    for (const name of Object.keys(props)) {
      const decl = props[name];
      if (!decl || !decl.reflect || decl.state) continue;
      this._reflectAttribute(name, this[name], decl);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks: override in subclasses
  // ---------------------------------------------------------------------------

  /**
   * Decide whether the component should render in response to a queued
   * update. Default implementation returns `true` (always render).
   *
   * **When to use:** override to skip an update when the relevant inputs
   * haven't changed, e.g. an expensive component that only depends on a
   * subset of its reactive properties.
   *
   * ```js
   * shouldUpdate(changedProperties) {
   *   return changedProperties.has('itemCount') || changedProperties.has('mode');
   * }
   * ```
   *
   * @param {Map<string, unknown>} _changedProperties
   * @returns {boolean}
   */
  shouldUpdate(_changedProperties) {
    return true;
  }

  /**
   * Run immediately before `update()`. Safe to set reactive properties
   * here without triggering another update cycle: assignments made inside
   * `willUpdate` are folded into the current `changedProperties` snapshot
   * and rendered in the same pass.
   *
   * **When to use:** computing derived values from changed inputs before
   * `render()` reads them. Lit users typically migrate `shouldUpdate`
   * heuristics that mutate state into `willUpdate`.
   *
   * ```js
   * willUpdate(changedProperties) {
   *   if (changedProperties.has('items')) {
   *     this.totalCount = this.items.length;
   *   }
   * }
   * ```
   *
   * @param {Map<string, unknown>} _changedProperties
   */
  willUpdate(_changedProperties) {}

  /**
   * The render-and-commit step. Default impl calls `render()` and commits
   * the returned `TemplateResult` to the render root.
   *
   * **When to use:** rarely. Override only when you need to wrap or
   * short-circuit the commit. Most users override `render()` instead.
   * If you do override, you MUST commit something to `this._renderRoot`
   * (or call `super.update(changedProperties)`).
   *
   * @param {Map<string, unknown>} _changedProperties
   */
  update(_changedProperties) {
    // Track signal reads during render so the component re-renders when
    // any of them change. The watcher is lazy-allocated on first
    // render and disposed in disconnectedCallback. observe() clears
    // prior dep edges before fn(), so each render re-records its own
    // (possibly different) read set.
    if (!this.__signalWatcher) {
      this.__signalWatcher = new Signal.subtle.Watcher(() => {
        if (this._connected) this.requestUpdate();
      });
    }
    let tpl;
    this.__signalWatcher.observe(() => { tpl = this.render(); });
    // Bare-await async render (#469): render() returned a promise. Use
    // stale-while-revalidate: keep the current DOM (the SSR first paint on
    // hydration, or the prior content on a re-fetch) visible until the new
    // template resolves, then commit it. Returns the pending promise so
    // _performRender defers the post-commit half of the cycle (hostUpdated,
    // firstUpdated/updated, updateComplete) until the real commit lands.
    // (Note: only signal reads BEFORE the first `await` are tracked; reads
    // after a suspension point do not establish reactive dependencies.)
    if (tpl && typeof (/** @type any */ (tpl).then) === 'function') {
      return this._commitAsync(/** @type {Promise<unknown>} */ (tpl));
    }
    clientRender(tpl, this._renderRoot);
    return undefined;
  }

  /**
   * Commit a promise-returning render() with stale-while-revalidate
   * semantics (#469). The current DOM stays untouched until the template
   * resolves; on a client RE-FETCH an author-defined renderFallback()
   * optionally swaps in a loading state first. The cycle's render token
   * (stamped by _performRender before update() ran) drops a superseded
   * resolution so an out-of-order fetch never commits stale DOM, INCLUDING
   * when the superseding render is synchronous (a later cycle re-stamps the
   * token whether or not it is async). A rejection routes to the
   * renderError() boundary, isolated to this component. Returns a promise
   * that settles once the commit (or its error / fallback) has been applied.
   *
   * @param {Promise<unknown>} pending
   * @returns {Promise<void>}
   * @private
   */
  _commitAsync(pending) {
    const token = this.__renderToken;
    // First paint (hydration): keep the SSR DOM, never a fallback, so
    // first-paint data stays visible with no skeleton flash. Re-fetch: an
    // author-defined renderFallback() overrides the stale-while-revalidate
    // default with an explicit loading state.
    if (this.__firstRendered && this._overridesRenderFallback()) {
      try {
        const fb = this.renderFallback();
        if (fb !== undefined) clientRender(fb, this._renderRoot);
      } catch (e) {
        console.error(`[webjs] renderFallback() threw:`, e);
      }
    }
    return Promise.resolve(pending).then(
      (tpl) => {
        if (token !== this.__renderToken) return; // superseded by a newer render
        // The COMMIT throws too, not just the fetch, and a sibling rejection
        // handler cannot see it: `.then(onFulfil, onRejected)` never routes
        // onFulfil's own throw to onRejected. Left uncaught, the returned
        // promise rejected and _performRender's `.then` had no rejection
        // handler, so the error escaped as an unhandled rejection,
        // renderError() never ran, __pendingAsyncCommits never decremented
        // (wedging it >= 1 forever, which also disables the non-committing
        // cycle's _resolveUpdate escape), and updateComplete never settled.
        // The sync path routes an identical throw to the same boundary, so
        // this is what makes the two paths agree.
        try {
          clientRender(tpl, this._renderRoot);
        } catch (commitError) {
          this._handleRenderError(
            commitError instanceof Error ? commitError : new Error(String(commitError)),
          );
        }
      },
      (error) => {
        if (token !== this.__renderToken) return;
        this._handleRenderError(error instanceof Error ? error : new Error(String(error)));
      },
    );
  }

  /**
   * Whether the subclass overrides renderFallback() (vs the inert default).
   * @returns {boolean}
   * @private
   */
  _overridesRenderFallback() {
    return this.renderFallback !== WebComponent.prototype.renderFallback;
  }

  /**
   * Client-side render-error boundary, shared by the sync and async commit
   * paths. Logs, then commits renderError()'s output (if any) so one broken
   * component does not crash the page.
   * @param {Error} error
   * @private
   */
  _handleRenderError(error) {
    console.error(
      `[webjs] render error in <${tagOf(/** @type any */ (this.constructor)) || this.tagName?.toLowerCase()}>:`,
      error,
    );
    try {
      const fallback = this.renderError(error);
      if (fallback !== undefined) clientRender(fallback, this._renderRoot);
    } catch (fallbackError) {
      console.error(`[webjs] renderError() also threw:`, fallbackError);
    }
  }

  /**
   * Post-commit half of the update cycle (steps 7-8 + updateComplete),
   * shared by the sync path and the async (post-resolution) path.
   * @param {Map<string, unknown>} changedProperties
   * @private
   */
  _postCommit(changedProperties) {
    try {
      if (!this.__firstRendered) {
        this.__firstRendered = true;
        this.firstUpdated(changedProperties);
      }
      this.updated(changedProperties);
    } catch (postCommitError) {
      console.error(`[webjs] lifecycle hook threw during post-commit phase:`, postCommitError);
    } finally {
      this._resolveUpdate();
    }
  }

  /**
   * Called after every render commit (both the first and all subsequent
   * renders). Receives the `changedProperties` Map so you can branch on
   * what changed this cycle.
   *
   * **When to use:** post-render DOM work that depends on the new DOM,
   * triggered by specific property changes. This is the lit-aligned
   * replacement for ad-hoc `requestAnimationFrame` shims that components
   * historically used to defer DOM work after `render()`.
   *
   * ```js
   * updated(changedProperties) {
   *   if (changedProperties.has('open') && this.open) {
   *     this.querySelector('input')?.focus();
   *   }
   * }
   * ```
   *
   * @param {Map<string, unknown>} _changedProperties
   */
  updated(_changedProperties) {}

  /**
   * Called exactly once, after the component's very first render completes
   * and the DOM is live. Receives the same `changedProperties` Map that
   * `updated()` does for the first render; entries reflect the initial
   * values of reactive properties (old values are `undefined`).
   *
   * **When to use:** one-time post-render setup that requires DOM access.
   * Auto-focusing an input, measuring layout, initializing a third-party
   * library on a DOM node. `connectedCallback` fires before the first
   * render, so querying shadow children there yields nothing.
   *
   * ```js
   * firstUpdated(changedProperties) {
   *   this.shadowRoot.querySelector('input')?.focus();
   * }
   * ```
   *
   * @param {Map<string, unknown>} _changedProperties
   */
  firstUpdated(_changedProperties) {}

  /**
   * A Promise that resolves after the next render commit. Resolves to
   * `true` when the component has settled (no further updates queued),
   * `false` if another render is already scheduled.
   *
   * **When to use:** awaiting a re-render in tests, or in user code that
   * needs to read the post-render DOM after triggering an update.
   *
   * ```js
   * el.count = 5;
   * await el.updateComplete;
   * // DOM now reflects count = 5
   * ```
   *
   * @returns {Promise<boolean>}
   */
  get updateComplete() {
    return this.getUpdateComplete();
  }

  /**
   * Override point for `updateComplete`. Default returns the internal
   * update promise. Override to await additional async work that should
   * be considered part of the update cycle (e.g. lazy-loaded subcomponents).
   *
   * ```js
   * async getUpdateComplete() {
   *   const result = await super.getUpdateComplete();
   *   await this._chart?.updateComplete;
   *   return result;
   * }
   * ```
   *
   * @returns {Promise<boolean>}
   */
  getUpdateComplete() {
    return this._updatePromise;
  }

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
   * than the component's: e.g. a controller that tracks a specific
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

  /**
   * Optional loading UI for an async render() (#469), shown ONLY during a
   * client RE-FETCH (a prop / dependency change re-runs `async render()`),
   * NEVER on the first paint.
   *
   * **When to override (AI hint):** the client re-fetch default is
   * stale-while-revalidate (the component keeps showing its current content
   * until the new render resolves). Override `renderFallback()` only when you
   * want a loading state (skeleton / spinner) shown during the re-fetch
   * instead of the stale content, e.g. when stale data would mislead.
   *
   * **What it does NOT do:** it does not affect the first paint (SSR always
   * blocks and bakes real data in), and it does NOT create a server-streaming
   * boundary. To show a first-paint fallback for slow data, wrap the component
   * in `<webjs-suspense .fallback=${...}>` instead. It is a prop-aware method,
   * not a static field, so it can branch on the component's current state.
   *
   * ```js
   * renderFallback() { return html`<div class="skeleton h-24"></div>`; }
   * async render() { const u = await getUser(this.id); return html`<h3>${u.name}</h3>`; }
   * ```
   *
   * @returns {unknown} A TemplateResult loading state, or undefined to keep
   *   the stale-while-revalidate default.
   */
  renderFallback() {
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

/**
 * Dual-role WebComponent class and factory.
 * Can be extended directly: `class X extends WebComponent`
 * Or called as a class factory: `class X extends WebComponent({ count: Number })`
 *
 * @param {Record<string, any>} [properties]
 * @returns {any}
 */
export function WebComponent(properties) {
  if (new.target) {
    return Reflect.construct(WebComponentBase, arguments, new.target);
  } else {
    return class extends WebComponentBase {
      static properties = properties;
      static [FACTORY_PROPS] = true;
    };
  }
}

// Ensure static inheritance and instanceof checks work
Object.setPrototypeOf(WebComponent, WebComponentBase);
WebComponent.prototype = WebComponentBase.prototype;

/**
 * Helper to define properties with custom options.
 *
 * @param {any} [type]
 * @param {any} [opts]
 * @returns {any}
 */
export function prop(type, opts = {}) {
  if (type && typeof type === 'object' && !('call' in type)) {
    opts = type;
    type = undefined;
  }
  return { ...(type ? { type } : {}), ...opts };
}
