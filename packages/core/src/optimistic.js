class OptimisticState {
  constructor(host, options) {
    this.host = host;
    this.options = options;
    this.updates = [];
    this._nextId = 0;
  }

  get value() {
    let current = this.options.source();
    if (!this.options.update) {
      return this.updates.length > 0
        ? this.updates[this.updates.length - 1].payload
        : current;
    }
    for (const update of this.updates) {
      current = this.options.update(current, update.payload);
    }
    return current;
  }

  add(payload, promise) {
    const id = `opt-${++this._nextId}`;
    this.updates.push({ id, payload });
    this.host?.requestUpdate?.();

    const release = () => {
      const idx = this.updates.findIndex(u => u.id === id);
      if (idx !== -1) {
        this.updates.splice(idx, 1);
        this.host?.requestUpdate?.();
      }
    };

    if (promise && typeof promise.then === 'function') {
      if (typeof promise.finally === 'function') {
        promise.finally(() => release()).catch(() => {});
      } else {
        promise.then(() => release(), () => release());
      }
    }

    return release;
  }
}

async function runLegacyOptimistic(signal, value, action) {
  const prev = signal.get();
  signal.set(value);
  let result;
  try {
    result = await action();
  } catch (err) {
    signal.set(prev);
    throw err;
  }
  if (result && result.success === false) {
    signal.set(prev);
  }
  return result;
}

/**
 * `optimistic(host, options)`, a React 19 / Next.js-style declarative
 * optimistic-state wrapper for Web Components.
 *
 * The optimistic-UI pattern: show the expected result of a mutation
 * IMMEDIATELY (so the interface feels instant), run the real server action,
 * and release the optimistic overlay when the action settles. This wrapper
 * manages a queue of pending updates, computes the combined value through
 * an optional reducer, and auto-releases when a passed promise resolves.
 *
 *   import { WebComponent, prop, optimistic, html } from '@webjsdev/core';
 *   import { createTodo } from '../actions/create-todo.server.js';
 *
 *   class TodoList extends WebComponent({ todos: prop(Array) }) {
 *     optimisticTodos = optimistic(this, {
 *       source: () => this.todos,
 *       // PURE: the row is derived from the payload, nothing is minted here.
 *       // `.value` re-folds the queue on every read (see Behaviour 1), so a
 *       // minted id would differ per render and a hardcoded 'tmp' would
 *       // collide across two concurrent adds.
 *       update: (state, add) => [...state, { id: add.tempId, title: add.title, pending: true }]
 *     });
 *
 *     async handleSubmit(e) {
 *       const title = e.target.querySelector('input').value;
 *       const tempId = crypto.randomUUID();
 *       const promise = createTodo({ title });
 *       this.optimisticTodos.add({ tempId, title }, promise);
 *       const result = await promise;
 *       if (result.success) this.todos = [...this.todos, result.data];
 *     }
 *
 *     render() {
 *       return html`<ul>${this.optimisticTodos.value.map(t =>
 *         html`<li class=${t.pending ? 'opacity-50' : ''}>${t.title}</li>`)}</ul>`;
 *     }
 *   }
 *
 * Behaviour:
 *   1. `.value` reads `source()` and folds all queued updates through `update`.
 *   2. `.add(payload)` pushes an update and calls `host.requestUpdate()`.
 *   3. `.add(payload, promise)` auto-releases on promise settlement.
 *   4. The returned `release()` fn removes the update by ID and re-renders.
 *   5. Concurrent updates stack; each release removes only its own entry.
 *
 * Backward-compatible imperative API (signal-based rollback):
 *   await optimistic(signal, value, () => likePost(postId));
 *
 * Client-only: it calls `host.requestUpdate()` (client work), so a component
 * importing it is never elided as display-only.
 *
 * @template State
 * @template Action
 * @param {{ requestUpdate?: () => void }} host  A WebComponent instance.
 * @param {{ source: () => State, update?: (state: State, action: Action) => State }} options
 * @returns {OptimisticState<State, Action>}
 */
export function optimistic(first, second, third) {
  if (first && typeof first.get === 'function' && typeof first.set === 'function') {
    return runLegacyOptimistic(first, second, third);
  }
  return new OptimisticState(first, second);
}
