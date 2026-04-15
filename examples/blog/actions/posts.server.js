'use server';

import { PrismaClient } from '@prisma/client';
import { expose } from 'webjs';

// Single PrismaClient per process — see Prisma docs on connection pooling.
/** @type {PrismaClient} */
const db = globalThis.__webjs_prisma ?? (globalThis.__webjs_prisma = new PrismaClient());

/**
 * List the most recent posts.
 *
 * Exposed as GET /api/posts for external consumers — the exact same function
 * is also callable from any client component via a plain import.
 *
 * @returns {Promise<Array<import('@prisma/client').Post>>}
 */
export const listPosts = expose('GET /api/posts', async () => {
  return db.post.findMany({ orderBy: { createdAt: 'desc' } });
});

/**
 * Look up a post by slug.
 *
 * Exposed as GET /api/posts/:slug.
 * @param {{ slug: string }} input
 */
export const getPost = expose('GET /api/posts/:slug', async ({ slug }) => {
  return db.post.findUnique({ where: { slug } });
});

/**
 * Create a post. Slug is derived from the title.
 *
 * Exposed as POST /api/posts. The body is parsed as JSON and merged into the
 * function's single object argument.
 *
 * @param {{ title: string, body: string }} input
 */
export const createPost = expose('POST /api/posts', async (input) => {
  const title = String(input.title || '').trim();
  const body = String(input.body || '').trim();
  if (!title || !body) throw new Error('Title and body are required');
  const base = slugify(title) || 'post';
  let slug = base;
  let n = 1;
  while (await db.post.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
  return db.post.create({ data: { title, body, slug } });
});

/** @param {string} s */
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
