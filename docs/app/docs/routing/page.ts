import { html } from 'webjs';

export const metadata = { title: 'Routing — webjs' };

export default function Routing() {
  return html`
    <h1>Routing</h1>
    <p>
      webjs uses <strong>file-based routing inspired by the Next.js App Router</strong>.
      Every file under your project's <code>app/</code> directory maps to a URL based on
      its folder path. There is no central route configuration file — the file system
      <em>is</em> the router.
    </p>

    <blockquote>
      If you have used Next.js 13+ App Router, webjs routing will feel immediately
      familiar. The conventions — <code>page.ts</code>, <code>layout.ts</code>,
      <code>route.ts</code>, <code>[param]</code> folders, <code>(group)</code> folders,
      <code>not-found.ts</code>, <code>error.ts</code>, and <code>loading.ts</code> — are
      modelled directly on Next.js, adapted for a no-build, web-components-first
      architecture.
    </blockquote>

    <h2>File Conventions at a Glance</h2>
    <pre>app/
├── layout.ts          # root layout — wraps every page
├── page.ts            # home page → /
├── not-found.ts       # 404 fallback
├── error.ts           # root error boundary
├── loading.ts         # loading UI (reserved for Suspense)
├── middleware.ts       # root middleware
├── about/
│   └── page.ts        # /about
├── blog/
│   ├── layout.ts      # nested layout for /blog/*
│   ├── page.ts        # /blog
│   └── [slug]/
│       └── page.ts    # /blog/:slug (dynamic)
├── files/
│   └── [...rest]/
│       └── page.ts    # /files/* (catch-all)
├── (marketing)/
│   └── pricing/
│       └── page.ts    # /pricing (group folder not in URL)
├── _internal/
│   └── helpers.ts     # excluded from routing (private folder)
└── api/
    ├── hello/
    │   └── route.ts   # GET /api/hello
    └── chat/
        └── route.ts   # GET + WS /api/chat</pre>

    <p>
      Files can use <code>.ts</code>, <code>.js</code>, <code>.mts</code>, or
      <code>.mjs</code> extensions. TypeScript files run natively on the server via
      Node 23.6+ type-stripping — no build step required.
    </p>

    <!-- ===== PAGES ===== -->
    <h2>Pages (<code>page.ts</code> / <code>page.js</code>)</h2>
    <p>
      A <code>page.ts</code> file makes a route publicly accessible. Its
      <strong>default export</strong> is an async function that receives a context object
      with <code>params</code>, <code>searchParams</code>, and <code>url</code>. The
      function runs <strong>only on the server</strong> during SSR — it never ships to the
      browser.
    </p>

    <h3>Signature</h3>
    <pre>// app/blog/[slug]/page.ts
import { html } from 'webjs';

type Ctx = {
  params: { slug: string };
  searchParams: Record&lt;string, string&gt;;
  url: string;
};

export default async function BlogPost({ params, searchParams, url }: Ctx) {
  const post = await db.posts.findBySlug(params.slug);
  const page = Number(searchParams.page) || 1;

  return html\`
    &lt;h1&gt;\${post.title}&lt;/h1&gt;
    &lt;p&gt;\${post.body}&lt;/p&gt;
    &lt;p&gt;Page \${page} &middot; Loaded from \${url}&lt;/p&gt;
  \`;
}</pre>

    <ul>
      <li><strong><code>params</code></strong> — an object of dynamic route segments (e.g. <code>{ slug: "hello-world" }</code>).</li>
      <li><strong><code>searchParams</code></strong> — an object of query-string key/value pairs (e.g. <code>{ page: "2" }</code>).</li>
      <li><strong><code>url</code></strong> — the full request URL as a string.</li>
    </ul>

    <p>
      The function can be <code>async</code> — you can <code>await</code> database
      queries, fetch calls, or any server-side work directly inside the page function.
      Return an <code>html\`...\`</code> tagged template literal (a <code>TemplateResult</code>)
      and webjs will render it to HTML on the server.
    </p>

    <!-- ===== LAYOUTS ===== -->
    <h2>Layouts (<code>layout.ts</code>)</h2>
    <p>
      A <code>layout.ts</code> file wraps every page (and nested layout) in its directory
      and all subdirectories. It receives a <code>children</code> prop containing the
      rendered page or inner layout.
    </p>

    <h3>Root Layout</h3>
    <pre>// app/layout.ts
import { html } from 'webjs';

export default function RootLayout({ children }: { children: unknown }) {
  return html\`
    &lt;nav&gt;&lt;a href="/"&gt;Home&lt;/a&gt; | &lt;a href="/about"&gt;About&lt;/a&gt;&lt;/nav&gt;
    &lt;main&gt;\${children}&lt;/main&gt;
    &lt;footer&gt;&amp;copy; 2025 My App&lt;/footer&gt;
  \`;
}</pre>

    <h3>Nested Layout</h3>
    <pre>// app/dashboard/layout.ts
import { html } from 'webjs';

export default function DashboardLayout({ children }: { children: unknown }) {
  return html\`
    &lt;div class="dashboard"&gt;
      &lt;aside&gt;
        &lt;a href="/dashboard"&gt;Overview&lt;/a&gt;
        &lt;a href="/dashboard/settings"&gt;Settings&lt;/a&gt;
      &lt;/aside&gt;
      &lt;section&gt;\${children}&lt;/section&gt;
    &lt;/div&gt;
  \`;
}</pre>

    <p>
      Layouts nest automatically by folder depth. For the route
      <code>/dashboard/settings</code>, webjs renders:
    </p>
    <pre>RootLayout
  └── DashboardLayout
        └── SettingsPage</pre>

    <p>
      The root <code>app/layout.ts</code> is the outermost wrapper. Every layout in the
      chain receives the same <code>params</code>, <code>searchParams</code>, and
      <code>url</code> context as the page, plus the <code>children</code> prop.
    </p>

    <!-- ===== DYNAMIC ROUTES ===== -->
    <h2>Dynamic Routes</h2>
    <p>
      Wrap a folder name in square brackets to create a dynamic segment. The folder name
      becomes the parameter key.
    </p>

    <h3>Single Parameter</h3>
    <pre>app/
└── users/
    └── [id]/
        └── page.ts     # matches /users/42, /users/abc, etc.</pre>

    <pre>// app/users/[id]/page.ts
import { html } from 'webjs';

export default async function UserPage({ params }: { params: { id: string } }) {
  const user = await db.users.find(params.id);
  return html\`&lt;h1&gt;\${user.name}&lt;/h1&gt;\`;
}</pre>

    <h3>Multiple Parameters</h3>
    <pre>app/
└── blog/
    └── [year]/
        └── [month]/
            └── page.ts   # /blog/2025/04 → { year: "2025", month: "04" }</pre>

    <h3>Catch-All Routes (<code>[...rest]</code>)</h3>
    <p>
      Prefix the parameter name with <code>...</code> to capture all remaining path
      segments as a single string.
    </p>

    <pre>app/
└── files/
    └── [...path]/
        └── page.ts     # /files/a/b/c → { path: "a/b/c" }</pre>

    <pre>// app/files/[...path]/page.ts
import { html } from 'webjs';

export default function FilesPage({ params }: { params: { path: string } }) {
  const segments = params.path.split('/');
  return html\`
    &lt;h1&gt;File browser&lt;/h1&gt;
    &lt;p&gt;Current path: /files/\${params.path}&lt;/p&gt;
    &lt;ul&gt;
      \${segments.map((s) =&gt; html\`&lt;li&gt;\${s}&lt;/li&gt;\`)}
    &lt;/ul&gt;
  \`;
}</pre>

    <p>
      Static routes are matched before dynamic routes, and dynamic routes are matched
      before catch-all routes, so you can safely mix them.
    </p>

    <!-- ===== ROUTE GROUPS ===== -->
    <h2>Route Groups (<code>(group)</code>)</h2>
    <p>
      Folders wrapped in parentheses are <strong>route groups</strong>. They do
      <strong>not</strong> appear in the URL, but they do scope layouts and middleware
      to a subset of routes.
    </p>

    <pre>app/
├── (marketing)/
│   ├── layout.ts       # marketing-specific layout
│   ├── about/
│   │   └── page.ts     # URL is /about (not /marketing/about)
│   └── pricing/
│       └── page.ts     # URL is /pricing
└── (app)/
    ├── layout.ts       # app-specific layout (authenticated shell)
    └── dashboard/
        └── page.ts     # URL is /dashboard</pre>

    <p>
      This is useful when you want different layouts or middleware for different sections
      of your site without affecting the URL structure.
    </p>

    <!-- ===== PRIVATE FOLDERS ===== -->
    <h2>Private Folders (<code>_private</code>)</h2>
    <p>
      Any folder whose name starts with an underscore (<code>_</code>) is
      <strong>excluded from routing entirely</strong>. Files inside it will never match a
      URL. Use private folders for shared utilities, internal helpers, or any code you
      want to colocate with your routes without exposing it.
    </p>

    <pre>app/
├── _lib/
│   ├── db.ts           # not a route — safe to import from pages
│   └── auth.ts
├── _components/
│   └── header.ts       # colocated components, not routed
└── page.ts             # / — can import from _lib/ and _components/</pre>

    <!-- ===== API ROUTES ===== -->
    <h2>API Routes / Route Handlers (<code>route.ts</code>)</h2>
    <p>
      A <code>route.ts</code> file defines an API endpoint. Instead of a default export,
      you export <strong>named functions for each HTTP method</strong> you want to handle:
      <code>GET</code>, <code>POST</code>, <code>PUT</code>, <code>PATCH</code>, and
      <code>DELETE</code>.
    </p>

    <p>
      Route handlers can live <strong>anywhere</strong> under <code>app/</code> — not
      just inside <code>app/api/</code>. The <code>api/</code> prefix is a convention,
      not a requirement.
    </p>

    <h3>Basic Example</h3>
    <pre>// app/api/hello/route.ts
export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get('name') || 'world';
  return { hello: name, at: new Date().toISOString() };
}

export async function POST(req: Request) {
  const body = await req.json();
  // ... create resource ...
  return Response.json({ created: true }, { status: 201 });
}</pre>

    <h3>Handler Signature</h3>
    <p>
      Each handler receives a standard <code>Request</code> object and an optional
      context object with <code>params</code> from dynamic route segments:
    </p>
    <pre>export async function GET(
  req: Request,
  { params }: { params: Record&lt;string, string&gt; }
): Promise&lt;Response | object&gt;</pre>

    <ul>
      <li>Return a <code>Response</code> object for full control over status, headers, and body.</li>
      <li>Return a plain object or array and webjs will automatically serialize it as <code>JSON</code> with a <code>200</code> status.</li>
      <li>If a request arrives for a method you have not exported, webjs responds with <code>405 Method Not Allowed</code> and an <code>Allow</code> header listing the supported methods.</li>
    </ul>

    <h3>Dynamic API Route</h3>
    <pre>// app/api/posts/[slug]/route.ts
type Ctx = { params: { slug: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const post = await db.posts.findBySlug(params.slug);
  if (!post) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(post);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  await db.posts.delete(params.slug);
  return Response.json({ deleted: true });
}</pre>

    <!-- ===== WEBSOCKET ROUTES ===== -->
    <h2>WebSocket Routes</h2>
    <p>
      To handle WebSocket connections, export a <code>WS</code> function from the same
      <code>route.ts</code> file. When a client sends a WebSocket upgrade request to that
      URL, webjs upgrades the connection and calls your <code>WS</code> handler.
    </p>

    <pre>// app/api/chat/route.ts
import type { WebSocket } from 'ws';

const clients = new Set&lt;WebSocket&gt;();

// Regular HTTP handler — still works alongside WS
export function GET() {
  return new Response(
    \`Connected clients: \${clients.size}\`,
    { headers: { 'content-type': 'text/plain' } },
  );
}

// WebSocket handler — called on upgrade
export function WS(ws: WebSocket, req: Request, { params }: { params: Record&lt;string, string&gt; }) {
  clients.add(ws);

  ws.on('message', (data) =&gt; {
    const text = data.toString();
    for (const client of clients) {
      if (client.readyState === 1) client.send(text);
    }
  });

  ws.on('close', () =&gt; {
    clients.delete(ws);
  });
}</pre>

    <h3>WS Handler Signature</h3>
    <pre>export function WS(
  ws: WebSocket,            // the ws library WebSocket instance
  req: Request,             // the original HTTP upgrade request (headers, cookies, etc.)
  ctx: { params: Record&lt;string, string&gt; }  // dynamic route params
): void</pre>

    <p>
      The <code>req</code> argument gives you access to cookies, authorization headers,
      and query parameters so you can authenticate the connection before accepting
      messages. WebSocket handlers work with dynamic routes just like HTTP handlers.
    </p>

    <!-- ===== NOT FOUND ===== -->
    <h2>Not Found (<code>not-found.ts</code>)</h2>
    <p>
      Place a <code>not-found.ts</code> file at the <strong>root</strong> of your
      <code>app/</code> directory to customize the 404 page. It is rendered whenever no
      route matches a request, or when a page calls <code>notFound()</code>.
    </p>

    <pre>// app/not-found.ts
import { html } from 'webjs';

export default function NotFound() {
  return html\`
    &lt;h1&gt;404&lt;/h1&gt;
    &lt;p&gt;Page not found.&lt;/p&gt;
    &lt;p&gt;&lt;a href="/"&gt;&amp;larr; Home&lt;/a&gt;&lt;/p&gt;
  \`;
}</pre>

    <p>
      If no <code>not-found.ts</code> exists, webjs renders a default
      <code>&lt;h1&gt;404 — Not found&lt;/h1&gt;</code> page.
    </p>

    <!-- ===== ERROR BOUNDARIES ===== -->
    <h2>Error Boundaries (<code>error.ts</code>)</h2>
    <p>
      An <code>error.ts</code> file acts as an <strong>error boundary</strong>. When an
      uncaught error occurs during page rendering, webjs walks up the folder tree looking
      for the <strong>nearest</strong> <code>error.ts</code> and renders it instead. This
      means error boundaries are nested — a deeply-placed <code>error.ts</code> catches
      errors for its subtree without affecting the rest of the site.
    </p>

    <pre>// app/error.ts — root error boundary
import { html } from 'webjs';

export default function ErrorBoundary({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return html\`
    &lt;h1&gt;Something went wrong&lt;/h1&gt;
    &lt;p&gt;\${message}&lt;/p&gt;
    &lt;p&gt;&lt;a href="/"&gt;Go home&lt;/a&gt;&lt;/p&gt;
  \`;
}</pre>

    <h3>Nested Error Boundaries</h3>
    <pre>app/
├── error.ts              # catches errors site-wide
├── dashboard/
│   ├── error.ts          # catches errors only in /dashboard/*
│   ├── page.ts
│   └── settings/
│       └── page.ts       # error here → caught by dashboard/error.ts</pre>

    <p>
      The error boundary receives the context object (<code>params</code>,
      <code>searchParams</code>, <code>url</code>) along with the <code>error</code>
      property. Errors from <code>notFound()</code> and <code>redirect()</code> are
      <strong>not</strong> caught by error boundaries — those are handled specially by the
      framework.
    </p>

    <!-- ===== METADATA ===== -->
    <h2>Metadata</h2>
    <p>
      webjs supports two ways to define page metadata (title, description, Open Graph
      tags, etc.):
    </p>

    <h3>Static Metadata</h3>
    <p>Export a <code>metadata</code> object from any page or layout:</p>
    <pre>// app/about/page.ts
import { html } from 'webjs';

export const metadata = {
  title: 'About — My App',
  description: 'Learn more about our company.',
  openGraph: {
    title: 'About Us',
    description: 'We build cool things.',
  },
};

export default function About() {
  return html\`&lt;h1&gt;About&lt;/h1&gt;\`;
}</pre>

    <h3>Dynamic Metadata (<code>generateMetadata</code>)</h3>
    <p>
      Export an async <code>generateMetadata</code> function for metadata that depends on
      route params or data fetching:
    </p>
    <pre>// app/blog/[slug]/page.ts
import { html } from 'webjs';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const post = await db.posts.findBySlug(params.slug);
  return post
    ? { title: \`\${post.title} — My Blog\` }
    : { title: 'Not found — My Blog' };
}

export default async function PostPage({ params }: { params: { slug: string } }) {
  // ...
}</pre>

    <h3>Metadata Merging</h3>
    <p>
      Metadata is collected from the outermost layout to the page. Later values
      <strong>override</strong> earlier ones, so a page's metadata takes precedence over
      its layout's metadata. Supported fields include:
    </p>
    <ul>
      <li><code>title</code> — sets <code>&lt;title&gt;</code></li>
      <li><code>description</code> — sets <code>&lt;meta name="description"&gt;</code></li>
      <li><code>viewport</code> — sets <code>&lt;meta name="viewport"&gt;</code> (defaults to <code>width=device-width,initial-scale=1</code>)</li>
      <li><code>themeColor</code> — sets <code>&lt;meta name="theme-color"&gt;</code></li>
      <li><code>openGraph</code> — an object of Open Graph properties (keys become <code>og:key</code>)</li>
      <li><code>preload</code> — an array of <code>&lt;link rel="preload"&gt;</code> entries (e.g. fonts, images)</li>
    </ul>

    <!-- ===== NAVIGATION HELPERS ===== -->
    <h2>Navigation Helpers</h2>
    <p>
      webjs provides two server-side navigation helpers, imported from <code>'webjs'</code>.
      Both work by throwing a sentinel error that the SSR pipeline catches — never wrap
      them in a try/catch.
    </p>

    <h3><code>notFound()</code></h3>
    <p>
      Aborts rendering and returns a <code>404</code> response. If a
      <code>not-found.ts</code> exists at the app root, it is rendered.
    </p>
    <pre>import { html, notFound } from 'webjs';

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await db.posts.findBySlug(params.slug);
  if (!post) notFound();  // stops execution, returns 404

  return html\`&lt;h1&gt;\${post.title}&lt;/h1&gt;\`;
}</pre>

    <h3><code>redirect(url, status?)</code></h3>
    <p>
      Aborts rendering and returns a redirect response. The default status is
      <code>307</code> (temporary redirect). Pass <code>308</code> for a permanent
      redirect.
    </p>
    <pre>import { redirect } from 'webjs';

export default async function ProtectedPage() {
  const user = await getSession();
  if (!user) redirect('/login');          // 307 temporary redirect
  // if (!user) redirect('/login', 308);  // 308 permanent redirect

  return html\`&lt;h1&gt;Welcome, \${user.name}&lt;/h1&gt;\`;
}</pre>

    <p>
      Both helpers can be called from pages, layouts, and <code>generateMetadata</code>
      functions — anywhere in the server-side rendering chain.
    </p>

    <!-- ===== LOADING ===== -->
    <h2>Loading UI (<code>loading.ts</code>)</h2>
    <p>
      The <code>loading.ts</code> file convention is <strong>reserved for future
      Suspense integration</strong>. When placed in a route folder, it defines a loading
      UI that will be shown while the page's async content is being resolved.
    </p>

    <pre>// app/dashboard/loading.ts  (reserved — future Suspense integration)
import { html } from 'webjs';

export default function Loading() {
  return html\`
    &lt;div class="skeleton"&gt;
      &lt;div class="skeleton-line"&gt;&lt;/div&gt;
      &lt;div class="skeleton-line short"&gt;&lt;/div&gt;
    &lt;/div&gt;
  \`;
}</pre>

    <p>
      Currently, webjs recognizes <code>loading.ts</code> files in the route table and
      associates them with their routes (outermost to innermost, mirroring the layout
      chain), but the automatic Suspense wrapping is not yet active. The file is included
      in the route scan today so your loading UIs are ready when streaming Suspense
      support is completed.
    </p>

    <!-- ===== SUMMARY ===== -->
    <h2>Route Resolution Order</h2>
    <p>When a request arrives, webjs resolves it in this order:</p>
    <ul>
      <li><strong>1. Static file</strong> — if a file exists in the project's public/static directory, it is served directly.</li>
      <li><strong>2. API route</strong> — <code>route.ts</code> handlers are matched against the URL. WebSocket upgrades also match here.</li>
      <li><strong>3. Page route</strong> — <code>page.ts</code> files are matched. Static routes take priority over dynamic, and dynamic over catch-all.</li>
      <li><strong>4. Not found</strong> — if nothing matches, <code>not-found.ts</code> is rendered with a <code>404</code> status.</li>
    </ul>

    <h2>Quick Reference</h2>
    <pre>File              Purpose                              Example URL
─────────────────────────────────────────────────────────────────────
page.ts           Page component (SSR)                 /about
layout.ts         Wrapping layout (nested)             wraps children
route.ts          API / WebSocket handler              /api/users
error.ts          Error boundary (nearest wins)        catches render errors
not-found.ts      Custom 404 page (app root only)      404 fallback
loading.ts        Loading UI (reserved for Suspense)   shown while loading
middleware.ts     Request middleware (nested)           runs before handlers
[param]/          Dynamic segment                      /users/:id
[...rest]/        Catch-all segment                    /files/*
(group)/          Route group (not in URL)             scopes layouts
_private/         Private folder (excluded)            not routable</pre>
  `;
}
