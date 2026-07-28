// A THIN route adapter: app/ is routing only. It fetches the initial data
// (server-side) via the 'use server' query and renders the interactive
// component, plus a page `action` for the no-JS write path. All the real logic
// lives in modules/todo/. This is the idiomatic app-thin + modules-logic split.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core'; // Metadata is a @webjsdev/core type
import { pageHeading } from '#lib/utils/ui.ts';
import { listTodos } from '#modules/todo/queries/list-todos.server.ts';
import { createTodo } from '#modules/todo/actions/create-todo.server.ts';
import { toggleTodo } from '#modules/todo/actions/toggle-todo.server.ts';
import { deleteTodo } from '#modules/todo/actions/delete-todo.server.ts';
import '#modules/todo/components/todo-app.ts';

export const metadata: Metadata = { title: 'Todo (optimistic UI) | examples' };

export default async function TodoExample() {
  // Fetched here on the server and handed down as a property, so <todo-app>
  // paints the real list on the first byte with nothing to fetch on hydration.
  const todos = await listTodos();
  return html`
    ${pageHeading('Optimistic todo')}
    <todo-app .todos=${todos}></todo-app>
  `;
}

// No-JS write path: the component's <form>s post here; with JS the component
// intercepts and mutates optimistically instead. Success is a 303 PRG.
export async function action({ formData }: { formData: FormData }) {
  const intent = String(formData.get('intent') ?? '');
  const id = String(formData.get('id') ?? '');
  if (intent === 'create') return createTodo({ title: String(formData.get('title') ?? '') });
  if (intent === 'toggle') return toggleTodo({ id });
  if (intent === 'delete') return deleteTodo({ id });
  return { success: false as const, error: 'Unknown action.', status: 400 };
}
