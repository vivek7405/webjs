'use server';

import { createTodo } from './create-todo.server.ts';
import { toggleTodo } from './toggle-todo.server.ts';
import { deleteTodo } from './delete-todo.server.ts';

// The no-JS write path for the todo forms. Every <form> in <todo-app> binds
// THIS action, and the submit button's own `name="intent"` says which mutation
// to run, which is how one form serves several buttons.
//
// Alternatively, per-button submitter server actions can be bound directly via
// `formaction=${action}` on <button> or <input type="submit"> (#1207).
//
// With JS the component intercepts the submit and calls the underlying action
// directly for the optimistic path, so this runs only with JS off.
export async function submitTodo(formData: FormData) {
  const intent = String(formData.get('intent') ?? '');
  const id = String(formData.get('id') ?? '');
  if (intent === 'create') return createTodo({ title: String(formData.get('title') ?? '') });
  if (intent === 'toggle') return toggleTodo({ id });
  if (intent === 'delete') return deleteTodo({ id });
  return { success: false as const, error: 'Unknown action.', status: 400 };
}
