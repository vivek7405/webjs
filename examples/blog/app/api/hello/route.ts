/**
 * GET /api/hello — returns a JSON greeting.
 * Any object returned from an API handler is auto-serialised as JSON;
 * return a Response directly for full control.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get('name') || 'world';
  return { hello: name, at: new Date().toISOString() };
}
