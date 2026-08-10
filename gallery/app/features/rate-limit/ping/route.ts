// The rate-limited endpoint. A plain GET route handler: it just reports success.
// The rateLimit() middleware in this folder runs BEFORE it and stamps the
// X-RateLimit-* headers onto the response (and returns a 429 once the window is
// exhausted, so this handler never runs on a limited request).
export function GET() {
  return Response.json({ ok: true, at: new Date().toISOString() });
}
