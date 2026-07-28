'use server';

import { db } from '#db/connection.server.ts';
import { formatPost } from '#modules/posts/utils/slugify.ts';
import type { PostFormatted } from '#modules/posts/types.ts';

// A GET server action (#488): a single-post read declares its HTTP semantics
// via reserved sibling exports. They shape the RPC endpoint a browser import
// hits, where the GET is cacheable and ETag-aware. A call from a page or a
// route.ts runs the function in-process and skips all of it (route() picks up
// only a declared validate and middleware, never the cache exports), so an
// endpoint that wants caching sets its own headers. The per-post `post:` tag
// (resolved from the `slug` arg) is
// what `deletePost` evicts. Cache stays private (the default); a public blog
// post is identical for everyone, but private is the safe baseline.
export const method = 'GET';
export const cache = 30;
export const tags = (input: { slug: string }) => ['posts', `post:${input.slug}`];
export async function getPost(input: { slug: string }): Promise<PostFormatted | null> {
  const row = await db.query.posts.findFirst({
    where: { slug: input.slug },
    with: { author: { columns: { name: true, email: true } } },
  });
  return row ? formatPost(row) : null;
}
