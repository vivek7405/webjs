'use server';

/**
 * Per-submitter form-action e2e fixture (#1207), the button-level override.
 *
 * Bound with `formaction=${publishDraft}` on the "Publish" button inside the
 * bound `<form action=${saveDraft}>` on `/feedback/triage`. Pressing that
 * button runs THIS action instead of the form's.
 *
 * With JavaScript off there is no interception anywhere: the browser submits
 * the pressed button's own `name`/`value` pair alongside the form's hidden
 * identity field, and the dispatcher takes the last one. That is the headline
 * claim of #1207, and the e2e asserts it in a real browser with scripting
 * disabled.
 */
export async function publishDraft(formData: FormData) {
  const note = String(formData.get('note') || '').trim();
  if (!note) {
    return {
      success: false as const,
      fieldErrors: { note: 'Write something first' },
      values: { note },
      status: 422,
    };
  }
  return { success: true as const, redirect: '/feedback/triage/done?ran=publishDraft' };
}
