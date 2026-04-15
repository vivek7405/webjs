/** Public shape of a post returned from queries/actions (DTO). */
export type PostFormatted = {
  id: number;
  slug: string;
  title: string;
  body: string;
  authorId: number;
  authorName: string | null;
  createdAt: string;
};

export type CreatePostInput = { title: string; body: string };
