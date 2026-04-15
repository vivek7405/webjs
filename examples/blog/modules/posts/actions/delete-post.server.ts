'use server';

import { prisma } from '../../../lib/prisma.ts';
import { currentUser } from '../../auth/queries/current-user.server.js';
import type { ActionResult } from './create-post.server.ts';

export async function deletePost(
  input: { slug: string },
): Promise<ActionResult<{ slug: string }>> {
  const me = await currentUser();
  if (!me) return { success: false, error: 'Not signed in', status: 401 };
  const post = await prisma.post.findUnique({ where: { slug: input.slug } });
  if (!post) return { success: false, error: 'Not found', status: 404 };
  if (post.authorId !== me.id) return { success: false, error: 'Forbidden', status: 403 };
  await prisma.post.delete({ where: { id: post.id } });
  return { success: true, data: { slug: input.slug } };
}
