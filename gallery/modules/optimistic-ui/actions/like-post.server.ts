'use server';
// A tiny mutation for the optimistic-UI feature demo. It validates and echoes
// (no persistence needed to show the mechanic). In a real app this would write
// to the db and return the saved row.
import type { ActionResult } from '@webjsdev/server';

export async function likePost(input: { liked: boolean }): Promise<ActionResult<{ liked: boolean }>> {
  return { success: true, data: { liked: !!input?.liked } };
}
