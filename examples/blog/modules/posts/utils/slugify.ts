import type { PostFormatted } from '#modules/posts/types.ts';
import type { Post, User } from '#db/schema.server.ts';

/** Produce a URL-safe slug from a title. Truncates at 60 chars. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Derived from the schema, not re-declared: a renamed column is a compile
// error at every call site instead of an `undefined` in the rendered post.
// `import type` erases before anything reaches the browser, so a schema type
// crosses the `.server.ts` boundary safely.
type PostRow = Post & {
  author?: Pick<User, 'name' | 'email'> | null;
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
