// getSession(req) reads the Session for the in-flight request (populated by the
// session middleware one level up). It is a small key/value store with .get() /
// .set() / .flash() / .destroy(); mutating it makes the middleware re-sign and
// set the cookie on the way out. Here each request bumps a per-visitor counter.
import { json, getSession } from '@webjsdev/server';

export async function GET(req: Request) {
  const s = getSession(req);
  const count = (Number(s.get('count')) || 0) + 1;
  s.set('count', count);
  return json({ count });
}
