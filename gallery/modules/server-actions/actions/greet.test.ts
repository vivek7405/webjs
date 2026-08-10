// Example node test for the documented test helpers (from @webjsdev/server).
// Run it with node --test (or webjs test after moving it under test/). The
// handle() harness drives the FULL request pipeline: createRequestHandler({
// appDir }) builds it, and rawActionRequest() / invokeActionForTest() fire a
// 'use server' action through it (CSRF + the rich serializer included).
// buildRouteTable(appDir) parses the file router; matchPage / matchApi resolve a
// URL against it, params included. See the testing docs.
//
// greet is gated by the requireAuth middleware, which reads the REAL signed
// session off the request (the auth gallery card). So an unauthenticated call is
// genuinely denied (401), and the success path needs a real session cookie
// (obtained via a signup + loginAndGetCookies, skipped until the db is migrated).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestHandler, buildRouteTable, matchPage, matchApi, invokeActionForTest } from '@webjsdev/server';
import { submitForm, loginAndGetCookies } from '@webjsdev/server/testing';

const appDir = process.cwd();
process.env.AUTH_SECRET ||= 'test-secret-at-least-32-characters-long!!';

const GREET = 'modules/server-actions/actions/greet.server.ts';

test('buildRouteTable + matchPage resolve a dynamic route with its params', async () => {
  const table = await buildRouteTable(appDir);
  const m = matchPage(table, '/features/routing/42');
  assert.ok(m, 'the [id] route matches');
  assert.equal(m.params.id, '42');
});

test('matchApi resolves the route-handler endpoint', async () => {
  const table = await buildRouteTable(appDir);
  const m = matchApi(table, '/features/route-handler/data');
  assert.ok(m, 'the route.ts endpoint matches');
});

test('an unauthenticated greet is denied by requireAuth before greet runs', async () => {
  const app = await createRequestHandler({ appDir, dev: true });
  if (app.warmup) await app.warmup();
  // No session cookie -> requireAuth short-circuits with a 401 failure envelope
  // (it reads only the cookie, so this is real without a migrated db).
  const r = (await invokeActionForTest(
    app, GREET, 'greet', [{ name: 'Bob' }], { throwOnError: false },
  )) as { success: boolean; error?: string; status?: number };
  assert.equal(r.success, false);
  assert.equal(r.status, 401);
});

test('an authenticated greet reads the caller off the session via actionContext()', async (t) => {
  const app = await createRequestHandler({ appDir, dev: true });
  if (app.warmup) await app.warmup();

  // Real signup through the auth card's page action, then a real login to capture
  // the signed session cookie. Both hit the users table, so skip until the db is
  // migrated (run db:generate + db:migrate) rather than fail misleadingly.
  const email = `greet+${Date.now()}@example.com`;
  const password = 'password123';
  // `submitForm` renders the signup page and reuses the identity the server put
  // in the form's hidden `__webjs_action` field, which is what tells the
  // dispatcher which action to run; a POST without it is answered 405.
  const signupRes = await submitForm(app.handle, '/features/auth/signup', {
    name: 'Ada', email, password,
  });
  if (signupRes.status !== 302) { t.skip('app deps/db not ready; run db:generate + db:migrate'); return; }
  const { cookies } = await loginAndGetCookies(app.handle, { email, password });

  // With the session cookie the middleware sets the caller, and greet reads it.
  const r = (await invokeActionForTest(
    app, GREET, 'greet', [{ name: 'Bob' }], { extraCookies: cookies },
  )) as { success: boolean; data?: { message: string } };
  assert.equal(r.success, true);
  // The message carries BOTH the input (Bob) and the session caller (Ada).
  assert.match(r.data?.message ?? '', /BOB/);
  assert.match(r.data?.message ?? '', /Ada/);
});
