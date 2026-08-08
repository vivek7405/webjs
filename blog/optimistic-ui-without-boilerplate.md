---
title: "Optimistic UI Without the Boilerplate (React useOptimistic, for Web Components)"
date: 2026-07-06T10:00:00+05:30
slug: optimistic-ui-without-boilerplate
description: "WebJs now ships a declarative optimistic() API with full React 19 useOptimistic parity for Web Components. No try-catch, no manual state caching, no temp-id reconciliation. Just add, await, and reconcile."
tags: optimistic-ui, web-components, react, state-management, ux
author: Vivek
---

Click a like button. The heart fills red immediately. The server call fires in the background. If it fails, the heart goes back to grey. If it succeeds, nothing changes because the UI was already right.

That is optimistic UI. The interface feels instant because it does not wait for the network to confirm what you already know is going to happen. The problem is that building it manually is tedious. You cache the old state, you mutate the new state, you wrap everything in try-catch, you generate temporary IDs, you reconcile on success, you revert on failure. Five lines of intent become thirty lines of bookkeeping.

React 19 solved this with `useOptimistic`. WebJs now has the same thing, but for Web Components. This post is about what it looks like, why the old pattern was painful, and how the new API drops the boilerplate without losing the safety net.

# The old way, and why it hurts

Here is what an optimistic todo add looked like before the new API. It works, and you have probably written something like it:

```ts
class TodoList extends WebComponent({ todos: prop(Array) }) {
  async handleSubmit(e) {
    e.preventDefault();
    const title = getTitle(e);

    // 1. Cache the current state
    const previousTodos = this.todos;

    // 2. Generate a temp ID and push the optimistic item
    const tempId = `tmp-${crypto.randomUUID()}`;
    this.todos = [
      { id: tempId, title, completed: false, pending: true },
      ...this.todos,
    ];

    try {
      // 3. Fire the server action
      const result = await createTodo({ title });

      if (result.success && result.data) {
        // 4. Reconcile: swap the temp ID for the real one
        this.todos = this.todos.map((t) =>
          t.id === tempId ? result.data : t
        );
      } else {
        // 5. Revert on failure
        this.todos = previousTodos;
      }
    } catch {
      // 6. Revert on error
      this.todos = previousTodos;
    }
  }
}
```

Six steps to add one item. The actual intent is "show the new todo, call the server, fix it up if the server disagrees." But the code is dominated by caching, temp IDs, try-catch, and reconciliation. And this is the simple case. When you have concurrent optimistic operations (two submits in quick succession), each one needs its own temp ID, its own previous-state cache, and its own release logic. The complexity compounds.

# The new way: optimistic(host, options)

The declarative API makes the same pattern look like this:

```ts
class TodoList extends WebComponent({ todos: prop(Array) }) {
  constructor() {
    super();
    this.todos = [];
    this.optimisticTodos = optimistic(this, {
      source: () => this.todos,
      // Pure: the row is derived from the payload, nothing is minted here.
      // The .value getter re-folds the queue on EVERY read, so a minted id
      // would differ per render, and a hardcoded 'tmp' would collide across
      // two concurrent adds. The temp id is minted once in the handler.
      update: (state, add) => [
        ...state,
        { id: add.tempId, title: add.title, completed: false, pending: true },
      ],
    });
  }

  async handleSubmit(e) {
    e.preventDefault();
    const title = getTitle(e);
    const tempId = crypto.randomUUID();
    const promise = createTodo({ title });
    this.optimisticTodos.add({ tempId, title }, promise);
    const result = await promise;
    if (result.success && result.data) {
      this.todos = [...this.todos, result.data];
    }
  }

  render() {
    return html`<ul>${this.optimisticTodos.value.map(t =>
      html`<li class=${t.pending ? 'opacity-50' : ''}>${t.title}</li>`)}</ul>`;
  }
}
```

The difference is structural. Instead of manually caching and reverting, you declare a pure reducer that builds the optimistic row out of a payload, then call `.add({ tempId, title }, promise)` and let the wrapper handle the rest. The optimistic update appears immediately. When the promise settles, it disappears. You update `this.todos` on success and the source of truth reconciles naturally.

No try-catch. No previous-state cache. No reconciling a temp id against the real one. Minting the id is one line in the handler, and everything that used to surround it is gone. Nothing tracks the temp row afterwards, because the overlay drops whole when the promise settles and the authoritative row arrives with `result.data`. The reducer is the only place the optimistic shape lives, so there is one source of truth for what an optimistic item looks like.

# How it works under the hood

The `optimistic()` function returns an `OptimisticState` object with two things: a `.value` getter and an `.add(payload, promise?)` method.

