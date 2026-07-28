'use server';
// A READ is a `'use server'` action so the client (and SSR) can call it via the
// normal import (rewritten to a typed RPC stub). `method = 'GET'` rides args in
// the URL and is CSRF-exempt. (Its result is also SSR-seeded so the component
// does not re-fetch on hydration, but that happens for an action of any verb,
// not because this one is a GET.)
import { db } from '#db/connection.server.ts';
import type { Todo } from '../types.ts';

export const method = 'GET';

export async function listTodos(): Promise<Todo[]> {
  // rc.3 read: the relational query API. `orderBy` uses the object form
  // (`{ column: 'asc' | 'desc' }`); passing `[desc(todos.createdAt)]` with an
  // imported column mis-compiles to a bad SQL alias in rc.3. Do NOT use
  // `db.select({ col })` either (its projection overload trips TS2554 in rc.3).
  // See the Database (Drizzle) section in this app's AGENTS.md.
  //
  // Two equivalent read styles, both fine: the relational query API
  // (`db.query.todos.findFirst({ where: { id } })` / `findMany`, used here and in
  // toggle-todo) reads by an object filter; the core builder
  // (`db.select().from(todos).where(eq(todos.id, id))`) reads with the `eq()`
  // helper. Reach for whichever fits; the relational form is terser for by-id reads.
  const rows = await db.query.todos.findMany({ orderBy: { createdAt: 'desc' } });
  return rows as Todo[];
}
