// Undo /break, so a test can assert what a page looks like once it renders
// cleanly again. Server-only, like every route handler.
export async function GET() {
  (globalThis as Record<string, unknown>).__wjFlakyBroken = false;
  return { ok: true };
}
