import { cookies } from '@webjs/server';
import { logout } from '../../../../modules/auth/actions/logout.server.js';
import { SESSION_COOKIE, clearSessionCookieHeader } from '../../../../lib/session.ts';

export async function POST() {
  await logout(cookies().get(SESSION_COOKIE));
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.append('set-cookie', clearSessionCookieHeader());
  return new Response('{"ok":true}', { status: 200, headers });
}
