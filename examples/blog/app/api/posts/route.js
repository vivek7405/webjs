/**
 * /api/posts — public list + authenticated create.
 * Thin adapter over modules/posts.
 */
import { listPosts } from '../../../modules/posts/queries/list-posts.server.js';
import { createPost } from '../../../modules/posts/actions/create-post.server.js';

export async function GET() {
  return Response.json(await listPosts());
}

export async function POST(req) {
  const input = await req.json().catch(() => null);
  const result = await createPost(input);
  if (!result.success) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result.data);
}
