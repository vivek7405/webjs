// A sitemap INDEX: for a large site split across several sitemaps, this points
// crawlers at each child sitemap. `sitemapIndex(sitemaps)` (from @webjsdev/server)
// serializes the spec-valid <sitemapindex> XML, the counterpart of `sitemap(entries)`
// in app/sitemap.ts (the single-file case). A route.ts serves it at /sitemaps;
// in a real app the children would be sharded (posts, products, ...).
import { sitemapIndex } from '@webjsdev/server';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:8080').replace(/\/$/, '');

export async function GET() {
  return new Response(
    sitemapIndex([
      { url: `${SITE_URL}/sitemap.xml` },
    ]),
    { headers: { 'content-type': 'application/xml; charset=utf-8' } },
  );
}
