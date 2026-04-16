import { html } from 'webjs';

export const metadata = { title: 'API Routes — webjs' };

export default function ApiRoutes() {
  return html`
    <h1>API Routes</h1>
    <p>API routes are <code>route.ts</code> files that export named HTTP method handlers. They follow the same file-based routing as pages but produce JSON (or any <code>Response</code>) instead of HTML. A <code>route.ts</code> can live <strong>anywhere under <code>app/</code></strong> -- not just in an <code>api/</code> subdirectory.</p>

    <h2>Basic Structure</h2>
    <p>Create a <code>route.ts</code> file and export functions named after the HTTP methods you want to handle:</p>

    <pre>// app/api/hello/route.ts
export async function GET(req: Request) {
  return Response.json({ message: 'Hello from webjs!' });
}

export async function POST(req: Request) {
  const body = await req.json();
  return Response.json({ received: body });
}</pre>

    <p>Supported method exports: <code>GET</code>, <code>POST</code>, <code>PUT</code>, <code>PATCH</code>, <code>DELETE</code>. If a request arrives with a method that has no matching export, webjs returns <code>405 Method Not Allowed</code> with an <code>Allow</code> header listing the available methods.</p>

    <h2>Request and Response (Standard Web APIs)</h2>
    <p>Handlers receive a standard <a href="https://developer.mozilla.org/en-US/docs/Web/API/Request">Request</a> object and should return a standard <a href="https://developer.mozilla.org/en-US/docs/Web/API/Response">Response</a>. No framework-specific request/response wrappers -- it is the same API you would use in a Service Worker, Cloudflare Worker, or Deno.</p>

    <pre>export async function POST(req: Request) {
  // Read headers
  const auth = req.headers.get('authorization');

  // Read URL / query params
  const url = new URL(req.url);
  const page = url.searchParams.get('page') || '1';

  // Read body (JSON, FormData, text, etc.)
  const data = await req.json();

  // Return any valid Response
  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'content-type': 'application/json', 'x-custom': 'value' },
  });
}</pre>

    <h2>Dynamic Params</h2>
    <p>Dynamic route segments work identically to page routes. A folder named <code>[slug]</code> captures that segment into <code>params.slug</code>:</p>

    <pre>// app/api/posts/[slug]/route.ts
type Ctx = { params: { slug: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const post = await db.post.findUnique({ where: { slug: params.slug } });
  if (!post) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(post);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  await db.post.delete({ where: { slug: params.slug } });
  return Response.json({ deleted: true });
}</pre>

    <p>Catch-all segments (<code>[...rest]</code>) work too:</p>

    <pre>// app/api/files/[...path]/route.ts
type Ctx = { params: { path: string } };

export async function GET(_req: Request, { params }: Ctx) {
  // params.path is "images/photo.jpg" for /api/files/images/photo.jpg
  const file = await readFile(join(STORAGE_DIR, params.path));
  return new Response(file, { headers: { 'content-type': 'application/octet-stream' } });
}</pre>

    <h2>Returning Objects (Auto-JSON)</h2>
    <p>If a handler returns a plain object (or array, null, etc.) instead of a <code>Response</code>, webjs automatically wraps it with <code>Response.json()</code>:</p>

    <pre>export async function GET() {
  const posts = await db.post.findMany();
  return posts;  // Automatically becomes Response.json(posts)
}

export async function POST(req: Request) {
  const data = await req.json();
  const post = await db.post.create({ data });
  return post;  // { id: 1, title: "Hello", createdAt: "2026-04-15T..." }
}</pre>

    <p>When you need control over the status code, headers, or streaming, return a <code>Response</code> directly.</p>

    <h2>json() Helper -- Content Negotiation</h2>
    <p>The <code>json()</code> helper from <code>@webjs/server</code> adds smart content negotiation. It checks the incoming request's <code>Accept</code> header and responds differently:</p>
    <ul>
      <li>If the client sent <code>Accept: application/vnd.webjs+json</code> (e.g. via <code>richFetch()</code>), the response is encoded with superjson so that <code>Date</code>, <code>Map</code>, <code>Set</code>, and <code>BigInt</code> survive the round trip.</li>
      <li>Otherwise, the response is plain <code>application/json</code> -- standard for curl, mobile apps, and third-party consumers.</li>
    </ul>

    <pre>// app/api/posts/route.ts
import { json } from '@webjs/server';

export async function GET() {
  const posts = await db.post.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return json(posts);
  // External client:  plain JSON, createdAt is an ISO string
  // richFetch client: superjson, createdAt is a real Date object
}

export async function POST(req: Request) {
  const input = await req.json();
  const post = await db.post.create({ data: input });
  return json(post, { status: 201 });
}</pre>

    <p>The helper reads the in-flight Request from an <code>AsyncLocalStorage</code> context (set up by the request pipeline), so you do not need to pass the request explicitly.</p>

    <h2>readBody() -- Parsing Rich Request Bodies</h2>
    <p>The <code>readBody()</code> helper from <code>@webjs/server</code> is the inverse of <code>json()</code>. It parses the request body as superjson when the client sent the <code>application/vnd.webjs+json</code> content type, and as plain JSON otherwise:</p>

    <pre>import { json, readBody } from '@webjs/server';

export async function POST(req: Request) {
  const data = await readBody(req);
  // If client sent via richFetch: data.publishAt is a real Date
  // If client sent plain JSON:    data.publishAt is a string
  const post = await db.post.create({ data });
  return json(post, { status: 201 });
}</pre>

    <h2>richFetch() -- Typed Client Calls</h2>
    <p>On the client side, <code>richFetch()</code> from <code>webjs</code> is a drop-in replacement for <code>fetch()</code> that enables the superjson round trip:</p>

    <pre>import { richFetch } from 'webjs';

// GET with rich types
const posts = await richFetch('/api/posts');
// posts[0].createdAt is a Date object, not a string

// POST with a rich body
const newPost = await richFetch('/api/posts', {
  method: 'POST',
  body: { title: 'Hello', publishAt: new Date(2026, 5, 1) },
  // body is automatically superjson-stringified
  // Content-Type is set to application/vnd.webjs+json
});

// Error handling
try {
  const data = await richFetch('/api/protected');
} catch (err) {
  console.log(err.status);  // e.g. 401
  console.log(err.body);    // parsed error response body
  console.log(err.message); // error message from response or status fallback
}</pre>

    <p><code>richFetch</code> automatically:</p>
    <ul>
      <li>Sets <code>Accept: application/vnd.webjs+json</code> on outgoing requests</li>
      <li>If <code>body</code> is a plain object (not FormData, Blob, ArrayBuffer, or string), stringifies it with superjson and sets the content type</li>
      <li>Parses the response with superjson when the server responds with the vendor content type, or with plain <code>JSON.parse</code> otherwise</li>
      <li>Throws an <code>Error</code> with <code>.status</code> and <code>.body</code> properties for non-2xx responses</li>
    </ul>

    <h2>WebSocket: Export WS</h2>
    <p>Any <code>route.ts</code> can also export a <code>WS</code> function to handle WebSocket connections at the same URL. See the <a href="/docs/websockets">WebSockets</a> documentation for full details.</p>

    <pre>// app/api/chat/route.ts
import type { WebSocket } from 'ws';

export function GET() {
  return Response.json({ status: 'WebSocket endpoint. Connect via ws://' });
}

export function WS(ws: WebSocket, req: Request) {
  ws.on('message', (data) =&gt; ws.send('echo: ' + data));
}</pre>

    <h2>Middleware on API Routes</h2>
    <p>API routes participate in the same per-segment middleware chain as pages. A <code>middleware.ts</code> file in a directory applies to all routes (page and API) under that directory:</p>

    <pre>// app/api/auth/middleware.ts
import { rateLimit } from '@webjs/server';

// 5 requests per 10 seconds per IP on all /api/auth/* routes
export default rateLimit({ window: '10s', max: 5 });</pre>

    <p>Middleware is a function <code>(req: Request, next: () =&gt; Promise&lt;Response&gt;) =&gt; Promise&lt;Response&gt;</code>. It can modify the request, short-circuit with its own response, or call <code>next()</code> to continue to the handler:</p>

    <pre>// app/api/admin/middleware.ts
export default async function authGuard(req: Request, next: () =&gt; Promise&lt;Response&gt;) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token || !await verifyToken(token)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return next();
}</pre>

    <p>Middleware files nest. If you have <code>app/middleware.ts</code>, <code>app/api/middleware.ts</code>, and <code>app/api/admin/middleware.ts</code>, a request to <code>/api/admin/users</code> runs all three in outermost-to-innermost order.</p>

    <h2>Rate Limiting</h2>
    <p>webjs ships a built-in in-memory fixed-window rate limiter, shaped as a middleware:</p>

    <pre>import { rateLimit } from '@webjs/server';

// In a middleware.ts file:
export default rateLimit({
  window: '1m',     // Window duration: number (ms), or "30s", "1m", "1h"
  max: 60,          // Max requests per window per key
  key: (req) =&gt; {   // Optional: custom key function (default: client IP)
    return req.headers.get('x-forwarded-for') || 'anon';
  },
  message: 'Slow down!',  // Optional: custom error message
});</pre>

    <p>When the limit is exceeded, the response is <code>429 Too Many Requests</code> with headers:</p>
    <ul>
      <li><code>Retry-After</code>: seconds until the window resets</li>
      <li><code>X-RateLimit-Limit</code>: the configured max</li>
      <li><code>X-RateLimit-Remaining</code>: requests left in the current window</li>
      <li><code>X-RateLimit-Reset</code>: Unix timestamp when the window resets</li>
    </ul>
    <p>These rate-limit headers are also added to successful responses so clients can monitor their usage.</p>

    <p>The default key function extracts the client IP from <code>X-Forwarded-For</code>, <code>CF-Connecting-IP</code>, or <code>X-Real-IP</code> headers (in that order). For multi-instance deployments, use an external rate limiter (Redis, nginx, Cloudflare) instead of the in-memory store.</p>

    <h2>CORS: expose() vs route.ts</h2>
    <p>There are two patterns for CORS in webjs, suited to different use cases:</p>

    <table>
      <thead>
        <tr><th>Pattern</th><th>Where CORS is configured</th><th>Best for</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><code>expose()</code></td>
          <td>Per-function via the <code>cors</code> option</td>
          <td>Server actions that double as public REST endpoints. CORS is automatic per-route, including OPTIONS preflight handling.</td>
        </tr>
        <tr>
          <td><code>route.ts</code></td>
          <td>Manually in the handler or via middleware</td>
          <td>Full-control API routes. Set <code>Access-Control-*</code> headers yourself or write a shared middleware that applies CORS to a group of routes.</td>
        </tr>
      </tbody>
    </table>

    <p>Example CORS middleware for route.ts files:</p>

    <pre>// app/api/public/middleware.ts
export default async function cors(req: Request, next: () =&gt; Promise&lt;Response&gt;) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization',
        'access-control-max-age': '86400',
      },
    });
  }
  const resp = await next();
  resp.headers.set('access-control-allow-origin', '*');
  return resp;
}</pre>

    <h2>Backend-Only Usage Pattern</h2>
    <p>webjs works as a <strong>pure API framework</strong> with no pages or components. If your <code>app/</code> directory contains only <code>route.ts</code> and <code>middleware.ts</code> files (no <code>page.ts</code>, no <code>layout.ts</code>), webjs serves only API routes. No SSR, no import maps, no client JS. This is ideal for microservices, backends for mobile apps, or REST APIs.</p>

    <pre>my-api/
├── app/
│   ├── api/
│   │   ├── users/
│   │   │   ├── route.ts         # GET /api/users, POST /api/users
│   │   │   └── [id]/
│   │   │       └── route.ts     # GET /api/users/:id, PUT, DELETE
│   │   ├── auth/
│   │   │   ├── login/
│   │   │   │   └── route.ts     # POST /api/auth/login
│   │   │   └── middleware.ts    # rate limiting
│   │   └── chat/
│   │       └── route.ts         # WS /api/chat
│   └── middleware.ts            # global auth check
├── middleware.ts                # top-level: logging, request ID
├── package.json
└── tsconfig.json</pre>

    <pre>// app/api/users/route.ts
import { json } from '@webjs/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') || '1');
  const limit = 20;
  const users = await db.user.findMany({
    skip: (page - 1) * limit,
    take: limit,
  });
  return json(users);
}

export async function POST(req: Request) {
  const body = await req.json();
  const user = await db.user.create({ data: body });
  return json(user, { status: 201 });
}</pre>

    <p>Start it with <code>npx webjs dev</code> or <code>npx webjs start</code> -- the same CLI, the same file conventions. Unmatched paths return a JSON 404 instead of an HTML page when the request accepts JSON.</p>

    <h2>Summary</h2>
    <ul>
      <li><code>route.ts</code> files export HTTP method handlers (<code>GET</code>, <code>POST</code>, etc.)</li>
      <li>Handlers receive a standard <code>Request</code> and return a standard <code>Response</code> (or a plain object for auto-JSON)</li>
      <li>Dynamic segments and catch-all segments work via <code>[param]</code> and <code>[...rest]</code> folders</li>
      <li><code>json()</code> from <code>@webjs/server</code> adds content negotiation (plain JSON vs superjson)</li>
      <li><code>readBody()</code> parses incoming request bodies with the same negotiation</li>
      <li><code>richFetch()</code> on the client enables typed, rich-type API calls</li>
      <li><code>WS</code> exports add WebSocket support to any route</li>
      <li>Per-segment <code>middleware.ts</code> files apply to all routes underneath</li>
      <li>The built-in <code>rateLimit()</code> middleware provides fixed-window rate limiting out of the box</li>
      <li>webjs works as a backend-only API framework when no page files are present</li>
    </ul>
  `;
}
