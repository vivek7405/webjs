// A route.ts is a server-only HTTP handler (named GET / POST / PUT / PATCH /
// DELETE exports). It is NOT isomorphic and never ships to the client, the webjs
// equivalent of a Next route handler. A folder cannot have BOTH page.ts and
// route.ts, so this endpoint lives one segment deeper, at
// /features/route-handler/data.
//
// `json(data)` (from @webjsdev/server) responds with the WebJs rich serializer,
// so a `Date` (or Map / Set / BigInt) round-trips as its real type when the
// caller uses `richFetch` (see modules/route-handler/components/rich-data.ts).
// The request accessors read the IN-FLIGHT request from context: `headers()`,
// `cookies()`, and `requestId()` take no argument (they read the active
// request), while `clientIp(req)` and `readBody(req)` take it explicitly.
import { json, headers, cookies, clientIp, requestId, cspNonce, readBody } from '@webjsdev/server';

export async function GET(req: Request) {
  return json({
    ok: true,
    at: new Date(), // a real Date; richFetch decodes it back to a Date, not a string
    ip: clientIp(req),
    requestId: requestId(),
    userAgent: headers().get('user-agent') ?? 'unknown',
    // cookies() reads the REQUEST cookies. Report how many are present (a
    // truthful, always-correct value); the app's theme lives in localStorage,
    // not a cookie, so do not read it here.
    cookieCount: cookies().entries().length,
    // cspNonce() reads the request's CSP nonce ('' with CSP off). Server-side
    // you use it to nonce a server-rendered inline <script> under CSP (a <style>
    // only needs it if you tighten style-src, which by default allows inline).
    hasNonce: cspNonce().length > 0,
  });
}

export async function POST(req: Request) {
  // readBody(req) parses the request body (the inverse of json()): rich types
  // sent by richFetch are decoded here.
  const body = await readBody(req);
  return json({ echoed: body, at: new Date() });
}
