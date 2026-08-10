// Password hashing with scrypt from node:crypto (built into Node AND Bun, no
// dependency). A server-only utility: hashes live server-side and never reach
// the browser. Swap in argon2/bcrypt here if you prefer; the call sites only use
// hash() and compare().
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return salt + ':' + buf.toString('hex');
}

export async function compare(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':');
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return timingSafeEqual(buf, Buffer.from(key, 'hex'));
}
