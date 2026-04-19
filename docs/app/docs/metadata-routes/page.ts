import { html } from '@webjskit/core';

export const metadata = { title: 'Metadata Routes — webjs' };

export default function MetadataRoutes() {
  return html`
    <h1>Metadata Routes</h1>
    <p>webjs supports special route files that generate SEO and PWA metadata: sitemaps, robots.txt, web manifest, favicons, and Open Graph images. These files export a function and the framework serves the output at the standard URL.</p>

    <h2>When to use</h2>
    <ul>
      <li>Dynamic sitemaps generated from your database (e.g. all blog post URLs).</li>
      <li>Environment-aware robots.txt (allow everything in production, block staging).</li>
      <li>Dynamic favicons or OG images (e.g. per-post preview images).</li>
    </ul>

    <h2>When NOT to use</h2>
    <ul>
      <li>For static files that never change — put them in <code>public/</code> instead (e.g. <code>public/favicon.ico</code>).</li>
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
    <pre>// app/sitemap.ts
import { prisma } from '../lib/prisma.ts';

export default async function sitemap() {
  const posts = await prisma.post.findMany({ select: { slug: true, updatedAt: true } });
  return [
    { url: 'https://example.com/', lastModified: new Date() },
    ...posts.map(p => ({
      url: ${'`https://example.com/blog/${p.slug}`'},
      lastModified: p.updatedAt,
    })),
  ];
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
    <p>For per-page title, description, and Open Graph tags, export a <code>metadata</code> object from any <code>page.ts</code>:</p>

    <pre>// app/blog/[slug]/page.ts
export const metadata = {
  title: 'My Post — Blog',
  description: 'A post about webjs',
  openGraph: { title: 'My Post', type: 'article' },
};</pre>

    <p>The SSR pipeline reads <code>metadata</code> and injects <code>&lt;title&gt;</code>, <code>&lt;meta&gt;</code>, and <code>&lt;meta property="og:..."&gt;</code> tags into the HTML head.</p>

    <h2>Constraints</h2>
    <ul>
      <li>Metadata route files must live at the root or in static segments — not inside <code>[dynamic]</code> folders.</li>
      <li>They are scanned at server startup, not on every request.</li>
    </ul>

    <h2>Next steps</h2>
    <ul>
      <li><a href="/docs/routing">Routing</a> — file conventions for pages and layouts</li>
      <li><a href="/docs/ssr">Server-Side Rendering</a> — how metadata is injected into HTML</li>
      <li><a href="/docs/deployment">Deployment</a> — serving metadata in production</li>
    </ul>
  `;
}
