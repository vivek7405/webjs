'use server';

import { prisma } from '../../../lib/prisma.ts';
import { hashPassword } from '../../../lib/password.ts';
import { createSession } from '../../../lib/session.ts';
import { validateSignup } from '../utils/validate.js';

/**
 * Register a new user + open a session. The session token is returned for
 * the caller (route handler) to set as a cookie on the HTTP response.
 *
 * @param {unknown} input
 * @returns {Promise<import('../types.js').ActionResult<{ user: import('../types.js').PublicUser, token: string }>>}
 */
export async function signup(input) {
  let parsed;
  try { parsed = validateSignup(input); }
  catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e), status: 400 };
  }
  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) return { success: false, error: 'That email is already registered', status: 409 };

  const passwordHash = await hashPassword(parsed.password);
  const user = await prisma.user.create({
    data: { email: parsed.email, passwordHash, name: parsed.name },
  });
  const { token } = await createSession(user.id);
  return {
    success: true,
    data: {
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
      token,
    },
  };
}
