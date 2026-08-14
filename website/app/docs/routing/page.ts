import { html } from '@webjsdev/core';

export const metadata = { title: 'Routing | WebJs' };

export default function Routing() {
  return html`
    <h1>Routing</h1>
    <p>
      WebJs uses <strong>file-based routing</strong>. Every file under your project's
      <code>app/</code> directory maps to a URL based on its folder path. There is no
      central route configuration file. The file system <em>is</em> the router.
    </p>

    <blockquote>
      The conventions (<code>page.ts</code>, <code>layout.ts</code>,
      <code>route.ts</code>, <code>[param]</code> folders, <code>(group)</code> folders,
      <code>not-found.ts</code>, <code>error.ts</code>, and <code>loading.ts</code>) are
      adapted for a no-build, web-components-first architecture and will feel familiar
      if you have used the NextJs App Router.
    </blockquote>

    <h2>File Conventions at a Glance</h2>
    <code-block>app/
├── layout.ts          # root layout, wraps every page
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
        └── route.ts   # GET + WS /api/chat</code-block>

    <p>
      Files can use <code>.ts</code>, <code>.js</code>, <code>.mts</code>, or
      <code>.mjs</code> extensions. TypeScript files run via Node 24+'s
      built-in type-stripping, no build step required.
    </p>

    <!-- ===== PAGES ===== -->
    <h2>Pages (<code>page.ts</code> / <code>page.js</code>)</h2>
    <p>
      A <code>page.ts</code> file makes a route publicly accessible. Its
      <strong>default export</strong> is an async function that receives a context object
      with <code>params</code>, <code>searchParams</code>, and <code>url</code>. The
      function runs <strong>only on the server</strong> during SSR. It never ships to the
      browser.
    </p>

    <h3>Signature</h3>
    <code-block>// app/blog/[slug]/page.ts
import { html } from '@webjsdev/core';

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
}</code-block>

    <ul>
      <li><strong><code>params</code></strong>: the dynamic route segments (e.g. <code>{ slug: "hello-world" }</code>). Readable synchronously (<code>params.slug</code>) AND awaitable (<code>const { slug } = await params</code>, the Next 15/16 pattern). Both work.</li>
      <li><strong><code>searchParams</code></strong>: the query-string key/value pairs (e.g. <code>{ page: "2" }</code>). Also sync-readable and awaitable.</li>
      <li><strong><code>url</code></strong>: the full request URL as a string.</li>
    </ul>

    <p>
      The function can be <code>async</code>. You can <code>await</code> database
      queries, fetch calls, or any server-side work directly inside the page function.
      Return an <code>html\`...\`</code> tagged template literal (a <code>TemplateResult</code>)
      and WebJs will render it to HTML on the server.
    </p>

    <!-- ===== LAYOUTS ===== -->
    <h2>Layouts (<code>layout.ts</code>)</h2>
    <p>
      A <code>layout.ts</code> file wraps every page (and nested layout) in its directory
      and all subdirectories. It receives a <code>children</code> prop containing the
      rendered page or inner layout.
    </p>

    <h3>Root Layout</h3>
    <code-block>// app/layout.ts
import { html } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';

export default function RootLayout({ children }: LayoutProps) {
  return html\`
    &lt;nav&gt;&lt;a href="/"&gt;Home&lt;/a&gt; | &lt;a href="/about"&gt;About&lt;/a&gt;&lt;/nav&gt;
    &lt;main&gt;\${children}&lt;/main&gt;
    &lt;footer&gt;&amp;copy; 2025 My App&lt;/footer&gt;
  \`;
}</code-block>

    <h3>Nested Layout</h3>
    <code-block>// app/dashboard/layout.ts
import { html } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';

export default function DashboardLayout({ children }: LayoutProps) {
  return html\`
    &lt;div class="dashboard"&gt;
      &lt;aside&gt;
        &lt;a href="/dashboard"&gt;Overview&lt;/a&gt;
        &lt;a href="/dashboard/settings"&gt;Settings&lt;/a&gt;
      &lt;/aside&gt;
      &lt;section&gt;\${children}&lt;/section&gt;
    &lt;/div&gt;
  \`;
}</code-block>

    <p>
      Layouts nest automatically by folder depth. For the route
      <code>/dashboard/settings</code>, WebJs renders:
    </p>
    <code-block>RootLayout
  └── DashboardLayout
        └── SettingsPage</code-block>

    <p>
      The root <code>app/layout.ts</code> is the outermost wrapper. Every layout in the
      chain receives the same <code>params</code>, <code>searchParams</code>, and
      <code>url</code> context as the page, plus the <code>children</code> prop.
    </p>

    <h3>Layouts and client navigation</h3>
    <p>
      Nested layouts double as <strong>partial-swap boundaries</strong> for the client
      router. The SSR pipeline auto-emits keyed boundary comment pairs
      (<code>&lt;!--wj:children:&lt;segment&gt;:&lt;route-key&gt;--&gt;</code> ...
      <code>&lt;!--/wj:children:&lt;segment&gt;--&gt;</code>) around each layout's
      <code>\${children}</code> interpolation and around the page itself. When a user
      clicks a link, the router compares route-keys: a changed key remounts fresh at
      the parent boundary (whose range contains the changed layout's own markup,
      Next.js param-change parity), an unchanged one swaps only the deepest shared
      boundary's children. The outer layouts' DOM (and any state inside
      them: sidenav scroll, input values, mounted custom elements) stays mounted.
      Authors write nothing extra; the boundary emission is invisible.
    </p>
    <p>
      See the <a href="/docs/client-router">client router</a> docs for the full
      mechanism, including form submissions, snapshot cache, and the
      <code>&lt;webjs-frame&gt;</code> escape hatch.
    </p>

    <!-- ===== DYNAMIC ROUTES ===== -->
    <h2>Dynamic Routes</h2>
    <p>
      Wrap a folder name in square brackets to create a dynamic segment. The folder name
      becomes the parameter key.
    </p>

    <h3>Single Parameter</h3>
    <code-block>app/
└── users/
    └── [id]/
        └── page.ts     # matches /users/42, /users/abc, etc.</code-block>

    <code-block>// app/users/[id]/page.ts
import { html } from '@webjsdev/core';

export default async function UserPage({ params }: { params: { id: string } }) {
  const user = await db.users.find(params.id);
  return html\`&lt;h1&gt;\${user.name}&lt;/h1&gt;\`;
}</code-block>

    <h3>Multiple Parameters</h3>
    <code-block>app/
└── blog/
    └── [year]/
        └── [month]/
            └── page.ts   # /blog/2025/04 → { year: "2025", month: "04" }</code-block>

    <h3>Catch-All Routes (<code>[...rest]</code>)</h3>
    <p>
      Prefix the parameter name with <code>...</code> to capture all remaining path
      segments as a single string.
    </p>

    <code-block>app/
└── files/
    └── [...path]/
        └── page.ts     # /files/a/b/c → { path: "a/b/c" }</code-block>

    <code-block>// app/files/[...path]/page.ts
import { html } from '@webjsdev/core';

export default function FilesPage({ params }: { params: { path: string } }) {
  const segments = params.path.split('/');
  return html\`
    &lt;h1&gt;File browser&lt;/h1&gt;
    &lt;p&gt;Current path: /files/\${params.path}&lt;/p&gt;
    &lt;ul&gt;
      \${segments.map((s) =&gt; html\`&lt;li&gt;\${s}&lt;/li&gt;\`)}
    &lt;/ul&gt;
  \`;
}</code-block>

    <p>
      Route precedence is positional and deterministic, the same model as Next.js.
      Segment by segment, a static literal outranks a dynamic <code>[param]</code>, which
      outranks a catch-all, so the catch-all kind is the lowest priority
      <strong>at its position</strong>, not a blanket "always last" rule. So
      <code>/[user]/settings</code> (a static tail) correctly wins over
      <code>/[org]/[repo]</code> for <code>/acme/settings</code>, and
      <code>/docs/[[...slug]]</code> (a literal first segment) correctly wins over
      <code>/[org]/[repo]</code> for <code>/docs/x</code> even though it ends in a
      catch-all. An explicit <code>/docs</code> still beats the optional-catch-all base
      <code>/docs/[[...slug]]</code> for <code>/docs</code> itself. A genuine tie between
      two equally specific routes resolves by a stable alphabetical key, never by file
      order, so the match is the same across machines and deploys.
    </p>

    <!-- ===== ROUTE GROUPS ===== -->
    <h2>Route Groups (<code>(group)</code>)</h2>
    <p>
      Folders wrapped in parentheses are <strong>route groups</strong>. They do
      <strong>not</strong> appear in the URL, but they do scope layouts and middleware
      to a subset of routes.
    </p>

    <code-block>app/
├── (marketing)/
│   ├── layout.ts       # marketing-specific layout
│   ├── about/
│   │   └── page.ts     # URL is /about (not /marketing/about)
│   └── pricing/
│       └── page.ts     # URL is /pricing
└── (app)/
    ├── layout.ts       # app-specific layout (authenticated shell)
    └── dashboard/
        └── page.ts     # URL is /dashboard</code-block>

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

    <code-block>app/
├── _lib/
│   ├── db.ts           # not a route, safe to import from pages
│   └── auth.ts
├── _components/
│   └── header.ts       # colocated components, not routed
└── page.ts             # /, can import from _lib/ and _components/</code-block>

    <!-- ===== API ROUTES ===== -->
    <h2>API Routes / Route Handlers (<code>route.ts</code>)</h2>
    <p>
      A <code>route.ts</code> file defines an API endpoint. Instead of a default export,
      you export <strong>named functions for each HTTP method</strong> you want to handle:
      <code>GET</code>, <code>POST</code>, <code>PUT</code>, <code>PATCH</code>, and
      <code>DELETE</code>.
    </p>

    <p>
      Route handlers can live <strong>anywhere</strong> under <code>app/</code>, not
      just inside <code>app/api/</code>. The <code>api/</code> prefix is a convention,
      not a requirement.
    </p>

    <h3>Basic Example</h3>
    <code-block>// app/api/hello/route.ts
export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get('name') || 'world';
  return { hello: name, at: new Date().toISOString() };
}

export async function POST(req: Request) {
  const body = await req.json();
  // ... create resource ...
  return Response.json({ created: true }, { status: 201 });
}</code-block>

    <h3>Handler Signature</h3>
    <p>
      Each handler receives a standard <code>Request</code> object and an optional
      context object with <code>params</code> from dynamic route segments:
    </p>
    <code-block>export async function GET(
  req: Request,
  { params }: { params: Record&lt;string, string&gt; }
): Promise&lt;Response | object&gt;</code-block>

    <ul>
      <li>Return a <code>Response</code> object for full control over status, headers, and body.</li>
      <li>Return a plain object or array and WebJs will automatically serialize it as <code>JSON</code> with a <code>200</code> status.</li>
      <li>If a request arrives for a method you have not exported, WebJs responds with <code>405 Method Not Allowed</code> and an <code>Allow</code> header listing the supported methods.</li>
    </ul>

    <h3>Dynamic API Route</h3>
    <code-block>// app/api/posts/[slug]/route.ts
type Ctx = { params: { slug: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const post = await db.posts.findBySlug(params.slug);
  if (!post) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(post);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  await db.posts.delete(params.slug);
  return Response.json({ deleted: true });
}</code-block>

    <!-- ===== WEBSOCKET ROUTES ===== -->
    <h2>WebSocket Routes</h2>
    <p>
      To handle WebSocket connections, export a <code>WS</code> function from the same
      <code>route.ts</code> file. When a client sends a WebSocket upgrade request to that
      URL, WebJs upgrades the connection and calls your <code>WS</code> handler.
    </p>

    <code-block>// app/api/chat/route.ts
import type { WebSocket } from 'ws';

const clients = new Set&lt;WebSocket&gt;();

// Regular HTTP handler, still works alongside WS
export function GET() {
  return new Response(
    \`Connected clients: \${clients.size}\`,
    { headers: { 'content-type': 'text/plain' } },
  );
}

// WebSocket handler, called on upgrade
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
}</code-block>

    <h3>WS Handler Signature</h3>
    <code-block>export function WS(
  ws: WebSocket,            // the ws library WebSocket instance
  req: Request,             // the original HTTP upgrade request (headers, cookies, etc.)
  ctx: { params: Record&lt;string, string&gt; }  // dynamic route params
): void</code-block>

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

    <code-block>// app/not-found.ts
import { html } from '@webjsdev/core';

export default function NotFound() {
  return html\`
    &lt;h1&gt;404&lt;/h1&gt;
    &lt;p&gt;Page not found.&lt;/p&gt;
    &lt;p&gt;&lt;a href="/"&gt;&amp;larr; Home&lt;/a&gt;&lt;/p&gt;
  \`;
}</code-block>

    <p>
      If no <code>not-found.ts</code> exists, WebJs renders a default
      <code>&lt;h1&gt;404 Not Found&lt;/h1&gt;</code> page.
    </p>

    <!-- ===== ERROR BOUNDARIES ===== -->
    <h2>Error Boundaries (<code>error.ts</code>)</h2>
    <p>
      An <code>error.ts</code> file acts as an <strong>error boundary</strong>. When an
      uncaught error occurs during page rendering, WebJs walks up the folder tree looking
      for the <strong>nearest</strong> <code>error.ts</code> and renders it instead. This
      means error boundaries are nested. A deeply-placed <code>error.ts</code> catches
      errors for its subtree without affecting the rest of the site.
    </p>
    <p>
      The boundary renders <strong>inside the layouts at and above its own segment</strong>,
      so the surrounding chrome stays on screen and a client-router navigation into a
      failing page is still a soft navigation. A layout deeper than the boundary is not
      rendered, since it never rendered on the way in either.
    </p>
    <p>
      A boundary sits inside its own segment's layout, so it cannot catch that layout.
      An error thrown by a layout is handled by the next boundary further out. This is
      Next's rule and it exists for a plain reason: re-running the layout that just threw
      would only throw again.
    </p>

    <code-block>// app/error.ts: root error boundary
import { html } from '@webjsdev/core';

export default function ErrorBoundary({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return html\`
    &lt;h1&gt;Something went wrong&lt;/h1&gt;
    &lt;p&gt;\${message}&lt;/p&gt;
    &lt;p&gt;&lt;a href="/"&gt;Go home&lt;/a&gt;&lt;/p&gt;
  \`;
}</code-block>

    <h3>Nested Error Boundaries</h3>
    <code-block>app/
├── error.ts              # catches errors site-wide
├── dashboard/
│   ├── error.ts          # catches errors only in /dashboard/*
│   ├── page.ts
│   └── settings/
│       └── page.ts       # error here → caught by dashboard/error.ts</code-block>

    <p>
      The error boundary receives the context object (<code>params</code>,
      <code>searchParams</code>, <code>url</code>) along with the <code>error</code>
      property. Errors from <code>notFound()</code> and <code>redirect()</code> are
      <strong>not</strong> caught by error boundaries. Those are handled specially by the
      framework. A <code>not-found.ts</code>, <code>forbidden.ts</code> or
      <code>unauthorized.ts</code> boundary receives that same context object and is
      wrapped in its layouts the same way.
    </p>

    <!-- ===== METADATA ===== -->
    <h2>Metadata</h2>
    <p>
      WebJs supports two ways to define page metadata (title, description, Open Graph
      tags, etc.):
    </p>

    <h3>Static Metadata</h3>
    <p>Export a <code>metadata</code> object from any page or layout:</p>
    <code-block>// app/about/page.ts
import { html } from '@webjsdev/core';

export const metadata = {
  title: 'About | My App',
  description: 'Learn more about our company.',
  openGraph: {
    title: 'About Us',
    description: 'We build cool things.',
  },
};

export default function About() {
  return html\`&lt;h1&gt;About&lt;/h1&gt;\`;
}</code-block>

    <h3>Dynamic Metadata (<code>generateMetadata</code>)</h3>
    <p>
      Export an async <code>generateMetadata</code> function for metadata that depends on
      route params or data fetching:
    </p>
    <code-block>// app/blog/[slug]/page.ts
import { html } from '@webjsdev/core';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const post = await db.posts.findBySlug(params.slug);
  return post
    ? { title: \`\${post.title} | My Blog\` }
    : { title: 'Not found | My Blog' };
}

export default async function PostPage({ params }: { params: { slug: string } }) {
  // ...
}</code-block>

    <h3>Metadata Merging</h3>
    <p>
      Metadata is collected from the outermost layout to the page. Later values
      <strong>override</strong> earlier ones, so a page's metadata takes precedence over
      its layout's metadata. Supported fields include:
    </p>
    <ul>
      <li><code>title</code>: sets <code>&lt;title&gt;</code></li>
      <li><code>description</code>: sets <code>&lt;meta name="description"&gt;</code></li>
      <li><code>viewport</code>: sets <code>&lt;meta name="viewport"&gt;</code> (defaults to <code>width=device-width,initial-scale=1</code>)</li>
      <li><code>themeColor</code>: sets <code>&lt;meta name="theme-color"&gt;</code></li>
      <li><code>openGraph</code>: an object of Open Graph properties (keys become <code>og:key</code>)</li>
      <li><code>preload</code>: an array of <code>&lt;link rel="preload"&gt;</code> entries (e.g. fonts, images)</li>
    </ul>

    <!-- ===== NAVIGATION HELPERS ===== -->
    <h2>Navigation Helpers</h2>
    <p>
      WebJs exports four navigation primitives from <code>'@webjsdev/core'</code> -
      two for the server (sentinel-throw helpers) and two for the client (programmatic
      nav + cache invalidation).
    </p>

    <h3><code>notFound()</code></h3>
    <p>
      Aborts rendering and returns a <code>404</code> response. If a
      <code>not-found.ts</code> exists at the app root, it is rendered.
    </p>
    <code-block>import { html, notFound } from '@webjsdev/core';

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await db.posts.findBySlug(params.slug);
  if (!post) notFound();  // stops execution, returns 404

  return html\`&lt;h1&gt;\${post.title}&lt;/h1&gt;\`;
}</code-block>

    <h3><code>redirect(url, status?)</code></h3>
    <p>
      Aborts rendering and returns a redirect response. When you do not pass a
      status, the catching site picks the conventional one: a redirect thrown
      during a <strong>GET</strong> page or layout render (a gate, an auth
      bounce) becomes <code>302</code> Found, the usual GET-to-GET code; a
      redirect thrown from a <strong>server action</strong> (a POST) becomes
      <code>307</code> Temporary Redirect, which is method-preserving so the
      action's intent survives. Pass an explicit status to override either
      default: positionally as <code>redirect('/x', 308)</code>, or with the
      options form <code>redirect('/x', { status: 301 })</code>.
    </p>
    <code-block>import { redirect } from '@webjsdev/core';

export default async function ProtectedPage() {
  const user = await getSession();
  if (!user) redirect('/login');               // GET gate -> 302 Found
  // if (!user) redirect('/login', 308);        // override -> 308 permanent
  // if (!user) redirect('/login', { status: 301 }); // options form

  return html\`&lt;h1&gt;Welcome, \${user.name}&lt;/h1&gt;\`;
}</code-block>
    <p>
      Inside a server action, the same <code>redirect('/somewhere')</code>
      defaults to <code>307</code> instead, so a POST that bounces keeps its
      method. The Post/Redirect/Get success path (returning
      <code>{ success: true, redirect }</code>) is separate and always uses
      <code>303</code> See Other.
    </p>

    <p>
      Both server helpers can be called from pages, layouts, and
      <code>generateMetadata</code> functions, anywhere in the server-side rendering
      chain.
    </p>

    <h3><code>navigate(url, opts?)</code></h3>
    <p>
      Programmatic client-side navigation. Use instead of
      <code>location.href = ...</code> to keep the partial-swap behavior. Pushes a
      history entry by default; pass <code>{ replace: true }</code> to replace.
    </p>
    <code-block>import { navigate } from '@webjsdev/core';
await navigate('/about');
await navigate('/login', { replace: true });</code-block>

    <h3><code>revalidate(url?)</code></h3>
    <p>
      Evict a cached snapshot from the client router's back/forward cache. Call after
      a JS-initiated server-action mutation so the next visit to that URL refetches
      instead of restoring stale data. Omit the argument to clear the whole cache.
      Form submissions through the router clear the cache automatically on mutating
      methods. You only need <code>revalidate()</code> for mutations that bypass the
      form pipeline.
    </p>
    <code-block>import { revalidate } from '@webjsdev/core';
revalidate('/products/123');  // evict one URL
revalidate();                 // clear the whole cache</code-block>

    <!-- ===== LOADING ===== -->
    <h2>Loading UI (<code>loading.ts</code>)</h2>
    <p>
      The <code>loading.ts</code> file convention provides <strong>automatic
      Suspense boundaries</strong>. When placed in a route folder, it defines a loading
      UI that will be shown while the page's async content is being resolved.
    </p>

    <code-block>// app/dashboard/loading.ts  (reserved for future Suspense integration)
import { html } from '@webjsdev/core';

export default function Loading() {
  return html\`
    &lt;div class="skeleton"&gt;
      &lt;div class="skeleton-line"&gt;&lt;/div&gt;
      &lt;div class="skeleton-line short"&gt;&lt;/div&gt;
    &lt;/div&gt;
  \`;
}</code-block>

    <p>
      WebJs automatically wraps the sibling page in a Suspense boundary with the
      loading content as the fallback. The page content streams in when ready,
      replacing the loading UI. No manual <code>Suspense()</code> call required.
    </p>
    <p>
      On client-side navigation, the same <code>loading.ts</code> is also cloned into
      the swap slot for instant feedback. The SSR pipeline emits each segment's
      loading template as a hidden
      <code>&lt;template id="wj-loading:&lt;segment-path&gt;"&gt;</code>; the router
      clones the deepest matching template into the active swap region the moment a
      link is clicked. See the
      <a href="/docs/loading-states">Loading States</a> page for the full mechanism.
    </p>

    <!-- ===== SUMMARY ===== -->
    <h2>Route Resolution Order</h2>
    <p>When a request arrives, WebJs resolves it in this order:</p>
    <ol>
      <li><strong>Static file</strong>: if a file exists in the project's public/static directory, it is served directly.</li>
      <li><strong>API route</strong>: <code>route.ts</code> handlers are matched against the URL. WebSocket upgrades also match here.</li>
      <li><strong>Page route</strong>: <code>page.ts</code> files are matched by positional specificity (segment by segment, a static segment beats a dynamic one beats a catch-all, so the catch-all kind is lowest at its position rather than blanket-last), with ties broken by a stable alphabetical key rather than file order.</li>
      <li><strong>Not found</strong>: if nothing matches, <code>not-found.ts</code> is rendered with a <code>404</code> status.</li>
    </ol>

    <h2>Quick Reference</h2>
    <code-block>File              Purpose                              Example URL
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
_private/         Private folder (excluded)            not routable</code-block>
  `;
}
