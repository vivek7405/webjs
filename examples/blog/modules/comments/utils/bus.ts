/**
 * Simple in-process publish/subscribe for live comments.
 *
 * Single-instance only. For multi-instance deployments, replace with
 * Redis pub/sub or a message broker — the framework doesn't abstract
 * this; the user decides their infrastructure.
 */
import type { CommentFormatted } from '../types.ts';

type Subscriber = (comment: CommentFormatted) => void;

const subs = globalThis.__commentSubs ?? (globalThis.__commentSubs = new Map<number, Set<Subscriber>>());

export function subscribe(postId: number, fn: Subscriber): () => void {
  let set = subs.get(postId);
  if (!set) { set = new Set(); subs.set(postId, set); }
  set.add(fn);
  return () => { set!.delete(fn); if (set!.size === 0) subs.delete(postId); };
}

export function publish(postId: number, comment: CommentFormatted): void {
  const set = subs.get(postId);
  if (!set) return;
  for (const fn of set) fn(comment);
}
