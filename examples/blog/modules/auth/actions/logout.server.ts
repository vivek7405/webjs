'use server';

import { destroySession } from '../../../lib/session.ts';
import type { ActionResult } from '../types.ts';

export async function logout(token: string | null | undefined): Promise<ActionResult<null>> {
  await destroySession(token);
  return { success: true, data: null };
}
