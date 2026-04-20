import { html, redirect } from '@webjskit/core';
import '../../modules/auth/components/auth-forms.ts';
import { currentUser } from '../../modules/auth/queries/current-user.server.ts';
import { rubric } from '../_utils/ui.ts';

type Ctx = { searchParams?: Record<string, string> };

export function generateMetadata({ searchParams }: Ctx) {
  return { title: searchParams?.tab === 'signup' ? 'Create account — webjs blog' : 'Sign in — webjs blog' };
}

export default async function LoginPage({ searchParams }: Ctx) {
  const me = await currentUser();
  if (me) redirect(searchParams?.then || '/dashboard');

  const mode = searchParams?.tab === 'signup' ? 'signup' : 'login';
  const heading = mode === 'signup' ? 'Create an account.' : 'Welcome back.';
  const subheading = mode === 'signup'
    ? 'Sign up to write posts and join the conversation.'
    : 'Sign in to write posts and join the conversation.';

  return html`
    <div class="max-w-[460px] mt-6 mx-auto text-center">
      ${rubric('access', 'sm')}
      <h1 class="font-serif text-[clamp(2rem,1.5rem+1.6vw,2.6rem)] leading-[1.1] tracking-[-0.03em] font-bold m-0 mb-3">${heading}</h1>
      <p class="text-fg-muted m-0 mb-8 text-base">${subheading}</p>
      <auth-forms mode=${mode} then=${searchParams?.then || '/dashboard'}></auth-forms>
    </div>
  `;
}
