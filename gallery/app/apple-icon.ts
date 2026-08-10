// app/apple-icon.ts serves /apple-icon (the Apple touch icon iOS uses when a
// visitor adds the site to their home screen). Apple expects a 180x180 square
// with no rounded corners (iOS rounds them). Same shape as icon.ts: return a
// Response with the exact content type. Swap the inline SVG for your real mark.
export default function AppleIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
    <rect width="180" height="180" fill="#1e2226"/>
    <text x="90" y="120" font-family="system-ui, sans-serif" font-size="104" font-weight="700" fill="#94989c" text-anchor="middle">w</text>
  </svg>`;
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' },
  });
}
