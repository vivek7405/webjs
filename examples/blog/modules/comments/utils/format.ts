import type { CommentFormatted } from '#modules/comments/types.ts';

// The row this formats is a comments row plus the author it was joined or
// spliced with. Typing it means a renamed column is a compile error here
// rather than an `undefined` in the rendered comment.
type CommentRow = {
  id: number;
  postId: number;
  body: string;
  createdAt: Date;
  author?: { name?: string | null; email?: string | null } | null;
};

export function formatComment(c: CommentRow): CommentFormatted {
  return {
    id: c.id,
    postId: c.postId,
    authorName: c.author?.name || c.author?.email || 'anonymous',
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  };
}
