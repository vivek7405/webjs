// app/opengraph-image.ts serves /opengraph-image (the preview card social
// platforms show when the site is shared). The Open Graph spec wants 1200x630.
// Returning a Response with an inline SVG keeps this buildless; for per-page
// previews, read the request in a nested static segment's opengraph-image.ts
// and compose the title in. Reference it from metadata via
// `openGraph: { images: ['/opengraph-image'] }`.
export default function OpengraphImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#1e2226"/>
    <text x="80" y="330" font-family="system-ui, sans-serif" font-size="88" font-weight="700" fill="#dee2e6">My App</text>
    <text x="80" y="410" font-family="system-ui, sans-serif" font-size="36" fill="#94989c">Build on the platform, not against it</text>
  </svg>`;
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' },
  });
}
