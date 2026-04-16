'use server';

import { randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from './prisma.ts';

export const SESSION_COOKIE = 'blog_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Create a new session for `userId` and return the raw token (128 bits hex).
 * The token is the row primary key; never hashed — simpler for a demo,
 * acceptable for a server-only DB.
 */
export async function createSession(
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

/** Destroy a session by token. Idempotent. */
export async function destroySession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } });
}

/** Resolve a session token to its user, or null. Expired tokens auto-cleanup. */
export async function getUserByToken(
  token: string | null | undefined,
): Promise<User | null> {
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!s) return null;
  if (s.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { token } }).catch(() => { });
    return null;
  }
  return s.user;
}

/** Build a Set-Cookie header value for the session cookie. */
export function sessionCookieHeader(
  token: string,
  opts: { secure?: boolean } = {},
): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_MS / 1000}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Cookie value that deletes the session cookie. */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
