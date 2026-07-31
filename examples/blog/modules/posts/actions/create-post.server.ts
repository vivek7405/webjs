'use server';

import { db } from '#db/connection.server.ts';
import { posts } from '#db/schema.server.ts';
import { slugify, formatPost } from '#modules/posts/utils/slugify.ts';
import { currentUser } from '#modules/auth/queries/current-user.server.ts';
import { listPosts } from '#modules/posts/queries/list-posts.server.ts';
import type { ActionResult } from '#modules/auth/types.ts';
import type { PostFormatted, CreatePostInput } from '#modules/posts/types.ts';

// A mutation (#488, POST by default). A new post invalidates the `posts` tag
// so the next listing / GET read refetches. (listPosts.invalidate() below is
// the server-side query cache; this is the HTTP-boundary tag set.)
export const invalidates = () => ['posts'];

/**
 * Create a post authored by the currently-logged-in user. Reads the user
 * from the request context (AsyncLocalStorage): no userId parameter.
 */
// The parameter declares the CONTRACT (CreatePostInput already lives in
// modules/posts/types.ts), so <new-post> type-checks its call. The runtime
// checks below stay because this action is also reachable from route.ts
// with a raw JSON body.
export async function createPost(
  input: CreatePostInput,
): Promise<ActionResult<PostFormatted>> {
  const me = await currentUser();
  if (!me) return { success: false, error: 'Not signed in', status: 401 };

  if (!input || typeof input !== 'object') {
    return { success: false, error: 'Expected an object', status: 400 };
  }
  const o = input as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const body  = typeof o.body  === 'string' ? o.body.trim()  : '';
  if (!title) return { success: false, error: 'title is required', status: 400 };
  if (!body)  return { success: false, error: 'body is required',  status: 400 };
  if (title.length > 200)   return { success: false, error: 'title too long', status: 400 };
  if (body.length  > 20_000) return { success: false, error: 'body too long',  status: 400 };

  const base = slugify(title) || 'post';
  let slug = base;
  let n = 1;
  while (await db.query.posts.findFirst({ where: { slug }, columns: { id: true } })) {
    slug = `${base}-${++n}`;
  }

  // insert().returning() yields columns only (no relations), so splice the
  // author we already hold (the current user) for formatPost.
  const [row] = await db.insert(posts).values({ title, body, slug, authorId: me.id }).returning();
  await listPosts.invalidate();
  return { success: true, data: formatPost({ ...row, author: { name: me.name, email: me.email } }) };
}
