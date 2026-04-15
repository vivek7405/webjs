'use server';

import { prisma } from '../../../lib/prisma.js';
import { currentUser } from '../../auth/queries/current-user.server.js';

/**
 * Delete a post. Only the author can delete their own post.
 * @param {{ slug: string }} input
 * @returns {Promise<import('../../auth/types.js').ActionResult<{ slug: string }>>}
 */
export async function deletePost({ slug }) {
  const me = await currentUser();
  if (!me) return { success: false, error: 'Not signed in', status: 401 };
  const post = await prisma.post.findUnique({ where: { slug } });
  if (!post) return { success: false, error: 'Not found', status: 404 };
  if (post.authorId !== me.id) return { success: false, error: 'Forbidden', status: 403 };
  await prisma.post.delete({ where: { id: post.id } });
  return { success: true, data: { slug } };
}
