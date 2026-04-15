'use server';

import { cookies } from '@webjs/server';
import { getUserByToken, SESSION_COOKIE } from '../../../lib/session.ts';
import type { PublicUser } from '../types.ts';

/**
 * Resolve the currently-logged-in user from the in-flight Request's
 * session cookie. Relies on `cookies()` from @webjs/server which reads
 * the AsyncLocalStorage-backed request context.
 */
export async function currentUser(): Promise<PublicUser | null> {
  const token = cookies().get(SESSION_COOKIE);
  const user = await getUserByToken(token);
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}
