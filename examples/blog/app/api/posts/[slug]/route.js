import { getPost } from '../../../../modules/posts/queries/get-post.server.js';
import { deletePost } from '../../../../modules/posts/actions/delete-post.server.js';

export async function GET(_req, { params }) {
  const post = await getPost({ slug: params.slug });
  if (!post) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(post);
}

export async function DELETE(_req, { params }) {
  const result = await deletePost({ slug: params.slug });
  if (!result.success) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.data);
}
