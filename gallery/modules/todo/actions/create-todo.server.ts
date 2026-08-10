'use server';
// A MUTATION (no `method` export defaults to POST: CSRF-protected, rich body).
// Args and the returned ActionResult round-trip through webjs's serializer.
import { db } from '#db/connection.server.ts';
import { todos } from '#db/schema.server.ts';
import type { Todo } from '../types.ts';
import type { ActionResult } from '@webjsdev/server';

export async function createTodo(input: { title: string }): Promise<ActionResult<Todo>> {
  const title = String(input?.title ?? '').trim();
  if (!title) return { success: false, error: 'A task needs a title.', status: 400 };
  // rc.3 mutation: `.returning()` takes NO field args in rc.3 (see the Database
  // section in this app's AGENTS.md).
  const [row] = await db.insert(todos).values({ title }).returning();
  return { success: true, data: row as Todo };
}
