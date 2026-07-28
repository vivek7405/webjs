'use server';

import { getCurrentUser } from '../auth.server.ts';

// This read deliberately stays POST-default (no 'method' export). A per-session
// result differs per user and changes on sign-in / sign-out, so it must never
// end up in a cache, and GET is the verb a `cache` window would later be added
// to. Keeping it POST keeps that door shut. Reach for GET + cache + tags on a
// read stable enough to serve twice, and for `{ public: true }` only when the
// data is identical for every visitor. (Staying POST costs nothing on the first
// paint, since SSR seeding applies to an action of any verb.)
export async function currentUser() {
  return getCurrentUser();
}
