'use server';

import { prisma } from '../../../lib/prisma.ts';
import { formatComment } from '../utils/format.ts';
import type { CommentFormatted } from '../types.ts';

export async function listComments(input: { postId: number }): Promise<CommentFormatted[]> {
  const rows = await prisma.comment.findMany({
    where: { postId: input.postId },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { name: true, email: true } } },
  });
  return rows.map(formatComment);
}
