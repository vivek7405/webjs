import { login } from '../../../../modules/auth/actions/login.server.js';
import { sessionCookieHeader } from '../../../../lib/session.ts';

export async function POST(req) {
  const input = await req.json().catch(() => null);
  const result = await login(input);
  if (!result.success) return Response.json({ error: result.error }, { status: result.status });
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  headers.append('set-cookie', sessionCookieHeader(result.data.token, {
    secure: new URL(req.url).protocol === 'https:',
  }));
  return new Response(JSON.stringify({ user: result.data.user }), { status: 200, headers });
}
