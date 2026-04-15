/**
 * Per-process publish/subscribe for live comments. Single-tenant; for
 * multi-process deployments swap for Redis pub/sub or Postgres LISTEN.
 *
 * Stored on globalThis so dev-mode module re-imports share the same bus
 * across connections (same pattern as Prisma / chat clients).
 */
import type { CommentFormatted } from '../types.ts';

type Subscriber = (comment: CommentFormatted) => void;

declare global {
  var __webjs_comments_bus: Map<number, Set<Subscriber>> | undefined;
}

const topics: Map<number, Set<Subscriber>> =
  globalThis.__webjs_comments_bus ??
  (globalThis.__webjs_comments_bus = new Map());

/** Subscribe to new comments for a given postId. Returns an unsubscribe fn. */
export function subscribe(postId: number, fn: Subscriber): () => void {
  let subs = topics.get(postId);
  if (!subs) { subs = new Set(); topics.set(postId, subs); }
  subs.add(fn);
  return () => {
    subs!.delete(fn);
    if (!subs!.size) topics.delete(postId);
  };
}

export function publish(postId: number, comment: CommentFormatted): void {
  const subs = topics.get(postId);
  if (!subs) return;
  for (const fn of subs) {
    try { fn(comment); } catch { /* one bad subscriber shouldn't stop the rest */ }
  }
}
