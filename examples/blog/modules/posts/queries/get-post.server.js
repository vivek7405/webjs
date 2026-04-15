'use server';

import { prisma } from '../../../lib/prisma.js';
import { formatPost } from '../utils/slugify.js';

/**
 * Look up a post by slug.
 * @param {{ slug: string }} input
 * @returns {Promise<import('../types.js').PostFormatted | null>}
 */
export async function getPost({ slug }) {
  const row = await prisma.post.findUnique({
    where: { slug },
    include: { author: { select: { name: true, email: true } } },
  });
  return row ? formatPost(row) : null;
}
