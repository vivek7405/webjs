'use server';

import { getCurrentUser } from '../auth.server.ts';

// This read deliberately stays POST-default (no 'method' export). A GET server
// action is a CACHEABLE read, which is wrong for a per-session lookup: the
// result differs per user and changes on sign-in / sign-out, so it must never be
// browser-cached or shared. Reserve GET + cache + tags for data identical for
// every visitor. (Staying POST costs nothing on the first paint, since SSR
// seeding applies to an action of any verb.)
export async function currentUser() {
  return getCurrentUser();
}
