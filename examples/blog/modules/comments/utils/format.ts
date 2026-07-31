import type { CommentFormatted } from '#modules/comments/types.ts';
import type { Comment, User } from '#db/schema.server.ts';

// The row is a comments row DERIVED from the schema, plus the author the
// caller joined or spliced onto it. `import type` is what lets a schema type
// cross the `.server.ts` boundary: the stripper erases it, so nothing pulls the
// DB driver in. Rename a column and every call site is a compile error instead
// of an `undefined` in the rendered comment.
type CommentRow = Comment & {
  author?: Pick<User, 'name' | 'email'> | null;
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
