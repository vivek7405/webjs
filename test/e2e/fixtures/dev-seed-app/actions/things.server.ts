'use server';

/**
 * The one seeded action. Deterministic for a given argument list, which is the
 * contract the dev determinism assertion checks (#1309).
 */
export async function getThing(id: number) {
  return { id, label: `thing-${id}` };
}
