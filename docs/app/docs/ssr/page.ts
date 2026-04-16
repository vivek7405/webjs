import { html } from 'webjs';

export const metadata = { title: 'Server-Side Rendering — webjs' };

export default function SSR() {
  return html`
    <h1>Server-Side Rendering</h1>
    <p>Every webjs page is <strong>server-rendered by default</strong>. There is no client-only mode and no opt-in flag. When a request arrives, the server executes your page function, renders the result to an HTML string, injects Declarative Shadow DOM for every web component that appeared, and streams the response. The browser paints meaningful content before a single byte of JavaScript has been parsed.</p>

    <h2>How SSR Works</h2>
    <p>Pages are plain async functions that return <code>html\`\`</code> tagged templates (a <code>TemplateResult</code>). The server imports the page module, calls its default export, and passes the result through <code>renderToString()</code>. That function walks the template tree, resolves every <code>Promise</code> it encounters in template holes, and produces a complete HTML string.</p>

    <pre>// app/page.ts
import { html } from 'webjs';

export const metadata = { title: 'Home' };

export default async function Home() {
  const posts = await db.post.findMany({ take: 10 });
  return html\`
    &lt;h1&gt;Latest Posts&lt;/h1&gt;
    &lt;ul&gt;
      \${posts.map(p =&gt; html\`&lt;li&gt;\${p.title}&lt;/li&gt;\`)}
    &lt;/ul&gt;
  \`;
}</pre>

    <p>Because Node 23.6+ strips TypeScript types natively, no compilation step is needed. The file above runs directly on the server.</p>

    <h2>The SSR Pipeline</h2>
    <p>When the server receives a GET request for a page URL, the pipeline runs in this order:</p>
    <ol>
      <li><strong>Route match</strong> -- the router scans the <code>app/</code> directory tree (at startup) and matches the URL pathname against the file-based route table. Dynamic segments (<code>[slug]</code>), catch-all segments (<code>[...rest]</code>), and route groups (<code>(marketing)</code>) all follow Next.js App Router conventions.</li>
      <li><strong>103 Early Hints</strong> -- before SSR begins, the server calls <code>res.writeEarlyHints()</code> with <code>&lt;link rel="modulepreload"&gt;</code> headers for every module URL that the page will need (the page file itself, its layout chain, and any web component modules discovered on a previous render). This lets the browser start fetching scripts while the server is still computing HTML.</li>
      <li><strong>Segment middleware</strong> -- if any <code>middleware.ts</code> files exist on the path from root to the matched route, they execute outermost-first as a chain: <code>(req, next) =&gt; Response</code>.</li>
      <li><strong>Load page module</strong> -- the server dynamically imports the matched <code>page.ts</code> file. In dev mode, a cache-busting query string is appended to the import URL so edits take effect immediately without restarting.</li>
      <li><strong>Load layout chain</strong> -- layout files are loaded outermost-first (<code>app/layout.ts</code>, then <code>app/blog/layout.ts</code>, etc.). Each layout wraps the previous result via its <code>children</code> prop.</li>
      <li><strong>Collect metadata</strong> -- each layout and the page can export a <code>metadata</code> object or a <code>generateMetadata(ctx)</code> async function. Metadata is merged page-wins so the innermost file's title takes precedence.</li>
      <li><strong>renderToString</strong> -- the fully-nested template tree is rendered to an HTML string. Promises in template holes are awaited. Arrays and <code>repeat()</code> iterables are expanded.</li>
      <li><strong>injectDSD</strong> -- the rendered HTML is scanned for registered custom element tags. For each one found, the server instantiates the component class, applies attributes, calls its <code>render()</code> method (which may be async), and wraps the output in a <code>&lt;template shadowrootmode="open"&gt;</code> element immediately after the opening tag. Scoped <code>css\`\`</code> styles are included inside the template.</li>
      <li><strong>Stream response</strong> -- the fully rendered document (or its initial chunk plus Suspense boundaries) is sent as a streaming <code>text/html</code> response.</li>
    </ol>

    <h2>Declarative Shadow DOM (DSD)</h2>
    <p>Declarative Shadow DOM is the key technology that makes web component SSR work without a hydration runtime. When the server renders a custom element like <code>&lt;my-counter count="5"&gt;</code>, the output looks like this:</p>

    <pre>&lt;my-counter count="5"&gt;
  &lt;template shadowrootmode="open"&gt;
    &lt;style&gt;:host { display: inline-flex; gap: 8px; } ...&lt;/style&gt;
    &lt;button&gt;-&lt;/button&gt;
    &lt;span&gt;5&lt;/span&gt;
    &lt;button&gt;+&lt;/button&gt;
  &lt;/template&gt;
&lt;/my-counter&gt;</pre>

    <p>The browser's HTML parser recognises <code>&lt;template shadowrootmode="open"&gt;</code> and immediately attaches a shadow root with that content. This happens during parsing, before any JavaScript runs. The result is:</p>
    <ul>
      <li><strong>First paint before JS loads</strong> -- the component's styled markup is visible as soon as the HTML arrives. There is no flash of unstyled content and no layout shift.</li>
      <li><strong>No hydration mismatch</strong> -- the shadow root already exists when the custom element's constructor runs. webjs's <code>connectedCallback</code> checks for an existing <code>shadowRoot</code> and re-renders into it rather than creating a new one.</li>
      <li><strong>Scoped styles for free</strong> -- the <code>&lt;style&gt;</code> inside the shadow root is scoped by the browser's native shadow DOM encapsulation. No CSS-in-JS runtime is needed.</li>
    </ul>

    <h3>Components Without Shadow DOM</h3>
    <p>If a component sets <code>static shadow = false</code>, DSD injection is skipped. The component renders into the light DOM and its styles are not scoped. This is useful for components that need to participate in the parent document's layout or inherit global styles.</p>

    <h2>Async Rendering</h2>
    <p>Pages, layouts, and components can all be async. The server awaits every level of the render tree:</p>

    <pre>// app/posts/[slug]/page.ts
import { html } from 'webjs';
import '../../components/post-card.ts';

export default async function PostPage({ params }: { params: { slug: string } }) {
  const post = await db.post.findUnique({ where: { slug: params.slug } });
  if (!post) throw notFound();
  return html\`
    &lt;post-card
      title="\${post.title}"
      body="\${post.body}"
      date="\${post.createdAt.toISOString()}"&gt;
    &lt;/post-card&gt;
  \`;
}</pre>

    <p>The component's <code>render()</code> method can also be async. During SSR, if <code>render()</code> returns a Promise, <code>injectDSD</code> awaits it before serialising the shadow root contents.</p>

    <h2>Streaming SSR with Suspense</h2>
    <p>Not every data fetch should block the initial HTML flush. The <code>Suspense</code> function creates a boundary that streams deferred content after the initial paint:</p>

    <pre>import { html, Suspense } from 'webjs';

export default function CataloguePage() {
  return html\`
    &lt;h1&gt;Catalogue&lt;/h1&gt;
    \${Suspense({
      fallback: html\`&lt;p&gt;Loading items...&lt;/p&gt;\`,
      children: loadExpensiveItems(),
    })}
  \`;
}

async function loadExpensiveItems() {
  const items = await db.item.findMany();
  return html\`&lt;ul&gt;\${items.map(i =&gt; html\`&lt;li&gt;\${i.name}&lt;/li&gt;\`)}&lt;/ul&gt;\`;
}</pre>

    <p>Here is how streaming works under the hood:</p>
    <ol>
      <li>The server renders the page. When it encounters a Suspense boundary, it emits the fallback HTML wrapped in a <code>&lt;webjs-boundary id="s1"&gt;</code> element and records the children Promise.</li>
      <li>The initial HTML chunk (everything up to and including all fallbacks) is flushed to the browser immediately. The response stream stays open.</li>
      <li>A tiny inline script is included in the <code>&lt;head&gt;</code> that defines <code>window.__webjsResolve(id)</code> -- a function that swaps a boundary's fallback for real content.</li>
      <li>As each Suspense promise resolves, the server renders the resolved content and streams it as a <code>&lt;template data-webjs-resolve="s1"&gt;...&lt;/template&gt;</code> followed by an inline script calling <code>__webjsResolve("s1")</code>.</li>
      <li>The browser receives each chunk, the script runs, and the fallback is replaced with the real content. No framework JS is needed -- it is a plain DOM <code>replaceWith()</code>.</li>
    </ol>
    <p>Nested Suspense is supported: resolved content can itself contain Suspense boundaries, which are emitted and resolved in subsequent streaming chunks.</p>

    <h2>Client Upgrade</h2>
    <p>After the browser has painted the SSR'd HTML, it loads the page's ES modules (as <code>&lt;script type="module"&gt;</code> imports). When a custom element's module loads:</p>
    <ol>
      <li>The class is registered via <code>customElements.define()</code> (called by <code>Counter.register(import.meta.url)</code>).</li>
      <li>The browser upgrades every instance of that tag in the document, calling <code>connectedCallback()</code>.</li>
      <li>In <code>connectedCallback</code>, if <code>this.shadowRoot</code> already exists (from DSD), webjs skips <code>attachShadow()</code> and re-renders into the existing shadow root. This means the DSD content serves as the initial paint, and the client render just adds event listeners and reactive bindings.</li>
      <li>The fine-grained client renderer preserves focus, cursor position, scroll offset, and form state across subsequent state updates.</li>
    </ol>

    <h2>Metadata in &lt;head&gt;</h2>
    <p>The SSR pipeline collects metadata from the layout chain and the page, then injects it into the document <code>&lt;head&gt;</code>. You declare metadata via a named export:</p>

    <pre>// Static metadata
export const metadata = {
  title: 'Blog Post Title — My App',
  description: 'A summary for search engines and social cards.',
  viewport: 'width=device-width, initial-scale=1',
  themeColor: '#1a1a1a',
  openGraph: {
    title: 'Blog Post Title',
    description: 'A summary for social cards.',
    image: 'https://example.com/og.png',
    url: 'https://example.com/posts/hello',
  },
  preload: [
    { href: '/fonts/inter.woff2', as: 'font', type: 'font/woff2', crossorigin: '' },
  ],
};</pre>

    <p>Or generate it dynamically based on route params:</p>

    <pre>export async function generateMetadata({ params }: { params: { slug: string } }) {
  const post = await db.post.findUnique({ where: { slug: params.slug } });
  return {
    title: post ? post.title + ' — My App' : 'Not Found',
    description: post?.summary,
    openGraph: post ? { title: post.title, image: post.coverImage } : undefined,
  };
}</pre>

    <p>Metadata is merged outermost-layout-first, page-last. The page's values win when keys conflict. The resulting <code>&lt;head&gt;</code> includes:</p>
    <ul>
      <li><code>&lt;title&gt;</code> -- from <code>metadata.title</code></li>
      <li><code>&lt;meta name="description"&gt;</code> -- from <code>metadata.description</code></li>
      <li><code>&lt;meta name="viewport"&gt;</code> -- defaults to <code>width=device-width,initial-scale=1</code> if not set</li>
      <li><code>&lt;meta name="theme-color"&gt;</code> -- from <code>metadata.themeColor</code></li>
      <li><code>&lt;meta property="og:*"&gt;</code> -- one tag per key in <code>metadata.openGraph</code></li>
      <li><code>&lt;link rel="preload"&gt;</code> -- from <code>metadata.preload</code> array (fonts, images, etc.)</li>
    </ul>

    <h2>Module Preload Hints</h2>
    <p>The SSR pipeline automatically emits <code>&lt;link rel="modulepreload"&gt;</code> tags for:</p>
    <ul>
      <li>The page's own module file</li>
      <li>Every layout in the chain</li>
      <li>Every custom element tag that actually appeared in the rendered HTML</li>
    </ul>
    <p>This breaks the ES module waterfall. Without modulepreload, the browser would discover each component's import only after parsing its parent module. With the hints in the <code>&lt;head&gt;</code>, the browser begins fetching all modules in parallel immediately.</p>
    <p>Component preload discovery works because <code>register(import.meta.url)</code> records the module URL alongside the tag name. During <code>injectDSD</code>, every custom element tag that matched is added to a <code>usedComponents</code> set. After rendering, the set is converted to <code>&lt;link&gt;</code> tags.</p>
    <p>In production bundle mode (when <code>.webjs/bundle.js</code> exists), all per-file preloads are replaced by a single <code>&lt;link rel="modulepreload" href="/__webjs/bundle.js"&gt;</code>.</p>

    <h2>103 Early Hints</h2>
    <p>Before SSR even starts, the server sends HTTP 103 Early Hints to the browser with the same modulepreload URLs that will appear in the <code>&lt;head&gt;</code>. This uses the Node.js <code>res.writeEarlyHints()</code> API. The browser can begin DNS resolution, TLS negotiation, and module fetching while the server is still executing page code and rendering templates.</p>
    <p>Early Hints are sent only in production mode (dev-mode file churn would send stale URLs after rebuilds) and only for GET/HEAD requests to page routes.</p>

    <pre>// Conceptual flow:
// 1. Browser sends GET /blog/hello
// 2. Server matches route, resolves module URLs
// 3. Server sends 103 Early Hints:
//      Link: &lt;/app/blog/[slug]/page.ts&gt;; rel=modulepreload
//      Link: &lt;/app/layout.ts&gt;; rel=modulepreload
//      Link: &lt;/components/post-card.ts&gt;; rel=modulepreload
// 4. Server runs SSR (may take 50-200ms for DB queries)
// 5. Server sends 200 OK with full HTML
// 6. Browser already has modules cached from step 3</pre>

    <h2>Error Handling</h2>
    <p>If a page or layout throws during rendering, the SSR pipeline catches the error and walks up the layout chain looking for the nearest <code>error.ts</code> file. Error boundaries are nested: <code>app/blog/error.ts</code> catches errors in blog pages, while <code>app/error.ts</code> is the outermost fallback.</p>
    <p>Special throw helpers are also caught:</p>
    <ul>
      <li><code>throw notFound()</code> -- renders the <code>not-found.ts</code> page with a 404 status.</li>
      <li><code>throw redirect('/login')</code> -- sends a 307 redirect (or the status you specify).</li>
    </ul>
    <p>In development, unhandled errors show the full stack trace in the browser. In production, only a generic "Something went wrong" message is shown -- no stack traces are leaked to the client.</p>

    <h2>CSRF Cookie</h2>
    <p>Every SSR response that lacks a CSRF cookie automatically sets one: <code>webjs_csrf</code> with <code>SameSite=Lax</code>. This cookie powers the double-submit CSRF protection for server actions. It is set during SSR so that the first client-side action call already has a token to send.</p>

    <h2>Full SSR Example</h2>
    <pre>// app/layout.ts
import { html } from 'webjs';
export const metadata = { title: 'My App' };

export default function RootLayout({ children }: { children: unknown }) {
  return html\`
    &lt;nav&gt;&lt;a href="/"&gt;Home&lt;/a&gt; &lt;a href="/about"&gt;About&lt;/a&gt;&lt;/nav&gt;
    &lt;main&gt;\${children}&lt;/main&gt;
  \`;
}

// app/page.ts
import { html, Suspense } from 'webjs';
import '../components/hero-banner.ts';

export const metadata = {
  title: 'Home — My App',
  description: 'Welcome to my webjs application.',
  openGraph: { title: 'My App', image: '/public/og.png' },
};

export default function Home() {
  return html\`
    &lt;hero-banner headline="Welcome"&gt;&lt;/hero-banner&gt;
    &lt;section&gt;
      \${Suspense({
        fallback: html\`&lt;p&gt;Loading recent posts...&lt;/p&gt;\`,
        children: recentPosts(),
      })}
    &lt;/section&gt;
  \`;
}

async function recentPosts() {
  const posts = await db.post.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
  return html\`
    &lt;ul&gt;
      \${posts.map(p =&gt; html\`&lt;li&gt;&lt;a href="/posts/\${p.slug}"&gt;\${p.title}&lt;/a&gt;&lt;/li&gt;\`)}
    &lt;/ul&gt;
  \`;
}</pre>

    <p>When a browser requests <code>/</code>, it receives the full HTML with the hero banner painted via DSD, the "Loading recent posts..." fallback visible immediately, and (milliseconds later) the real post list streamed in -- all before the page's JavaScript has finished loading.</p>
  `;
}
