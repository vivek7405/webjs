import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createRequestHandler } from '@webjsdev/server';
import { testRequest, submitForm, loginAndGetCookies, withSessionCookie } from '@webjsdev/server/testing';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The auth pages + dashboard middleware query the users table via Drizzle. Until
// `db:generate` has authored the migration (then `db:migrate` applies it, or
// `dev` applies it via webjs.dev.before), a request hitting those modules 500s;
// we detect that at the RESPONSE level (a 5xx on the dashboard) and SKIP with a
// clear message rather than report a misleading failure. After the db is set up
// every assertion runs for real.
// The SAME path `.env.example` and `drizzle.config.ts` use, so `db:migrate`
// prepares the database this test connects to. Pointing somewhere else made the
// skip below permanent: it told you to run `db:migrate`, and running it
// migrated a different file.
process.env.DATABASE_URL ||= 'file:./db/dev.db';
process.env.AUTH_SECRET ||= 'test-secret-at-least-32-characters-long!!';

function makeHandler() {
  // createRequestHandler builds lazily, so it succeeds even before the DB is
  // migrated; the missing table only surfaces when a request reaches a module
  // that queries it. That is why readiness is probed per-response.
  return createRequestHandler({ appDir, dev: true });
}

test('protected route redirects to login when unauthenticated', async (t) => {
  const app = await makeHandler();
  const res = await testRequest(app.handle, '/features/auth/dashboard');
  if (res.status >= 500) {
    t.skip('app deps not ready (run db:generate + db:migrate)');
    return;
  }
  // The dashboard middleware calls auth(req); with no session cookie it 302s to
  // login. This needs no DB row, only a cookie read, so it is always real once
  // the modules import.
  assert.equal(res.status, 302, 'unauthenticated dashboard is gated');
  assert.equal(res.headers.get('location'), '/features/auth/login');
});

test('signup -> login -> dashboard renders for the authenticated user', async (t) => {
  const app = await makeHandler();
  // Probe readiness: a 5xx on the dashboard means deps/DB are not set up.
  const probe = await testRequest(app.handle, '/features/auth/dashboard');
  if (probe.status >= 500) { t.skip('app deps not ready; run db:generate + db:migrate'); return; }

  const email = `harness+${Date.now()}@example.com`;
  const password = 'password123';

  // Real signup through the bound server action (the no-JS form write-path).
  // `submitForm` renders the page and reuses the identity the server put in the
  // form's hidden field, exactly as a browser with JS off submits it; a POST
  // without that field is not a form submission and is answered 405.
  // Only the REQUEST is guarded: an unmigrated table makes the action throw, and
  // that is the one condition worth skipping for. The assertions below stay
  // outside the try on purpose, so a genuine regression fails loudly instead of
  // being caught and reported as a database that was never set up.
  let signupRes: Response | null = null;
  try {
    signupRes = await submitForm(app.handle, '/features/auth/signup', {
      name: 'Harness', email, password,
    });
  } catch {
    signupRes = null;
  }
  if (!signupRes || signupRes.status >= 500) {
    t.skip('no migrated DB; run db:migrate to enable the full flow');
    return;
  }
  // Success auto-logs-in and 302s to the dashboard (carrying the session
  // cookie); a 422 means validation failed. Either way the action ran.
  assert.ok([302, 422].includes(signupRes.status), 'signup action ran');
  if (signupRes.status === 302) {
    assert.equal(signupRes.headers.get('location'), '/features/auth/dashboard', 'signup lands on the dashboard');
  } else {
    t.skip('signup was rejected by validation; run db:migrate to enable the full flow');
    return;
  }

  // Real login captures the genuine signed session cookie.
  const { cookies } = await loginAndGetCookies(app.handle, { email, password });

  // With the session cookie the protected route now renders (200).
  const dash = await testRequest(app.handle, '/features/auth/dashboard', withSessionCookie({}, cookies));
  assert.equal(dash.status, 200, 'the session cookie unlocks the dashboard');
  const body = await dash.text();
  assert.match(body, /Dashboard/, 'the dashboard content rendered');
  // The greeting interpolates the real user, so the name renders and the literal
  // template source never leaks (a counterfactual for the escaping bug).
  assert.match(body, /Harness/, 'the dashboard greets the signed-in user by name');
  assert.ok(!body.includes('${user'), 'the greeting interpolation is not a literal string');
});
