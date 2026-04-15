/**
 * /api/chat — global broadcast chat.
 * GET returns a status snapshot; WS upgrades to a live connection.
 */
import { clients, broadcast } from '../../../modules/chat/utils/clients.js';

export async function GET() {
  return new Response(
    `Open a WebSocket to this URL. Currently connected: ${clients.size}\n`,
    { headers: { 'content-type': 'text/plain; charset=utf-8' } }
  );
}

export function WS(ws) {
  clients.add(ws);
  broadcast({ kind: 'join', count: clients.size }, ws);
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { msg = { text: data.toString() }; }
    broadcast({ kind: 'say', text: String(msg.text || '').slice(0, 500), at: Date.now() });
  });
  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ kind: 'leave', count: clients.size });
  });
}
