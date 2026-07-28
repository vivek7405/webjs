'use server';

import { getCurrentUser } from '../auth.server.ts';

// This read deliberately stays POST-default (no 'method' export). GET is the
// verb you pair with a `cache` window, and a per-session result like this one
// differs per user and changes on sign-in / sign-out, so there is no window
// worth caching it for.
// Reach for GET + cache + tags on a read that is stable enough to serve twice,
// and for `{ public: true }` only when the data is identical for every visitor.
// (Staying POST costs nothing on the first paint, since SSR seeding applies to
// an action of any verb.)
export async function currentUser() {
  return getCurrentUser();
}
