// app/sitemap.ts serves /sitemap.xml. The default export is a (possibly async)
// server function; `sitemap(entries)` from @webjsdev/server serializes a
// spec-valid XML sitemap. In a real app, build the entries from your content
// (a query over posts/products), so new content is discoverable without editing
// this file. Here it lists the gallery's static routes as an example.
import { sitemap } from '@webjsdev/server';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:8080').replace(/\/$/, '');

export default function Sitemap() {
  const routes = ['/', '/features/routing', '/features/boundaries'];
  return sitemap(
    routes.map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: 'weekly' as const,
      priority: path === '/' ? 1.0 : 0.7,
    })),
  );
}
