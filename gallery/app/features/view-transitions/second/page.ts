// The soft-navigation target. It carries the same view-transition opt-in so the
// cross-fade wraps the swap in BOTH directions, and the same
// data-webjs-permanent input (same id) so the router regrafts the one live node
// across the swap: the text you typed on page one is still here.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { inputClass } from '#components/ui/input.ts';
import { pageHeading } from '#lib/utils/ui.ts';

export const metadata: Metadata = {
  title: 'View transitions: page two | features',
  other: { 'view-transition': 'same-origin' },
};

export default function ViewTransitionsSecond() {
  return html`
    ${pageHeading('Page two')}
    <div class="rounded-2xl bg-foreground/5 border border-border p-6 mb-6">
      <p class="text-foreground m-0">You arrived with a cross-fade, no full
        reload. The input below is the same node from page one, regrafted across
        the swap.</p>
    </div>
    <label class="block mb-6">
      <span class="text-muted-foreground text-sm">Its value persisted across the transition:</span>
      <input id="vt-note" data-webjs-permanent type="text" placeholder="type something…"
        class=${inputClass('mt-2 block max-w-sm')} />
    </label>
    <a href="/features/view-transitions" class="text-primary no-underline font-medium">&larr; Back to page one</a>
  `;
}
