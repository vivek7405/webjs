import { html } from 'webjs';
import '../../components/auth-forms.js';
import { currentUser } from '../../modules/auth/queries/current-user.server.js';
import { redirect } from 'webjs';

export const metadata = { title: 'Sign in — webjs blog' };

export default async function LoginPage({ searchParams }) {
  // Already signed in? Send them where they were headed.
  const me = await currentUser();
  if (me) redirect(searchParams?.then || '/dashboard');

  return html`
    <h1>Sign in</h1>
    <auth-forms then=${searchParams?.then || '/dashboard'}></auth-forms>
  `;
}
