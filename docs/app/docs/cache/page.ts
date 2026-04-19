import { html } from '@webjs/core';

export const metadata = { title: 'Caching — webjs' };

export default function Cache() {
  return html`
    <h1>Caching</h1>
    <p>webjs provides two complementary caching layers: <code>cache()</code> for server-side query result caching, and HTTP <code>Cache-Control</code> headers for page-level browser/CDN caching. Both follow the <strong>opinionated defaults</strong> philosophy — zero config in development, set <code>REDIS_URL</code> for production scaling.</p>

    <h2>cache() — Server-Side Query Caching</h2>
    <p>Wrap any async function with <code>cache()</code> to cache its return value on the server. Same function + same arguments = cached result until TTL expires or you call <code>invalidate()</code>.</p>

    <pre>import { cache } from '@webjs/server';

export const listPosts = cache(
  async () => {
    return prisma.post.findMany({ orderBy: { createdAt: 'desc' } });
  },
  { key: 'posts', ttl: 60 }
);

// Call it normally — first call hits DB, subsequent calls serve cache
const posts = await listPosts();</pre>

    <h3>Options</h3>
    <ul>
      <li><code>key</code> (required) — cache key prefix. Combined with serialized arguments to form the full key.</li>
      <li><code>ttl</code> (optional) — time-to-live in seconds. Default: 60.</li>
    </ul>

    <h3>Invalidation</h3>
    <p>The cached function has an <code>invalidate()</code> method. Call it after mutations to clear the cache:</p>

    <pre>import { listPosts } from '../queries/list-posts.server.ts';

export async function createPost(input) {
  await prisma.post.create({ data: input });
  await listPosts.invalidate();  // next call to listPosts() will hit DB
}</pre>

    <p>Invalidation clears the no-args cache key. Argument-specific keys (from calls with different arguments) expire naturally via TTL. For full invalidation of parameterized queries, use a short TTL.</p>

    <h2>HTTP Cache-Control — Page-Level Caching</h2>
    <p>For page-level caching served to browsers and CDNs, use the <code>metadata.cacheControl</code> export in any <code>page.ts</code>:</p>

    <pre>// app/posts/page.ts
export const metadata = {
  title: 'Posts',
  cacheControl: 'public, max-age=60, stale-while-revalidate=300',
};</pre>

    <p>This sets the standard <code>Cache-Control</code> header on the HTTP response. Browsers and CDNs cache the rendered page without any server-side state.</p>

    <h2>Low-Level Cache Store</h2>
    <p>Both <code>cache()</code> and the rate limiter are built on a pluggable cache store. You can use it directly for custom caching needs:</p>

    <pre>import { getStore, setStore, redisStore } from '@webjs/server';

// Get the default store (memoryStore in dev)
const store = getStore();

// Read/write raw values
await store.set('user:42', JSON.stringify({ name: 'Ada' }), 300_000); // TTL in ms
const raw = await store.get('user:42');
await store.delete('user:42');

// Atomic increment (used by rate limiter)
const count = await store.increment('api:hits:192.168.1.1', 60_000);</pre>

    <h3>Stores</h3>
    <h4>memoryStore (default)</h4>
    <p>In-process LRU Map. Fast, zero dependencies, single-instance only. Data is lost on restart — intentional for dev.</p>

    <h4>redisStore (production)</h4>
    <p>Redis-backed store for multi-instance deployments. Set it explicitly at app startup:</p>

    <pre>import { setStore, redisStore } from '@webjs/server';
setStore(redisStore({ url: process.env.REDIS_URL }));</pre>

    <h3>Store API</h3>
    <ul>
      <li><code>store.get(key)</code> — returns the cached string or <code>null</code>.</li>
      <li><code>store.set(key, value, ttlMs?)</code> — stores a string value with optional TTL in milliseconds.</li>
      <li><code>store.delete(key)</code> — removes a key.</li>
      <li><code>store.increment(key, ttlMs?)</code> — atomically increments a counter. Returns the new value. Creates the key with value 1 if it does not exist.</li>
    </ul>

    <h2>Internal Usage</h2>
    <p>Several framework subsystems use the cache store as their backing store:</p>
    <ul>
      <li><strong>cache()</strong> — server-side function result caching.</li>
      <li><strong>Rate limiter</strong> — uses <code>store.increment()</code> with TTL to track request counts per window.</li>
      <li><strong>Sessions</strong> — <code>storeSessionStorage()</code> persists session data in the cache when using server-side sessions.</li>
      <li><strong>Auth</strong> — database session strategy stores auth sessions in the cache store.</li>
    </ul>
    <p>Because they all share the same store, switching from memory to Redis upgrades everything at once.</p>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/sessions">Sessions</a> — session middleware built on the cache store</li>
      <li><a href="/docs/authentication">Authentication</a> — NextAuth-style auth with providers</li>
      <li><a href="/docs/middleware">Middleware</a> — rate limiting and other middleware that uses the cache</li>
    </ul>
  `;
}
