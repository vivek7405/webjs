/**
 * WebSocket-native broadcast — send data to all connected WebSocket
 * clients on a given route path.
 *
 * ```js
 * // app/api/chat/route.ts
 * import { broadcast } from '@webjs/server';
 *
 * export function WS(ws, req) {
 *   ws.on('message', (data) => {
 *     broadcast('/api/chat', data); // reaches ALL clients on this route
 *   });
 * }
 * ```
 *
 * Convention over configuration:
 *   - No REDIS_URL → broadcast reaches clients on this instance only
 *   - REDIS_URL set → broadcast reaches clients on ALL server instances
 *     (uses pub/sub internally, invisible to the developer)
 *
 * @module broadcast
 */

import { getPubSub } from './pubsub.js';

/**
 * Per-path WebSocket client registry.
 * @type {Map<string, Set<import('ws').WebSocket>>}
 */
const pathClients = new Map();

/**
 * Register a WebSocket client for a path. Called internally by the
 * WebSocket handler when a connection is established.
 *
 * @param {string} path  Route path (e.g., '/api/chat')
 * @param {import('ws').WebSocket} ws
 */
export function registerClient(path, ws) {
  let clients = pathClients.get(path);
  if (!clients) { clients = new Set(); pathClients.set(path, clients); }
  clients.add(ws);

  // Subscribe to cross-instance messages for this path
  const ps = getPubSub();
  const handler = (/** @type {string} */ msg) => {
    if (ws.readyState === 1) ws.send(msg);
  };
  ps.subscribe(`ws:${path}`, handler);

  ws.on('close', () => {
    clients.delete(ws);
    if (clients.size === 0) pathClients.delete(path);
    ps.unsubscribe(`ws:${path}`, handler);
  });
}

/**
 * Broadcast data to all WebSocket clients connected to a route path.
 *
 * With `REDIS_URL` set, the message reaches clients on ALL server
 * instances via pub/sub. Without Redis, only this instance's clients.
 *
 * @param {string} path  Route path (e.g., '/api/chat')
 * @param {string | Buffer} data  Data to send to all clients
 * @param {{ except?: import('ws').WebSocket }} [opts]
 *   - `except`: exclude this client from the broadcast (e.g., the sender)
 */
export async function broadcast(path, data, opts) {
  const msg = typeof data === 'string' ? data : data.toString();

  // Send to local clients immediately
  const clients = pathClients.get(path);
  if (clients) {
    for (const ws of clients) {
      if (opts?.except && ws === opts.except) continue;
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  // Publish to cross-instance pub/sub (Redis if REDIS_URL set)
  // Other instances' registerClient() subscribers will deliver to their clients
  const ps = getPubSub();
  await ps.publish(`ws:${path}`, msg);
}

/**
 * Get the number of connected WebSocket clients on a path (this instance only).
 *
 * @param {string} path  Route path
 * @returns {number}
 */
export function clientCount(path) {
  return pathClients.get(path)?.size || 0;
}
