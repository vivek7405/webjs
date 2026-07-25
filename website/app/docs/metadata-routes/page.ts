import { html } from '@webjsdev/core';

export const metadata = { title: 'Metadata Routes | WebJs' };

export default function MetadataRoutes() {
  return html`
    <h1>Metadata Routes</h1>
    <p>WebJs supports special route files that generate SEO and PWA metadata: sitemaps, robots.txt, web manifest, favicons, and Open Graph images. These files export a function and the framework serves the output at the standard URL.</p>

    <h2>When to use</h2>
    <ul>
      <li>Dynamic sitemaps generated from your database (e.g. all blog post URLs).</li>
      <li>Environment-aware robots.txt (allow everything in production, block staging).</li>
      <li>Dynamic favicons or OG images (e.g. per-post preview images).</li>
    </ul>

    <h2>When NOT to use</h2>
    <ul>
      <li>For static files that never change. Put them in <code>public/</code> instead (e.g. <code>public/favicon.ico</code>).</li>
    </ul>

    <h2>Supported files</h2>
    <p>Place these at the root of <code>app/</code> or in any static (non-dynamic) route segment:</p>

    <table>
      <tr><th>File</th><th>Served at</th><th>Use case</th></tr>
      <tr><td><code>sitemap.ts</code></td><td><code>/sitemap.xml</code></td><td>XML sitemap for search engines</td></tr>
      <tr><td><code>robots.ts</code></td><td><code>/robots.txt</code></td><td>Crawler directives</td></tr>
      <tr><td><code>manifest.ts</code></td><td><code>/manifest.json</code></td><td>PWA web app manifest</td></tr>
      <tr><td><code>icon.ts</code></td><td><code>/icon</code></td><td>Dynamic favicon</td></tr>
      <tr><td><code>apple-icon.ts</code></td><td><code>/apple-icon</code></td><td>Apple touch icon</td></tr>
      <tr><td><code>opengraph-image.ts</code></td><td><code>/opengraph-image</code></td><td>OG preview image</td></tr>
      <tr><td><code>twitter-image.ts</code></td><td><code>/twitter-image</code></td><td>Twitter card image</td></tr>
    </table>

    <h2>sitemap.ts</h2>
    <p>The <code>sitemap()</code> helper from <code>@webjsdev/server</code> turns an array of entries into spec-valid <code>&lt;urlset&gt;</code> XML for you (escaping each URL, formatting <code>lastModified</code> as a W3C datetime, validating <code>priority</code> and <code>changeFrequency</code>). Return its output from the default export.</p>
    <pre>// app/sitemap.ts
import { sitemap } from '@webjsdev/server';
import { listPostSlugs } from '#modules/blog/queries/list-post-slugs.server.ts';

export default async function () {
  const posts = await listPostSlugs();
  return sitemap([
    { url: 'https://example.com/', lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    ...posts.map(p => ({
      url: ${'`https://example.com/blog/${p.slug}`'},
      lastModified: p.updatedAt,
    })),
  ]);
}</pre>
    <p>Each entry is <code>{ url, lastModified?, changeFrequency?, priority? }</code>. The <code>url</code> is REQUIRED and XML-escaped (a value with <code>&amp;</code> or <code>&lt;</code> cannot break the document). A malformed entry (no <code>url</code>), an out-of-range <code>priority</code>, or an unknown <code>changeFrequency</code> is dropped rather than emitted as broken XML. The helper is OPTIONAL: you can still return a raw string or a <code>Response</code> for full control.</p>

    <h3>Sharding a large site (sitemap index)</h3>
    <p>A single sitemap maxes out at 50,000 URLs. To shard past that, serve each chunk from a <code>route.ts</code> handler and point a root <code>sitemapIndex()</code> at them. Both helpers share the same escaping + date rules.</p>
    <pre>// app/sitemaps/[shard]/route.ts
import { sitemap } from '@webjsdev/server';
import { listShardUrls } from '#modules/blog/queries/list-shard-urls.server.ts';

export async function GET(req: Request, { params }: { params: { shard: string } }) {
  const entries = await listShardUrls(params.shard);
  return new Response(sitemap(entries), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}</pre>
    <pre>// app/sitemap.ts (the index)
import { sitemapIndex } from '@webjsdev/server';

export default function () {
  return sitemapIndex([
    { url: 'https://example.com/sitemaps/posts.xml', lastModified: new Date() },
    { url: 'https://example.com/sitemaps/pages.xml' },
  ]);
}</pre>

    <h2>robots.ts</h2>
    <pre>// app/robots.ts
export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: 'https://example.com/sitemap.xml',
  };
}</pre>

    <h2>manifest.ts</h2>
    <pre>// app/manifest.ts
