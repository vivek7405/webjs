'use server';
// A mutation paired with the cached GET in ../queries/read-clock.server.ts. With
// no `method` export it defaults to POST (CSRF-protected, rich request body).
//
// `invalidates` lists the cache tags to evict when the action completes. The
// server drops those tags from its own cache() entries and reports them on the
// response, so the client coordinator marks them stale and the NEXT readClock()
// bypasses its browser-cached copy instead of serving a value the mutation just
// made wrong. Without this export the read would keep answering from cache until
// its max-age elapsed.
import type { ActionResult } from '@webjsdev/server';
import { bumpReading } from '../utils/clock.server.ts';

export const invalidates = () => ['clock'];

export async function bumpClock(): Promise<ActionResult<{ reading: number }>> {
  // Mutations return the ActionResult envelope, so a caller narrows one shape
  // whether the write succeeded or failed.
  return { success: true, data: { reading: bumpReading() } };
}
