'use server';

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * Hash a password with scrypt. Output format: `scrypt$<saltHex>$<hashHex>`.
 *
 * scrypt's default params (N=16384, r=8, p=1) take ~50ms per hash — cheap
 * on one login, prohibitive to brute-force.
 *
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = /** @type {Buffer} */ (await scryptAsync(password, salt, 64));
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verify a password against a stored hash. Constant-time compare.
 *
 * @param {string} password
 * @param {string | null | undefined} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = /** @type {Buffer} */ (await scryptAsync(password, salt, expected.length));
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
