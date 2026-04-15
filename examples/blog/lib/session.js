'use server';

import { randomBytes } from 'node:crypto';
import { prisma } from './prisma.js';

export const SESSION_COOKIE = 'blog_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Create a new session for `userId` and return the raw token (128 bits hex).
 * The token is stored as the row primary key; never store it hashed — simpler
 * for a demo, acceptable for a server-only DB.
 *
 * @param {number} userId
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function createSession(userId) {
  const token = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

/**
 * Destroy a session by token. Idempotent.
 * @param {string | null | undefined} token
 */
export async function destroySession(token) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } });
}

/**
 * Resolve a session token to its user, or null. Expired tokens auto-cleanup.
 *
 * @param {string | null | undefined} token
 * @returns {Promise<import('@prisma/client').User | null>}
 */
export async function getUserByToken(token) {
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!s) return null;
  if (s.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { token } }).catch(() => {});
    return null;
  }
  return s.user;
}

/** Build a Set-Cookie header value for the session cookie. */
export function sessionCookieHeader(token, { secure = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_MS / 1000}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** A cookie value that deletes the session cookie. */
export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
