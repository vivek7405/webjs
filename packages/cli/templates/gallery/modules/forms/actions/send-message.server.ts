'use server';

// The action a <form action=${sendMessage}> submits to. It receives the
// FormData directly: a form-bound action always does, on the JS path and the
// no-JS path alike.
//
// Return a FAILURE to re-render the SAME page at 422 with the result on
// `actionData` (so the fields repopulate), or a SUCCESS with a same-site
// `redirect` for a 303 Post-Redirect-Get.
//
// FOOTGUN: to redirect on success, RETURN `{ success: true, redirect: '/path' }`
// (a 303 See Other, so the browser follows with a GET). Do NOT THROW `redirect()`
// from a form action, that is a 307 which PRESERVES the POST method and body, so
// the browser re-POSTs to the target and re-runs the mutation (a duplicate
// write). Throw `redirect()` only from a page render / GET context.
export interface Result {
  success: boolean;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  redirect?: string;
}

export async function sendMessage(formData: FormData): Promise<Result> {
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const message = String(formData.get('message') ?? '').trim();
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = 'Your name is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fieldErrors.email = 'A valid email is required.';
  if (message.length < 5) fieldErrors.message = 'Message must be at least 5 characters.';
  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors, values: { name, email, message } };
  // A real app would persist / email here. We just confirm.
  return { success: true, redirect: '/features/forms?sent=1' };
}
