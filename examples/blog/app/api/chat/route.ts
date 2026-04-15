/**
 * /api/chat — global broadcast chat.
 * GET returns a status snapshot; WS upgrades to a live connection.
 */
import type { WebSocket } from 'ws';
import { clients, broadcast } from '../../../modules/chat/utils/clients.ts';

export async function GET() {
  return new Response(
    `Open a WebSocket to this URL. Currently connected: ${clients.size}\n`,
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}

export function WS(ws: WebSocket) {
  clients.add(ws);
  broadcast({ kind: 'join', count: clients.size }, ws);
  ws.on('message', (data) => {
    let msg: { text?: string };
    try { msg = JSON.parse(data.toString()); } catch { msg = { text: data.toString() }; }
    broadcast({ kind: 'say', text: String(msg.text || '').slice(0, 500), at: Date.now() });
  });
  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ kind: 'leave', count: clients.size });
  });
}
