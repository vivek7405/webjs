/**
 * Task — a ReactiveController for managing async data fetching inside
 * web components.
 *
 * ## When to use
 *
 * Use Task when a component needs to fetch data and render
 * loading / error / success states. Task handles `AbortController`
 * automatically — navigating away or re-running cancels the previous
 * in-flight request, preventing race conditions and wasted work.
 *
 * Good fits:
 * - Search-as-you-type / autocomplete
 * - Lazy-loaded data panels that fetch when a tab becomes active
 * - Infinite scroll / pagination within a component
 * - Any component-scoped async operation (geocoding, AI completions, etc.)
 *
 * ## When NOT to use
 *
 * - For **page-level** data loading, use async page functions or server
 *   actions instead — they run on the server, stream via Suspense, and
 *   produce real HTML for crawlers.
 * - For one-shot fire-and-forget mutations (form submit, delete), a plain
 *   `async` method on the component is usually simpler.
 *
 * ## Quick example
 *
 * ```js
 * import { WebComponent, html } from 'webjs';
 * import { Task } from 'webjs/task';
 *
 * class UserSearch extends WebComponent {
 *   static tag = 'user-search';
 *   static properties = { query: { type: String } };
 *
 *   _search = new Task(this, {
 *     task: async (query, { signal }) => {
 *       const res = await fetch(`/api/users?q=${query}`, { signal });
 *       if (!res.ok) throw new Error('Search failed');
 *       return res.json();
 *     },
 *     args: () => [this.query],
 *   });
 *
 *   render() {
 *     return html`
 *       <input .value=${this.query}
 *              @input=${e => this.query = e.target.value}>
 *       ${this._search.render({
 *         initial:  ()     => html`<p>Type to search</p>`,
 *         pending:  ()     => html`<p>Searching…</p>`,
 *         complete: (users)=> html`<ul>${users.map(u => html`<li>${u.name}</li>`)}</ul>`,
 *         error:    (err)  => html`<p class="error">${err.message}</p>`,
 *       })}
 *     `;
 *   }
 * }
 * UserSearch.register();
 * ```
 *
 * ### Manual control
 *
 * Set `autoRun: false` to disable automatic re-runs on arg changes and
 * call `task.run()` explicitly (e.g. on button click):
 *
 * ```js
 * this._export = new Task(this, {
 *   task: async (format, { signal }) => { … },
 *   args: () => [this.format],
 *   autoRun: false,
 * });
 *
 * // In render:
 * html`<button @click=${() => this._export.run()}>Export</button>`
 * ```
 *
 * @module
 */

// ---------------------------------------------------------------------------
// TaskStatus enum
// ---------------------------------------------------------------------------

/**
 * Possible states of a Task.
 *
 * | Value | Name      | Meaning                              |
 * | ----- | --------- | ------------------------------------ |
 * | 0     | INITIAL   | Task has never run.                  |
 * | 1     | PENDING   | Task is in-flight (awaiting).        |
 * | 2     | COMPLETE  | Task resolved successfully.          |
 * | 3     | ERROR     | Task rejected or threw.              |
 *
 * @readonly
 * @enum {number}
 */
export const TaskStatus = /** @type {const} */ ({
  INITIAL: 0,
  PENDING: 1,
  COMPLETE: 2,
  ERROR: 3,
});

// ---------------------------------------------------------------------------
// Task controller
// ---------------------------------------------------------------------------

/**
 * A ReactiveController that runs an async function, tracks its lifecycle
 * (initial → pending → complete | error), and triggers host re-renders
 * on state transitions.
 *
 * ## AI guidance
 *
 * - **`task.render()`** provides declarative async UI. Pass an object
 *   with `initial`, `pending`, `complete`, and `error` callbacks and
 *   Task returns the right template for the current status:
 *   ```js
 *   task.render({
 *     pending:  ()     => html`Loading…`,
 *     complete: (data) => html`${data.name}`,
 *     error:    (err)  => html`Error: ${err.message}`,
 *   })
 *   ```
 *   Omitted callbacks return `undefined` (renders nothing).
 *
 * - **AbortController** is managed automatically. Each call to `run()`
 *   aborts the previous in-flight request. The `{ signal }` object
 *   passed as the last argument to your task function is wired to the
 *   internal AbortController — pass it to `fetch()`, `ReadableStream`,
 *   or any other signal-aware API.
 *
 * - **`args`** is a function that returns an array. It is re-evaluated
 *   on every `hostUpdate()`. When `autoRun` is true (the default) and
 *   the args have changed (shallow identity comparison per element),
 *   the task automatically re-runs. This is how search-as-you-type and
 *   reactive data loading work.
 *
 * - When the host disconnects (e.g. the component is removed from the
 *   DOM), any in-flight task is aborted automatically — no cleanup
 *   needed.
 *
 * @template T
 */
