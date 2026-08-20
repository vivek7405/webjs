import { html } from '@webjsdev/core';

export const metadata = {
  title: 'Optimistic UI | WebJs',
  description:
    'optimistic() from @webjsdev/core shows a mutation\'s expected result immediately, runs the real server action, and releases the overlay when it settles. Covers the declarative queue API, the imperative signal flip, keeping the reducer pure, and when to skip optimistic UI entirely.',
};

export default function OptimisticUI() {
  return html`
    <h1>Optimistic UI</h1>

    <p>
      A mutation should feel instant. <code>optimistic()</code> from <code>@webjsdev/core</code> paints the expected result of a create, update, delete, like, toggle, or reorder <em>before</em> the server confirms it, runs the real server action underneath, and releases the optimistic overlay when that action settles. It is the default for every user-facing mutation whose result the client can predict from the input.
    </p>

    <p>
      The rule that follows from that: <strong>never hand-roll try-catch, cache-and-restore, or temp-id reconciliation</strong> when one of the two signatures below covers the pattern. Those hand-rolled versions are where the subtle bugs live (a rollback that fires twice, an overlapping mutation that clobbers its neighbour, a temp id that outlives its row), and all three are already solved here.
    </p>

    <h2>Two signatures, one export</h2>

    <p>
      <code>optimistic</code> is a single import with two call shapes, picked apart at runtime by what you pass first.
    </p>

    <ul>
      <li><strong>Declarative</strong>, <code>optimistic(host, { source, update })</code>. A React 19-style queue of pending updates attached to a component. Reach for this for collections, which is most mutations.</li>
      <li><strong>Imperative</strong>, <code>optimistic(signal, value, action)</code>. A thin wrapper that flips a signal, awaits the action, and restores the previous value on failure. Reach for this only when the mutation <em>is</em> a single value, typically a boolean.</li>
    </ul>

    <p>
      Both are client-only, because both do client work (the declarative form calls <code>host.requestUpdate()</code>, the imperative form writes a signal). A component that imports <code>optimistic</code> is therefore never elided as a display-only component, and its module always ships to the browser. See <a href="/docs/elision">Display-Only Elision</a>.
    </p>

    <h2>Declarative: <code>optimistic(host, { source, update })</code></h2>

    <p>
      The call returns an <code>OptimisticState</code> with a <code>.value</code> getter and an <code>.add()</code> method. <code>source</code> reads the authoritative state, usually a reactive prop. <code>update</code> is a reducer folding one queued payload into that state. Calling <code>.add()</code> pushes a payload and schedules a re-render, so the next paint reads the optimistic value.
    </p>

    <code-block>import { WebComponent, prop, optimistic, html } from '@webjsdev/core';
import { createTodo } from '#modules/todos/actions/create-todo.server.ts';
import type { Todo } from '#db/schema.server.ts';  // type-only, erased before the browser

class TodoList extends WebComponent({ todos: prop&lt;Todo[]&gt;(Array) }) {
  // A prop with no seeded value and no declared default is undefined, so give
  // it one here. The page below seeds real rows through a .todos prop hole.
  constructor() { super(); this.todos = []; }

  private optimisticTodos = optimistic(this, {
    source: () =&gt; this.todos,
    // KEEP THIS REDUCER PURE. See the section below.
    update: (state, add: { tempId: string; title: string }) =&gt; [
      ...state,
      { id: add.tempId, title: add.title, completed: false, pending: true },
    ],
  });

  async handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const title = new FormData(form).get('title') as string;
    if (!title) return;
    form.reset();

    // Minted ONCE here, not in the reducer.
    const tempId = crypto.randomUUID();
    const promise = createTodo({ title });
    this.optimisticTodos.add({ tempId, title }, promise);  // auto-releases on settle

    const result = await promise;
    if (result.success && result.data) {
      // Reconcile: append the server's canonical row.
      this.todos = [...this.todos, result.data];
    }
  }

  render() {
    // The form binds the action AND calls the handler, so it submits with JS
    // off and runs the optimistic path with JS on. See "degrade-first" below.
    return html\`
      &lt;form action=\${createTodo} @submit=\${(e: SubmitEvent) =&gt; this.handleSubmit(e)}&gt;
        &lt;input name="title" required&gt;
        &lt;button&gt;Add&lt;/button&gt;
      &lt;/form&gt;
      &lt;ul&gt;\${this.optimisticTodos.value.map(todo =&gt; html\`
        &lt;li class=\${todo.pending ? 'opacity-50' : ''}&gt;\${todo.title}&lt;/li&gt;
      \`)}&lt;/ul&gt;\`;
  }
}
TodoList.register('todo-list');</code-block>

    <h3>Keep the reducer pure</h3>

    <p>
      This is the one rule that bites, so it is worth stating plainly. <code>.value</code> re-folds the <em>entire</em> queue on every read, not once per <code>.add()</code>. Your <code>update</code> reducer therefore runs again on each render, and anything it mints is minted again each time.
    </p>

    <p>
      A <code>crypto.randomUUID()</code> inside the reducer hands the pending row a different id on every read. A keyed list (<code>repeat(todos, t =&gt; t.id, ...)</code>) sees a new key each update and tears the row down and rebuilds it, losing focus, any in-progress transition, and DOM state. A hardcoded <code>'tmp'</code> is no better, because two concurrent adds collide on it. Mint the temp id in the handler, carry it in the payload, and the row keeps one stable identity for its whole life.
    </p>

    <p>
      The same applies to anything else derived at fold time. A <code>createdAt: new Date()</code> in the reducer is rebuilt per read too, which is tolerable only for as long as nothing keys on it or renders it as a stable string. Put it in the payload as well the moment something does.
    </p>

    <h3>Auto-release, and what rollback actually means</h3>

    <p>
      Pass the action's promise as the second argument to <code>.add(payload, promise)</code> and the entry auto-releases the moment that promise settles, on resolve <em>and</em> on reject. Internally that is a <code>.finally()</code>, with a <code>.then()</code> fallback for thenables that lack it.
    </p>

    <p>
      Worth being precise about what happens on failure, because "rolls back" undersells it. The declarative form holds no copy of your state. The overlay stores only the payloads, and <code>.value</code> rebuilds the optimistic view from <code>source()</code> on every read. So when the promise rejects, the entry drops and the next paint reads authoritative state again, with nothing to restore and nothing to unwind. That is also why the success path needs an explicit reconcile: the optimistic row was never written to <code>this.todos</code>, so you append the server's canonical row from <code>result.data</code>, matching the order your reducer used.
    </p>

    <ul>
      <li><strong>Concurrent adds stack.</strong> Each entry carries its own release keyed by id, so overlapping in-flight mutations never clobber one another.</li>
      <li><strong><code>.add()</code> returns its own <code>release()</code>.</strong> Call it by hand when there is no promise to hand over, for example an overlay you clear on a later user action rather than on a network result.</li>
      <li><strong>Omitting <code>update</code> replaces the state.</strong> With no reducer the payload becomes the value directly (<code>Action</code> is <code>State</code>), and with several queued the <em>last</em> one wins. This matches the plain <code>useOptimistic(setState)</code> shape.</li>
    </ul>

    <h3>Author it as a degrade-first form</h3>

    <p>
      That is what the <code>&lt;form&gt;</code> above is doing, and it is worth naming as a pattern. Wrap the mutation in a real form bound to the action, then intercept it for the optimistic path. One form serves both ends. With JS off the browser submits and the server dispatches to that action, which is the no-JS write path. With JS on, <code>@submit</code> calls <code>e.preventDefault()</code> and runs the optimistic path instead. Note the arrow wrapper on that listener. An <code>@event</code> handler is not bound to your component, so a plain method passed directly would see a framework-internal object as <code>this</code> and fail quietly rather than throw.
    </p>

    <p>
      The same imported function is both the form binding and the optimistic path's callee, which is what makes this cheap: there is no second wiring to keep in step. <code>method</code> and the enctype are supplied by the renderer, and the hidden identity field is re-inserted as the form's first child on every client render, so nothing there is yours to manage. A fetch-only <code>@click</code> handler is the shape to avoid, because it has no no-JS half at all. See <a href="/docs/progressive-enhancement">Progressive Enhancement</a>.
    </p>

    <p>
      When a page owns several mutations, give each form its own binding (<code>action=\${createTodo}</code>, <code>action=\${toggleTodo}</code>, <code>action=\${deleteTodo}</code>), or bind each submitter with <code>formaction=\${action}</code> so one form can drive several actions. A bound submitter carries its own submission and asks nothing of the form around it.
    </p>

    <h3>Seed the list from the server for SSR plus optimistic</h3>

    <p>
      For a page that server-renders a list <em>and</em> lets the user add to it, let one component own both the list and the form, and seed it from the page through a <code>.prop</code> hole (a DOM property that round-trips through SSR on custom elements). The list is then fully server-rendered on first paint, readable with JS off, and re-renders optimistically on each add.
    </p>

    <code-block>// app/notes/page.ts (server-only; awaits the data so it is in the first paint)
import { html } from '@webjsdev/core';
import '#modules/notes/components/note-composer.ts';  // registers &lt;note-composer&gt;
import { listNotes } from '#modules/notes/queries/list-notes.server.ts';

export default async function NotesPage() {
  const notes = await listNotes();
  return html\`&lt;note-composer .notes=\${notes}&gt;&lt;/note-composer&gt;\`;
}</code-block>

    <p>
      The component reads that seeded prop as its <code>source</code>, so <code>source: () =&gt; this.notes</code> is both the SSR'd list and the base for optimistic additions. Rendering a separate static list in the page would not update on an optimistic add, because a page never hydrates.
    </p>

    <h2>Imperative: <code>optimistic(signal, value, action)</code></h2>

    <p>
      For a boolean flip where the value itself is the mutation (like, follow, pin), the imperative form is a thin wrapper over the signal primitive. It sets the signal, awaits the action, and restores the previous value on failure.
    </p>

    <code-block>import { signal, optimistic } from '@webjsdev/core';
import { likePost } from '#modules/posts/actions/like-post.server.ts';

const liked = signal(false);
// in an @click handler:
const result = await optimistic(liked, true, () =&gt; likePost(postId));
// liked flips to true instantly, and stays on success.</code-block>

    <p>
      Two failure modes restore the previous value. A <strong>throw</strong> from the action rolls back and then re-throws, so a caller that wants to react still has to catch it. A returned <code>{ success: false }</code> envelope rolls back and is <em>returned</em> rather than thrown, so you read its <code>error</code> or <code>fieldErrors</code> off the result.
    </p>

    <p>
      One sharp edge is worth knowing. That second check tests <code>result.success === false</code> exactly, which is stricter than the general <code>ActionResult</code> failure rule described in <a href="/docs/server-actions">Server Actions</a>, where a bare <code>fieldErrors</code> or <code>error</code> key also counts as failure. An action that returns <code>{ fieldErrors: { ... } }</code> and omits <code>success</code> therefore leaves the optimistic value in place. Return an explicit <code>success: false</code> from any action you drive this way, which is the shape to write regardless.
    </p>

    <h2>When optimistic UI is appropriate</h2>

    <ul>
      <li>Todo items, comments, posts, likes, follows, toggles, reorders, renames, status changes.</li>
      <li>Any mutation where the client can construct the expected result from the input.</li>
      <li>CRUD where the server returns the same shape the client already holds.</li>
    </ul>

    <h2>When to skip it</h2>

    <p>
      Optimistic UI is a lie the client tells briefly and then makes true. Skip it wherever the client cannot honestly predict the ending.
    </p>

    <ul>
      <li><strong>The result is unpredictable.</strong> AI-generated content, server-computed values, anything the client would have to invent. Show a pending state instead.</li>
      <li><strong>The user must wait for a side effect.</strong> Payment processing, email sending, an OAuth round trip. Pretending it is done is worse than showing it in progress.</li>
      <li><strong>The action validates against data that may have moved.</strong> Unique constraints and race conditions produce a rollback the user reads as a glitch, because the row they watched appear vanishes a moment later.</li>
      <li><strong>The mutation is destructive with no undo.</strong> A confirm-first flow is the better UX, and an optimistic delete that fails leaves the user unsure what state their data is in.</li>
    </ul>

    <h2>Rules</h2>

    <ol>
      <li>Default to <code>optimistic()</code> for every predictable user-facing mutation.</li>
      <li>Prefer the declarative <code>.add(payload, promise)</code> form for list mutations, and pass the promise so release is automatic.</li>
      <li>Keep the <code>update</code> reducer pure, and mint temp ids in the handler.</li>
      <li>Use the imperative form only for a single value whose flip <em>is</em> the mutation.</li>
      <li>Never hand-roll try-catch, cache-and-restore, or temp-id reconciliation when these APIs cover the pattern.</li>
      <li>Reconcile the authoritative row from the returned <code>ActionResult</code> once the promise settles.</li>
    </ol>

    <p>
      <a href="/docs/server-actions">Server Actions</a> covers the actions these calls invoke and the <code>ActionResult</code> envelope they return. <a href="/docs/data-fetching">Data Fetching</a> covers the read side. <a href="/docs/client-router">Client Router</a> covers how a bound form's response is applied in place, which is what the no-JS half of a degrade-first form falls back to.
    </p>
  `;
}
