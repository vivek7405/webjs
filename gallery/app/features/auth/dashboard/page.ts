import { html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { badgeClass } from '#components/ui/badge.ts';
import { currentUser } from '#modules/auth/queries/current-user.server.ts';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const user = await currentUser();
  return html`
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold">Dashboard</h1>
      <span class=${badgeClass()}>Signed in</span>
    </div>
    <div class="${cardClass()} p-6">
      <h2 class="text-lg font-semibold text-foreground m-0 mb-1">Welcome, ${user?.name || user?.email}!</h2>
      <p class="text-sm text-muted-foreground m-0">This route is gated by middleware.ts. Promote it into your product, or drop the whole auth card with gallery:clear.</p>
    </div>
  `;
}
