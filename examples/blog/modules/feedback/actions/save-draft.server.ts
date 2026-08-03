'use server';

/**
 * Per-submitter form-action e2e fixture (#1207), the form-level default.
 *
 * `/feedback/triage` binds this action on the `<form>` itself, so it runs when
 * the form is submitted by anything that does not name its own action: the
 * "Save draft" button, or a bare Enter in the text field.
 *
 * It reports WHICH action ran, because the whole point of the per-button
 * binding is that a different one runs for a different button, and "the form
 * submitted successfully" cannot tell those apart.
 */
export async function saveDraft(formData: FormData) {
  const note = String(formData.get('note') || '').trim();
  if (!note) {
    return {
      success: false as const,
      fieldErrors: { note: 'Write something first' },
      values: { note },
      status: 422,
    };
  }
  return { success: true as const, redirect: '/feedback/triage/done?ran=saveDraft' };
}
