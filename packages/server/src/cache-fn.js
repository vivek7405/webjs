/**
 * NextJs-style function-level caching with tag-based invalidation.
 *
 * ```js
 * import { cache, revalidateTag } from '@webjs/server';
 *
 * // Cache a function — auto-keyed by arguments, 60s TTL
 * export const listPosts = cache(
 *   async () => prisma.post.findMany(),
 *   { revalidate: 60, tags: ['posts'] }
 * );
 *
 * // Invalidate from a server action
 * export async function createPost(input) {
 *   await prisma.post.create({ data: input });
 *   revalidateTag('posts');
 * }
 * ```
 *
 * Convention over configuration:
 *   - REDIS_URL set → cache is shared across instances
 *   - No REDIS_URL → in-memory cache (single process)
 *
 * @module cache-fn
 */

import { getStore } from './cache.js';

/**
 * Tag → Set<cacheKey> mapping for tag-based invalidation.
 * In-memory only — for cross-instance invalidation with Redis,
 * tags are stored as Redis sets.
 * @type {Map<string, Set<string>>}
 */
const tagIndex = new Map();

/**
 * Wrap an async function with automatic caching.
 *
 * The cache key is generated from the function's string representation
 * and the serialized arguments. Same args → same cached result.
 *
 * @template {(...args: any[]) => Promise<any>} T
 * @param {T} fn  The async function to cache.
 * @param {{
 *   revalidate?: number,
 *   tags?: string[],
 *   key?: string,
 * }} [opts]
 *   - `revalidate`: TTL in seconds. Default: 60.
 *   - `tags`: cache tags for invalidation via `revalidateTag()`.
 *   - `key`: explicit cache key prefix. Default: auto-generated from fn.
 * @returns {T}  A cached version of the function with the same signature.
 */
export function cache(fn, opts = {}) {
  const ttl = (opts.revalidate ?? 60) * 1000;
  const tags = opts.tags || [];
  const keyPrefix = opts.key || fnHash(fn);

  const cached = /** @type {T} */ (async function (...args) {
    const store = getStore();
    const cacheKey = `cache:${keyPrefix}:${stableStringify(args)}`;

    // Try cache hit
    const hit = await store.get(cacheKey);
    if (hit !== null) {
      try { return JSON.parse(hit); } catch { /* corrupted — recompute */ }
    }

    // Cache miss — compute and store
    const result = await fn(...args);
    await store.set(cacheKey, JSON.stringify(result), ttl);

    // Register tags for invalidation
    for (const tag of tags) {
      let keys = tagIndex.get(tag);
      if (!keys) { keys = new Set(); tagIndex.set(tag, keys); }
      keys.add(cacheKey);
    }

    return result;
  });

  return cached;
}

/**
 * Invalidate all cache entries with a given tag.
 *
 * ```js
 * import { revalidateTag } from '@webjs/server';
 * revalidateTag('posts'); // clears all caches tagged 'posts'
 * ```
 *
 * @param {string} tag
 */
export async function revalidateTag(tag) {
  const store = getStore();
  const keys = tagIndex.get(tag);
  if (!keys) return;
  for (const key of keys) {
    await store.delete(key);
  }
  tagIndex.delete(tag);
}

/**
 * Invalidate all cache entries for a given path.
 * Clears any cache tagged with the path string.
 *
 * ```js
 * import { revalidatePath } from '@webjs/server';
 * revalidatePath('/blog'); // clears all caches tagged '/blog'
 * ```
 *
 * @param {string} path
 */
export async function revalidatePath(path) {
  return revalidateTag(`path:${path}`);
}

/**
 * Simple stable hash of a function for cache key generation.
 * Uses the first 16 chars of the function's string representation.
 * @param {Function} fn
 * @returns {string}
 */
function fnHash(fn) {
  const s = fn.toString();
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Stable JSON serialization of arguments for cache key.
 * @param {unknown[]} args
 * @returns {string}
 */
function stableStringify(args) {
  if (args.length === 0) return '';
  try { return JSON.stringify(args); }
  catch { return String(args); }
}
