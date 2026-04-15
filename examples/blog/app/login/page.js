import { html, redirect } from 'webjs';
import '../../modules/auth/components/auth-forms.js';
import { currentUser } from '../../modules/auth/queries/current-user.server.js';

export const metadata = { title: 'Sign in — webjs blog' };

export default async function LoginPage({ searchParams }) {
  const me = await currentUser();
  if (me) redirect(searchParams?.then || '/dashboard');

  return html`
    <style>
      .wrap {
        max-width: 460px;
        margin: var(--sp-6) auto;
        text-align: center;
      }
      .wrap h1 {
        margin: 0 0 var(--sp-2);
      }
      .wrap p {
        color: var(--fg-muted);
        margin: 0 0 var(--sp-6);
      }
    </style>
    <div class="wrap">
      <h1>Welcome back</h1>
      <p>Sign in to write posts and join the conversation.</p>
      <auth-forms then=${searchParams?.then || '/dashboard'}></auth-forms>
    </div>
  `;
}
