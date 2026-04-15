/**
 * Shared chat client Set. Lives on globalThis so dev-mode re-imports share
 * the same connections across WebSocket handler reloads.
 */
import type { WebSocket } from 'ws';

declare global {
  var __webjs_chat_clients: Set<WebSocket> | undefined;
}

export const clients: Set<WebSocket> =
  globalThis.__webjs_chat_clients ?? (globalThis.__webjs_chat_clients = new Set());

/** Broadcast a message to every open client, optionally excluding the sender. */
export function broadcast(msg: unknown, except?: WebSocket): void {
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const c of clients) {
    if (c === except) continue;
    if (c.readyState === 1) {
      try { c.send(payload); } catch { /* ignore one bad client */ }
    }
  }
}
