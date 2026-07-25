import { html } from '@webjsdev/core';

export const metadata = { title: 'Backend-Only Mode | WebJs' };

export default function BackendOnly() {
  return html`
    <h1>Backend-Only Mode</h1>
    <p>WebJs works as a pure API framework with no pages, no SSR, and no web components. If you only need file-based routing, middleware, TypeScript, and a fast HTTP server, you can use WebJs without writing a single page or component. Everything in the framework is designed around standard <code>Request</code>/<code>Response</code> objects, so the server-side features work independently of the rendering layer.</p>

    <h2>When to Choose Backend-Only</h2>
    <p>Use backend-only mode when:</p>
    <ul>
      <li>You are building a REST or JSON API for a mobile app, SPA, or external consumers.</li>
      <li>You want file-based routing and middleware without the weight of a UI framework.</li>
      <li>Your frontend is a separate app (React, Vue, Svelte, plain HTML) and you need a typed API backend.</li>
      <li>You are building a microservice that only serves data.</li>
      <li>You want typed RPC endpoints (server actions, optionally exposed over REST via <code>route.ts</code>) callable from another WebJs app or any HTTP client.</li>
    </ul>
    <p>Use full-stack WebJs when you want server-rendered pages, web components, streaming SSR, and server actions all in one codebase.</p>

    <h2>Minimal API-Only App Structure</h2>
    <pre>my-api/
  app/
    api/
      health/
        route.ts           # GET /api/health
      users/
        route.ts           # GET /api/users, POST /api/users
        [id]/
          route.ts         # GET /api/users/:id, PUT, DELETE
      auth/
        login/
          route.ts         # POST /api/auth/login
        signup/
          route.ts         # POST /api/auth/signup
        middleware.ts       # rate limiting for /api/auth/*
    middleware.ts           # segment middleware for all /api/* (CORS, etc.)
  actions/
    users.server.ts        # server actions (exposed over REST via route.ts)
  db/
    connection.server.ts
    schema.server.ts
  lib/
    session.ts
  middleware.ts             # root middleware (logging, timing)
  package.json
  tsconfig.json</pre>
    <p>There is no <code>page.ts</code>, no <code>layout.ts</code>, no <code>components/</code> directory. WebJs detects what files exist and only activates the features you use.</p>

    <h2>File-Based API Routing</h2>
    <p>A <code>route.ts</code> file anywhere under <code>app/</code> becomes an API endpoint. Export functions named after HTTP methods:</p>
    <pre>// app/api/users/route.ts
import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';

export async function GET(req: Request, { params }: { params: Record&lt;string, string&gt; }) {
  const rows = await db.query.users.findMany({
    columns: { id: true, name: true, email: true, createdAt: true },
  });
  return Response.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const [user] = await db.insert(users).values({ name: body.name, email: body.email }).returning();
  return Response.json(user, { status: 201 });
}</pre>
    <pre>// app/api/users/[id]/route.ts
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await db.query.users.findFirst({ where: { id: Number(params.id) } });
  if (!user) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(user);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const [user] = await db.update(users).set(body).where(eq(users.id, Number(params.id))).returning();
  return Response.json(user);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  await db.delete(users).where(eq(users.id, Number(params.id)));
  return new Response(null, { status: 204 });
}</pre>
    <p>Dynamic segments (<code>[id]</code>), catch-all segments (<code>[...rest]</code>), and route groups (<code>(groupName)</code>) all work the same way as with pages.</p>

    <h2>Middleware for Auth, CORS, Rate Limiting</h2>
    <p>Middleware works identically in backend-only mode. Place <code>middleware.ts</code> files at the root or in any segment directory:</p>
    <pre>// middleware.ts (root): logging for every request
export default async function logger(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
): Promise&lt;Response&gt; {
  const start = Date.now();
  const resp = await next();
  console.log(\`\${req.method} \${new URL(req.url).pathname} \${resp.status} \${Date.now() - start}ms\`);
  return resp;
}</pre>
    <pre>// app/middleware.ts: CORS for all routes under app/
export default async function cors(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
): Promise&lt;Response&gt; {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-max-age': '86400',
      },
    });
  }
  const resp = await next();
  resp.headers.set('access-control-allow-origin', '*');
  return resp;
}</pre>
    <pre>// app/api/auth/middleware.ts: rate limit auth endpoints
import { rateLimit } from '@webjsdev/server';

export default rateLimit({ window: '10s', max: 5 });</pre>

    <h2>Server Actions over REST via route.ts</h2>
    <p>Define your API logic as plain server-action functions, then expose them over HTTP through a <code>route.ts</code> handler. The <code>route()</code> adapter from <code>@webjsdev/server</code> writes the common handler (merge query + params + JSON body, run an optional validator, JSON-respond) in one line:</p>
    <pre>// actions/users.server.ts
'use server';
import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';

export async function listUsers() {
  return db.query.users.findMany({
    columns: { id: true, name: true, email: true },
  });
}

export async function getUser({ id }: { id: string }) {
  const user = await db.query.users.findFirst({ where: { id: Number(id) } });
  if (!user) throw new Error('User not found');
  return user;
}

export async function createUser({ name, email }: { name: string; email: string }) {
  const [user] = await db.insert(users).values({ name, email }).returning();
  return user;
}</pre>
    <pre>// app/api/v2/users/route.ts
import { route } from '@webjsdev/server';
import { listUsers, createUser } from '#actions/users.server.ts';

const validateUser = (input: any) =&gt; {
  if (!input.name || typeof input.name !== 'string') throw new Error('name is required');
  if (!input.email || typeof input.email !== 'string') throw new Error('email is required');
  return input;
};

export const GET = route(listUsers);
export const POST = route(createUser, { validate: validateUser });

// app/api/v2/users/[id]/route.ts: ctx.params.id merges into the input
import { route } from '@webjsdev/server';
import { getUser } from '#actions/users.server.ts';
export const GET = route(getUser);</pre>
    <p>The action is reachable two ways:</p>
    <ul>
      <li><strong>As an HTTP endpoint:</strong> <code>GET /api/v2/users/:id</code> from curl, Postman, or any HTTP client, served by the <code>route.ts</code> handler.</li>
      <li><strong>As a typed function import:</strong> another WebJs app (or the same app's components) can <code>import { getUser } from '#actions/users.server.ts'</code> and call it as a function with full type safety.</li>
    </ul>
    <p>The <code>route()</code> adapter merges URL params, query string, and JSON body into a single object argument. The optional <code>validate</code> function runs before the handler and can transform or reject input (works with zod, valibot, or any schema library that throws on error). For CORS, wrap the handler in the <code>cors()</code> middleware, or apply it in <code>middleware.ts</code> for the path.</p>

    <h2>WebSocket Support</h2>
    <p>Export a <code>WS</code> function from any <code>route.ts</code> to create a WebSocket endpoint:</p>
    <pre>// app/api/chat/route.ts
import type { WebSocket } from 'ws';

const clients = new Set&lt;WebSocket&gt;();

export function WS(ws: WebSocket, req: Request, { params }: { params: Record&lt;string, string&gt; }) {
  clients.add(ws);

  ws.on('message', (data: Buffer) =&gt; {
    const msg = data.toString();
    for (const c of clients) {
      if (c.readyState === 1) c.send(msg);
    }
  });

  ws.on('close', () =&gt; clients.delete(ws));
}</pre>
    <p>WebSocket endpoints coexist with HTTP handlers in the same <code>route.ts</code>. The second argument is a <code>Request</code> object from the upgrade handshake, so you can read cookies, headers, and query params for auth.</p>

    <h2>Content-Negotiated JSON</h2>
    <p>Use the <code>json()</code> helper from <code>@webjsdev/server</code> and the <code>richFetch()</code> client helper from <code>webjs</code> for rich-encoded responses that preserve <code>Date</code>, <code>Map</code>, <code>Set</code>, <code>BigInt</code>, <code>TypedArray</code>, <code>Blob</code>, <code>File</code>, <code>FormData</code>, and reference cycles:</p>
    <pre>// app/api/events/route.ts
import { json } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';

export async function GET() {
  const events = await db.query.events.findMany();
  return json(events); // dates stay as Dates for richFetch callers
}</pre>
    <pre>// Internal client (another webjs app or same-app component)
import { richFetch } from '@webjsdev/core';

const events = await richFetch('/api/events');
// events[0].createdAt is a real Date object

// External client (curl, Postman) gets plain JSON automatically
// curl http://localhost:8080/api/events</pre>
    <p>The <code>json()</code> helper reads the <code>Accept</code> header. If the client sent <code>Accept: application/vnd.webjs+json</code> (as <code>richFetch</code> does), the response is encoded with the WebJs serializer. Otherwise, plain <code>application/json</code>. The <code>Vary: Accept</code> header is set automatically.</p>
    <p>For reading request bodies with the same content negotiation, use <code>readBody(req)</code> from <code>@webjsdev/server</code>.</p>

    <h2>Health Probes, Graceful Shutdown, Compression</h2>
    <p>All production features work in backend-only mode with no extra configuration:</p>
    <ul>
      <li><strong>Health probes:</strong> <code>GET /__webjs/health</code> and <code>GET /__webjs/ready</code> return <code>{ "status": "ok" }</code>.</li>
      <li><strong>Graceful shutdown:</strong> <code>SIGINT</code>/<code>SIGTERM</code> drains in-flight requests, then exits cleanly.</li>
      <li><strong>Compression:</strong> Brotli/Gzip for JSON responses in production.</li>
      <li><strong>ETags:</strong> static file ETags and cache headers.</li>
      <li><strong>Structured logging:</strong> JSON-per-line in production, human-readable in dev.</li>
    </ul>

    <h2>createRequestHandler() for Serverless/Edge</h2>
    <p>Embed a backend-only WebJs app in any environment that speaks <code>Request</code>/<code>Response</code>:</p>
    <pre>import { createRequestHandler } from '@webjsdev/server';

// Build the handler once at cold start
const app = await createRequestHandler({
  appDir: process.cwd(),
  dev: false,
});

// Serverless function (AWS Lambda with response streaming, Vercel, etc.)
export default async function handler(req: Request): Promise&lt;Response&gt; {
  return app.handle(req);
}

// Or embed in an existing Fastify server
import Fastify from 'fastify';
const fastify = Fastify();

fastify.all('*', async (request, reply) =&gt; {
  const url = new URL(request.url, \`http://\${request.headers.host}\`);
  const webReq = new Request(url, {
    method: request.method,
    headers: request.headers as Record&lt;string, string&gt;,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  });
  const resp = await app.handle(webReq);
  reply.status(resp.status);
  resp.headers.forEach((v, k) =&gt; reply.header(k, v));
  const body = await resp.text();
  reply.send(body);
});

fastify.listen({ port: 8080 });</pre>

    <h2>Comparison with Express/Fastify</h2>
    <p>Here is what WebJs gives you compared to a traditional Node.js API framework:</p>
    <ul>
      <li><strong>File-based routing</strong>: no manual <code>app.get()</code> / <code>app.post()</code> registration. Drop a <code>route.ts</code> in a folder and it is live.</li>
      <li><strong>Nested middleware</strong>: middleware scoped to route subtrees, not global or per-route.</li>
      <li><strong>TypeScript first</strong>: no build step, no compilation, no config. <code>.ts</code> files run directly.</li>
      <li><strong>Rich wire format</strong>: webjs's built-in serializer round-trips <code>Date</code>/<code>Map</code>/<code>Set</code>/<code>BigInt</code>/<code>TypedArray</code>/<code>Blob</code>/<code>File</code>/<code>FormData</code> and reference cycles.</li>
      <li><strong>WebSocket support</strong>: export a <code>WS</code> function from a route file, no separate setup.</li>
      <li><strong>Health probes</strong>: built-in, zero config.</li>
      <li><strong>route.ts + route()</strong>: turn server functions into REST endpoints with validation and CORS.</li>
      <li><strong>Graceful shutdown</strong>: handles SIGINT/SIGTERM, drains connections, hard-exits on timeout.</li>
      <li><strong>Compression and ETags</strong>: built-in, negotiated automatically.</li>
    </ul>
    <p>What WebJs does not give you:</p>
    <ul>
      <li><strong>Massive middleware ecosystem</strong>: Express has thousands of middleware packages (passport, multer, helmet, etc.). WebJs has a handful of built-in utilities. You can still use any standard library that works with <code>Request</code>/<code>Response</code>.</li>
      <li><strong>Years of battle-testing</strong>: Express and Fastify have been production-proven at enormous scale. WebJs is new.</li>
      <li><strong>Plugin system</strong>: Fastify's plugin architecture for encapsulated contexts does not have a WebJs equivalent. The middleware chain and file conventions are the extension points.</li>
      <li><strong>Advanced schema validation</strong>: Fastify has built-in JSON Schema validation with Ajv. In webjs, use the <code>validate</code> config export (or the <code>route()</code> adapter's <code>validate</code> option) with zod, valibot, or any library.</li>
    </ul>

    <h2>Example: Complete API-Only Setup</h2>
    <h3>package.json</h3>
    <pre>{
  "name": "my-api",
  "type": "module",
  "scripts": {
    "dev": "webjs dev",
    "start": "webjs start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@webjsdev/cli": "0.1.0",
    "@webjsdev/core": "0.1.0",
    "@webjsdev/server": "0.1.0",
    "drizzle-orm": "^1.0.0-rc.3"
  },
  "devDependencies": {
    "drizzle-kit": "^1.0.0-rc.3",
    "typescript": "^5.7.0"
  }
}</pre>

    <h3>middleware.ts (root)</h3>
    <pre>export default async function logger(
  req: Request,
  next: () =&gt; Promise&lt;Response&gt;,
): Promise&lt;Response&gt; {
  const start = Date.now();
  const resp = await next();
  const ms = Date.now() - start;
  console.log(\`\${req.method} \${new URL(req.url).pathname} \${resp.status} \${ms}ms\`);
  return resp;
}</pre>

    <h3>app/api/posts/route.ts</h3>
    <pre>import { json } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { posts } from '#db/schema.server.ts';

export async function GET() {
  const rows = await db.query.posts.findMany({
    orderBy: { createdAt: 'desc' },
    with: { author: { columns: { name: true } } },
  });
  return json(rows);
}

export async function POST(req: Request) {
  const { title, body, authorId } = await req.json();
  const [post] = await db.insert(posts).values({
    title, body, slug: title.toLowerCase().replace(/\s+/g, '-'), authorId,
  }).returning();
  return json(post, { status: 201 });
}</pre>

    <h3>Run it</h3>
    <pre>webjs dev
# API is live at http://localhost:8080
# curl http://localhost:8080/api/posts
# curl http://localhost:8080/__webjs/health</pre>
    <p>No pages, no layouts, no components, no SSR. Just a fast, typed API server with file-based routing.</p>
  `;
}
