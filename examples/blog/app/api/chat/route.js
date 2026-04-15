/**
 * Broadcast chat endpoint.
 *   - GET  /api/chat   → one-liner help text
 *   - WS   /api/chat   → every connected client gets every message
 *
 * The same `route.js` hosts both HTTP and WebSocket handlers; the `WS`
 * export is what makes this a WebSocket endpoint.
 */

// Module is re-imported per connection in dev (the loader cache-busts to pick
// up edits). Stash the shared state on globalThis so every instance sees the
// same Set — same pattern as the Prisma client dance.
/** @type {Set<import('ws').WebSocket>} */
const clients = globalThis.__webjs_chat_clients ?? (globalThis.__webjs_chat_clients = new Set());

export async function GET() {
  return new Response(
    'Open a WebSocket to this URL to broadcast to everyone else.\n' +
    `Currently connected: ${clients.size}\n`,
    { headers: { 'content-type': 'text/plain; charset=utf-8' } }
  );
}

/**
 * @param {import('ws').WebSocket} ws
 * @param {Request} req — the upgrade Request (headers/cookies available)
 */
export function WS(ws, req) {
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

/** Send `msg` as JSON to every open client. Optionally skip `except`. */
function broadcast(msg, except) {
  const payload = JSON.stringify(msg);
  for (const c of clients) {
    if (c === except) continue;
    if (c.readyState === 1) {
      try { c.send(payload); } catch {}
    }
  }
}
