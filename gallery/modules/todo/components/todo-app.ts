// The interactive surface. Demonstrates: the WebComponent factory + reactive
// prop, the DECLARATIVE optimistic() API (instant update, auto-rollback), and
// progressive enhancement (each mutation is a <form action=${submitTodo}> bound to a server action,
// intercepted by JS for the optimistic path). All interactivity lives in a
// component; a page/layout cannot be interactive in its own markup.
//
// Styling uses the shadcn-standard design tokens the @webjsdev/ui theme defines
// (bg-card, text-foreground, bg-primary, text-muted-foreground, border-border,
// ...), so the whole app (this component AND any `webjs ui add` component) shares
// one coherent theme. Prefer these tokens (and opacity modifiers like
// bg-primary/90) over ad-hoc colors.
import { WebComponent, prop, optimistic, html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { buttonClass } from '#components/ui/button.ts';
import { bareInputClass } from '#components/ui/input.ts';
import { cn } from '#lib/utils/cn.ts';
import { createTodo } from '../actions/create-todo.server.ts';
import { toggleTodo } from '../actions/toggle-todo.server.ts';
import { deleteTodo } from '../actions/delete-todo.server.ts';
import { submitTodo } from '../actions/submit-todo.server.ts';
import type { Todo } from '../types.ts';

type Op =
  | { kind: 'add'; tempId: string; title: string }
  | { kind: 'toggle'; id: string; completed: boolean }
  | { kind: 'delete'; id: string };

export class TodoApp extends WebComponent({
  // A reactive prop: the SSR'd list arrives via `.todos=${todos}` and hydrates.
  todos: prop<Todo[]>(Array),
}) {
  // One optimistic store, three ops. `.add(payload, promise)` applies `update`
  // instantly and auto-releases when the promise settles (resolve OR reject),
  // so there is no manual try-catch / rollback / temp-id bookkeeping.
  private store = optimistic(this, {
    source: () => this.todos ?? [],
    update: (state: Todo[], op: Op): Todo[] => {
      if (op.kind === 'add') return [{ id: op.tempId, title: op.title, completed: false, createdAt: new Date(), pending: true }, ...state];
      if (op.kind === 'toggle') return state.map((t) => (t.id === op.id ? { ...t, completed: op.completed } : t));
      return state.filter((t) => t.id !== op.id);
    },
  });

  async add(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const title = String(new FormData(form).get('title') ?? '').trim();
    if (!title) return;
    form.reset();
    const tempId = crypto.randomUUID();
    const promise = createTodo({ title });
    this.store.add({ kind: 'add', tempId, title }, promise);
    const r = await promise;
    if (r.success && r.data) this.todos = [r.data, ...(this.todos ?? [])];
  }

  async toggle(e: Event, todo: Todo) {
    e.preventDefault();
    if (todo.pending) return;
    const completed = !todo.completed;
    const promise = toggleTodo({ id: todo.id, completed });
    this.store.add({ kind: 'toggle', id: todo.id, completed }, promise);
    const r = await promise;
    if (r.success && r.data) { const d = r.data; this.todos = (this.todos ?? []).map((t) => (t.id === todo.id ? d : t)); }
  }

  async removeTodo(e: Event, todo: Todo) {
    e.preventDefault();
    if (todo.pending) return;
    const promise = deleteTodo({ id: todo.id });
    this.store.add({ kind: 'delete', id: todo.id }, promise);
    const r = await promise;
    if (r.success) this.todos = (this.todos ?? []).filter((t) => t.id !== todo.id);
  }

  render() {
    const list = this.store.value;
    const done = list.filter((t) => t.completed).length;
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;
    return html`
      <section class="w-full max-w-lg grid gap-5">
        <!-- Header: a title, a live done/total count, and a progress bar. -->
        <header class="grid gap-3">
          <div class="flex items-center gap-3">
            <span class="grid place-items-center w-10 h-10 rounded-2xl bg-primary/15 text-primary shrink-0">
              <svg viewBox="0 0 24 24" class="w-5 h-5 stroke-current fill-none" style="stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"><path d="m5 13 4 4L19 7"/></svg>
            </span>
            <div class="grid gap-0.5">
              <h2 class="m-0 text-2xl font-bold tracking-[-0.02em] leading-none text-foreground">Tasks</h2>
              <p class="m-0 text-sm text-muted-foreground leading-none">${done} of ${list.length} done</p>
            </div>
            <span class="ml-auto text-sm font-semibold tabular-nums text-muted-foreground">${pct}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-muted overflow-hidden">
            <div class="h-full rounded-full bg-primary transition-[width] duration-300" style="width:${pct}%"></div>
          </div>
        </header>

        <!-- Add: a real <form> bound to the server action, so it works with JS
             off; with JS, @submit intercepts and runs the optimistic path. -->
        <form action=${submitTodo} @submit=${(e: SubmitEvent) => this.add(e)}
          class="${cardClass()} flex items-center gap-2 p-2 pl-4 shadow-[0_1px_0_0_color-mix(in_oklch,var(--foreground)_5%,transparent)]">
          <input type="hidden" name="intent" value="create" />
          <input name="title" required maxlength="280" autocomplete="off" placeholder="What needs doing?"
            class=${bareInputClass()} />
          <button type="submit"
            class="${buttonClass()} shrink-0">Add</button>
        </form>

        <ul class="list-none m-0 p-0 grid gap-2">
          ${list.length ? list.map((todo) => html`
            <li>
              <!-- One form, two submit buttons: each carries its own
                   name="intent", which the bound action dispatches on. -->
              <form action=${submitTodo}
                class="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card border border-border transition-colors hover:border-border-strong ${todo.pending ? 'opacity-55' : ''}">
                <input type="hidden" name="id" value=${todo.id} />
                <!-- Toggle is a submit button (degrades to a form POST no-JS); with JS
                     @click intercepts for the optimistic toggle. The check is centered
                     (grid place-items-center) and only visible once completed. -->
                <button id="t-${todo.id}" type="submit" name="intent" value="toggle"
                  aria-pressed=${todo.completed ? 'true' : 'false'}
                  aria-label=${todo.completed ? 'Mark as not done' : 'Mark as done'}
                  @click=${(e: Event) => this.toggle(e, todo)}
                  class="shrink-0 grid place-items-center w-5 h-5 rounded-full border-2 cursor-pointer transition-all ${todo.completed ? 'bg-primary border-primary text-primary-foreground' : 'bg-transparent border-border-strong text-transparent hover:border-primary'}">
                  <svg viewBox="0 0 24 24" class="w-3 h-3 stroke-current fill-none" style="stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round"><path d="m5 13 4 4L19 7"/></svg>
                </button>
                <!-- The title is a <label for> the toggle: clicking the text toggles
                     the task (works on JS and no-JS paths, and screen readers). -->
                <label for="t-${todo.id}" class="flex-1 min-w-0 text-sm leading-snug break-words cursor-pointer select-none ${todo.completed ? 'line-through text-muted-foreground' : 'text-foreground'}">${todo.title}</label>
                <!-- Delete: a proper icon button, revealed on row hover / focus. -->
                <button type="submit" name="intent" value="delete" aria-label="Delete task"
                  @click=${(e: Event) => this.removeTodo(e, todo)}
                  class=${cn(buttonClass({ variant: 'destructive', size: 'none' }), 'w-7 h-7 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100')}>
                  <svg viewBox="0 0 24 24" class="w-4 h-4 stroke-current fill-none" style="stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </form>
            </li>
          `) : html`
            <li class="text-center text-muted-foreground text-sm py-14 border border-dashed border-border rounded-2xl">No tasks yet. Add your first one above.</li>
          `}
        </ul>
      </section>
    `;
  }
}
TodoApp.register('todo-app');
