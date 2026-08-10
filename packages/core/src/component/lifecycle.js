import { render as clientRender } from '../render-client.js';
import { readAttributeValue, resolveAttributeProperty } from '../attribute-reader.js';
import { setActiveActionSignal } from '../action-abort-client.js';
import { carriesFunction } from '../form-action.js';
import { isCSS, adoptStyles } from '../css.js';
import { register, tagOf } from '../registry.js';
import { parse as deserializeProp } from '../serialize.js';
import { Signal } from '../signal.js';
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
} from '../slot.js';
import { ServerElement } from './server-element.js';
import {
  defaultHasChanged,
  safeString,
  warnFunctionReflection,
  warnUnserializableReflection,
  prop,
} from './reactive.js';

const isBrowser = typeof window !== 'undefined' && typeof HTMLElement !== 'undefined';
const Base = isBrowser ? HTMLElement : /** @type {any} */ (ServerElement);

const FACTORY_PROPS = Symbol('webjs.factoryProps');
const _propsChecked = new WeakSet();

class WebComponentBase extends Base {
  static shadow = false;
  static hydrate = undefined;
  static properties = {};
  static styles = null;

  static register(tag) {
    register(tag, this);
  }

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
    this.__controllers = new Set();
    this.__firstRendered = false;
    this._changedProperties = new Map();
    this._updateResolve = null;
    this._updatePromise = Promise.resolve(true);
    this._isUpdating = false;

