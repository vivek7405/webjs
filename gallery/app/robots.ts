// app/robots.ts serves /robots.txt. The default export returns a string (served
// as text/plain) or an object. This example allows all crawlers and points them
// at the sitemap. Tighten the rules (Disallow paths) for a real app.
const SITE_URL = (process.env.SITE_URL || 'http://localhost:8080').replace(/\/$/, '');

export default function Robots() {
  return [
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
  ].join('\n');
}
