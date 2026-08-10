// app/twitter-image.ts serves /twitter-image (the card image shown when the
// site is shared on Twitter/X). Its own route so the Twitter card can differ
// from the Open Graph image (opengraph-image.ts); when they are identical, drop
// this file and let the OG image cover both. A `summary_large_image` card wants
// roughly 1200x630. Reference it via metadata `twitter: { images: [...] }`.
export default function TwitterImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#1e2226"/>
    <text x="80" y="330" font-family="system-ui, sans-serif" font-size="88" font-weight="700" fill="#dee2e6">My App</text>
    <text x="80" y="410" font-family="system-ui, sans-serif" font-size="36" fill="#94989c">Build on the platform, not against it</text>
  </svg>`;
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' },
  });
}
