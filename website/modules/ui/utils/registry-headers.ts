/**
 * Response headers shared by every /ui/registry endpoint.
 *
 * `Access-Control-Allow-Origin: *` is deliberate and load-bearing: the
 * registry is a public read-only API that `webjs ui add` fetches from
 * arbitrary machines, and the old ui.webjs.dev endpoints sent it too. Dropping
 * it here would break browser-context consumers that work today.
 *
 * Declared once so the three route handlers cannot drift apart on caching or
 * CORS, which is exactly the kind of difference nothing would catch until a
 * shipped CLI hit the one endpoint that changed.
 */
export const REGISTRY_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60',
  'Access-Control-Allow-Origin': '*',
};
