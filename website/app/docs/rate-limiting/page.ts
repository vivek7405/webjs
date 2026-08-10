import { html } from '@webjsdev/core';

export const metadata = { title: 'Rate Limiting | WebJs' };

export default function RateLimiting() {
  return html`
    <h1>Rate Limiting</h1>
    <p>WebJs ships a fixed-window rate limiter backed by the pluggable cache store. In development it uses in-memory counters. For shared limits across multiple instances in production, switch the global cache store to Redis at app startup (one <code>setStore()</code> call), and the rate limiter picks it up automatically.</p>

    <h2>When to use</h2>
    <ul>
      <li>Protect login/signup endpoints from brute-force attacks.</li>
      <li>Throttle expensive API routes (search, AI completions, file uploads).</li>
      <li>Enforce usage quotas on public-facing endpoints.</li>
    </ul>

    <h2>When NOT to use</h2>
    <ul>
      <li>For page routes that are already behind auth. Use middleware auth checks instead.</li>
      <li>For global DDoS protection. Use a CDN or reverse proxy (Cloudflare, nginx) in front of your server.</li>
    </ul>

    <h2>Basic usage</h2>
    <p>Create a <code>middleware.ts</code> file and export the rate limiter:</p>

    <code-block>// app/api/auth/middleware.ts
import { rateLimit } from '@webjsdev/server';

export default rateLimit({ window: '1m', max: 10 });</code-block>

    <p>This limits the <code>/api/auth/*</code> routes to 10 requests per minute per IP address.</p>

    <h2>Options</h2>
    <ul>
      <li><code>window</code>: duration string or milliseconds. Supports: <code>'10s'</code>, <code>'1m'</code>, <code>'1h'</code>, <code>60000</code>. Default: <code>'1m'</code>.</li>
      <li><code>max</code>: maximum requests per window. Default: <code>60</code>.</li>
      <li><code>key</code>: a string prefix or a function <code>(req) => string</code> that returns a unique key per client. Default: the framework-stamped socket IP, see <strong>Behind a proxy</strong> below.</li>
      <li><code>trustProxy</code>: when <code>true</code>, the default key resolution honours the leftmost <code>X-Forwarded-For</code> entry, then <code>CF-Connecting-IP</code>, then <code>X-Real-IP</code>, before falling back to the socket IP. Default: <code>false</code>. Inert while <code>WEBJS_NO_TRUST_PROXY=1</code> is set, which outranks it. See <strong>Behind a proxy</strong> below for the threat model.</li>
      <li><code>message</code>: error message in the 429 response body. Default: <code>'Too Many Requests'</code>.</li>
      <li><code>store</code>: override the cache store (e.g. a dedicated Redis instance for rate limits).</li>
    </ul>

    <h2>Behind a proxy</h2>
    <p>The default IP source is the TCP socket address that the framework stamps onto every inbound request via the <code>x-webjs-remote-ip</code> internal header. <code>dev.js</code>'s <code>toWebRequest</code> strips any inbound copy of that header before adding its own, so clients cannot spoof it from the wire. Forwarded-IP headers (<code>X-Forwarded-For</code>, <code>CF-Connecting-IP</code>, <code>X-Real-IP</code>) are ignored. This is the correct default for any server that handles its own TCP connections directly (bare-metal, single-VM, dev mode).</p>

    <p><strong>When you're fronted by a reverse proxy or CDN</strong> (Cloudflare, nginx, Caddy, Railway, Fly, Render, Vercel, Heroku), the socket IP is the proxy, not the user. Every request shares the same IP and the limiter buckets everyone together. Opt in to forwarded-header parsing:</p>

    <p>A proxy POOL fails the other way, and it is the failure you are more likely to hit, because it does not look like a failure at all. Each proxy in the pool is a separate peer, so each gets its own full allowance and your effective limit is the configured one multiplied by the pool size. The headers stay plausible throughout: every response carries a <code>X-RateLimit-Remaining</code> that counts down correctly for its own bucket, so the limiter reads as working while no visitor is ever refused. The tell is that a fresh connection restarts the count while requests sharing one keep-alive connection do count down. This is what shipped in the feature gallery's rate-limit demo, which is why that demo now sets <code>trustProxy: true</code>.</p>

    <code-block>// app/api/auth/middleware.ts
import { rateLimit } from '@webjsdev/server';

export default rateLimit({ window: '1m', max: 10, trustProxy: true });</code-block>

    <p>With <code>trustProxy: true</code>, the limiter reads the leftmost <code>X-Forwarded-For</code> entry, then <code>CF-Connecting-IP</code>, then <code>X-Real-IP</code>, then the stamped socket IP, then <code>'_anon_'</code>. Your reverse proxy MUST strip any inbound <code>X-Forwarded-For</code> from the wire before adding its own; otherwise <code>trustProxy</code> re-introduces the spoofability it exists to defend against. Cloudflare, Fly, Railway, Render, and Vercel all strip by default. Nginx and Caddy strip only if explicitly configured (<code>proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for</code> in nginx).</p>

    <p><code>WEBJS_NO_TRUST_PROXY=1</code> OUTRANKS this option. That env var is the operator's statement that nothing trusted sits in front of the container, and it governs every forwarded-header read in the framework, so while it is set <code>trustProxy: true</code> is ignored and the limiter keys on the stamped socket IP (or <code>'_anon_'</code> when there is none), logging one warning per process. The switch can only ever subtract trust, never grant it. Setting both is a misconfiguration, and it costs you: every visitor behind the proxy shares one bucket, because the proxy is the only peer the socket ever sees. Unset the env var on a genuinely proxied deploy.</p>

    <p><strong>Embedded adapters</strong> (running WebJs via <code>createRequestHandler</code> under Express / Fastify / Bun / Deno / edge runtimes) do NOT get the socket-stamping automatically, the framework's <code>startServer</code> path does it. The adapter MUST call <code>stampRemoteIp(req, remoteAddress)</code> before passing the request to webjs:</p>

    <code-block>// express adapter
import { createRequestHandler, stampRemoteIp } from '@webjsdev/server';

const handler = createRequestHandler({ appDir: './app' });

app.use(async (req, res) => {
  const webReq = new Request(/* ... */, { method: req.method, headers: req.headers, /* ... */ });
  const safe = stampRemoteIp(webReq, req.socket.remoteAddress);
  const webRes = await handler.handle(safe);
  // write webRes back to res
});</code-block>

    <p>Without <code>stampRemoteIp</code>, the adapter passes inbound headers through unmodified. A malicious client can include <code>x-webjs-remote-ip: &lt;anything&gt;</code> on the wire and <code>clientIp(req)</code> will trust it, defeating the limiter even with <code>trustProxy: false</code>.</p>

    <h2>Custom key function</h2>
    <p>Rate limit by authenticated user instead of IP:</p>

    <code-block>// app/api/posts/middleware.ts
import { rateLimit } from '@webjsdev/server';
import { auth } from '#modules/auth/index.ts';

export default rateLimit({
  window: '1m',
  max: 30,
  key: async (req) => {
    const session = await auth(req);
    return session?.user?.id ?? 'anon';
  },
});</code-block>

    <h2>Response headers</h2>
    <p>Every response from a rate-limited route includes standard headers:</p>
    <ul>
      <li><code>x-ratelimit-limit</code>: the configured max.</li>
      <li><code>x-ratelimit-remaining</code>: requests left in the current window.</li>
      <li><code>x-ratelimit-reset</code>: Unix timestamp when the window resets.</li>
    </ul>
    <p>When the limit is exceeded, the response is <code>429 Too Many Requests</code> with <code>retry-after</code> header and a JSON body: <code>{ "error": "Too Many Requests" }</code>.</p>

    <h2>Per-route vs global</h2>
    <p>Place the middleware file at the route level you want to protect:</p>
    <ul>
      <li><code>app/middleware.ts</code>: rate limits every route in the app.</li>
      <li><code>app/api/middleware.ts</code>: rate limits all API routes.</li>
      <li><code>app/api/auth/middleware.ts</code>: rate limits only auth endpoints.</li>
    </ul>

    <h2>Scaling with Redis</h2>
    <p>In production with multiple server instances, set <code>REDIS_URL</code> and call <code>setStore(redisStore({ url: process.env.REDIS_URL }))</code> once at app startup. The rate limiter uses whatever store is active, so switching once applies to every <code>rateLimit()</code> middleware in the app.</p>

    <code-block># .env
REDIS_URL=redis://localhost:6379</code-block>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/middleware">Middleware</a>: how middleware chains work</li>
      <li><a href="/docs/cache">Caching</a>: the underlying cache store that powers rate limiting</li>
      <li><a href="/docs/authentication">Build Your Own Authentication</a>: protect routes with auth</li>
    </ul>
  `;
}
