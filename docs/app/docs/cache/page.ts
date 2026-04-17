import { html } from 'webjs';

export const metadata = { title: 'Cache Store — webjs' };

export default function Cache() {
  return html`
    <h1>Cache Store</h1>
    <p>webjs ships a pluggable cache store that follows the <strong>opinionated defaults</strong> philosophy: zero config in development, set one environment variable for production. The cache backs the rate limiter, sessions, and background jobs internally, but you can also use it directly for application-level caching.</p>

    <h2>Zero-Config Convention</h2>
    <p>In development, webjs uses an in-memory store automatically — no setup required. When you deploy to production, set <code>REDIS_URL</code> and webjs switches to Redis without any code changes:</p>

    <pre># Development — nothing to configure
# webjs uses memoryStore automatically

# Production — set one env var
REDIS_URL=redis://localhost:6379</pre>

    <p>That is it. No config file, no adapter registration, no provider wiring. The framework detects <code>REDIS_URL</code> at startup and selects the appropriate backend.</p>

    <h2>Stores</h2>
    <h3>memoryStore (default)</h3>
    <p>An in-process Map-based store. Fast, zero dependencies, perfect for development and single-instance deployments. Data is lost on restart — this is intentional for dev.</p>

    <h3>redisStore (production)</h3>
    <p>A Redis-backed store suitable for multi-instance deployments. Activated automatically when <code>REDIS_URL</code> is present. Supports TTL, atomic increments, and all the features the built-in subsystems rely on.</p>

    <h2>API</h2>
    <p>Import the cache from <code>@webjs/server</code>:</p>

    <pre>import { cache } from '@webjs/server';</pre>

    <h3>cache.get(key)</h3>
    <p>Returns the cached value or <code>undefined</code> if the key does not exist or has expired.</p>

    <pre>const user = await cache.get('user:42');
// { id: 42, name: 'Ada' } or undefined</pre>

    <h3>cache.set(key, value, ttl?)</h3>
    <p>Stores a value. The optional <code>ttl</code> is in seconds — omit it for no expiry.</p>

    <pre>// Cache for 5 minutes
await cache.set('user:42', { id: 42, name: 'Ada' }, 300);

// Cache indefinitely
await cache.set('config:features', { darkMode: true });</pre>

    <h3>cache.delete(key)</h3>
    <p>Removes a key from the store.</p>

    <pre>await cache.delete('user:42');</pre>

    <h3>cache.increment(key, amount?)</h3>
    <p>Atomically increments a numeric value. Returns the new count. If the key does not exist it is initialized to 0 before incrementing. This is the primitive the rate limiter uses internally.</p>

    <pre>const count = await cache.increment('api:hits:192.168.1.1');
// 1, 2, 3, ...</pre>

    <h2>Example: Caching an Expensive Query</h2>
    <pre>// app/api/dashboard/route.server.js
import { cache } from '@webjs/server';
import { prisma } from '../../lib/db.server.js';

export async function GET(req) {
  const key = 'dashboard:stats';
  let stats = await cache.get(key);

  if (!stats) {
    stats = await prisma.order.aggregate({
      _sum: { total: true },
      _count: { id: true },
    });
    await cache.set(key, stats, 60); // cache 1 minute
  }

  return Response.json(stats);
}</pre>

    <h2>Internal Usage</h2>
    <p>The cache store is not just for application code. Several framework subsystems use it as their backing store:</p>
    <ul>
      <li><strong>Rate limiter</strong> — uses <code>cache.increment()</code> with TTL to track request counts per window.</li>
      <li><strong>Sessions</strong> — <code>storeSession</code> persists session data in the cache when using server-side sessions.</li>
      <li><strong>Background jobs</strong> — the job queue stores pending and in-progress jobs in the cache.</li>
    </ul>
    <p>Because they all share the same store, switching from memory to Redis upgrades everything at once.</p>

    <h2>Explicit Store Selection</h2>
    <p>If you need to override the auto-detection (for example, to use Redis in a test environment without setting <code>REDIS_URL</code>), you can configure the store explicitly:</p>

    <pre>// webjs.config.js
import { redisStore } from '@webjs/server';

export default {
  cache: redisStore({ url: 'redis://test-redis:6379' }),
};</pre>

    <p>This is rarely needed. The convention — <code>REDIS_URL</code> present means Redis, absent means memory — covers the vast majority of deployments.</p>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/sessions">Sessions</a> — session middleware built on the cache store</li>
      <li><a href="/docs/jobs">Background Jobs</a> — job queues backed by the same store</li>
      <li><a href="/docs/middleware">Middleware</a> — rate limiting and other middleware that uses the cache</li>
    </ul>
  `;
}
