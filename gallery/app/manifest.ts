// app/manifest.ts serves /manifest.json (the web app manifest). The default
// export returns an object, serialized to JSON. Adapt the name, colors, and
// icons to your app; pair it with the opt-in service worker for an installable
// PWA. See agent-docs/service-worker.md. (Gallery files are copied verbatim, so
// set the real app name here by hand rather than expecting substitution.)
export default function Manifest() {
  return {
    name: 'webjs app',
    short_name: 'webjs app',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1e2226',
    icons: [
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
