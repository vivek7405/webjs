'use server';

import { prisma } from '../../../lib/prisma.js';
import { formatPost } from '../utils/slugify.js';

/**
 * List the most recent posts (newest first), with author info denormalised.
 * @returns {Promise<Array<import('../types.js').PostFormatted>>}
 */
export async function listPosts() {
  const rows = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { name: true, email: true } } },
  });
  return rows.map(formatPost);
}
