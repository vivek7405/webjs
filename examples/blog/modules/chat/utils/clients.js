/**
 * Shared chat client Set. Lives on globalThis so dev-mode re-imports share
 * the same connections across the WebSocket handler reloads.
 *
 * @type {Set<import('ws').WebSocket>}
 */
export const clients =
  globalThis.__webjs_chat_clients ?? (globalThis.__webjs_chat_clients = new Set());

/**
 * Send a message to every open client, optionally excluding the sender.
 * @param {unknown} msg
 * @param {import('ws').WebSocket} [except]
 */
export function broadcast(msg, except) {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const c of clients) {
    if (c === except) continue;
    if (c.readyState === 1) {
      try { c.send(payload); } catch { /* ignore one bad client */ }
    }
  }
}
