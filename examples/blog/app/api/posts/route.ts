/**
 * /api/posts — public list + authenticated create.
 *
 * Uses webjs's `json()` helper for content-negotiated responses:
 *   - External clients (curl, mobile) sending `Accept: application/json`
 *     get plain JSON with stringified dates.
 *   - webjs's own UI using `richFetch()` sends
 *     `Accept: application/vnd.webjs+json` and gets back the rich
 *     wire format with real `Date` objects.
 */
import { json } from '@webjskit/server';
import { listPosts } from '../../../modules/posts/queries/list-posts.server.ts';
import { createPost } from '../../../modules/posts/actions/create-post.server.ts';

export async function GET() {
  return json(await listPosts());
}

export async function POST(req: Request) {
  const input = await req.json().catch(() => null);
  const result = await createPost(input);
  if (!result.success) return json({ error: result.error }, { status: result.status });
  return json(result.data);
}
