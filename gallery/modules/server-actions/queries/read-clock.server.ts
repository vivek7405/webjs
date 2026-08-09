'use server';
// A GET server action. An action declares its HTTP semantics through reserved
// sibling exports the framework reads statically, the same way a page declares
// `export const revalidate`.
//
//   method     'GET' rides the args in the URL, is CSRF-exempt, and carries a weak
//              ETag (a revalidation answers 304). It does NOT cache on its own: a
//              GET with no `cache` export is `no-store`. With
//              no `method` export an action is a POST mutation. (SSR seeding is
//              NOT a GET feature: an action invoked during a fully buffered SSR
//              render is seeded into the page whatever its verb. A streamed page
//              emits no seed block at all.)
//   cache      the max-age in seconds, and what makes the response cacheable at
//              all. The number is shorthand for the object form, so
//              { maxAge: 10, swr: 30 } adds a stale-while-revalidate grace
//              window. PRIVATE by default. Only pass
//              { public: true } for data identical for EVERY visitor, since a
//              shared cache keys the entry on the URL and args alone. Same
//              safety rule as a page's `export const revalidate`.
//   tags       labels this cached entry so a mutation can evict it by name.
//
// One function per file is required once a file carries these config exports.
import { serveReading } from '../utils/clock.server.ts';

export const method = 'GET';
export const cache = 10;
export const tags = () => ['clock'];

export async function readClock(): Promise<{ reading: number; serving: number; at: string }> {
  // `at` goes over the wire as an ISO instant, not a formatted local time: the
  // card sits it next to a browser-side timestamp, and a server in another
  // timezone would otherwise put the two columns hours apart.
  // `serving` counts the times this body actually ran, so a repeat call answered
  // from the browser cache is visible: the number does not move. It is also why
  // this particular read never answers a 304, since a per-execution counter gives
  // every response a different ETag. A read whose result is stable does.
  return { ...serveReading(), at: new Date().toISOString() };
}
