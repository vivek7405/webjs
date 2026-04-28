import { html } from '@webjskit/core';

export const metadata = { title: 'API Routes — webjs' };

export default function ApiRoutes() {
  return html`
    <h1>API Routes</h1>
    <p>API routes are <code>route.ts</code> files that export named async functions for each HTTP method you want to handle. They follow the same file-based routing as pages but produce JSON (or any <code>Response</code>) instead of HTML.</p>

    <blockquote>A <code>route.ts</code> can live <strong>anywhere under <code>app/</code></strong> -- not just inside an <code>api/</code> subdirectory. <code>app/webhook/route.ts</code> maps to <code>/webhook</code>, <code>app/stripe/checkout/route.ts</code> maps to <code>/stripe/checkout</code>, and so on.</blockquote>

    <h2>Supported Methods</h2>
    <p>Export one or more named async functions from a <code>route.ts</code> file:</p>
    <ul>
      <li><strong>GET</strong> -- read a resource</li>
      <li><strong>POST</strong> -- create a resource</li>
      <li><strong>PUT</strong> -- replace a resource</li>
      <li><strong>PATCH</strong> -- partially update a resource</li>
      <li><strong>DELETE</strong> -- remove a resource</li>
    </ul>
    <p>If a request arrives with a method that has no matching export, webjs returns <code>405 Method Not Allowed</code> with an <code>Allow</code> header listing the available methods.</p>

    <h2>Handler Signature</h2>
    <p>Every handler receives two arguments:</p>
    <pre>export async function GET(
  req: Request,
  { params }: { params: Record&lt;string, string&gt; }
): Promise&lt;Response | object&gt;</pre>
    <ul>
      <li><strong>req</strong> -- a standard Web API <code>Request</code>. Read headers, cookies, URL, query params, body.</li>
      <li><strong>params</strong> -- an object containing dynamic route segment values (from <code>[slug]</code> folder names).</li>
    </ul>
    <p>Return a <code>Response</code> for full control over status, headers, and body. Or return a plain object (or array, number, null) and webjs wraps it with <code>Response.json()</code> automatically.</p>

    <h2>Basic Example</h2>
    <pre>// app/api/hello/route.ts

export async function GET(req: Request) {
  return Response.json({ message: 'Hello from webjs!' });
}

export async function POST(req: Request) {
  const body = await req.json();
  return Response.json({ received: body });
}</pre>

    <h2>Routes Outside app/api/</h2>
    <p>There is nothing special about the <code>api/</code> directory. A <code>route.ts</code> file anywhere in the <code>app/</code> tree becomes an API endpoint at the corresponding URL path:</p>
    <pre>app/
  api/
    users/route.ts          # GET /api/users
  webhook/route.ts          # POST /webhook
  stripe/checkout/route.ts  # POST /stripe/checkout
  health/route.ts           # GET /health</pre>

    <h2>Dynamic Params via [slug] Folders</h2>
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
    <p>Catch-all segments (<code>[...rest]</code>) work too -- <code>params.rest</code> is the full remaining path as a string:</p>
    <pre>// app/api/files/[...path]/route.ts
type Ctx = { params: { path: string } };

export async function GET(_req: Request, { params }: Ctx) {
  // params.path is "images/photo.jpg" for /api/files/images/photo.jpg
  const file = await readFile(join(STORAGE_DIR, params.path));
  return new Response(file, {
    headers: { 'content-type': 'application/octet-stream' },
  });
}</pre>

    <h2>Returning Objects (Auto-JSON)</h2>
    <p>If a handler returns a plain object or array instead of a <code>Response</code>, webjs wraps it with <code>Response.json()</code>:</p>
    <pre>export async function GET() {
  const posts = await db.post.findMany();
  return posts;  // Automatically becomes Response.json(posts)
}

export async function POST(req: Request) {
  const data = await req.json();
  const post = await db.post.create({ data });
  return post;  // { id: 1, title: "Hello", createdAt: "2026-04-15T..." }
}</pre>
    <p>When you need control over status code, headers, or streaming, return a <code>Response</code> directly.</p>

    <h2>json() Helper -- Content Negotiation</h2>
    <p>The <code>json()</code> helper from <code>@webjskit/server</code> adds smart content negotiation. It inspects the incoming request's <code>Accept</code> header and responds accordingly:</p>
    <ul>
      <li>If the client sent <code>Accept: application/vnd.webjs+json</code> (e.g. via <code>richFetch()</code>), the response is encoded with the <strong>webjs serializer</strong> so that <code>Date</code>, <code>Map</code>, <code>Set</code>, <code>BigInt</code>, <code>TypedArray</code>, <code>Blob</code>, <code>File</code>, <code>FormData</code>, and reference cycles all survive the round trip.</li>
      <li>Otherwise, the response is plain <code>application/json</code> -- standard for curl, mobile apps, and third-party consumers.</li>
    </ul>
    <pre>// app/api/posts/route.ts
import { json } from '@webjskit/server';

export async function GET() {
  const posts = await db.post.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return json(posts);
  // External client:  plain JSON, createdAt is an ISO string
  // richFetch client: rich types, createdAt is a real Date object
}

export async function POST(req: Request) {
  const input = await req.json();
  const post = await db.post.create({ data: input });
  return json(post, { status: 201 });
}</pre>
    <p>The helper reads the in-flight Request from an <code>AsyncLocalStorage</code> context set up by the request pipeline, so you do not need to pass the request explicitly.</p>

    <h2>readBody() -- Parsing Rich Request Bodies</h2>
    <p>The <code>readBody()</code> helper from <code>@webjskit/server</code> is the inverse of <code>json()</code>. It parses the request body with the webjs rich serializer when the client sent the <code>application/vnd.webjs+json</code> content type, and as plain JSON otherwise:</p>
    <pre>import { json, readBody } from '@webjskit/server';

export async function POST(req: Request) {
  const data = await readBody(req);
  // If client sent via richFetch: data.publishAt is a real Date
  // If client sent plain JSON:    data.publishAt is a string
  const post = await db.post.create({ data });
  return json(post, { status: 201 });
}</pre>

    <h2>richFetch() -- Typed Client Calls</h2>
    <p>On the client side, <code>richFetch()</code> from <code>webjs</code> is a drop-in replacement for <code>fetch()</code> that enables the rich-type round trip:</p>
    <pre>import { richFetch } from '@webjskit/core';

// GET with rich types
const posts = await richFetch('/api/posts');
// posts[0].createdAt is a Date object, not a string

// POST with a rich body
const newPost = await richFetch('/api/posts', {
  method: 'POST',
  body: { title: 'Hello', publishAt: new Date(2026, 5, 1) },
  // body is automatically encoded with the rich serializer
  // Content-Type is set to application/vnd.webjs+json
});

// Error handling
try {
  const data = await richFetch('/api/protected');
} catch (err) {
  console.log(err.status);   // e.g. 401
  console.log(err.body);     // parsed error response body
  console.log(err.message);  // error message from response or status fallback
}</pre>
    <p><code>richFetch</code> automatically:</p>
    <ul>
      <li>Sets <code>Accept: application/vnd.webjs+json</code> on outgoing requests</li>
      <li>If <code>body</code> is a plain object (not FormData, Blob, ArrayBuffer, or string), encodes it with the webjs serializer and sets the content type</li>
      <li>Parses the response with the webjs serializer when the server responds with the vendor content type, or with plain <code>JSON.parse</code> otherwise</li>
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

    <h2>Per-Segment Middleware on API Routes</h2>
    <p>API routes participate in the same per-segment middleware chain as pages. A <code>middleware.ts</code> file in a directory applies to all routes (page and API) under that directory:</p>
    <pre>// app/api/auth/middleware.ts
import { rateLimit } from '@webjskit/server';

// 5 requests per 10 seconds per IP on all /api/auth/* routes
export default rateLimit({ window: '10s', max: 5 });</pre>
    <p>Middleware is a function <code>(req: Request, next: () =&gt; Promise&lt;Response&gt;) =&gt; Promise&lt;Response&gt;</code>. It can inspect the request, short-circuit with its own response, or call <code>next()</code> to continue to the handler:</p>
    <pre>// app/api/admin/middleware.ts
export default async function authGuard(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token || !await verifyToken(token)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return next();
}</pre>
    <p>Middleware files nest. If you have <code>app/middleware.ts</code>, <code>app/api/middleware.ts</code>, and <code>app/api/admin/middleware.ts</code>, a request to <code>/api/admin/users</code> runs all three in outermost-to-innermost order.</p>

    <h2>Rate Limiting</h2>
    <p>webjs ships a built-in in-memory fixed-window rate limiter, shaped as a middleware:</p>
    <pre>import { rateLimit } from '@webjskit/server';

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
      <li><code>Retry-After</code> -- seconds until the window resets</li>
      <li><code>X-RateLimit-Limit</code> -- the configured max</li>
      <li><code>X-RateLimit-Remaining</code> -- requests left in the current window</li>
      <li><code>X-RateLimit-Reset</code> -- Unix timestamp when the window resets</li>
    </ul>
    <p>These rate-limit headers are also added to successful responses so clients can monitor their usage. The default key function extracts the client IP from <code>X-Forwarded-For</code>, <code>CF-Connecting-IP</code>, or <code>X-Real-IP</code> headers (in that order). For multi-instance deployments, use an external rate limiter (Redis, nginx, Cloudflare).</p>

    <h2>CORS on expose()d Endpoints</h2>
    <p>There are two patterns for CORS in webjs:</p>
    <ol>
      <li><strong>expose() with cors option</strong> -- per-function CORS for server actions that double as REST endpoints. Preflight <code>OPTIONS</code> handling is automatic.</li>
      <li><strong>route.ts with middleware</strong> -- manual CORS via a shared middleware that applies to all routes in a segment.</li>
    </ol>
    <p>Example CORS middleware for route.ts files:</p>
    <pre>// app/api/public/middleware.ts
export default async function cors(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
) {
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

    <h2>Backend-Only Usage</h2>
    <p>webjs works as a <strong>pure API framework</strong> with no pages or components. If your <code>app/</code> directory contains only <code>route.ts</code> and <code>middleware.ts</code> files (no <code>page.ts</code>, no <code>layout.ts</code>), webjs serves only API routes. No SSR, no import maps, no client JS. This is ideal for microservices, backends for mobile apps, or REST APIs. See <a href="/docs/backend-only">Backend-Only Mode</a> for a full guide.</p>

    <h2>Complete CRUD Example</h2>
    <p>Here is a full route.ts implementing GET, POST, and DELETE for a resource:</p>
    <pre>// app/api/posts/route.ts
import { json, readBody } from '@webjskit/server';

// GET /api/posts -- list all posts, with pagination
export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') || '1');
  const limit = 20;

  const [posts, total] = await Promise.all([
    db.post.findMany({
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    db.post.count(),
  ]);

  return json({
    posts,
    page,
    totalPages: Math.ceil(total / limit),
    total,
  });
}

// POST /api/posts -- create a new post
export async function POST(req: Request) {
  const data = await readBody(req);

  if (!data.title || typeof data.title !== 'string') {
    return Response.json(
      { error: 'title is required' },
      { status: 400 },
    );
  }

  const post = await db.post.create({
    data: {
      title: data.title,
      body: data.body || '',
      slug: data.title.toLowerCase().replace(/\\s+/g, '-'),
    },
  });

  return json(post, { status: 201 });
}

// DELETE /api/posts -- delete posts by IDs
export async function DELETE(req: Request) {
  const { ids } = await req.json();

  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json(
      { error: 'ids array is required' },
      { status: 400 },
    );
  }

  const result = await db.post.deleteMany({
    where: { id: { in: ids } },
  });

  return json({ deleted: result.count });
}</pre>

    <h3>Single-Resource Route (Dynamic Params)</h3>
    <pre>// app/api/posts/[slug]/route.ts
import { json, readBody } from '@webjskit/server';

type Ctx = { params: { slug: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const post = await db.post.findUnique({
    where: { slug: params.slug },
    include: { author: true },
  });
  if (!post) return Response.json({ error: 'Not found' }, { status: 404 });
  return json(post);
}

export async function PUT(req: Request, { params }: Ctx) {
  const data = await readBody(req);
  const post = await db.post.update({
    where: { slug: params.slug },
    data: { title: data.title, body: data.body },
  });
  return json(post);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  await db.post.delete({ where: { slug: params.slug } });
  return new Response(null, { status: 204 });
}</pre>

    <h2>Summary</h2>
    <ul>
      <li><code>route.ts</code> files export named async functions: <code>GET</code>, <code>POST</code>, <code>PUT</code>, <code>PATCH</code>, <code>DELETE</code></li>
      <li>They can live anywhere under <code>app/</code>, not just in <code>app/api/</code></li>
      <li>Handler signature: <code>(req: Request, { params }) =&gt; Response | object</code></li>
      <li>Dynamic params via <code>[slug]</code> folder names, catch-all via <code>[...rest]</code></li>
      <li>Return a <code>Response</code> for full control, or return a plain object for auto-JSON</li>
      <li><code>json()</code> from <code>@webjskit/server</code> provides content negotiation (plain JSON vs webjs rich JSON)</li>
      <li><code>readBody()</code> parses incoming rich-format or plain JSON based on content type</li>
      <li><code>richFetch()</code> on the client for typed API calls with rich types</li>
      <li>Export <code>WS</code> from the same <code>route.ts</code> for WebSocket support</li>
      <li>Per-segment <code>middleware.ts</code> applies to all routes underneath</li>
      <li><code>rateLimit()</code> from <code>@webjskit/server</code> for built-in rate limiting</li>
      <li>CORS via <code>expose()</code> options or custom middleware on <code>route.ts</code> files</li>
      <li>webjs works as a backend-only API framework when no page files are present</li>
    </ul>
  `;
}
