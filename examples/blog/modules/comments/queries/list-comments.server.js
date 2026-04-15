'use server';

import { prisma } from '../../../lib/prisma.ts';

/**
 * @param {{ postId: number }} input
 * @returns {Promise<Array<import('../types.js').CommentFormatted>>}
 */
export async function listComments({ postId }) {
  const rows = await prisma.comment.findMany({
    where: { postId },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { name: true, email: true } } },
  });
  return rows.map(formatComment);
}

/** @param {any} c */
export function formatComment(c) {
  return {
    id: c.id,
    postId: c.postId,
    authorName: c.author?.name || c.author?.email || 'anonymous',
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  };
}
