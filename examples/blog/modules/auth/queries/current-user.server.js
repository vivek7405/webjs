'use server';

import { cookies } from '@webjs/server';
import { getUserByToken, SESSION_COOKIE } from '../../../lib/session.ts';

/**
 * Resolve the currently-logged-in user from the in-flight Request's
 * session cookie. Relies on `cookies()` from @webjs/server which reads
 * the AsyncLocalStorage-backed request context.
 *
 * Returns null when there is no session, or the session is expired.
 *
 * @returns {Promise<import('../types.js').PublicUser | null>}
 */
export async function currentUser() {
  const token = cookies().get(SESSION_COOKIE);
  const user = await getUserByToken(token);
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}
