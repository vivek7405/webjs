import { getPost } from '../../../../modules/posts/queries/get-post.server.ts';
import { deletePost } from '../../../../modules/posts/actions/delete-post.server.ts';

type Ctx = { params: { slug: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const post = await getPost({ slug: params.slug });
  if (!post) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(post);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const result = await deletePost({ slug: params.slug });
  if (!result.success) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.data);
}
