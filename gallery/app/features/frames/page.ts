// <webjs-frame> is a URL-addressable region that swaps ON ITS OWN, driven by a
// link targeting its id, shipping zero component JS. It is WebJs's take on Turbo
// Frames. Unlike the client router (which swaps the whole page's children when
// you navigate to a DIFFERENT url), a frame refreshes just ONE sub-region in
// place. It is also NOT a layout: a layout (layout.ts) is server-rendered chrome
// that WRAPS a route subtree via ${children} and re-renders only as part of a
// navigation, so it answers "what structure wraps these routes". A frame answers
// "which region updates itself in place", with no navigation at all. Use a layout
// for shared chrome across routes; use a frame when one region (a filtered list,
// a paginated table, a tab panel) must refresh on its own without navigating.
// The filter links below live INSIDE the frame, so a click walks
// closest('webjs-frame'), refetches THIS same page with the new ?status, and the
// server returns ONLY the <webjs-frame id="tasks"> subtree (open the network tab
// to see it). The router swaps that subtree in; everything outside the frame,
// the heading and the intro copy, never re-renders.
//
// Progressive enhancement: with JS off, each filter link is a normal full-page
// navigation to ?status=..., which re-renders the whole page with the same
// filtered list. The frame is an enhancement on top of a working page, never a
// requirement. The frame element itself upgrades because the root layout ships a
// component (the theme toggle), so @webjsdev/core and the router load app-wide.
import { html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { buttonClass } from '#components/ui/button.ts';
import { cn } from '#lib/utils/cn.ts';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import type { Metadata } from '@webjsdev/core';
import { filterTasks, normalizeStatus, type Status } from '#modules/frames/utils/tasks.ts';

export const metadata: Metadata = { title: 'Frames (webjs-frame partial swap) | features' };

// One filter tab. The href targets THIS page with a new ?status. Because it sits
// inside the frame, the router scopes the swap to the frame id automatically. A
// link OUTSIDE the frame would drive it from anywhere via data-webjs-frame="tasks".
function filterTab(current: Status, status: Status, label: string) {
  const active = current === status;
  // A segmented control: keep ONE variant (constant weight, border, padding) so
  // toggling the active tab never reflows the row, overriding only the active
  // colors with cn().
  const cls = cn(
    buttonClass({ variant: 'secondary', size: 'sm' }),
    'no-underline',
    active && 'bg-primary text-primary-foreground border-primary hover:border-primary',
  );
  return html`<a href="/features/frames?status=${status}" class=${cls}>${label}</a>`;
}

export default function FramesExample({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const status = normalizeStatus(searchParams?.status);
  const tasks = filterTasks(status);
  return html`
    ${pageHeading('Frames')}
    ${lede(html`
      Filter the list. With JS on, only the framed region swaps (the response is
      just the frame's subtree, not the whole page) and the heading above never
      re-renders. With JS off, the same links do full-page navigations. It is one
      region refreshing independently of a navigation, which neither a page nor a
      layout can express: a layout wraps routes with shared chrome and only
      re-renders when you navigate, while a frame updates one region in place.
    `)}
    <webjs-frame id="tasks" class="${cardClass()} block p-4">
      <div class="flex gap-2 mb-4">
        ${filterTab(status, 'all', 'All')}
        ${filterTab(status, 'active', 'Active')}
        ${filterTab(status, 'done', 'Done')}
      </div>
      <ul class="grid gap-2 m-0 p-0 list-none">
        ${tasks.map(
          (t) => html`
            <li class="flex items-center gap-2 text-foreground">
              <span class=${t.done ? 'text-primary' : 'text-muted-foreground'}>${t.done ? '✓' : '○'}</span>
              <span class=${t.done ? 'line-through text-muted-foreground' : ''}>${t.title}</span>
            </li>
          `,
        )}
      </ul>
    </webjs-frame>
    <p class="text-muted-foreground text-sm mt-6">
      A frame can also self-load with <code class="font-mono">src</code>
      (<code class="font-mono">loading="lazy"</code> defers the fetch to viewport
      entry), or be driven from outside via
      <code class="font-mono">data-webjs-frame="tasks"</code>.
      <code class="font-mono">data-webjs-frame="_top"</code> breaks out to a
      full-page navigation.
    </p>
  `;
}
