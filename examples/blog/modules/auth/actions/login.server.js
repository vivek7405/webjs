'use server';

import { prisma } from '../../../lib/prisma.ts';
import { verifyPassword } from '../../../lib/password.ts';
import { createSession } from '../../../lib/session.ts';
import { validateLogin } from '../utils/validate.js';

/**
 * Authenticate by email + password; open a new session.
 *
 * @param {unknown} input
 * @returns {Promise<import('../types.js').ActionResult<{ user: import('../types.js').PublicUser, token: string }>>}
 */
export async function login(input) {
  let parsed;
  try { parsed = validateLogin(input); }
  catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e), status: 400 };
  }
  const user = await prisma.user.findUnique({ where: { email: parsed.email } });
  // Constant-ish time: always run verifyPassword even when user is missing.
  const valid = user
    ? await verifyPassword(parsed.password, user.passwordHash)
    : await verifyPassword(parsed.password, 'scrypt$00$00');
  if (!user || !valid) {
    return { success: false, error: 'Invalid credentials', status: 401 };
  }
  const { token } = await createSession(user.id);
  return {
    success: true,
    data: {
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
      token,
    },
  };
}
