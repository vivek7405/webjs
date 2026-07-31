'use server';

import { db } from '#db/connection.server.ts';
import { verifyPassword } from '#lib/password.server.ts';
import { createSession } from '#lib/session.server.ts';
import { validateLogin } from '#modules/auth/utils/validate.ts';
import type { LoginInput } from '#modules/auth/utils/validate.ts';
import type { ActionResult, PublicUser } from '#modules/auth/types.ts';

/** Authenticate by email + password; open a new session. */
// The parameter declares the CONTRACT (so a caller type-checks against it);
// validateLogin is the runtime enforcement, since this action is also
// reachable from route.ts with a raw JSON body.
export async function login(
  input: LoginInput,
): Promise<ActionResult<{ user: PublicUser; token: string }>> {
  let parsed;
  try { parsed = validateLogin(input); }
  catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e), status: 400 };
  }
  const user = await db.query.users.findFirst({ where: { email: parsed.email } });
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
