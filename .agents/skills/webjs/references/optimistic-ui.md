# Optimistic UI

## What This Covers

- The declarative `optimistic(host, { source, update })` API (preferred) with `.add(payload, promise)` auto-release
- The imperative `optimistic(signal, value, action)` API for simple boolean flips
- When optimistic UI is appropriate, and when to skip it
- Why you never hand-roll try-catch, cache-and-restore, or temp-ID reconciliation

Read this when a mutation should feel instant, when the client can predict the result of a create/update/delete/like/toggle/reorder before the server confirms it. Sibling refs: `data-and-actions.md` (the server actions and the `ActionResult` envelope these calls invoke), `components.md` (the `WebComponent` host, reactive props, and signals these APIs attach to).

## The Idea

`optimistic()` from `@webjsdev/core` shows a mutation's expected result IMMEDIATELY (the UI feels instant), runs the real server action, and ROLLS BACK automatically on failure. It is the default for every user-facing mutation where the client can construct the expected result from the input. **Never write manual try-catch, cache-and-restore, or temp-ID reconciliation** when `optimistic()` covers the pattern.

## Declarative API (preferred)

`optimistic(host, { source, update })` returns an `OptimisticState<State, Action>` with a `.value` getter and an `.add(payload, promise?)` method. The `source` reads the authoritative state (usually a reactive prop). The `update` reducer transforms that state with each payload. Calling `.add()` pushes an update and schedules a re-render, so `.value` reflects the optimistic state on the next paint.

**The reducer must be pure.** `.value` re-folds the whole queue on every read, so `update` runs again on each render rather than once per `.add()`. Anything it MINTS is therefore minted per render. Mint a temp id in the handler and pass it in the payload. A `crypto.randomUUID()` inside the reducer gives the pending row a different id on every read, which breaks a keyed list and anything else treating that id as stable.

```ts
import { WebComponent, prop, optimistic, html } from '@webjsdev/core';
import { createTodo } from '#modules/todos/actions/create-todo.server.ts';

class TodoList extends WebComponent({
  todos: prop<Todo[]>(Array),
}) {
  private optimisticTodos = optimistic(this, {
    source: () => this.todos,
    // KEEP THIS REDUCER PURE. `.value` re-folds every queued update on EVERY
    // read, not once per `.add()`, so anything minted in here is minted again
    // on each render. A `crypto.randomUUID()` here would hand the pending row
    // a NEW id per render, and a keyed list (`repeat(todos, t => t.id, ...)`)
    // would tear the row down and rebuild it every update, losing focus, any
    // in-progress transition, and DOM state. Mint the temp id in the handler
    // and carry it in the payload, so it is stable for the life of the row.
    update: (state, add: { tempId: string; title: string }) => [
      ...state,
      // `createdAt` is rebuilt per read too. That is tolerable only because
      // nothing keys on it; put it in the payload as well if anything does.
      { id: add.tempId, title: add.title, completed: false, createdAt: new Date(), pending: true },
    ],
  });

  async handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const title = new FormData(e.target as HTMLFormElement).get('title') as string;
    if (!title) return;
    (e.target as HTMLFormElement).reset();

    // Minted ONCE here, not in the reducer. `Todo['id']` is a string (a uuid
    // primary key), so no cast is needed. Against an auto-increment integer
    // id there is no honest client-side value, so model the temp row instead
    // (an optional id, or a `tempId` the row keys on) rather than casting.
    const tempId = crypto.randomUUID();
    const promise = createTodo({ title });
    this.optimisticTodos.add({ tempId, title }, promise);

    const result = await promise;
    if (result.success && result.data) {
      // Reconcile: the optimistic row is never written to `this.todos`. The
      // overlay holds only the PAYLOAD, and `update` rebuilds the row from it
      // on each `.value` read, so this prop holds only confirmed rows. Append
      // the server's canonical row, matching the order the `update` reducer
      // used. (The overlay entry auto-released when the promise settled, so
      // `.value` does not double-count it on the next paint.)
      this.todos = [...this.todos, result.data];
    }
  }

  render() {
    return html`<ul>${this.optimisticTodos.value.map(todo => html`
      <li class=${todo.pending ? 'opacity-50' : ''}>${todo.title}</li>
    `)}</ul>`;
  }
}
TodoList.register('todo-list');
```

**Auto-release is the whole point.** Pass the action's promise as the second argument to `.add(payload, promise)`, and the update auto-releases the moment that promise settles (resolve OR reject). It uses `.finally()`, with a `.then()` fallback for thenables that lack `.finally`. No try-catch, no manual rollback, no reconciling a temp id against the real one. The handler mints a temp id for the pending row, but nothing tracks it afterwards: the overlay drops whole when the promise settles, and the authoritative row arrives from `result.data`. On failure the optimistic entry simply drops when the promise rejects.

