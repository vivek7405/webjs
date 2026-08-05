// Flip the flaky page into a throwing one, so the test can make a page fail
// AFTER the browser is already sitting on it. A route handler is server-only,
// so this never reaches the client.
export async function GET() {
  (globalThis as Record<string, unknown>).__wjFlakyBroken = true;
  return { ok: true };
}
