'use server';

import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';
import { hash } from '../password.server.ts';
import { signIn } from '../auth.server.ts';

// The action the signup <form> is bound to. It takes the FormData directly:
// that is what a form-bound action always receives, on the JS path and the
// no-JS path alike, so validation lives HERE rather than in a per-page adapter.
//
// A validation failure returns fieldErrors + values, which re-renders the SAME
// page at 422 with the messages and the user's typed input preserved. On
// success it signs the new user in: signIn returns a 302 Response carrying the
// session cookie, and an action may return a Response, which the framework
// honors verbatim. signIn lives in the server-only auth module, imported here
// server-to-server, so it never reaches the browser.
export async function signup(formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const values = { name, email };
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = 'Name is required';
  if (!email.includes('@')) fieldErrors.email = 'Enter a valid email';
  if (password.length < 8) fieldErrors.password = 'At least 8 characters';
  if (Object.keys(fieldErrors).length) return { success: false as const, fieldErrors, values, status: 422 };

  const exists = await db.query.users.findFirst({ where: { email }, columns: { id: true } });
  if (exists) {
    return { success: false as const, fieldErrors: { email: 'Email already registered' }, values, status: 409 };
  }
  await db.insert(users).values({ name, email, passwordHash: await hash(password) });
  return signIn('credentials', { email, password }, { redirectTo: '/features/auth/dashboard' });
}
