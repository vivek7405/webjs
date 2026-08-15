// A button that calls the bustCaches() server action (imported as a typed RPC
// stub). Client-only interactivity, so it lives in a component; with JS off the
// button is inert (cache eviction there happens as a side effect of the write
// action that changed the data).
import { WebComponent, signal, html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { bustCaches } from '#modules/caching/actions/bust-caches.server.ts';

export class CacheBuster extends WebComponent {
  private status = signal('');

  private async bust() {
    this.status.set('evicting…');
    // 'path' evicts THIS page's cached HTML (revalidatePath), so a refresh
    // re-renders with a fresh timestamp even inside the 10s window. 'tags' would
    // only evict cache() query results, which this page does not use.
    const result = await bustCaches('path');
    this.status.set(result.success ? 'evicted, now refresh the page' : 'failed');
  }

  render() {
    return html`
      <div class="flex items-center gap-3 text-[15px]">
        <button @click=${() => this.bust()}
          class=${buttonClass({ variant: 'secondary', size: 'sm' })}>revalidate this page</button>
        <span class="text-muted-foreground">${this.status.get()}</span>
      </div>
    `;
  }
}
CacheBuster.register('cache-buster');
