'use server';

import { destroySession } from '../../../lib/session.js';

/**
 * Invalidate a session token.
 * @param {string | null | undefined} token
 */
export async function logout(token) {
  await destroySession(token);
  return { success: true, data: null };
}
