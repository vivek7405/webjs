'use server';
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { todos } from '#db/schema.server.ts';
import type { Todo } from '../types.ts';
import type { ActionResult } from '@webjsdev/server';

// `completed` is explicit on the JS path; omit it on the no-JS <form> path and
// the server reads the row and flips it (so the example degrades without JS).
export async function toggleTodo(input: { id: string; completed?: boolean }): Promise<ActionResult<Todo>> {
  const id = String(input?.id ?? '');
  if (!id) return { success: false, error: 'Missing id.', status: 400 };
  let completed = input?.completed;
  if (typeof completed !== 'boolean') {
    const cur = await db.query.todos.findFirst({ where: { id } });
    if (!cur) return { success: false, error: 'Not found.', status: 404 };
    completed = !cur.completed;
  }
  const [row] = await db.update(todos).set({ completed }).where(eq(todos.id, id)).returning();
  return { success: true, data: row as Todo };
}
