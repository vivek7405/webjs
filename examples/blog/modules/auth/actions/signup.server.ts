'use server';

import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';
import { hashPassword } from '#lib/password.server.ts';
import { createSession } from '#lib/session.server.ts';
import { validateSignup } from '#modules/auth/utils/validate.ts';
import type { SignupPayload } from '#modules/auth/utils/validate.ts';
import type { ActionResult, PublicUser } from '#modules/auth/types.ts';

/**
 * Register a new user + open a session. The session token is returned for
 * the caller (route handler) to set as a cookie on the HTTP response.
 */
// The parameter declares the CONTRACT (so a caller type-checks against it);
// validateSignup is the runtime enforcement, since this action is also
// reachable from route.ts with a raw JSON body.
export async function signup(
  input: SignupPayload,
): Promise<ActionResult<{ user: PublicUser; token: string }>> {
  let parsed;
  try { parsed = validateSignup(input); }
  catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e), status: 400 };
  }
  const existing = await db.query.users.findFirst({
    where: { email: parsed.email },
    columns: { id: true },
  });
  if (existing) return { success: false, error: 'That email is already registered', status: 409 };

  const passwordHash = await hashPassword(parsed.password);
  const [user] = await db.insert(users).values({ email: parsed.email, passwordHash, name: parsed.name }).returning();
  const { token } = await createSession(user.id);
  return {
    success: true,
    data: {
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
      token,
    },
  };
}
