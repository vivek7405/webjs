/**
 * Server-side function caching for RPC queries.
 *
 * Wraps an async function with a cache layer backed by the cache store.
 * Same function + same arguments = cached result until TTL expires.
 *
 * ```js
 * import { cache } from '@webjs/server';
 *
 * export const listPosts = cache(
 *   async () => prisma.post.findMany({ orderBy: { createdAt: 'desc' } }),
 *   { key: 'posts', ttl: 60 }
 * );
 *
 * // Call it normally — first call hits DB, subsequent calls serve cache
 * const posts = await listPosts();
 * ```
 *
 * For page-level HTTP caching, use `metadata.cacheControl` instead —
 * that sets standard Cache-Control headers for browsers and CDNs.
 * This `cache()` is for server-side query result caching.
 *
 * @module cache-fn
 */

import { getStore } from './cache.js';

/**
 * Wrap an async function with server-side caching.
 *
 * @template {(...args: any[]) => Promise<any>} T
 * @param {T} fn  The async function to cache.
 * @param {{
 *   key: string,
 *   ttl?: number,
 * }} opts
 *   - `key`: cache key prefix. Combined with serialized args to form the full key.
 *   - `ttl`: time-to-live in seconds. Default: 60.
 * @returns {T & { invalidate: () => Promise<void> }}
 *   The cached function with the same signature, plus an `invalidate()`
 *   method to manually clear the cache.
 */
export function cache(fn, opts) {
  const prefix = opts.key;
  const ttlMs = (opts.ttl ?? 60) * 1000;

  const wrapped = /** @type {T & { invalidate: () => Promise<void> }} */ (
    async function (...args) {
      const store = getStore();
      const cacheKey = args.length
        ? `cache:${prefix}:${JSON.stringify(args)}`
        : `cache:${prefix}`;

      const hit = await store.get(cacheKey);
      if (hit !== null) {
        try { return JSON.parse(hit); } catch { /* corrupted — recompute */ }
      }

      const result = await fn(...args);
      await store.set(cacheKey, JSON.stringify(result), ttlMs);
      return result;
    }
  );

  /**
   * Manually invalidate this cache. Call after mutations:
   *
   * ```js
   * export async function createPost(input) {
   *   await prisma.post.create({ data: input });
   *   await listPosts.invalidate();
   * }
   * ```
   */
  wrapped.invalidate = async function () {
    const store = getStore();
    // Delete the base key (no-args call)
    await store.delete(`cache:${prefix}`);
    // Note: arg-specific keys are not tracked. If the cached function
    // is called with different arguments, those entries expire via TTL.
    // For full invalidation of arg-specific keys, use a short TTL.
  };

  return wrapped;
}
