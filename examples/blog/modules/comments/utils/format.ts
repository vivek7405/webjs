import type { CommentFormatted } from '../types.ts';

export function formatComment(c: any): CommentFormatted {
  return {
    id: c.id,
    postId: c.postId,
    authorName: c.author?.name || c.author?.email || 'anonymous',
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  };
}
