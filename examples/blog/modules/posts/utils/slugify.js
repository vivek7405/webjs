/**
 * Produce a URL-safe slug from a title. Truncates at 60 chars.
 * @param {string} s
 */
export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** @param {any} post */
export function formatPost(post) {
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
