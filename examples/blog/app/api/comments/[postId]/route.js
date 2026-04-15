import { listComments } from '../../../../modules/comments/queries/list-comments.server.js';
import { createComment } from '../../../../modules/comments/actions/create-comment.server.js';
import { subscribe } from '../../../../modules/comments/utils/bus.js';

export async function GET(_req, { params }) {
  const postId = Number(params.postId);
  if (!Number.isFinite(postId)) return Response.json({ error: 'bad postId' }, { status: 400 });
  return Response.json(await listComments({ postId }));
}

export async function POST(req, { params }) {
  const body = await req.json().catch(() => null);
  const result = await createComment({ postId: Number(params.postId), body: body?.body });
  if (!result.success) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.data);
}

/**
 * Live comment stream for a single post via WebSocket.
 * Every comment persisted via `createComment` is broadcast to subscribers.
 */
export function WS(ws, _req, { params }) {
  const postId = Number(params.postId);
  if (!Number.isFinite(postId)) { ws.close(1008, 'bad postId'); return; }
  const unsubscribe = subscribe(postId, (comment) => {
    if (ws.readyState === 1) try { ws.send(JSON.stringify(comment)); } catch {}
  });
  ws.on('close', unsubscribe);
}
