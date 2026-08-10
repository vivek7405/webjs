// Auth: password login/signup on top of createAuth, a signed session cookie, and
// a genuinely protected route. This card wires a REAL auth baseline (a users
// table with a passwordHash, createAuth in modules/auth/auth.server.ts, and the
// /features/auth/dashboard subtree gated by a middleware.ts), so a fresh app can
// promote it into a product. gallery:clear removes the whole surface (this card,
// modules/auth, app/api/auth, the passwordHash column) back to the minimal base.
//
// This index page is public and reads the current session with currentUser() so
// it can show who is signed in. The read is a 'use server' action, so the same
// line is the real query during SSR and a safe RPC stub on the client.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import { currentUser } from '#modules/auth/queries/current-user.server.ts';

export const metadata: Metadata = { title: 'Auth (login + protected route) | features' };

export default async function AuthExample() {
  const user = await currentUser();
  return html`
    ${pageHeading('Auth')}
    ${lede(html`Password login on <code>createAuth</code>, a signed session cookie, and a protected <code>/features/auth/dashboard</code> that redirects anonymous visitors to login.`)}

    ${user
      ? html`
        <p class="mb-4">Signed in as <strong>${user.name || user.email}</strong>.</p>
        <p><a class="text-primary underline underline-offset-2" href="/features/auth/dashboard">Open the protected dashboard</a></p>`
      : html`
        <p class="mb-4">You are signed out. <a class="text-primary underline underline-offset-2" href="/features/auth/dashboard">Visiting the dashboard</a> bounces you to login.</p>
        <p class="flex gap-4"><a class="text-primary underline underline-offset-2" href="/features/auth/login">Log in</a><a class="text-primary underline underline-offset-2" href="/features/auth/signup">Create an account</a></p>`}

    <p class="text-muted-foreground text-sm mt-6">The gate is <code class="font-mono">app/features/auth/dashboard/middleware.ts</code> calling <code class="font-mono">auth(req)</code>; the login form posts to the <code class="font-mono">app/api/auth/[...path]</code> handler; OAuth (GitHub / Google) activates once you set the matching env vars.</p>
  `;
}
