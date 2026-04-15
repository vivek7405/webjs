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
export const listPosts = expose(
  'GET /api/posts',
  async () => db.post.findMany({ orderBy: { createdAt: 'desc' } }),
  { cors: true } // Demo: allow any origin to read the post feed.
);

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
 * Validate and normalise createPost input. Any throw here turns into a 400
 * JSON response at the edge, before the function runs.
 *
 * @param {unknown} input
 * @returns {{ title: string, body: string }}
 */
function validateCreatePost(input) {
  if (!input || typeof input !== 'object') throw new Error('Expected an object');
  const obj = /** @type {Record<string, unknown>} */ (input);
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const body = typeof obj.body === 'string' ? obj.body.trim() : '';
  if (!title) throw new Error('title is required');
  if (!body) throw new Error('body is required');
  if (title.length > 200) throw new Error('title too long');
  if (body.length > 20_000) throw new Error('body too long');
  return { title, body };
}

/**
 * Create a post. Slug is derived from the title.
 *
 * Exposed as POST /api/posts. `validate` runs before the handler — it's the
 * single place that decides what "valid input" looks like and is shared by
 * both callers (client-component RPC and external HTTP).
 *
 * @param {{ title: string, body: string }} input
 */
export const createPost = expose(
  'POST /api/posts',
  async (input) => {
    const base = slugify(input.title) || 'post';
    let slug = base;
    let n = 1;
    while (await db.post.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
    return db.post.create({ data: { title: input.title, body: input.body, slug } });
  },
  { validate: validateCreatePost }
);

/** @param {string} s */
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
