/** Public shape of a comment returned from queries/actions (DTO). */
export type CommentFormatted = {
  id: number;
  postId: number;
  authorName: string;
  body: string;
  createdAt: string;
};