**`.value`** reads the current state from your `source()` function and then folds every queued optimistic update through your `update` reducer. If there are no pending updates, it returns the source value directly. If there are three, it applies all three in order. This means the value is always computed, never stored, so it automatically reflects the latest source state. Because the fold re-runs on every read, the reducer has to be pure. Anything it mints is minted again on each render, so a `crypto.randomUUID()` inside `update` hands the pending row a fresh id every time, and a keyed list tears that row down and rebuilds it on each update, losing focus and any in-progress transition. Mint the id once in the handler, pass it in the payload, and it stays stable for the life of the row.

**`.add(payload, promise?)`** pushes the payload onto the internal queue and calls `host.requestUpdate()` so the component re-renders with the new computed value. If you pass a promise, it chains `.finally()` to auto-release the update when the promise settles. For thenables that lack `.finally`, it falls back to `.then(onFulfilled, onRejected)`. The method returns a `release()` function for cases where you want manual control instead.

Concurrent updates stack. Each one gets a unique ID, and its `release()` removes only that entry. So if you add two todos in quick succession, both appear optimistically, and each one disappears independently when its own promise settles.

# The signal-based API is still there

For single-value toggles, the legacy imperative API is simpler than the declarative form:

```ts
const liked = signal(false);

// In an @click handler:
await optimistic(liked, true, () => likePost(postId));
// liked flips to true instantly.
// Rolls back on throw or { success: false }.
// Stays true on success.
```

This is the original `optimistic(signal, value, action)`. It captures the previous value, sets the optimistic value immediately, awaits the action, and rolls back on failure. For a like button, a follow toggle, a single boolean, this is exactly the right tool. The new declarative API is for collections and complex state where a reducer makes the intent clearer.

The exported `optimistic()` function dispatches between them automatically. If the first argument has `get` and `set` methods, it is the signal-based path. Otherwise it is the declarative path. Same import, two shapes.

# Auto-release versus manual release

The promise-based auto-release is the default pattern and covers most cases:

```ts
const tempId = crypto.randomUUID();
const promise = createTodo({ title });
this.optimisticTodos.add({ tempId, title }, promise);
// The optimistic item disappears when promise settles (resolve or reject).
```

When you need explicit control, `.add(payload)` without a promise returns a `release()` function:

```ts
const release = this.optimisticTodos.add({ tempId: crypto.randomUUID(), title });
try {
  const result = await createTodo({ title });
  if (result.success) this.todos = [...this.todos, result.data];
} finally {
  release();
}
```

This is useful when the action promise does not match the optimistic update lifecycle (for example, when you want to keep the optimistic state visible until some other condition is met, or when the action returns a value you need to inspect before deciding whether to release).

# What about the optional reducer?

If you omit `update`, the payload replaces the state directly. This matches React's `useOptimistic(state, setState)` pattern where the optimistic value IS the new state:

```ts
this.optCount = optimistic(this, { source: () => this.count });
this.optCount.add(42);  // .value is now 42
```

This is useful for simple replacements where you do not need to merge or transform. The type inference also improves: when `update` is absent, TypeScript knows `Action = State`, so you do not need to annotate the payload type.

# The honest trade

There is one thing the declarative API does not do that the manual pattern does: it does not give you the previous state in the error handler. In the old pattern, `previousTodos` was available in the catch block, so you could show a specific error message or log the reverted items. With the new API, the release is automatic and silent.

This is deliberate. The point of the API is to remove the bookkeeping, and bookkeeping includes the error-path state inspection. If you need that, use the manual `release()` pattern and keep the try-catch. The API gives you the escape hatch; it just does not force it on you for the common case where "show it, call the server, fix it on success" is the whole story.

# Why this matters for early-stage developers

If you are building your first full-stack app, optimistic UI is one of those things that separates a prototype from a product. A prototype shows a spinner and waits. A product shows the result immediately and corrects itself if wrong. The difference in perceived speed is enormous, and it is the kind of polish that makes users trust an app.

But the boilerplate cost is high enough that many developers skip it entirely, especially when they are learning. The old pattern required understanding temp-id reconciliation, state caching, try-catch reverts, and concurrent update handling. That is a lot of concepts to hold in your head when you are just trying to make a todo app work.

The new API reduces it to three steps: declare the reducer, call `.add()`, reconcile on success. The concepts are the same (optimistic update, server call, reconciliation), but the code is small enough that you can see the whole thing at once. That is the difference between "I understand this pattern" and "I copied this pattern and hope it works."

Optimistic UI should not require a state machine. It should be three things: show the expected result immediately, run the real server action, and release the optimistic overlay when the action settles. WebJs now gives you that directly through `optimistic(host, { source, update })`, with React 19 `useOptimistic` parity, auto-release on promise settlement, concurrent update stacking, and a fallback to the original signal-based API for simple toggles. The boilerplate of state caching, try-catch, and temp-id reconciliation is gone. What remains is the intent: add the item, call the server, fix it up if the server disagrees.
