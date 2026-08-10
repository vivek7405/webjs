// app/icon.ts serves /icon (the dynamic favicon). The default export is a
// (possibly async) server function; returning a Response lets you set the exact
// content type, so an inline SVG needs no asset file. For a favicon that never
// changes, put a static file in public/ instead (e.g. public/favicon.ico) and
// delete this route. Generate it dynamically (per-theme, per-tenant) when the
// mark must be computed at request time.
export default function Icon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="#1e2226"/>
    <text x="16" y="22" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="#94989c" text-anchor="middle">w</text>
  </svg>`;
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' },
  });
}
