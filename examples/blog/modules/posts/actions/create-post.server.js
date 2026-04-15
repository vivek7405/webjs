'use server';

import { prisma } from '../../../lib/prisma.js';
import { slugify, formatPost } from '../utils/slugify.js';
import { currentUser } from '../../auth/queries/current-user.server.js';

/**
 * Create a post authored by the currently-logged-in user. The action reads
 * the user from the request context — no userId parameter needed.
 *
 * @param {unknown} input
 * @returns {Promise<import('../../auth/types.js').ActionResult<import('../types.js').PostFormatted>>}
 */
export async function createPost(input) {
  const me = await currentUser();
  if (!me) return { success: false, error: 'Not signed in', status: 401 };

  if (!input || typeof input !== 'object') {
    return { success: false, error: 'Expected an object', status: 400 };
  }
  const o = /** @type {Record<string, unknown>} */ (input);
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const body = typeof o.body === 'string' ? o.body.trim() : '';
  if (!title) return { success: false, error: 'title is required', status: 400 };
  if (!body) return { success: false, error: 'body is required', status: 400 };
  if (title.length > 200) return { success: false, error: 'title too long', status: 400 };
  if (body.length > 20_000) return { success: false, error: 'body too long', status: 400 };

  const base = slugify(title) || 'post';
  let slug = base;
  let n = 1;
  while (await prisma.post.findUnique({ where: { slug } })) slug = `${base}-${++n}`;

  const row = await prisma.post.create({
    data: { title, body, slug, authorId: me.id },
    include: { author: { select: { name: true, email: true } } },
  });
  return { success: true, data: formatPost(row) };
}
