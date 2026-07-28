'use server';

import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { posts } from '#db/schema.server.ts';
import { currentUser } from '#modules/auth/queries/current-user.server.ts';
import { listPosts } from '#modules/posts/queries/list-posts.server.ts';
import type { ActionResult } from '#modules/auth/types.ts';

// A mutation (#488, POST by default). `invalidates` lists the cache tags to
// evict once the action completes without throwing, so a later getPost GET for
// this slug refetches instead of serving a stale browser-cached value. Note the
// 401 path below still evicts: eviction is gated on the action having RUN, so a
// returned { success: false } envelope counts. (The listPosts.invalidate() call below
// is the separate server-side query cache; this is the HTTP-boundary tag set.)
export const invalidates = (input: { slug: string }) => ['posts', `post:${input.slug}`];
export async function deletePost(
  input: { slug: string },
): Promise<ActionResult<{ slug: string }>> {
  const me = await currentUser();
  if (!me) return { success: false, error: 'Not signed in', status: 401 };
  const post = await db.query.posts.findFirst({
    where: { slug: input.slug },
    columns: { id: true, authorId: true },
  });
  if (!post) return { success: false, error: 'Not found', status: 404 };
  if (post.authorId !== me.id) return { success: false, error: 'Forbidden', status: 403 };
  await db.delete(posts).where(eq(posts.id, post.id));
  await listPosts.invalidate();
  return { success: true, data: { slug: input.slug } };
}