export default function manifest() {
  return {
    name: 'My App',
    short_name: 'App',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#000000',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  };
}</pre>

    <h2>Page-level metadata</h2>
    <p>For per-page title, description, and Open Graph tags, export a <code>metadata</code> object from any <code>page.ts</code>. Annotate it with the <code>Metadata</code> type (imported from <code>@webjsdev/core</code>) so a misspelled field or a wrong-typed value is a compile-time error:</p>

    <pre>// app/blog/[slug]/page.ts
import type { Metadata } from '@webjsdev/core';

export const metadata: Metadata = {
  title: 'My Post | Blog',
  description: 'A post about webjs',
  openGraph: { title: 'My Post', type: 'article' },
};</pre>

    <p>The SSR pipeline reads <code>metadata</code> and injects <code>&lt;title&gt;</code>, <code>&lt;meta&gt;</code>, and <code>&lt;meta property="og:..."&gt;</code> tags into the HTML head. For a request-scoped title (a dynamic route building its metadata from the loaded record), export an async <code>generateMetadata(ctx)</code> returning <code>Promise&lt;Metadata&gt;</code> instead. See <a href="/docs/typescript">TypeScript</a> for the typed-metadata surface.</p>

    <h3>JSON-LD structured data</h3>
    <p><code>metadata.jsonLd</code> emits schema.org structured data as one or more <code>&lt;script type="application/ld+json"&gt;</code> blocks in <code>&lt;head&gt;</code>. This is the highest-leverage modern SEO surface (Google's Article, Product, BreadcrumbList, Organization, and FAQ rich results all read it). WebJs stays true to its no-build identity here. JSON-LD is a web standard rendered as a plain script tag, so the framework ONLY serializes and escapes. There is no schema library and no validation, so you own the schema.org object.</p>
    <p>A single object emits one script:</p>
    <pre>import type { Metadata } from '@webjsdev/core';

export const metadata: Metadata = {
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'How webjs ships zero dead JS',
    author: { '@type': 'Person', name: 'Vivek' },
    datePublished: '2026-06-01',
    image: 'https://example.com/og.png',
  },
};</pre>
    <p>An array emits one script PER element, so you can ship several graphs for one page (a Product alongside its BreadcrumbList, say). Per-request data works the same way through <code>generateMetadata</code>, so a dynamic route can build the Article from the loaded record.</p>
    <pre>import type { Metadata, MetadataContext } from '@webjsdev/core';

export async function generateMetadata(ctx: MetadataContext): Promise&lt;Metadata&gt; {
  const post = await getPost(ctx.params.slug);   // via a server query
  return {
    title: post.title,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      datePublished: post.publishedAt,
      author: { '@type': 'Person', name: post.authorName },
    },
  };
}</pre>
    <p>The serialized JSON is HTML-safe-escaped automatically. <code>&lt;</code>, <code>&gt;</code>, <code>&amp;</code>, and the line separators U+2028 / U+2029 are replaced with their JSON Unicode escapes, so the literal byte sequence <code>&lt;/script&gt;</code> can never form in the served HTML (a value containing <code>&lt;/script&gt;</code> cannot break out of the script tag). You escape nothing yourself. The block is a NON-EXECUTABLE data island, so a Content-Security-Policy <code>script-src</code> does not gate it and it carries NO nonce. The framework fails SAFE per element: an entry that is not a plain object, or one with a circular reference <code>JSON.stringify</code> cannot serialize, is skipped (with a one-line <code>console.warn</code>) rather than breaking the rest of the head. Absent <code>jsonLd</code> emits nothing.</p>

    <h3>Connection-warming: <code>preconnect</code> / <code>dnsPrefetch</code></h3>
    <p>Warm a cross-origin connection the page is about to use (an API host, a font / image CDN) so the browser pays the DNS + TLS + TCP cost ahead of the first real request (#243):</p>
    <pre>import type { Metadata } from '@webjsdev/core';

export const metadata: Metadata = {
  preconnect: [
    'https://api.example.com',                              // bare URL
    { url: 'https://fonts.gstatic.com', crossorigin: true },// crossorigin set
  ],
  dnsPrefetch: 'https://analytics.example.com',             // a single URL
};</pre>
    <ul>
      <li><strong>preconnect</strong> emits <code>&lt;link rel="preconnect" href="..." [crossorigin]&gt;</code>, warming DNS + TLS + TCP. Each entry is a URL string or <code>{ url, crossorigin? }</code> (<code>crossorigin: true</code> emits a bare <code>crossorigin</code>; a string like <code>'anonymous'</code> emits its value). A font CDN needs <code>crossorigin</code>.</li>
      <li><strong>dnsPrefetch</strong> emits <code>&lt;link rel="dns-prefetch" href="..."&gt;</code>, which resolves DNS only (a lighter-weight precursor that never carries <code>crossorigin</code>).</li>
      <li>Each field takes a URL string, the object form, or an array of either. Every href is HTML-escaped.</li>
    </ul>
    <p><strong>Auto vendor preconnect.</strong> For an UNPINNED app resolving vendors live from a cross-origin CDN, the framework auto-emits ONE <code>&lt;link rel="preconnect" href="&lt;cdn-origin&gt;" crossorigin&gt;</code> (the resolved vendor CDN origin, e.g. <code>https://ga.jspm.io</code>, derived from the importmap so a <code>--from jsdelivr</code> app preconnects to jsdelivr), so the browser warms that connection before the importmap resolves. It is DEDUPED against an author-declared <code>preconnect</code> to the same origin, and NONE is emitted for a same-origin pinned app (vendors served from the app's own origin) or an app with no cross-origin vendors.</p>

    <h2>Constraints</h2>
    <ul>
      <li>Metadata route files must live at the root or in static segments, not inside <code>[dynamic]</code> folders.</li>
      <li>They are scanned at server startup, not on every request.</li>
    </ul>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/routing">Routing</a>: file conventions for pages and layouts</li>
      <li><a href="/docs/ssr">Server-Side Rendering</a>: how metadata is injected into HTML</li>
      <li><a href="/docs/deployment">Deployment</a>: serving metadata in production</li>
    </ul>
  `;
}
