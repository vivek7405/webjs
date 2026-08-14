'use server';
// The settings write path. A `'use server'` action bound straight to the form,
// so it submits with JS off and the client router applies the response in place
// with JS on. No fetch, no endpoint to name.
//
// Validation returns an ActionResult carrying BOTH fieldErrors and values, so
// the re-rendered form can show what was wrong AND keep everything the reader
// typed. Losing the other fifteen fields because one was wrong is the thing
// that makes people abandon a settings form.
import type { ActionResult } from '@webjsdev/server';
import { NOTIFICATION_KEYS } from '../types.ts';

export interface SettingsInput {
  displayName: string;
  email: string;
  practice: string;
  timezone: string;
  notifications: string;
}

export async function saveSettings(formData: FormData): Promise<ActionResult<SettingsInput>> {
  const displayName = String(formData.get('displayName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const practice = String(formData.get('practice') ?? '').trim();
  const timezone = String(formData.get('timezone') ?? '').trim();

  // An unchecked checkbox submits NOTHING, so the set of present keys IS the
  // answer. Read them back so a failed validation can restore them: the four
  // text fields surviving a 422 while six toggles silently reset is the same
  // defect in a less obvious place.
  const notifications = NOTIFICATION_KEYS.filter((k) => formData.get(k) != null);
  // `values` is a Record<string, string> by the envelope's definition, mirroring
  // the fact that a form submits strings. So the set rides as one comma-joined
  // field rather than as an array, and the page splits it back.
  const values = { displayName, email, practice, timezone, notifications: notifications.join(',') };
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
