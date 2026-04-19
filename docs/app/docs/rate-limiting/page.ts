import { html } from '@webjskit/core';

export const metadata = { title: 'Rate Limiting — webjs' };

export default function RateLimiting() {
  return html`
    <h1>Rate Limiting</h1>
    <p>webjs ships a fixed-window rate limiter backed by the pluggable cache store. In development it uses in-memory counters; set <code>REDIS_URL</code> and limits are shared across all instances automatically.</p>

    <h2>When to use</h2>
    <ul>
      <li>Protect login/signup endpoints from brute-force attacks.</li>
      <li>Throttle expensive API routes (search, AI completions, file uploads).</li>
      <li>Enforce usage quotas on public-facing endpoints.</li>
    </ul>

    <h2>When NOT to use</h2>
    <ul>
      <li>For page routes that are already behind auth — use middleware auth checks instead.</li>
      <li>For global DDoS protection — use a CDN or reverse proxy (Cloudflare, nginx) in front of your server.</li>
    </ul>

    <h2>Basic usage</h2>
    <p>Create a <code>middleware.ts</code> file and export the rate limiter:</p>

    <pre>// app/api/auth/middleware.ts
import { rateLimit } from '@webjskit/server';

export default rateLimit({ window: '1m', max: 10 });</pre>

    <p>This limits the <code>/api/auth/*</code> routes to 10 requests per minute per IP address.</p>

    <h2>Options</h2>
    <ul>
      <li><code>window</code> — duration string or milliseconds. Supports: <code>'10s'</code>, <code>'1m'</code>, <code>'1h'</code>, <code>60000</code>. Default: <code>'1m'</code>.</li>
      <li><code>max</code> — maximum requests per window. Default: <code>60</code>.</li>
      <li><code>key</code> — a string prefix or a function <code>(req) => string</code> that returns a unique key per client. Default: IP address from <code>x-forwarded-for</code>, <code>cf-connecting-ip</code>, or <code>x-real-ip</code> headers.</li>
      <li><code>message</code> — error message in the 429 response body. Default: <code>'Too Many Requests'</code>.</li>
      <li><code>store</code> — override the cache store (e.g. a dedicated Redis instance for rate limits).</li>
    </ul>

    <h2>Custom key function</h2>
    <p>Rate limit by authenticated user instead of IP:</p>

    <pre>// app/api/posts/middleware.ts
import { rateLimit } from '@webjskit/server';
import { auth } from '../../modules/auth/index.ts';

export default rateLimit({
  window: '1m',
  max: 30,
  key: async (req) => {
    const session = await auth(req);
    return session?.user?.id ?? 'anon';
  },
});</pre>

    <h2>Response headers</h2>
    <p>Every response from a rate-limited route includes standard headers:</p>
    <ul>
      <li><code>x-ratelimit-limit</code> — the configured max.</li>
      <li><code>x-ratelimit-remaining</code> — requests left in the current window.</li>
      <li><code>x-ratelimit-reset</code> — Unix timestamp when the window resets.</li>
    </ul>
    <p>When the limit is exceeded, the response is <code>429 Too Many Requests</code> with <code>retry-after</code> header and a JSON body: <code>{ "error": "Too Many Requests" }</code>.</p>

    <h2>Per-route vs global</h2>
    <p>Place the middleware file at the route level you want to protect:</p>
    <ul>
      <li><code>app/middleware.ts</code> — rate limits every route in the app.</li>
      <li><code>app/api/middleware.ts</code> — rate limits all API routes.</li>
      <li><code>app/api/auth/middleware.ts</code> — rate limits only auth endpoints.</li>
    </ul>

    <h2>Scaling with Redis</h2>
    <p>In production with multiple server instances, set <code>REDIS_URL</code> and the rate limiter automatically uses the shared Redis store. No code changes needed — the cache store is pluggable.</p>

    <pre># .env
REDIS_URL=redis://localhost:6379</pre>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/middleware">Middleware</a> — how middleware chains work</li>
      <li><a href="/docs/cache">Caching</a> — the underlying cache store that powers rate limiting</li>
      <li><a href="/docs/authentication">Authentication</a> — protect routes with auth</li>
    </ul>
  `;
}
