'use server';

import { prisma } from '../../../lib/prisma.ts';
import type { CommentFormatted } from '../types.ts';

export async function listComments(input: { postId: number }): Promise<CommentFormatted[]> {
  const rows = await prisma.comment.findMany({
    where: { postId: input.postId },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { name: true, email: true } } },
  });
  return rows.map(formatComment);
}

export function formatComment(c: any): CommentFormatted {
  return {
    id: c.id,
    postId: c.postId,
    authorName: c.author?.name || c.author?.email || 'anonymous',
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  };
}
