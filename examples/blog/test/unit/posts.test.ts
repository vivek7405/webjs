/**
 * Integration tests for the posts module (listPosts, getPost, createPost,
 * deletePost).
 *
 * Prerequisites:
 *   - Prisma client generated: npx prisma generate
 *   - Database migrated:       npx prisma migrate dev
 *
 * Run with Node >= 23.6 (native type-stripping):
 *   node --test test/unit/posts.test.ts
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaClient } from '@prisma/client';
import { withRequest } from '@webjs/server';
import { setStore, memoryStore } from '@webjs/server';

import { signup } from '../../modules/auth/actions/signup.server.ts';
import { listPosts } from '../../modules/posts/queries/list-posts.server.ts';
import { getPost } from '../../modules/posts/queries/get-post.server.ts';
import { createPost } from '../../modules/posts/actions/create-post.server.ts';
import { deletePost } from '../../modules/posts/actions/delete-post.server.ts';

// -- helpers ----------------------------------------------------------------

const prisma = new PrismaClient();
setStore(memoryStore());

const SUFFIX = Date.now();

function email(label: string): string {
  return `test-posts-${label}-${SUFFIX}@example.com`;
}

/** Run `fn` in a fake request scope with the given session cookie. */
function withSession<T>(token: string | null, fn: () => T): T {
  const cookieHeader = token ? `blog_session=${token}` : '';
  const req = new Request('http://localhost/test', {
    headers: { cookie: cookieHeader },
  });
  return withRequest(req, fn);
}

// -- shared state -----------------------------------------------------------

let authToken: string;
let userId: number;
const createdEmails: string[] = [];
const createdPostSlugs: string[] = [];

// -- cleanup ----------------------------------------------------------------

after(async () => {
  // Delete test posts first (foreign-key order), then users
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

// -- setup: create a test user ----------------------------------------------

describe('posts', () => {
  test('setup: create a test user', async () => {
    const em = email('author');
    createdEmails.push(em);
    const result = await signup({
      email: em,
      password: 'password1234',
      name: 'Post Author',
    });
    assert.equal(result.success, true);
    if (!result.success) return;
    authToken = result.data.token;
    userId = result.data.user.id;
  });

  // -- listPosts ------------------------------------------------------------

  test('listPosts returns an array', async () => {
    const posts = await listPosts();
    assert.ok(Array.isArray(posts), 'should return an array');
  });

  // -- createPost -----------------------------------------------------------

  test('createPost with valid input returns success', async () => {
    const result = await withSession(authToken, () =>
      createPost({ title: `Test Post ${SUFFIX}`, body: 'Hello world content.' }),
    );
    assert.equal(result.success, true);
    if (!result.success) return;
    const post = result.data;
    createdPostSlugs.push(post.slug);
    assert.ok(post.id, 'should have an id');
    assert.ok(post.slug, 'should have a slug');
    assert.equal(post.title, `Test Post ${SUFFIX}`);
    assert.equal(post.body, 'Hello world content.');
    assert.equal(post.authorId, userId);
    assert.ok(post.createdAt, 'should have createdAt');
  });

  test('createPost with missing title returns error', async () => {
    const result = await withSession(authToken, () =>
      createPost({ title: '', body: 'Has a body but no title.' }),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 400);
    assert.match(result.error, /title/i);
  });

  test('createPost with missing body returns error', async () => {
    const result = await withSession(authToken, () =>
      createPost({ title: 'Has Title', body: '' }),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 400);
    assert.match(result.error, /body/i);
  });

  test('createPost without auth returns 401', async () => {
    const result = await withSession(null, () =>
      createPost({ title: 'No Auth Post', body: 'Should fail.' }),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 401);
  });

  test('createPost with non-object input returns error', async () => {
    const result = await withSession(authToken, () =>
      createPost(null as unknown),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 400);
  });

  // -- getPost --------------------------------------------------------------

  test('getPost with valid slug returns the post', async () => {
    // First create a post to look up
    const createResult = await withSession(authToken, () =>
      createPost({ title: `GetPost Test ${SUFFIX}`, body: 'Lookup body.' }),
    );
    assert.equal(createResult.success, true);
    if (!createResult.success) return;
    const slug = createResult.data.slug;
    createdPostSlugs.push(slug);

    const post = await getPost({ slug });
    assert.ok(post, 'should find the post');
    assert.equal(post!.slug, slug);
    assert.equal(post!.title, `GetPost Test ${SUFFIX}`);
  });

  test('getPost with invalid slug returns null', async () => {
    const post = await getPost({ slug: `nonexistent-slug-${SUFFIX}` });
    assert.equal(post, null);
  });

  // -- deletePost -----------------------------------------------------------

  test('deletePost with valid slug owned by user works', async () => {
    // Create a post to delete
    const createResult = await withSession(authToken, () =>
      createPost({ title: `Delete Me ${SUFFIX}`, body: 'About to be deleted.' }),
    );
    assert.equal(createResult.success, true);
    if (!createResult.success) return;
    const slug = createResult.data.slug;
    // No need to track in createdPostSlugs since we are deleting it

    const deleteResult = await withSession(authToken, () =>
      deletePost({ slug }),
    );
    assert.equal(deleteResult.success, true);
    if (!deleteResult.success) return;
    assert.equal(deleteResult.data.slug, slug);

    // Verify it is gone
    const post = await getPost({ slug });
    assert.equal(post, null, 'post should be deleted');
  });

  test('deletePost without auth returns 401', async () => {
    // Create a post first
    const createResult = await withSession(authToken, () =>
      createPost({ title: `No Auth Delete ${SUFFIX}`, body: 'Should not be deletable.' }),
    );
    assert.equal(createResult.success, true);
    if (!createResult.success) return;
    const slug = createResult.data.slug;
    createdPostSlugs.push(slug);

    const result = await withSession(null, () =>
      deletePost({ slug }),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 401);
  });

  test('deletePost with nonexistent slug returns 404', async () => {
    const result = await withSession(authToken, () =>
      deletePost({ slug: `no-such-post-${SUFFIX}` }),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 404);
  });

  test('deletePost by non-owner returns 403', async () => {
    // Create a second user
    const em2 = email('non-owner');
    createdEmails.push(em2);
    const signup2 = await signup({
      email: em2,
      password: 'password1234',
      name: 'Other User',
    });
    assert.equal(signup2.success, true);
    if (!signup2.success) return;

    // Create a post with the original user
    const createResult = await withSession(authToken, () =>
      createPost({ title: `Forbidden Delete ${SUFFIX}`, body: 'Owned by someone else.' }),
    );
    assert.equal(createResult.success, true);
    if (!createResult.success) return;
    const slug = createResult.data.slug;
    createdPostSlugs.push(slug);

    // Try to delete with the second user
    const result = await withSession(signup2.data.token, () =>
      deletePost({ slug }),
    );
    assert.equal(result.success, false);
    if (result.success) return;
    assert.equal(result.status, 403);
  });
});
