// `richFetch(url, init?)` is a drop-in `fetch` for your own API routes that
// preserves rich types: it sends Accept: application/vnd.webjs+json, and when
// the route answered with `json(...)` it decodes the WebJs wire, so a `Date`
// comes back as a real Date (not an ISO string), and Map / Set / BigInt / Blob
// round-trip too. A plain-object `body` is encoded the same way. Client-only
// (it runs in the browser), so it lives in a component; with JS off this button
// is inert and the page still reads.
import { WebComponent, signal, html, richFetch } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';

interface RichPayload { at: Date; ip: string; requestId: string; cookieCount: number }

export class RichData extends WebComponent {
  private line = signal('click to fetch');

  private async load() {
    const data = await richFetch<RichPayload>('/features/route-handler/data');
    // data.at is a Date, so Date methods work with no manual parsing.
    this.line.set(`at ${data.at.toLocaleTimeString()} · id ${data.requestId} · ${data.cookieCount} cookie(s)`);
  }

  render() {
    return html`
      <div class="flex items-center gap-3 text-[15px]">
        <button @click=${() => this.load()}
          class=${buttonClass({ size: 'sm' })}>richFetch() the route</button>
        <span class="text-muted-foreground">${this.line.get()}</span>
      </div>
    `;
  }
}
RichData.register('rich-data');
