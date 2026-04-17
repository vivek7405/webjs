/**
 * Integration tests for the auth module (signup, login, currentUser).
 *
 * Prerequisites:
 *   - Prisma client generated: npx prisma generate
 *   - Database migrated:       npx prisma migrate dev
 *
 * Run with Node >= 23.6 (native type-stripping):
 *   node --test test/unit/auth.test.ts
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaClient } from '@prisma/client';
import { withRequest } from '@webjs/server';
import { setStore, memoryStore } from '@webjs/server';

import { signup } from '../../modules/auth/actions/signup.server.ts';
import { login } from '../../modules/auth/actions/login.server.ts';
import { currentUser } from '../../modules/auth/queries/current-user.server.ts';

// -- helpers ----------------------------------------------------------------

const prisma = new PrismaClient();
setStore(memoryStore());

const SUFFIX = Date.now();

/** Build a unique email for this test run. */
function email(label: string): string {
  return `test-${label}-${SUFFIX}@example.com`;
}

/** Wrap `fn` in a fake request context with the given session cookie. */
function withSession<T>(token: string | null, fn: () => T): T {
  const cookieHeader = token ? `blog_session=${token}` : '';
  const req = new Request('http://localhost/test', {
    headers: { cookie: cookieHeader },
  });
  return withRequest(req, fn);
}

// -- cleanup ----------------------------------------------------------------

const createdEmails: string[] = [];

after(async () => {
  // Delete all test users (cascades to sessions, posts, comments)
  if (createdEmails.length > 0) {
    await prisma.user.deleteMany({
      where: { email: { in: createdEmails } },
    });
  }
  await prisma.$disconnect();
});

// -- tests ------------------------------------------------------------------

describe('signup', () => {
  test('signup with valid input creates user and returns token', async () => {
    const em = email('signup-ok');
    createdEmails.push(em);
    const result = await signup({
      email: em,
      password: 'password1234',
      name: 'Test User',
    });
    assert.equal(result.success, true);
    if (!result.success) return; // narrow type
    assert.ok(result.data.token, 'should return a session token');
    assert.equal(result.data.user.email, em);
    assert.equal(result.data.user.name, 'Test User');
    assert.ok(result.data.user.id, 'should have an id');
  });

  test('signup with duplicate email returns error', async () => {
    const em = email('signup-dup');
    createdEmails.push(em);
    // First signup succeeds
    const first = await signup({
      email: em,
      password: 'password1234',
      name: null,
    });
    assert.equal(first.success, true);

    // Second signup with same email fails
    const second = await signup({
      email: em,
      password: 'other-password',
      name: null,
    });
    assert.equal(second.success, false);
    if (second.success) return;
    assert.equal(second.status, 409);
    assert.match(second.error, /already registered/i);
  });

  test('signup with invalid email returns error', async () => {
    const result = await signup({
      email: 'not-an-email',
      password: 'password1234',
      name: null,
    });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 400);
  });

  test('signup with short password returns error', async () => {
    const result = await signup({
      email: email('signup-shortpw'),
      password: 'short',
      name: null,
    });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 400);
    assert.match(result.error, /8 characters/);
  });
});

describe('login', () => {
  const loginEmail = email('login-user');

  test('login setup: create a user to test against', async () => {
    createdEmails.push(loginEmail);
    const result = await signup({
      email: loginEmail,
      password: 'my-secret-pw',
      name: 'Login Tester',
    });
    assert.equal(result.success, true);
  });

  test('login with valid credentials returns success', async () => {
    const result = await login({
      email: loginEmail,
      password: 'my-secret-pw',
    });
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.ok(result.data.token, 'should return a session token');
    assert.equal(result.data.user.email, loginEmail);
  });

  test('login with wrong password returns error', async () => {
    const result = await login({
      email: loginEmail,
      password: 'wrong-password',
    });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 401);
    assert.match(result.error, /invalid credentials/i);
  });

  test('login with nonexistent email returns error', async () => {
    const result = await login({
      email: `nonexistent-${SUFFIX}@example.com`,
      password: 'some-password',
    });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 401);
  });

  test('login with missing fields returns error', async () => {
    const result = await login({ email: '', password: '' });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 400);
  });
});

describe('currentUser', () => {
  test('currentUser returns null when no session cookie', async () => {
    const user = await withSession(null, () => currentUser());
    assert.equal(user, null);
  });

  test('currentUser returns null for invalid token', async () => {
    const user = await withSession('bogus-token-value', () => currentUser());
    assert.equal(user, null);
  });

  test('currentUser returns user for valid session', async () => {
    const em = email('currentuser');
    createdEmails.push(em);

    // Create user and get session token
    const result = await signup({
      email: em,
      password: 'password1234',
      name: 'Current User',
    });
    assert.equal(result.success, true);
    if (!result.success) return;
    const { token } = result.data;

    // Resolve user from token via request context
    const user = await withSession(token, () => currentUser());
    assert.ok(user, 'should resolve the user');
    assert.equal(user!.email, em);
    assert.equal(user!.name, 'Current User');
  });
});