export class Task {
  /**
   * @param {import('./component.js').WebComponent} host
   *   The host component that owns this task.
   * @param {{
   *   task: (...args: [...unknown[], { signal: AbortSignal }]) => Promise<T>,
   *   args?: () => unknown[],
   *   autoRun?: boolean
   * }} options
   *   - `task` — The async function to execute. Receives the spread args
   *     from `args()` followed by an options object with `{ signal }`.
   *   - `args` — A function returning an array of arguments. Re-evaluated
   *     on every host update cycle. Defaults to `() => []`.
   *   - `autoRun` — When true (default), the task re-runs automatically
   *     whenever `args()` returns values that differ from the previous
   *     run. Set to false for manual-only triggering via `run()`.
   */
  constructor(host, { task, args, autoRun = true }) {
    /** @type {import('./component.js').WebComponent} */
    this._host = host;
    /** @type {(...args: any[]) => Promise<T>} */
    this._taskFn = task;
    /** @type {() => unknown[]} */
    this._argsFn = args || (() => []);
    /** @type {boolean} */
    this._autoRun = autoRun;

    /** @type {number} — current TaskStatus */
    this._status = TaskStatus.INITIAL;
    /** @type {T | undefined} */
    this._value = undefined;
    /** @type {unknown} */
    this._error = undefined;

    /** @type {AbortController | null} */
    this._abortController = null;

    /**
     * Snapshot of args from the last run, used for shallow comparison.
     * @type {unknown[] | null}
     */
    this._prevArgs = null;

    if (typeof host.addController === 'function') {
      host.addController(this);
    }
  }

  // ---- Read-only public properties ----------------------------------------

  /**
   * Current status of the task.
   * @returns {number} One of the `TaskStatus` enum values.
   */
  get status() {
    return this._status;
  }

  /**
   * The resolved value when status is `COMPLETE`, otherwise `undefined`.
   * @returns {T | undefined}
   */
  get value() {
    return this._value;
  }

  /**
   * The rejection reason when status is `ERROR`, otherwise `undefined`.
   * @returns {unknown}
   */
  get error() {
    return this._error;
  }

  // ---- Public methods -----------------------------------------------------

  /**
   * Manually trigger (or re-trigger) the task.
   *
   * Any in-flight invocation is aborted before the new one starts. The
   * `args()` function is called to produce the current arguments.
   *
   * @returns {Promise<void>} Resolves when the task finishes (or is
   *   superseded). Does not reject — errors are captured in `this.error`.
   */
  async run() {
    // Abort previous.
    this.abort();

    const ac = new AbortController();
    this._abortController = ac;

    const args = this._argsFn();
    this._prevArgs = args;

    this._status = TaskStatus.PENDING;
    this._error = undefined;
    this._requestHostUpdate();

    try {
      const result = await this._taskFn(...args, { signal: ac.signal });

      // Guard: if this invocation was superseded while awaiting, discard.
      if (ac.signal.aborted) return;

      this._value = result;
      this._status = TaskStatus.COMPLETE;
      this._error = undefined;
    } catch (err) {
      if (ac.signal.aborted) return;

      this._error = err;
      this._status = TaskStatus.ERROR;
      this._value = undefined;
    } finally {
      if (this._abortController === ac) {
        this._abortController = null;
      }
    }

    this._requestHostUpdate();
  }

  /**
   * Abort the current in-flight task (if any).
   *
   * The AbortController's signal is set to aborted, which cancels any
   * `fetch()` or other signal-aware work inside the task function. The
   * task's status is **not** changed — it remains at whatever state it
   * was before the abort. A subsequent `run()` will transition to
   * PENDING.
   */
  abort() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  /**
   * Declarative async UI helper.
   *
   * Returns the result of calling the callback matching the current
   * status. Omitted callbacks return `undefined`.
   *
   * ```js
   * task.render({
   *   initial:  ()      => html`<p>Ready</p>`,
   *   pending:  ()      => html`<p>Loading…</p>`,
   *   complete: (data)  => html`<p>${data}</p>`,
   *   error:    (err)   => html`<p>Error: ${err.message}</p>`,
   * })
   * ```
   *
   * @param {{
   *   initial?:  () => unknown,
   *   pending?:  () => unknown,
   *   complete?: (value: T) => unknown,
   *   error?:    (error: unknown) => unknown,
   * }} handlers
   * @returns {unknown} The template result for the current status.
   */
  render(handlers = {}) {
    switch (this._status) {
      case TaskStatus.INITIAL:
        return handlers.initial?.();
      case TaskStatus.PENDING:
        return handlers.pending?.();
      case TaskStatus.COMPLETE:
        return handlers.complete?.(/** @type {T} */ (this._value));
      case TaskStatus.ERROR:
        return handlers.error?.(this._error);
      default:
        return undefined;
    }
  }

  // ---- ReactiveController lifecycle ---------------------------------------

  /**
   * Called before the host renders. When `autoRun` is enabled, checks
   * whether `args()` have changed and re-runs the task if so.
   */
  hostUpdate() {
    if (!this._autoRun) return;

    const nextArgs = this._argsFn();

    if (!this._argsEqual(this._prevArgs, nextArgs)) {
      // Don't await — the run will trigger another host update when it
      // transitions status.
      this.run();
    }
  }

  /**
   * Called after the host has rendered. Currently a no-op; required by
   * the ReactiveController interface.
   */
  hostUpdated() {}

  /**
   * Called when the host connects to the DOM. Currently a no-op —
   * initial run (if autoRun) happens on the first `hostUpdate()`.
   */
  hostConnected() {}

  /**
   * Called when the host disconnects from the DOM. Aborts any in-flight
   * task to prevent updates to an unmounted component.
   */
  hostDisconnected() {
    this.abort();
  }

  // ---- Internal -----------------------------------------------------------

  /** @private */
  _requestHostUpdate() {
    if (typeof this._host.requestUpdate === 'function') {
      this._host.requestUpdate();
    }
  }

  /**
   * Shallow comparison of two args arrays by identity (`===`).
   * Returns true if both are non-null, same length, and every element
   * is strictly equal.
   *
   * @param {unknown[] | null} a
   * @param {unknown[]} b
   * @returns {boolean}
   * @private
   */
  _argsEqual(a, b) {
    if (a === null) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}
