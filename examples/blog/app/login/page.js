import { html, redirect } from 'webjs';
import '../../modules/auth/components/auth-forms.ts';
import { currentUser } from '../../modules/auth/queries/current-user.server.ts';

export const metadata = { title: 'Sign in — webjs blog' };

export default async function LoginPage({ searchParams }) {
  const me = await currentUser();
  if (me) redirect(searchParams?.then || '/dashboard');

  return html`
    <style>
      .wrap {
        max-width: 460px;
        margin: var(--sp-5) auto 0;
        text-align: center;
      }
      .rubric {
        display: block;
        font: 600 11px/1 var(--font-mono);
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: var(--sp-3);
      }
      .wrap h1 {
        font-family: var(--font-serif);
        font-size: clamp(2rem, 1.5rem + 1.6vw, 2.6rem);
        line-height: 1.1;
        letter-spacing: -0.03em;
        font-weight: 700;
        margin: 0 0 var(--sp-3);
      }
      .wrap p {
        color: var(--fg-muted);
        margin: 0 0 var(--sp-6);
        font-size: 1rem;
      }
    </style>
    <div class="wrap">
      <span class="rubric">● access</span>
      <h1>Welcome back.</h1>
      <p>Sign in to write posts and join the conversation.</p>
      <auth-forms then=${searchParams?.then || '/dashboard'}></auth-forms>
    </div>
  `;
}
