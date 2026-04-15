/**
 * /api/posts — public list + authenticated create.
 * Thin adapter over modules/posts.
 *
 * Uses webjs's `json()` helper for content-negotiated responses:
 *   - External clients (curl, mobile) sending `Accept: application/json`
 *     get plain JSON with stringified dates (existing contract preserved).
 *   - Webjs's own UI using `richFetch()` from `webjs` sends
 *     `Accept: application/vnd.webjs+json` and gets back superjson with
 *     real `Date` objects.
 */
import { json } from '@webjs/server';
import { listPosts } from '../../../modules/posts/queries/list-posts.server.js';
import { createPost } from '../../../modules/posts/actions/create-post.server.js';

export async function GET() {
  return json(await listPosts());
}

export async function POST(req) {
  const input = await req.json().catch(() => null);
  const result = await createPost(input);
  if (!result.success) return json({ error: result.error }, { status: result.status });
  return json(result.data);
}
