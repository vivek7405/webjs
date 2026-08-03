'use server';

import { createTodo } from './create-todo.server.ts';
import { toggleTodo } from './toggle-todo.server.ts';
import { deleteTodo } from './delete-todo.server.ts';

// The no-JS write path for the todo forms. Every <form> in <todo-app> binds
// THIS action, and the submit button's own `name="intent"` says which mutation
// to run, which is how one form serves several buttons.
//
// Why an intent dispatcher here rather than binding each button to its own
// action: this form carries the todo's `id` on a hidden input and needs the
// SAME id for whichever mutation runs, so one action reading both fields is the
// simpler shape. When the buttons need no shared payload, bind each one
// directly instead, with `formaction=${action}` on a <button> or an
// <input type="submit"> inside the bound form. The identity then rides that
// button's own name/value pair, so it works with JS off too. Note the tradeoff:
// a bound submitter cannot carry its own `name`/`value`, which is exactly the
// channel `name="intent"` uses below.
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
