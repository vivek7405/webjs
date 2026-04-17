/**
 * Unit tests for lib/password.ts — pure crypto, no database needed.
 *
 * Run with Node >= 23.6 (native type-stripping):
 *   node --test test/unit/password.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword } from '../../lib/password.ts';

test('hashPassword produces a scrypt$salt$hash string', async () => {
  const hash = await hashPassword('test-password-123');
  const parts = hash.split('$');
  assert.equal(parts.length, 3, 'should have 3 parts separated by $');
  assert.equal(parts[0], 'scrypt', 'prefix should be "scrypt"');
  assert.equal(parts[1].length, 32, 'salt should be 16 bytes = 32 hex chars');
  assert.equal(parts[2].length, 128, 'derived key should be 64 bytes = 128 hex chars');
});

test('hashPassword produces unique hashes for the same password', async () => {
  const h1 = await hashPassword('same-password');
  const h2 = await hashPassword('same-password');
  assert.notEqual(h1, h2, 'different salts should produce different hashes');
});

test('verifyPassword returns true for correct password', async () => {
  const hash = await hashPassword('correct-horse-battery');
  const ok = await verifyPassword('correct-horse-battery', hash);
  assert.equal(ok, true);
});

test('verifyPassword returns false for wrong password', async () => {
  const hash = await hashPassword('correct-horse-battery');
  const ok = await verifyPassword('wrong-password', hash);
  assert.equal(ok, false);
});

test('verifyPassword returns false for null/undefined stored hash', async () => {
  assert.equal(await verifyPassword('anything', null), false);
  assert.equal(await verifyPassword('anything', undefined), false);
  assert.equal(await verifyPassword('anything', ''), false);
});

test('verifyPassword returns false for malformed stored hash', async () => {
  assert.equal(await verifyPassword('pw', 'not-a-valid-hash'), false);
  assert.equal(await verifyPassword('pw', 'scrypt$bad'), false);
});
