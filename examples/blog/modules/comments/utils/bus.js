/**
 * Per-process publish/subscribe for live comments. Single-tenant; for
 * multi-process deployments swap for Redis pub/sub or Postgres LISTEN.
 *
 * Stored on globalThis so dev-mode module re-imports share the same bus
 * across connections (same pattern as Prisma / chat clients).
 *
 * @typedef {(comment: import('../types.js').CommentFormatted) => void} Subscriber
 */

/** @type {Map<number, Set<Subscriber>>} */
const topics = globalThis.__webjs_comments_bus ?? (globalThis.__webjs_comments_bus = new Map());

/**
 * Subscribe to new comments for a given postId. Returns an unsubscribe fn.
 * @param {number} postId
 * @param {Subscriber} fn
 */
export function subscribe(postId, fn) {
  let subs = topics.get(postId);
  if (!subs) { subs = new Set(); topics.set(postId, subs); }
  subs.add(fn);
  return () => {
    subs.delete(fn);
    if (!subs.size) topics.delete(postId);
  };
}

/**
 * @param {number} postId
 * @param {import('../types.js').CommentFormatted} comment
 */
export function publish(postId, comment) {
  const subs = topics.get(postId);
  if (!subs) return;
  for (const fn of subs) {
    try { fn(comment); } catch { /* ignore — one bad subscriber shouldn't stop the rest */ }
  }
}
