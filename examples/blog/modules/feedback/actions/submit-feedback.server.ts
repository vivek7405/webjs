'use server';

/**
 * Form-action e2e fixture (#1155): the no-JS write path.
 *
 * A `<form action=${submitFeedback}>` on `/feedback` posts to that page's own
 * url, and this action runs. Invalid input re-renders the SAME page (422) with
 * a field error and the user's typed value preserved; valid input redirects
 * (303 PRG) to `/feedback/thanks`. Works with JavaScript disabled, and the
 * client router upgrades it to an in-place swap when JS is on. No fetch
 * handler, no form library.
 *
 * Kept intentionally minimal and self-contained so the e2e probe can assert the
 * headline behavior in a real browser with JS both off and on.
 */
export async function submitFeedback(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  // Server-side validation the browser cannot do: this address is "already on
  // the list". The input is a valid email format (so the native Constraint
  // Validation API lets it submit), but the server rejects it and re-renders
  // with the field error, the canonical server-validation case.
  if (email.toLowerCase() === 'taken@example.com') {
    return {
      success: false as const,
      fieldErrors: { email: 'That email is already subscribed' },
      values: { email },
      status: 422,
    };
  }
  return { success: true as const, redirect: '/feedback/thanks' };
}
