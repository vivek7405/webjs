/**
 * Integration tests for the comments module (listComments, createComment).
 *
 * Prerequisites:
 *   - Prisma client generated: npx prisma generate
 *   - Database migrated:       npx prisma migrate dev
 *
 * Run with Node >= 23.6 (native type-stripping):
 *   node --test test/unit/comments.test.ts
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaClient } from '@prisma/client';
import { withRequest } from '@webjs/server';
import { setStore, memoryStore } from '@webjs/server';

import { signup } from '../../modules/auth/actions/signup.server.ts';
import { createPost } from '../../modules/posts/actions/create-post.server.ts';
import { listComments } from '../../modules/comments/queries/list-comments.server.ts';
import { createComment } from '../../modules/comments/actions/create-comment.server.ts';

// -- helpers ----------------------------------------------------------------

const prisma = new PrismaClient();
setStore(memoryStore());

const SUFFIX = Date.now();

function email(label: string): string {
  return `test-comments-${label}-${SUFFIX}@example.com`;
}

function withSession<T>(token: string | null, fn: () => T): T {
  const cookieHeader = token ? `blog_session=${token}` : '';
  const req = new Request('http://localhost/test', {
    headers: { cookie: cookieHeader },
  });
  return withRequest(req, fn);
}

// -- shared state -----------------------------------------------------------

let authToken: string;
let postId: number;
const createdEmails: string[] = [];
const createdPostSlugs: string[] = [];

// -- cleanup ----------------------------------------------------------------

after(async () => {
  // Comments cascade-delete with posts; posts cascade-delete with users.
  for (const slug of createdPostSlugs) {
    await prisma.post.deleteMany({ where: { slug } });
  }
  if (createdEmails.length > 0) {
    await prisma.user.deleteMany({
      where: { email: { in: createdEmails } },
    });
  }
  await prisma.$disconnect();
});

// -- tests ------------------------------------------------------------------

describe('comments', () => {
  test('setup: create a user and a post', async () => {
    const em = email('commenter');
    createdEmails.push(em);
    const userResult = await signup({
      email: em,
      password: 'password1234',
      name: 'Commenter',
    });
    assert.equal(userResult.success, true);
    if (!userResult.success) return;
    authToken = userResult.data.token;

    const postResult = await withSession(authToken, () =>
      createPost({ title: `Comment Target ${SUFFIX}`, body: 'Post for comments.' }),
    );
    assert.equal(postResult.success, true);
    if (!postResult.success) return;
    postId = postResult.data.id;
    createdPostSlugs.push(postResult.data.slug);
  });

  // -- listComments ---------------------------------------------------------

  test('listComments returns an array for a post', async () => {
    const comments = await listComments({ postId });
    assert.ok(Array.isArray(comments), 'should return an array');
  });

  test('listComments returns empty array for post with no comments', async () => {
    // Create a fresh post with no comments
    const postResult = await withSession(authToken, () =>
      createPost({ title: `No Comments ${SUFFIX}`, body: 'Empty.' }),
    );
    assert.equal(postResult.success, true);
    if (!postResult.success) return;
    createdPostSlugs.push(postResult.data.slug);

    const comments = await listComments({ postId: postResult.data.id });
    assert.ok(Array.isArray(comments));
    assert.equal(comments.length, 0);
  });

  // -- createComment --------------------------------------------------------

  test('createComment with valid input creates a comment', async () => {
    const result = await withSession(authToken, () =>
      createComment({ postId, body: `Test comment ${SUFFIX}` }),
    );
    assert.equal(result.success, true);
    if (!result.success) return;
    const comment = result.data;
    assert.ok(comment.id, 'should have an id');
    assert.equal(comment.postId, postId);
    assert.equal(comment.body, `Test comment ${SUFFIX}`);
    assert.ok(comment.authorName, 'should have an author name');
    assert.ok(comment.createdAt, 'should have createdAt');
  });

  test('createComment shows up in listComments', async () => {
    // Create a comment
    await withSession(authToken, () =>
      createComment({ postId, body: `Visible comment ${SUFFIX}` }),
    );

    const comments = await listComments({ postId });
    const found = comments.find((c) => c.body === `Visible comment ${SUFFIX}`);
    assert.ok(found, 'the new comment should appear in listComments');
  });

  test('createComment without auth returns 401', async () => {
    const result = await withSession(null, () =>
      createComment({ postId, body: 'Should fail.' }),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 401);
  });

  test('createComment with empty body returns error', async () => {
    const result = await withSession(authToken, () =>
      createComment({ postId, body: '' }),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 400);
    assert.match(result.error, /body/i);
  });

  test('createComment with nonexistent post returns 404', async () => {
    const result = await withSession(authToken, () =>
      createComment({ postId: 999_999_999, body: 'Ghost post.' }),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 404);
  });
});
