// The soft-navigation target for the client-router demo. A plain page: the
// router needs no per-page code. The browser Back button restores this page and
// its scroll position from the client-router snapshot cache.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export const metadata: Metadata = { title: 'Client router: page two | features' };

export default function ClientRouterSecond() {
  return html`
    ${pageHeading('Page two')}
    ${lede(html`
      You arrived here without a full reload. Press the browser Back button (or
      the link below): the previous page and its scroll position are restored
      from the snapshot cache.
    `)}
    <a href="/features/client-router" class="text-primary no-underline font-medium">&larr; Back to page one</a>
  `;
}
