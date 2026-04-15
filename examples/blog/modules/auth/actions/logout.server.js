'use server';

import { destroySession } from '../../../lib/session.ts';

/**
 * Invalidate a session token.
 * @param {string | null | undefined} token
 */
export async function logout(token) {
  await destroySession(token);
  return { success: true, data: null };
}
