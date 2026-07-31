'use server';

import { createTodo } from './create-todo.server.ts';
import { toggleTodo } from './toggle-todo.server.ts';
import { deleteTodo } from './delete-todo.server.ts';

// The no-JS write path for the todo forms. Every <form> in <todo-app> binds
// THIS action, and the submit button's own `name="intent"` says which mutation
// to run, which is how one form serves several buttons.
//
// Why an intent dispatcher rather than binding each button to its own action:
// `formaction=${fn}` on a submit button is refused, because a per-submitter
// identity would have to ride the submitter's name/value pair, and that pair is
// exactly how a multi-button form tells its buttons apart. So a form binds ONE
// action, and a form with several buttons dispatches on the intent here.
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
