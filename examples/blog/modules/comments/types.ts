/** Public shape of a comment returned from queries/actions (DTO). */
export type CommentFormatted = {
  id: number;
  postId: number;
  authorName: string;
  body: string;
  createdAt: string;
};

/** What a caller sends to createComment. The contract, enforced at runtime. */
export type CreateCommentInput = { postId: number; body: string };
