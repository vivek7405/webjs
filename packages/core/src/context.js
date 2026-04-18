/**
 * Context Protocol — cross-component data sharing without prop drilling.
 *
 * Implements the W3C Community Group Context Protocol so any web component
 * (not just webjs components) can participate as a provider or consumer.
 *
 * ## When to use
 *
 * Use Context when you need to share data (theme, auth state, locale,
 * config, feature flags) across deeply nested components without passing
 * props through every intermediate level.
 *
 * Prefer Context over module-level globals when the shared data is **scoped
 * to a subtree** — e.g. a specific page, panel, or dialog — and different
 * subtrees may hold different values for the same context key.
 *
 * ## When NOT to use
 *
 * - For page-level data loading, use async page functions or server actions
 *   instead. Context is a client-side primitive.
 * - If only a parent and its direct child need to communicate, plain
 *   properties/attributes are simpler.
 * - If every component in the app needs the same single value (e.g. a
 *   singleton API client), a module-level export may be simpler than
 *   context.
 *
 * ## Quick example
 *
 * ```js
 * import { WebComponent, html } from 'webjs';
 * import { createContext, ContextProvider, ContextConsumer } from 'webjs/context';
 *
 * const ThemeCtx = createContext('theme');
 *
 * class MyApp extends WebComponent {
 *   static tag = 'my-app';
 *   _theme = new ContextProvider(this, { context: ThemeCtx, initialValue: 'light' });
 *   render() {
 *     return html`
 *       <button @click=${() => this._theme.setValue(
 *         this._theme.value === 'light' ? 'dark' : 'light'
 *       )}>Toggle</button>
 *       <slot></slot>
 *     `;
 *   }
 * }
 * MyApp.register();
 *
 * class ThemedCard extends WebComponent {
 *   static tag = 'themed-card';
 *   _theme = new ContextConsumer(this, { context: ThemeCtx, subscribe: true });
 *   render() {
 *     return html`<div class=${this._theme.value}>Card content</div>`;
 *   }
 * }
 * ThemedCard.register();
 * ```
 *
 * `<themed-card>` can live at any depth under `<my-app>` — it finds the
 * provider automatically via a bubbling `context-request` event that
 * crosses shadow-DOM boundaries (`composed: true`).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Context key
// ---------------------------------------------------------------------------

/**
 * @template T
 * @typedef {{ __context__: typeof CONTEXT_KEY, name: string }} Context
 */

const CONTEXT_KEY = Symbol.for('webjs.context');

/**
 * Create a typed context key.
 *
 * The returned object is used as an identity token — two calls to
 * `createContext('theme')` produce **different** contexts even though
 * the debug name is the same. Store the key in a shared module and
 * import it from both provider and consumer.
 *
 * @template T
 * @param {string} name  Human-readable name (used in error messages and
 *   devtools, not for matching).
 * @returns {Context<T>}
 */
export function createContext(name) {
  return { __context__: CONTEXT_KEY, name };
}

// ---------------------------------------------------------------------------
// ContextRequestEvent
// ---------------------------------------------------------------------------

/**
 * Fired by a consumer to locate a provider higher in the DOM.
 *
 * - `bubbles: true` so it walks up the DOM tree.
 * - `composed: true` so it crosses shadow-DOM boundaries.
 *
 * Providers listen for this event on their host element and respond by
 * calling the event's `callback` with the current value.
 *
 * @template T
 */
export class ContextRequestEvent extends Event {
  /**
   * @param {Context<T>} context   The context key to request.
   * @param {(value: T, unsubscribe?: () => void) => void} callback
   *   Called by the provider with the current value. If `subscribe` is
   *   true the provider retains the callback and calls it again whenever
   *   the value changes (passing an `unsubscribe` function on each call).
   * @param {boolean} subscribe  Whether the consumer wants ongoing updates.
   */
  constructor(context, callback, subscribe = false) {
    super('context-request', { bubbles: true, composed: true });
    /** @type {Context<T>} */
    this.context = context;
    /** @type {(value: T, unsubscribe?: () => void) => void} */
    this.callback = callback;
    /** @type {boolean} */
    this.subscribe = subscribe;
  }
}

// ---------------------------------------------------------------------------
// ContextProvider
// ---------------------------------------------------------------------------

/**
 * @template T
 * @typedef {{ callback: (value: T, unsubscribe?: () => void) => void }} Subscription
 */

/**
 * A ReactiveController that provides a context value to descendant
 * components.
 *
 * The provider listens for `context-request` events on its host element.
 * When a matching request arrives it delivers the current value (and,
 * for subscribing consumers, retains the callback for future updates).
 *
 * ## AI guidance
 *
 * - Create one `ContextProvider` per context key per component.
 * - Call `setValue()` to push updates to all subscribing consumers.
 * - The provider **must** be a DOM ancestor of its consumers (shadow-DOM
 *   depth does not matter thanks to `composed: true`).
 *
 * @template T
 */