    this._assertFactoryProperties();
    this._initializeProperties();
  }

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

  _initializeProperties() {
    const Ctor = /** @type {any} */ (this.constructor);
    const props = Ctor.properties;
    if (!props || typeof props !== 'object') return;

    this.__propValues = {};

    for (const [propName, decl] of Object.entries(props)) {
      const d = typeof decl === 'object' ? decl : { type: decl };
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

          if (d.reflect && !d.state && this._connected) {
            this._reflectAttribute(propName, newVal, d);
          }

          this.requestUpdate(propName, oldVal);
        },
      });

      if (initial !== undefined) {
        this.__propValues[propName] = initial;
      } else if (d.default !== undefined) {
        this.__propValues[propName] =
          typeof d.default === 'function' ? d.default() : d.default;
      }
    }
  }

  _reflectAttribute(propName, value, decl) {
    const attrName = decl.attribute || hyphenate(propName);
    if (this.__reflectingAttribute) return;
    this.__reflectingAttribute = true;
    try {
      if (decl.converter && decl.converter.toAttribute) {
        const serialized = decl.converter.toAttribute(value, decl.type);
        if (serialized == null) this.removeAttribute(attrName);
        else this.setAttribute(attrName, serialized);
      } else if (typeof value === 'function') {
        this.removeAttribute(attrName);
        warnFunctionReflection(this, propName, attrName);
      } else if (decl.type === Boolean) {
        if (value) this.setAttribute(attrName, '');
        else this.removeAttribute(attrName);
      } else if (value == null) {
        this.removeAttribute(attrName);
      } else if (decl.type === Object || decl.type === Array) {
        let serialized;
        let serializable = true;
        try {
          serialized = JSON.stringify(value);
        } catch (e) {
          serializable = false;
          this.removeAttribute(attrName);
          warnUnserializableReflection(this, propName, attrName, e && e.message);
        }
        if (serializable) this.setAttribute(attrName, serialized);
      } else if (carriesFunction(value)) {
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

    if (!this.__webjsPropsHydrated) {
      this.__webjsPropsHydrated = true;
      this._hydratePropAttrs();
    }

    const Ctor = /** @type any */ (this.constructor);

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
    this._reflectDeclaredAttributes();
    const Ctor = /** @type any */ (this.constructor);
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
        if (hadSSRShadow) {
          const ssrStyle = this.shadowRoot.querySelector('style');
          if (ssrStyle) ssrStyle.remove();
        }
        adoptStyles(this._renderRoot, list);
      }
    } else {
      this._renderRoot = this;
      if (Ctor.styles) {
        console.warn(
          `[webjs] <${tagOf(Ctor) || this.tagName?.toLowerCase()}> has static shadow = false AND static styles. ` +
          `static styles only works with shadow DOM (adoptedStyleSheets). ` +
          `For light DOM, use global CSS or <style> in render().`
        );
      }
      if (hasSlotState(this)) {
        reconnectSweep(this);
      } else if (
        this.__isHydrating() ||
        this.hasAttribute('data-wj-serialized') ||
        hasFrameworkRenderedSubtree(this)
      ) {
        this.removeAttribute('data-wj-serialized');
        ensureSlotState(this);
        adoptSSRAssignments(this);
      } else {
        captureAuthoredChildren(this);
      }
      installSlotInterception(this);
      installSlotSensors(this);
    }

    for (const c of this.__controllers) {
      if (c.hostConnected) c.hostConnected();
    }

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
    });
  }

  __isHydrating() {
    const first = this.firstChild;
    const isHydrate =
      first != null &&
      first.nodeType === 8 &&
      /** @type {Comment} */ (first).data === 'webjs-hydrate';
    if (isHydrate) this.__hydratedAtActivate = true;
    return isHydrate;
  }

  disconnectedCallback() {
    this._connected = false;
    if (this.__hydrationObserver) {
      this.__hydrationObserver.disconnect();
      this.__hydrationObserver = null;
    }
    teardownSlotSensors(this);
    if (this.__signalWatcher) {
      this.__signalWatcher.dispose();
      this.__signalWatcher = undefined;
    }
    for (const c of this.__controllers) {
      if (c.hostDisconnected) c.hostDisconnected();
    }
  }

  attributeChangedCallback(name, _old, value) {
    if (this.__reflectingAttribute) return;
    const resolved = resolveAttributeProperty(this.constructor, name);
    if (resolved === undefined) return;
    const { propName, def } = resolved;
    const v = readAttributeValue(def, value);

    if (this[propName] !== v) {
      this[propName] = v;
      if (this._connected) this.requestUpdate();
    }
  }

  requestUpdate(name, oldValue) {
    if (name !== undefined && !this._changedProperties.has(name)) {
      this._changedProperties.set(name, oldValue);
    }
    this._scheduleUpdate();
  }

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
        console.error(`[webjs] lifecycle hook threw during update cycle:`, err);
      }
    });
  }

  _performRender() {
    if (!this._renderRoot) return;

    const changedProperties = this._changedProperties;
    this._isUpdating = true;
    let didCommit = false;
    let pendingCommit = null;

    try {
      if (this.shouldUpdate(changedProperties)) {
        this.willUpdate(changedProperties);

        for (const c of this.__controllers) {
          if (c.hostUpdate) c.hostUpdate();
        }

        this.__renderToken = (this.__renderToken || 0) + 1;
        if (this.__renderAbort) this.__renderAbort.abort();
        this.__renderAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        setActiveActionSignal(this.__renderAbort ? this.__renderAbort.signal : null);
        try {
          const r = this.update(changedProperties);
          if (r && typeof r.then === 'function') pendingCommit = r;
        } catch (error) {
          this._handleRenderError(/** @type {Error} */ (error));
        } finally {
          setActiveActionSignal(null);
        }

        if (!pendingCommit) {
          for (const c of this.__controllers) {
            if (c.hostUpdated) c.hostUpdated();
          }
          didCommit = true;
        }
      }
    } catch (preCommitError) {
      console.error(`[webjs] lifecycle hook threw during update phase:`, preCommitError);
    } finally {
      this._isUpdating = false;
      if (didCommit || pendingCommit) {
        this._changedProperties = new Map();
      }
    }

    if (pendingCommit) {
      const token = this.__renderToken;
      this.__pendingAsyncCommits = (this.__pendingAsyncCommits || 0) + 1;
      const settle = () => {
        this.__pendingAsyncCommits--;
        if (token !== this.__renderToken) return;
        for (const c of this.__controllers) {
          if (c.hostUpdated) c.hostUpdated();
        }
        this._postCommit(changedProperties);
      };
      pendingCommit.then(settle, (error) => {
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

    if (didCommit) {
      this._postCommit(changedProperties);
    } else if (!this.__pendingAsyncCommits) {
      this._resolveUpdate();
    }
  }

  _resolveUpdate() {
    if (this._updateResolve) {
      const settled = this._changedProperties.size === 0;
      this._updateResolve(settled);
      this._updateResolve = null;
    }
  }

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

  _reflectDeclaredAttributes() {
    const props = /** @type {any} */ (this.constructor).properties || {};
    for (const name of Object.keys(props)) {
      const decl = props[name];
      if (!decl || !decl.reflect || decl.state) continue;
      this._reflectAttribute(name, this[name], decl);
    }
  }

  shouldUpdate(_changedProperties) {
    return true;
  }

  willUpdate(_changedProperties) {}

  update(_changedProperties) {
    if (!this.__signalWatcher) {
      this.__signalWatcher = new Signal.subtle.Watcher(() => {
        if (this._connected) this.requestUpdate();
      });
    }
    let tpl;
    this.__signalWatcher.observe(() => { tpl = this.render(); });
    if (tpl && typeof (/** @type any */ (tpl).then) === 'function') {
      return this._commitAsync(/** @type {Promise<unknown>} */ (tpl));
    }
    clientRender(tpl, this._renderRoot);
    return undefined;
  }

  _commitAsync(pending) {
    const token = this.__renderToken;
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
        if (token !== this.__renderToken) return;
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

  _overridesRenderFallback() {
    return this.renderFallback !== WebComponent.prototype.renderFallback;
  }

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

  updated(_changedProperties) {}
  firstUpdated(_changedProperties) {}

  get updateComplete() {
    return this.getUpdateComplete();
  }

  getUpdateComplete() {
    return this._updatePromise;
  }

  addController(controller) {
    this.__controllers.add(controller);
    if (this._connected && controller.hostConnected) {
      controller.hostConnected();
    }
  }

  removeController(controller) {
    this.__controllers.delete(controller);
  }

  render() {
    return '';
  }

  renderError(error) {
    return undefined;
  }

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

Object.setPrototypeOf(WebComponent, WebComponentBase);
WebComponent.prototype = WebComponentBase.prototype;