- Multiple `.add()` calls stack independently. Each carries its own release by ID, so overlapping in-flight mutations do not clobber one another.
- When `update` is omitted, the payload REPLACES the state directly (`Action = State`), matching the simple `useOptimistic(setState)` pattern.

### Author the optimistic mutation as a degrade-first form

Wrap the mutation in a REAL `<form>` bound to the action, then intercept it for the optimistic path. One form serves both: with JS off the browser submits and the server dispatches to that action (the no-JS write path, see `routing-and-pages.md`), and with JS on `@submit` calls `e.preventDefault()` and runs the optimistic path. That is the progressive-enhancement contract, not a fetch-only handler. Note the arrow wrapper on the listener: WebJs does not bind an `@event` handler to your component, so passing the method directly would leave `this` pointing at a framework-internal object (see `muscle-memory-gotchas.md`).

The SAME imported function is the form binding and the optimistic path's callee, which is what makes a degrade-first form cheap to write: there is no second wiring to keep in step.

```ts
import { createTodo } from '#modules/todo/actions/create-todo.server.ts';

render() {
  return html`
    <form action=${createTodo} @submit=${(e: SubmitEvent) => this.handleSubmit(e)}>
      <input name="title" required>
      <button>Add</button>
    </form>
    <ul>${this.optimisticTodos.value.map(t => html`<li class=${t.pending ? 'opacity-50' : ''}>${t.title}</li>`)}</ul>`;
}
```

`method` and the enctype are supplied by the renderer, and the hidden identity field is re-inserted as the form's first child on every client render, so there is nothing to manage by hand.

When a page owns SEVERAL mutations (create, toggle, delete), give each form its OWN binding (`action=${createTodo}` / `action=${toggleTodo}` / `action=${deleteTodo}`), or use per-button submitter server action bindings via `formaction=${action}` on submitter buttons (#1207, #1307: a bound submitter carries its own submission, so the enclosing form need not be bound). Alternatively, a form that dispatches dynamically can bind ONE action and inspect a submit button's `name="intent"`.

## Seed the list from the server for SSR plus optimistic

For a page that server-renders a list AND lets the user add to it optimistically, let ONE component own both the list and the form, and seed it from the page through a `.prop` hole (a DOM property that round-trips through SSR on custom elements). The list is then fully server-rendered on first paint (readable with JS off) and re-renders optimistically on each add. A separate static list in the page would not update on an optimistic add.

```ts
// app/notes/page.ts (runs server-only; awaits the data so it is in the first paint)
import { html } from '@webjsdev/core';
import '#modules/notes/components/note-composer.ts'; // registers <note-composer>
import { listNotes } from '#modules/notes/queries/list-notes.server.ts';

export default async function NotesPage() {
  const notes = await listNotes();
  // .notes=${notes} seeds the component; the list SSRs through the component.
  return html`<note-composer .notes=${notes}></note-composer>`;
}
```

The component reads that seeded prop as its `optimistic()` `source`, so `source: () => this.notes` is both the SSR list and the base for optimistic additions.

## Imperative API (simple boolean flips)

For a boolean toggle where the value itself is the mutation (like, follow, pin), `optimistic(signal, value, action)` is a thin wrapper over the signal primitive.

```ts
import { signal, optimistic } from '@webjsdev/core';
import { likePost } from '#modules/posts/actions/like-post.server.ts';

const liked = signal(false);
// in an @click handler:
const result = await optimistic(liked, true, () => likePost(postId));
// `liked` flips to true instantly. If likePost THROWS or returns
// { success: false }, `liked` rolls back to its prior value: the throw
// re-throws, and the { success: false } result is returned so you can
// read its error / fieldErrors. On success the optimistic value stays;
// reconcile to the authoritative value from `result` if you need it.
```

It rolls back on a thrown error OR an `ActionResult` `{ success: false }` envelope, and never on success. It is client-only (it mutates a signal), so a component importing it is never elided as a display-only component.

## When Optimistic UI Is Appropriate

- Todo items, comments, posts, likes, follows, toggles, reorders, renames, status changes.
- Any mutation where the client can construct the expected result from the input.
- CRUD operations where the server returns the same shape the client already has.

## When To Skip It

- The result is unpredictable (AI-generated content, server-computed values the client cannot guess).
- The mutation has side effects the user must wait for (payment processing, email sending, OAuth).
- The action validates against data that may have changed server-side (unique constraints, race conditions).
- The mutation is destructive and irreversible with no undo (confirm-first UX is better).

## Rules

1. Default to `optimistic()` for every predictable user-facing mutation. Instant UI, automatic rollback.
2. Prefer the declarative `.add(payload, promise)` form for list mutations. Pass the promise so release is automatic.
3. Use the imperative `optimistic(signal, value, action)` form only for a boolean flip whose value is the mutation.
4. Never hand-roll try-catch, cache-and-restore, or temp-ID reconciliation when one of these APIs covers the pattern.
5. Reconcile the authoritative result from the returned `ActionResult` after the promise settles when you need the server's canonical row.
