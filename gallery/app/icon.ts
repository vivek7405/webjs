// app/icon.ts serves /icon (a dynamic favicon). The default export is a
// (possibly async) server function; returning a Response lets you set the exact
// content type, so an inline SVG needs no asset file. Generate it dynamically
// (per-theme, per-tenant) when the mark must be computed at request time.
//
// This is the DEMO of that surface, not the gallery's own favicon. A metadata
// route is not auto-linked: the framework emits `<link rel="icon">` only from
// metadata.icons, so the gallery declares the static WebJs brand mark from
// public/ there (see app/layout.ts) and this route stays browsable at /icon.
// For a favicon that never changes, that static path is the one to copy; drop
// this route when your app has no request-time mark to compute.
export default function Icon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill="#1e2226"/>
    <text x="16" y="22" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="#94989c" text-anchor="middle">w</text>
  </svg>`;
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' },
  });
}
