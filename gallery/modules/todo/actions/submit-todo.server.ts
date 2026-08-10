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
// directly instead, with `formaction=${action}` on a <button>. The enclosing
// <form> does NOT have to be bound: a bound submitter carries its own
// `formmethod` and enctype, so it works in any form or none. The identity rides
// that button's own name/value pair, so it works with JS off too. Two things to
// know: it must be a <button> (on an
// <input type="submit"> the identity would occupy `value`, which is also that
// control's visible label), and a bound submitter cannot carry its own
// `name`/`value`, which is exactly the channel `name="intent"` uses below.
//
// Third thing to know: no `formaction` url is emitted, because the identity
// travels in the body instead. So the submission targets whatever the FORM
// targets, and a form declaring `action="/x"` sends its buttons there. The
// action still runs when `/x` is a PAGE route; against a `route.ts` or another
// origin the identity is ignored and nothing runs, which the dev-time client
// guard reports at submit time.
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
