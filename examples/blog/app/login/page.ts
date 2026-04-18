import { html, redirect } from 'webjs';
import '../../modules/auth/components/auth-forms.ts';
import { currentUser } from '../../modules/auth/queries/current-user.server.ts';

export const metadata = { title: 'Sign in — webjs blog' };

type Ctx = { searchParams?: Record<string, string> };

export default async function LoginPage({ searchParams }: Ctx) {
  const me = await currentUser();
  if (me) redirect(searchParams?.then || '/dashboard');

  return html`
    <div class="max-w-[460px] mt-6 mx-auto text-center">
      <span class="block font-mono text-[11px] leading-none font-semibold tracking-[0.2em] uppercase text-accent mb-3">● access</span>
      <h1 class="font-serif text-[clamp(2rem,1.5rem+1.6vw,2.6rem)] leading-[1.1] tracking-[-0.03em] font-bold m-0 mb-3">Welcome back.</h1>
      <p class="text-fg-muted m-0 mb-8 text-base">Sign in to write posts and join the conversation.</p>
      <auth-forms then=${searchParams?.then || '/dashboard'}></auth-forms>
    </div>
  `;
}
