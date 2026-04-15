'use server';

import { prisma } from '../../../lib/prisma.ts';
import { currentUser } from '../../auth/queries/current-user.server.ts';
import { publish } from '../utils/bus.ts';
import { formatComment } from '../queries/list-comments.server.ts';
import type { ActionResult } from '../../auth/types.ts';
import type { CommentFormatted } from '../types.ts';

/**
 * Add a comment to a post. Requires auth. Publishes to the comments bus
 * so live subscribers (WebSocket clients) pick it up instantly.
 */
export async function createComment(
  input: { postId: number; body: string } | { postId: unknown; body: unknown },
): Promise<ActionResult<CommentFormatted>> {
  const me = await currentUser();
  if (!me) return { success: false, error: 'Not signed in', status: 401 };
  const postId = Number((input as any)?.postId);
  const body = typeof (input as any)?.body === 'string' ? (input as any).body.trim() : '';
  if (!Number.isFinite(postId)) return { success: false, error: 'postId required', status: 400 };
  if (!body) return { success: false, error: 'body is required', status: 400 };
  if (body.length > 2000) return { success: false, error: 'body too long', status: 400 };

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return { success: false, error: 'Post not found', status: 404 };

  const row = await prisma.comment.create({
    data: { postId, authorId: me.id, body },
    include: { author: { select: { name: true, email: true } } },
  });
  const formatted = formatComment(row);
  publish(postId, formatted);
  return { success: true, data: formatted };
}
