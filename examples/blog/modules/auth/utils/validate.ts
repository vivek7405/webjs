/**
 * Auth input validators. Server-side last-line defense; UI should enforce
 * the same rules for a better UX.
 */

export type SignupInput = { email: string; password: string; name: string | null };
export type LoginInput = { email: string; password: string };

export function validateSignup(input: unknown): SignupInput {
  if (!input || typeof input !== 'object') throw new Error('Expected an object');
  const obj = input as Record<string, unknown>;
  const email = typeof obj.email === 'string' ? obj.email.trim().toLowerCase() : '';
  const password = typeof obj.password === 'string' ? obj.password : '';
  const name = typeof obj.name === 'string' ? obj.name.trim() || null : null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  if (password.length > 200) throw new Error('Password too long');
  if (name && name.length > 100) throw new Error('Name too long');
  return { email, password, name };
}

export function validateLogin(input: unknown): LoginInput {
  if (!input || typeof input !== 'object') throw new Error('Expected an object');
  const obj = input as Record<string, unknown>;
  const email = typeof obj.email === 'string' ? obj.email.trim().toLowerCase() : '';
  const password = typeof obj.password === 'string' ? obj.password : '';
  if (!email || !password) throw new Error('Email and password required');
  return { email, password };
}
