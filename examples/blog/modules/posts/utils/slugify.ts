import type { PostFormatted } from '../types.ts';

/** Produce a URL-safe slug from a title. Truncates at 60 chars. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

type PostRow = {
  id: number;
  slug: string;
  title: string;
  body: string;
  authorId: number;
  createdAt: Date;
  author?: { name: string | null; email: string } | null;
};

export function formatPost(post: PostRow): PostFormatted {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    body: post.body,
    authorId: post.authorId,
    authorName: post.author?.name ?? null,
    createdAt: post.createdAt.toISOString(),
  };
}
