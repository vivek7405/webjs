'use server';
// The settings write path. A `'use server'` action bound straight to the form,
// so it submits with JS off and the client router applies the response in place
// with JS on. No fetch, no endpoint to name.
//
// Validation returns an ActionResult carrying BOTH fieldErrors and values, so
// the re-rendered form can show what was wrong AND keep everything the reader
// typed. Losing the other fifteen fields because one was wrong is the thing
// that makes people abandon a settings form.
import type { ActionResult } from '@webjsdev/core';

export interface SettingsInput {
  displayName: string;
  email: string;
  practice: string;
  timezone: string;
}

export async function saveSettings(formData: FormData): Promise<ActionResult<SettingsInput>> {
  const displayName = String(formData.get('displayName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const practice = String(formData.get('practice') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? '').trim();

  const values = { displayName, email, practice, timezone };
  const fieldErrors: Record<string, string> = {};

  if (displayName.length < 2 || displayName.length > 60) {
    fieldErrors.displayName = 'Use between 2 and 60 characters.';
  }
  // Deliberately not a clever regex. An email is checked by sending to it; the
  // form's job is to catch the obvious typo without rejecting a valid address.
  if (!email.includes('@') || !email.includes('.') || email.length < 6) {
    fieldErrors.email = 'Enter an email address we can reach you at.';
  }

  if (Object.keys(fieldErrors).length) {
    return { success: false, fieldErrors, values };
  }

  return { success: true, data: values, redirect: '/examples/settings?saved=1' };
}