export class ContextProvider {
  /**
   * @param {import('./component.js').WebComponent} host
   *   The host component that owns this provider.
   * @param {{ context: Context<T>, initialValue?: T }} options
   */
  constructor(host, { context, initialValue }) {
    /** @type {import('./component.js').WebComponent} */
    this._host = host;
    /** @type {Context<T>} */
    this._context = context;
    /** @type {T} */
    this._value = /** @type {T} */ (initialValue);
    /** @type {Set<Subscription<T>>} */
    this._subscriptions = new Set();

    /** @type {(e: Event) => void} */
    this._onRequest = (e) => {
      const evt = /** @type {ContextRequestEvent<T>} */ (e);
      if (evt.context !== this._context) return;

      // Prevent further providers higher in the tree from also responding.
      e.stopPropagation();

      if (evt.subscribe) {
        /** @type {Subscription<T>} */
        const sub = { callback: evt.callback };
        const unsubscribe = () => { this._subscriptions.delete(sub); };
        this._subscriptions.add(sub);
        evt.callback(this._value, unsubscribe);
      } else {
        evt.callback(this._value);
      }
    };

    // Follow the ReactiveController protocol.
    if (typeof host.addController === 'function') {
      host.addController(this);
    }
  }

  /** @returns {T} The current provided value. */
  get value() {
    return this._value;
  }

  /**
   * Update the provided value and notify all subscribers.
   *
   * Every subscribing consumer's callback is invoked synchronously with
   * the new value. Each consumer then calls `host.requestUpdate()` to
   * schedule a re-render — so one `setValue` batches all downstream
   * re-renders via the microtask queue.
   *
   * @param {T} newValue
   */
  setValue(newValue) {
    if (Object.is(this._value, newValue)) return;
    this._value = newValue;
    for (const sub of this._subscriptions) {
      const unsubscribe = () => { this._subscriptions.delete(sub); };
      sub.callback(newValue, unsubscribe);
    }
  }

  /** Called by the host's controller lifecycle when the element connects. */
  onMount() {
    this._host.addEventListener('context-request', this._onRequest);
  }

  /** Called by the host's controller lifecycle when the element disconnects. */
  onUnmount() {
    this._host.removeEventListener('context-request', this._onRequest);
    this._subscriptions.clear();
  }
}

// ---------------------------------------------------------------------------
// ContextConsumer
// ---------------------------------------------------------------------------

/**
 * A ReactiveController that consumes a context value from an ancestor
 * provider.
 *
 * On `onMount` it dispatches a `ContextRequestEvent`. If a provider
 * for the matching context key exists higher in the DOM tree, the consumer
 * receives the current value immediately (and, if `subscribe: true`, all
 * future updates as well).
 *
 * ## AI guidance
 *
 * - Use `subscribe: true` (the default) when you want the consumer to
 *   update automatically whenever the provider calls `setValue()`. This is
 *   the common case for reactive data like theme, auth, or locale.
 * - Use `subscribe: false` for one-shot reads where you only need the
 *   value at connection time (e.g. reading a static config once).
 * - Access the value via `consumer.value`. It is `undefined` until a
 *   provider responds.
 * - If no provider exists in the ancestor chain, `value` stays
 *   `undefined` — design your render method to handle that case.
 *
 * @template T
 */
export class ContextConsumer {
  /**
   * @param {import('./component.js').WebComponent} host
   *   The host component that owns this consumer.
   * @param {{ context: Context<T>, subscribe?: boolean }} options
   *   `subscribe` defaults to `true`.
   */
  constructor(host, { context, subscribe = true }) {
    /** @type {import('./component.js').WebComponent} */
    this._host = host;
    /** @type {Context<T>} */
    this._context = context;
    /** @type {boolean} */
    this._subscribe = subscribe;
    /** @type {T | undefined} */
    this._value = undefined;
    /** @type {(() => void) | undefined} */
    this._unsubscribe = undefined;

    if (typeof host.addController === 'function') {
      host.addController(this);
    }
  }

  /**
   * The current context value. `undefined` if no provider has responded
   * yet.
   * @returns {T | undefined}
   */
  get value() {
    return this._value;
  }

  /** Called by the host's controller lifecycle when the element connects. */
  onMount() {
    this._dispatchRequest();
  }

  /** Called by the host's controller lifecycle when the element disconnects. */
  onUnmount() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = undefined;
    }
  }

  /** @private */
  _dispatchRequest() {
    const event = new ContextRequestEvent(
      this._context,
      (value, unsubscribe) => {
        // Guard against duplicate updates with the same value.
        const old = this._value;
        this._value = value;
        if (unsubscribe) {
          this._unsubscribe = unsubscribe;
        }
        // Trigger a re-render of the consuming component when the value
        // changes (skip on the very first delivery during connection,
        // since the host will render after connectedCallback anyway —
        // but we still update to be safe with various host lifecycles).
        if (!Object.is(old, value) && typeof this._host.requestUpdate === 'function') {
          this._host.requestUpdate();
        }
      },
      this._subscribe,
    );

    this._host.dispatchEvent(event);
  }
}
