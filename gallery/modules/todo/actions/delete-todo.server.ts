'use server';
// A MUTATION (no `method` export defaults to POST: CSRF-protected). Imported
// directly by the client component (the import becomes a typed RPC stub); the
// id argument and the ActionResult round-trip through webjs's serializer.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { todos } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';

export async function deleteTodo(input: { id: string }): Promise<ActionResult<{ id: string }>> {
  const id = String(input?.id ?? '');
  if (!id) return { success: false, error: 'Missing id.', status: 400 };
  await db.delete(todos).where(eq(todos.id, id));
  return { success: true, data: { id } };
}
