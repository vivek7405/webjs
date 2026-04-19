import { html } from '@webjskit/core';

export const metadata = { title: 'expose() — REST Endpoints from Server Actions — webjs' };

export default function Expose() {
  return html`
    <h1>expose() — REST Endpoints</h1>
    <p><code>expose()</code> lets you tag a server action to also be reachable at a stable REST URL. The same function powers both the RPC call (from components) and the HTTP endpoint (for external consumers, webhooks, mobile apps).</p>

    <h2>When to use</h2>
    <ul>
      <li>You have a server action that external consumers need to call over HTTP (mobile apps, webhooks, third-party integrations).</li>
      <li>You want a stable, documented API endpoint without writing a separate <code>route.ts</code> file.</li>
      <li>You want input validation on the HTTP path but trust the same-origin RPC path.</li>
    </ul>

    <h2>When NOT to use</h2>
    <ul>
      <li>For internal-only server actions that only your components call — plain server actions with RPC stubs are simpler and CSRF-protected.</li>
      <li>For complex REST resources with multiple methods — use <code>app/api/**/route.ts</code> instead.</li>
    </ul>

    <h2>Basic usage</h2>
    <pre>// modules/posts/actions/create-post.server.ts
import { expose } from '@webjskit/core';
import { prisma } from '../../../lib/prisma.ts';

export const createPost = expose('POST /api/posts', async ({ title, body }) => {
  return prisma.post.create({ data: { title, body } });
});</pre>

    <p>This function is now callable two ways:</p>
    <ul>
      <li><strong>From a component</strong> (RPC): <code>import { createPost } from '../actions/create-post.server.ts';</code> — auto-RPC stub, CSRF-protected.</li>
      <li><strong>Over HTTP</strong>: <code>POST /api/posts</code> with JSON body — no CSRF (designed for external callers).</li>
    </ul>

    <h2>Input validation</h2>
    <p>Pass a <code>validate</code> function as the third argument. It runs only on the HTTP path (RPC calls are same-origin and CSRF-protected, so they bypass validation):</p>

    <pre>import { expose } from '@webjskit/core';
import { z } from 'zod';

const PostSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
});

export const createPost = expose(
  'POST /api/posts',
  async ({ title, body }) => {
    return prisma.post.create({ data: { title, body } });
  },
  { validate: (input) => PostSchema.parse(input) }
);</pre>

    <p>If validation throws, the HTTP response is <code>400</code> with the error message and any <code>issues</code> array (compatible with Zod/Valibot).</p>

    <h2>URL parameters</h2>
    <p><code>expose()</code> supports URL parameters. On the HTTP path, the adapter merges <code>{ ...queryParams, ...urlParams, ...jsonBody }</code> into a single object argument:</p>

    <pre>export const getPost = expose('GET /api/posts/:slug', async ({ slug }) => {
  return prisma.post.findUnique({ where: { slug } });
});</pre>

    <h2>Security</h2>
    <p><strong>Important:</strong> <code>expose()</code>d endpoints are NOT CSRF-protected — they're designed for external consumers. You must handle authentication yourself:</p>

    <ul>
      <li>Require a bearer token or API key via <code>headers().get('authorization')</code>.</li>
      <li>Or protect the route with auth middleware.</li>
      <li>Or rely on session cookies but add your own CSRF check for browser-facing endpoints.</li>
    </ul>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/server-actions">Server Actions</a> — the RPC system that expose() builds on</li>
      <li><a href="/docs/api-routes">API Routes</a> — the alternative for complex REST resources</li>
      <li><a href="/docs/rate-limiting">Rate Limiting</a> — protect exposed endpoints from abuse</li>
      <li><a href="/docs/middleware">Middleware</a> — add auth to exposed routes</li>
    </ul>
  `;
}
