'use server';
// A 'use server' action IS the API: a client import is rewritten to a typed RPC
// stub POSTing to the server. It may use server-only utilities (they run here,
// server-side), which is why the shout() util stays off the client.
import { shout } from '../utils/format.server.ts';
import { actionContext, actionSignal } from '@webjsdev/server';
import type { ActionResult } from '@webjsdev/server';
import { requireAuth, type AuthUser } from '../middleware/require-auth.server.ts';

// `export const middleware` is a reserved sibling config export the framework
// reads statically (the same way a page declares `export const revalidate`). The
// chain runs around greet() on every boundary: requireAuth either short-circuits
// (the action never runs) or stashes the caller on the request context.
export const middleware = [requireAuth];

export async function greet(input: { name: string }): Promise<ActionResult<{ message: string }>> {
  // actionContext() is populated ONLY on a boundary that runs the middleware
  // chain (the RPC stub here, or a route() adapter). requireAuth runs there and
  // guarantees a user, so `caller` is set on every real call. A DIRECT
  // server-to-server greet() call skips middleware and leaves it undefined, so
  // GUARD rather than assume the cast (from server code, pass the caller in
  // explicitly instead of relying on the context).
  const caller = actionContext().user as AuthUser | undefined;
  if (!caller) return { success: false, error: 'Unauthorized.', status: 401 };

  const name = String(input?.name ?? '').trim();
  if (!name) return { success: false, error: 'Name required.', status: 400 };

  // actionSignal() is the request's AbortSignal (fires on a client disconnect or a
  // superseded render). Thread it into the slow work so the work itself aborts
  // (a real fetch(url, { signal: actionSignal() }) or a DB driver rejects on
  // abort). lookupGreeting models that, and we map an abort to a cancelled
  // envelope. A guard BEFORE any await can never fire, since nothing has been
  // awaited yet, which is why the re-check lives after the await.
  try {
    const message = await lookupGreeting(name, caller.name || caller.email || 'a signed-in user', actionSignal());
    return { success: true, data: { message } };
  } catch (e) {
    if (actionSignal().aborted) return { success: false, error: 'Request cancelled.', status: 499 };
    throw e;
  }
}

// A private (non-exported) stand-in for a slow lookup or upstream fetch, so the
// file still has exactly one action (the one-action-per-configured-file rule). A
// real fetch / DB call rejects with an AbortError when the request aborts; greet()
// catches that and returns the 499 envelope.
async function lookupGreeting(name: string, who: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return shout('hello ' + name) + ' (greeted by ' + who + ')';
}
