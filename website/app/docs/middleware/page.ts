import { html } from '@webjsdev/core';

export const metadata = { title: 'Middleware | WebJs' };

export default function Middleware() {
  return html`
    <h1>Middleware</h1>
    <p>Middleware in WebJs lets you intercept requests before they reach your pages, API routes, or server actions. Use it for authentication, logging, rate limiting, CORS, header injection, or any cross-cutting concern. WebJs supports two levels of middleware: a single root middleware and per-segment middleware scoped to subtrees of your route hierarchy.</p>

    <h2>Root Middleware</h2>
    <p>Place a <code>middleware.ts</code> at the root of your project (next to <code>app/</code>, not inside it). This middleware runs on <strong>every app request</strong> before WebJs routes it to a page, API route, or server action. Any of <code>middleware.ts</code>, <code>.js</code>, <code>.mts</code>, or <code>.mjs</code> works, and <code>.ts</code> wins if you somehow have more than one.</p>
    <p>Two things are served ahead of it, so root middleware never sees them. The framework's own <code>/__webjs/*</code> assets and health probes bypass it in both dev and production, because they are framework infrastructure your app needs to boot rather than app routes. In <strong>development only</strong>, static files under <code>/public/*</code> (plus the <code>/sw.js</code> and <code>/offline.html</code> root remaps and <code>/favicon.ico</code>) are served ahead of it as well, so a stylesheet is never queued behind the dev server's startup analysis. In production those static files go through root middleware normally, so a middleware that protects an asset still protects it where it counts.</p>
    <code-block>my-app/
  middleware.ts          # root middleware: runs on every app request
  app/
    page.ts
    api/
      hello/
        route.ts</code-block>
    <code-block>// middleware.ts
export default async function middleware(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
): Promise&lt;Response&gt; {
  const started = Date.now();
  const resp = await next();
  const elapsed = Date.now() - started;
  console.log(\`\${req.method} \${new URL(req.url).pathname} -> \${resp.status} (\${elapsed}ms)\`);
  resp.headers.set('x-response-time', \`\${elapsed}ms\`);
  return resp;
}</code-block>

    <h2>Per-Segment Middleware</h2>
    <p>Place a <code>middleware.ts</code> inside any directory under <code>app/</code> to scope it to that subtree. It runs only for requests whose URL matches that segment and its children.</p>
    <code-block>my-app/
  middleware.ts               # root: every app request
  app/
    page.ts                   # /: root + no segment middleware
    dashboard/
      middleware.ts            # only /dashboard/* requests
      page.ts                 # / dashboard
      settings/
        page.ts               # /dashboard/settings
    api/
      auth/
        middleware.ts          # only /api/auth/* requests
        login/
          route.ts             # POST /api/auth/login
        signup/
          route.ts             # POST /api/auth/signup</code-block>

    <h2>Signature</h2>
    <p>Every middleware function has the same signature, whether root or per-segment:</p>
    <code-block>export default async function middleware(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
): Promise&lt;Response&gt;</code-block>
    <ul>
      <li><strong>req</strong>: a standard <a href="https://developer.mozilla.org/en-US/docs/Web/API/Request">Request</a> object. Read headers, cookies, URL, method, body.</li>
      <li><strong>next()</strong>: calls the next middleware in the chain, or the final handler (page render, API route, action). Returns a <code>Promise&lt;Response&gt;</code>.</li>
      <li><strong>Return value</strong>: you must return a <code>Response</code>. Either pass through the one from <code>next()</code> (optionally modified), or return your own to short-circuit the chain.</li>
    </ul>
    <p>The file must <code>export default</code> a function. Named exports are ignored.</p>

    <h2>Chain Order</h2>
    <p>When a request arrives, middleware executes in this order:</p>
    <ol>
      <li><strong>Root middleware</strong> (<code>middleware.ts</code> at project root)</li>
      <li><strong>Outermost segment middleware</strong> (<code>app/middleware.ts</code> if it exists)</li>
      <li><strong>Next segment</strong> (<code>app/dashboard/middleware.ts</code>)</li>
      <li><strong>Innermost segment</strong> (deepest <code>middleware.ts</code> on the matched route)</li>
      <li><strong>Handler</strong> (page SSR, API route, or server action)</li>
    </ol>
    <p>Each middleware calls <code>next()</code> to proceed. Responses bubble back up through the chain in reverse order, so outer middleware can inspect or modify the final response.</p>
    <code-block>// Execution flow for GET /dashboard/settings:
//
//   root middleware
//     -> app/dashboard/middleware.ts
//       -> SSR app/dashboard/settings/page.ts
//       &lt;- Response
//     &lt;- Response (dashboard middleware can modify)
//   &lt;- Response (root middleware can modify)</code-block>

    <h2>Short-Circuiting</h2>
    <p>Return a <code>Response</code> without calling <code>next()</code> to stop the chain early. The request never reaches downstream middleware or the route handler.</p>
    <code-block>// app/api/middleware.ts: require API key for all /api/* routes
export default async function apiAuth(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
): Promise&lt;Response&gt; {
  const key = req.headers.get('x-api-key');
  if (key !== process.env.API_KEY) {
    return Response.json(
      { error: 'Invalid API key' },
      { status: 401 },
    );
  }
  return next();
}</code-block>

    <h2>Use Case: Auth Gate on /dashboard</h2>
    <p>A common pattern: require authentication for an entire subtree by placing a middleware in the segment directory.</p>
    <code-block>// app/dashboard/middleware.ts
import { cookies } from '@webjsdev/server';
import { getUserByToken, SESSION_COOKIE } from '#lib/session.server.ts';

export default async function requireAuth(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
): Promise&lt;Response&gt; {
  const user = await getUserByToken(cookies().get(SESSION_COOKIE));
  if (!user) {
    const to = encodeURIComponent(new URL(req.url).pathname);
    return new Response(null, {
      status: 302,
      headers: { location: \`/login?then=\${to}\` },
    });
  }
  return next();
}</code-block>
    <p>Every page and API route under <code>app/dashboard/</code> is now protected. Unauthenticated users are redirected to <code>/login</code> with a <code>then</code> query param so they can be sent back after signing in.</p>

    <h2>Use Case: Logging and Timing</h2>
    <code-block>// middleware.ts (root)
export default async function logger(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
): Promise&lt;Response&gt; {
  const url = new URL(req.url);
  const start = Date.now();
  const resp = await next();
  const ms = Date.now() - start;
  console.log(\`\${req.method} \${url.pathname} \${resp.status} \${ms}ms\`);
  return resp;
}</code-block>

    <h2>Use Case: CORS Headers</h2>
    <code-block>// app/api/middleware.ts: add CORS to all /api/* routes
export default async function cors(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
): Promise&lt;Response&gt; {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-max-age': '86400',
      },
    });
  }

  const resp = await next();
  resp.headers.set('access-control-allow-origin', '*');
  return resp;
}</code-block>
    <p>WebJs also ships a ready-made <code>cors()</code> middleware (from <code>@webjsdev/server</code>) you can wrap around a single <code>route.ts</code> handler. Use middleware CORS when you need blanket coverage across all routes in a segment.</p>

    <h2>Rate Limiting</h2>
    <p>WebJs ships a built-in rate limiter as a middleware factory. Import <code>rateLimit</code> from <code>@webjsdev/server</code>:</p>
    <code-block>// app/api/auth/middleware.ts
import { rateLimit } from '@webjsdev/server';

export default rateLimit({ window: '10s', max: 5 });</code-block>
    <p>That single line protects every route under <code>/api/auth/</code> (login, signup, password reset) with a limit of 5 requests per 10 seconds per IP address.</p>
    <h3>rateLimit() Options</h3>
    <code-block>rateLimit({
  window: '1m',       // time window: number (ms) or string: '30s', '1m', '1h'
  max: 60,            // max requests per window per key
  key: req =&gt; {       // custom key function (default: IP from x-forwarded-for)
    return \`login:\${req.headers.get('x-forwarded-for') || 'anon'}\`;
  },
  message: 'Slow down' // custom 429 error message
})</code-block>
    <p>The rate limiter is in-memory and uses a fixed-window algorithm. Response headers are set automatically:</p>
    <ul>
      <li><code>x-ratelimit-limit</code>: the max for this window</li>
      <li><code>x-ratelimit-remaining</code>: requests left in the current window</li>
      <li><code>x-ratelimit-reset</code>: unix timestamp when the window resets</li>
      <li><code>retry-after</code>: seconds until the window resets (on 429 responses only)</li>
    </ul>
    <p>For multi-instance deployments, rate-limit at the edge (nginx, Cloudflare, AWS WAF) or use the <code>key</code> function to integrate with a shared store like Redis.</p>

    <h2>cookies() and headers() Helpers</h2>
    <p>WebJs provides request-scoped helpers via <code>@webjsdev/server</code> that let you read cookies and headers from anywhere in your server-side code (middleware, pages, server actions, API routes) without explicitly threading the request object:</p>
    <code-block>import { cookies, headers } from '@webjsdev/server';

// In any server-side function:
const token = cookies().get('session_token');
const hasToken = cookies().has('session_token');
const allCookies = cookies().entries(); // [string, string][]

const auth = headers().get('authorization');
const userAgent = headers().get('user-agent');</code-block>
    <p>These are backed by AsyncLocalStorage. The request context is established before your middleware runs, so they work everywhere in the request lifecycle. Calling them outside a request scope (e.g., at module top level) throws an error.</p>
    <p><strong>Note:</strong> <code>cookies()</code> is read-only. To set a cookie, include a <code>Set-Cookie</code> header on the Response you return from your middleware, API route, or server action.</p>

    <h2>Middleware and Server Actions</h2>
    <p>Root middleware runs on server action RPC calls (<code>POST /__webjs/action/:hash/:fn</code>) just like any other request. Per-segment middleware does not apply to server actions (they bypass the file-based route tree). For action-level guards, check auth inside the action itself, declare per-action <code>middleware</code> on the action, or call the action from a <code>route.ts</code> under a middleware-protected segment.</p>

    <h2>Middleware and API Routes</h2>
    <p>Per-segment middleware applies to API routes (<code>route.ts</code>) within the same subtree. If <code>app/api/middleware.ts</code> exists, it runs before <code>app/api/hello/route.ts</code>, <code>app/api/auth/login/route.ts</code>, and every other route under <code>/api/</code>.</p>
    <p>Middleware chains nest: a request to <code>/api/auth/login</code> runs the root middleware, then <code>app/api/middleware.ts</code>, then <code>app/api/auth/middleware.ts</code>, then the route handler.</p>

    <h2>Tips</h2>
    <ul>
      <li><strong>Keep middleware fast.</strong> It runs on every request in its scope. Defer heavy work to the route handler when possible.</li>
      <li><strong>Avoid mutating the request.</strong> The Web <code>Request</code> API is largely immutable. If you need to pass data downstream (e.g., a resolved user object), store it in a module-scoped <code>AsyncLocalStorage</code> or use a header.</li>
      <li><strong>One default export.</strong> Each <code>middleware.ts</code> must export a single default function. Multiple middleware in one file are not supported. If you need composition, chain them manually inside your export.</li>
      <li><strong>Use <code>rateLimit()</code> from <code>@webjsdev/server</code></strong> rather than writing your own. It handles cleanup, header injection, and per-bucket IP resolution that defaults to the framework-stamped socket address (spoof-safe) and only honours <code>X-Forwarded-For</code> / <code>CF-Connecting-IP</code> / <code>X-Real-IP</code> when you opt in with <code>trustProxy: true</code> and <code>WEBJS_NO_TRUST_PROXY=1</code> is not set (that env var outranks the option). See <a href="/docs/rate-limiting">Rate limiting</a> for the threat model.</li>
    </ul>
  `;
}
