import { html } from '@webjsdev/core';

export const metadata = { title: 'Caching | WebJs' };

export default function Cache() {
  return html`
    <h1>Caching</h1>
    <p>WebJs provides two complementary caching layers: <code>cache()</code> for server-side query result caching, and HTTP <code>Cache-Control</code> headers for page-level browser/CDN caching. Zero config in development (in-memory store). For horizontal scaling in production, call <code>setStore(redisStore({ url: process.env.REDIS_URL }))</code> once at app startup to share the cache across instances.</p>

    <h2>cache(): Server-Side Query Caching</h2>
    <p>Wrap any async function with <code>cache()</code> to cache its return value on the server. Same function + same arguments = cached result until TTL expires or you call <code>invalidate()</code>.</p>

    <pre>import { cache } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';

export const listPosts = cache(
  async () => {
    return db.query.posts.findMany({ orderBy: { createdAt: 'desc' } });
  },
  { key: 'posts', ttl: 60 }
);

// Call it normally. First call hits DB, subsequent calls serve cache.
const posts = await listPosts();</pre>

    <h3>Options</h3>
    <ul>
      <li><code>key</code> (required): cache key prefix. Combined with serialized arguments to form the full key.</li>
      <li><code>ttl</code> (optional): time-to-live in seconds. Default: 60.</li>
      <li><code>tags</code> (optional) attaches tags for cross-module invalidation. Either a static <code>string[]</code> or a function <code>(...args) =&gt; string[]</code>, so a per-entity read can tag itself with the id. Evict by tag with <code>revalidateTag</code> / <code>revalidateTags</code> (see below).</li>
    </ul>

    <p><strong>Rich values are preserved.</strong> Both the cached value and the argument key go through the same rich serializer as the RPC wire (<code>Date</code>, <code>Map</code>, <code>Set</code>, <code>BigInt</code>, typed arrays, cycles), not JSON. So a warm cache hit returns the same value shape as a cold miss (a row's <code>createdAt</code> stays a <code>Date</code>), and a <code>Map</code> or <code>Set</code> argument is a distinct key per value rather than collapsing to one. Cached values do not need to be JSON-plain.</p>

    <h3>Invalidation</h3>
    <p>The cached function has an <code>invalidate()</code> method. Call it after mutations to clear the cache:</p>

    <pre>import { listPosts } from '#modules/posts/queries/list-posts.server.ts';
import { db } from '#db/connection.server.ts';
import { posts } from '#db/schema.server.ts';

export async function createPost(input) {
  await db.insert(posts).values(input);
  await listPosts.invalidate();  // next call to listPosts() will hit DB
}</pre>

    <p>Invalidation clears the no-args cache key. Argument-specific keys (from calls with different arguments) expire naturally via TTL. To evict a specific argument's entry (for example one post id), tag the read and use <code>revalidateTag</code> (next section) rather than waiting on the TTL.</p>

    <h3>Tag-based invalidation (revalidateTag)</h3>
    <p>The <code>invalidate()</code> method only clears the no-args base key, so for a parameterized read each argument produces a distinct key. Add <code>tags</code> to a <code>cache()</code> so an unrelated mutation can evict the right entries without importing the wrapper. Tags are either a static <code>string[]</code> or a function <code>(...args) =&gt; string[]</code> that derives a per-entity tag from the arguments:</p>

    <pre>export const postById = cache(
  async (id) =&gt; db.query.posts.findFirst({ where: { id } }),
  { key: 'post', ttl: 300, tags: (id) =&gt; ['post:' + id] }  // per-entity tag
);

export const listPosts = cache(
  async () =&gt; db.query.posts.findMany(),
  { key: 'posts', ttl: 60, tags: ['posts'] }                // static tag
);</pre>

    <p>A mutating server action then calls <code>revalidateTag(tag)</code> after the write. It works across modules (the comments module evicts a posts-module read with no import of the wrapper):</p>

    <pre>// modules/comments/actions/create-comment.server.ts
'use server';
import { revalidateTag, revalidatePath } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { comments } from '#db/schema.server.ts';

export async function createComment(input) {
  await db.insert(comments).values(input);
  await revalidateTag('post:' + input.postId);  // postById(postId) recomputes
  await revalidateTag('posts');                  // listPosts recomputes
  await revalidatePath('/blog');                 // also evict the cached HTML
  return { success: true };
}</pre>

    <p><code>revalidateTag('post:5')</code> evicts ONLY the id-5 entry, leaving other ids cached. <code>revalidateTags([...])</code> clears several tags at once. This is the fix for the old argument-key leak. Tag a per-argument read and evict the exact id by tag instead of relying on a short TTL. An untagged <code>cache()</code> is untouched by any <code>revalidateTag</code>. Both <code>revalidateTag</code> and <code>revalidateTags</code> are imported from <code>@webjsdev/server</code>.</p>

    <p><strong>The mutation-to-read contract.</strong> A read declares the tags it belongs to, and a mutation declares the tags it evicts. The two never import each other. This is the same pairing that <a href="/docs/server-actions">HTTP-verb server actions</a> express declaratively. A GET action exports <code>const tags = (id) =&gt; [...]</code> to tag its cached response, and a mutation exports <code>const invalidates = (id) =&gt; [...]</code> so that on completion the framework evicts those tags (via <code>revalidateTags</code>) and reports them to the client so a later read revalidates. Tagging a <code>cache()</code> read with the same tag a verb action invalidates makes one eviction reach both the action response cache and the <code>cache()</code> data.</p>

    <p><strong>Tag invalidation evicts cached DATA, <code>revalidatePath</code> evicts cached HTML.</strong> Together they are the server cache invalidation surface, both imported from <code>@webjsdev/server</code>.</p>

    <p><strong>Multi-instance note.</strong> On the built-in memory and Redis stores the tag index is a real set (a native <code>Set</code> in memory, a Redis <code>SADD</code> set), so adding a cache key to a tag is an atomic insert. Two mutations appending to the same tag concurrently (across Redis instances, or interleaved in one process) no longer lose an entry, so <code>revalidateTag</code> reliably evicts every tagged key. A custom store that does not implement the optional atomic-set methods falls back to the older non-atomic JSON path, where a concurrent append can be lost; there, prefer a short <code>ttl</code> as the cross-instance floor. The index entry carries the cache TTL so it self-prunes either way.</p>

    <h2>HTTP Cache-Control: Page-Level Caching</h2>
    <p>For page-level caching served to browsers and CDNs, use the <code>metadata.cacheControl</code> export in any <code>page.ts</code>:</p>

    <pre>// app/posts/page.ts
export const metadata = {
  title: 'Posts',
  cacheControl: 'public, max-age=60, stale-while-revalidate=300',
};</pre>

    <p>This sets the standard <code>Cache-Control</code> header on the HTTP response. Browsers and CDNs cache the rendered page without any server-side state.</p>

    <h2>Server HTML Response Cache (export const revalidate)</h2>
    <p>For a page that renders identical HTML for every visitor, opt into the server HTML response cache so the SSR pipeline runs once per window instead of once per request (webjs's no-build equivalent of Next.js's Full Route Cache and ISR). Declare a revalidation window on the page module:</p>

    <pre>// app/blog/page.ts
export const revalidate = 60;   // seconds: cache this page's HTML for 60s

export default async function Blog() {
  const posts = await listPosts();
  return html\`...\`;
}</pre>

    <p><strong>Safety.</strong> Caching is opt-in and conservative, because a wrongly-cached per-user page is a data leak. Declaring <code>revalidate</code> asserts <strong>this page is the same for everyone for N seconds</strong>. The cache is keyed by the full URL (path plus search) only, with no per-user keying, so a page that reads <code>cookies()</code>, a session, or any per-user data MUST NOT set <code>revalidate</code>. The framework also refuses to cache any response that is not a <code>200</code>, is a streamed Suspense body, sets <strong>any</strong> <code>Set-Cookie</code>, or runs under CSP. SSR responses carry no framework cookie (action CSRF is an Origin / Sec-Fetch-Site check, not a token cookie), so a cacheable page is cookieless and safe to share across visitors.</p>

    <p><strong>Framework defense, not just the contract.</strong> When the render reads per-user state through a framework helper (<code>cookies()</code>, <code>headers()</code>, <code>getSession()</code>, or <code>auth()</code>), the framework auto-marks the request dynamic and refuses to cache it even if you set <code>revalidate</code>, warning you once with the page path. So a wrong <code>revalidate</code> on a cookie-reading or <code>auth()</code>-gated page fails safe (served fresh) instead of leaking. An auth-gated dashboard page that does <code>const session = await auth()</code> is auto-excluded. The loud caveat is that this only catches reads THROUGH those helpers. A page that varies its body by an inbound auth cookie or <code>Authorization</code> header but reads it raw (not via <code>cookies()</code> / <code>headers()</code> / <code>getSession()</code> / <code>auth()</code>) and sets no new <code>Set-Cookie</code> WILL be cached and served to a logged-out visitor. Read per-user request state through the framework helpers, which auto-exclude the page, or never set <code>revalidate</code> on a per-user page.</p>

    <p>Evict on a write with <code>revalidatePath</code> from a server action:</p>

    <pre>// modules/blog/actions/publish-post.server.ts
'use server';
import { revalidatePath } from '@webjsdev/server';

export async function publishPost(input) {
  // ... persist via Drizzle ...
  await revalidatePath('/blog');   // next /blog request re-renders fresh
  return { success: true };
}</pre>

    <p><code>revalidatePath(path)</code> evicts the server HTML cache for one path, and <code>revalidateAll()</code> clears everything. This is distinct from the client-side <code>revalidate()</code> from <code>@webjsdev/core</code>, which evicts the browser snapshot cache used by client navigation. Time-based eviction is handled automatically by the store TTL (the <code>revalidate</code> seconds).</p>

    <p><strong>Multi-instance note.</strong> <code>revalidatePath(path)</code> deletes a store key, so it reaches every instance sharing a Redis store. <code>revalidateAll()</code> bumps an in-process counter, so on a multi-instance deploy it only flushes the instance it ran on, and peers keep serving until their own TTL expires. For a multi-instance (Redis) deploy, prefer a short <code>revalidate</code> TTL (the time-based floor that always holds cross-instance), use <code>revalidatePath</code> per mutation as the reliable cross-instance primitive, and treat <code>revalidateAll()</code> as a single-instance or dev convenience.</p>

    <h2>Low-Level Cache Store</h2>
    <p>Both <code>cache()</code> and the rate limiter are built on a pluggable cache store. You can use it directly for custom caching needs:</p>

    <pre>import { getStore, setStore, redisStore } from '@webjsdev/server';

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
    <p>In-process LRU Map. Fast, zero dependencies, single-instance only. Data is lost on restart, intentionally for dev.</p>

    <h4>redisStore (production)</h4>
    <p>Redis-backed store for multi-instance deployments. Set it explicitly at app startup:</p>

    <pre>import { setStore, redisStore } from '@webjsdev/server';
setStore(redisStore({ url: process.env.REDIS_URL }));</pre>

    <h3>Store API</h3>
    <ul>
      <li><code>store.get(key)</code>: returns the cached string or <code>null</code>.</li>
      <li><code>store.set(key, value, ttlMs?)</code>: stores a string value with optional TTL in milliseconds.</li>
      <li><code>store.delete(key)</code>: removes a key.</li>
      <li><code>store.increment(key, ttlMs?)</code>: atomically increments a counter. Returns the new value. Creates the key with value 1 if it does not exist.</li>
    </ul>

    <h2>Internal Usage</h2>
    <p>Several framework subsystems use the cache store as their backing store:</p>
    <ul>
      <li><strong>cache()</strong>: server-side function result caching.</li>
      <li><strong>Rate limiter</strong>: uses <code>store.increment()</code> with TTL to track request counts per window.</li>
      <li><strong>Sessions</strong>: <code>storeSessionStorage()</code> persists session data in the cache when using server-side sessions.</li>
      <li><strong>Auth</strong>: database session strategy stores auth sessions in the cache store.</li>
    </ul>
    <p>Because they all share the same store, switching from memory to Redis upgrades everything at once.</p>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/sessions">Sessions</a>: session middleware built on the cache store</li>
      <li><a href="/docs/authentication">Authentication</a>: NextAuth-style auth with providers</li>
      <li><a href="/docs/middleware">Middleware</a>: rate limiting and other middleware that uses the cache</li>
    </ul>
  `;
}
