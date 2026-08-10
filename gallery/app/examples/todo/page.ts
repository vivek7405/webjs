// A THIN route adapter: app/ is routing only. It fetches the initial data
// (server-side) via the 'use server' query and renders the interactive
// component. All the real logic lives in modules/todo/, including the action
// the component's forms bind to. This is the idiomatic app-thin +
// modules-logic split.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core'; // Metadata is a @webjsdev/core type
import { pageHeading } from '#lib/utils/ui.ts';
import { listTodos } from '#modules/todo/queries/list-todos.server.ts';
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
