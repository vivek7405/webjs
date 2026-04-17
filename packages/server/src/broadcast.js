/**
 * WebSocket broadcast — send data to all connected clients on a route.
 *
 * ```js
 * // app/api/chat/route.ts
 * import { broadcast } from '@webjs/server';
 *
 * export function WS(ws, req) {
 *   ws.on('message', (data) => {
 *     broadcast('/api/chat', data);
 *   });
 * }
 * ```
 *
 * Single-instance by default. For multi-instance scaling, the user
 * wires Redis themselves — explicit, not magic.
 *
 * @module broadcast
 */

/**
 * Per-path WebSocket client registry.
 * @type {Map<string, Set<import('ws').WebSocket>>}
 */
const pathClients = new Map();

/**
 * Register a WebSocket client for a path. Called internally by the
 * WebSocket handler when a connection is established.
 *
 * @param {string} path
 * @param {import('ws').WebSocket} ws
 */
export function registerClient(path, ws) {
  let clients = pathClients.get(path);
  if (!clients) { clients = new Set(); pathClients.set(path, clients); }
  clients.add(ws);
  ws.on('close', () => {
    clients.delete(ws);
    if (clients.size === 0) pathClients.delete(path);
  });
}

/**
 * Broadcast data to all WebSocket clients connected to a route path.
 *
 * @param {string} path  Route path (e.g., '/api/chat')
 * @param {string | Buffer} data  Data to send
 * @param {{ except?: import('ws').WebSocket }} [opts]
 *   - `except`: exclude this client (e.g., the sender)
 */
export function broadcast(path, data, opts) {
  const clients = pathClients.get(path);
  if (!clients) return;
  const msg = typeof data === 'string' ? data : data.toString();
  for (const ws of clients) {
    if (opts?.except && ws === opts.except) continue;
    if (ws.readyState === 1) ws.send(msg);
  }
}

/**
 * Get the number of connected WebSocket clients on a path.
 * @param {string} path
 * @returns {number}
 */
export function clientCount(path) {
  return pathClients.get(path)?.size || 0;
}
