// Drives the GET-versus-mutation pair. Both are imported normally (the client
// import is rewritten to a typed RPC stub); the verbs are declared on the action
// files, so nothing here changes between a GET and a POST call site.
//
// The reads are click-driven on purpose. A read issued during SSR would resolve
// from the action seed on its first client call, so "watch it hit the network"
// would be wrong for the first paint.
import { WebComponent, signal, html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { buttonClass } from '#components/ui/button.ts';
import { readClock } from '../queries/read-clock.server.ts';
import { bumpClock } from '../actions/bump-clock.server.ts';

interface Row {
  reading: number;
  serving: number;
  at: string;
  clickedAt: string;
}

export class ClockReader extends WebComponent {
  private rows = signal<Row[]>([]);
  private busy = signal(false);
  private error = signal('');

  // Both timestamps are formatted here, in the visitor's timezone, so the server
  // instant and the click time are directly comparable wherever this is deployed.
  private clock(value: Date | string): string {
    return new Date(value).toLocaleTimeString('en-US', { hour12: false });
  }

  async read() {
    // `?disabled` only lands on the next render commit, so a second click in the
    // same task would fire a second request. The signal is the real guard.
    if (this.busy.get()) return;
    this.busy.set(true);
    this.error.set('');
    const clickedAt = this.clock(new Date());
    try {
      // A GET action returns its value directly. The stub THROWS on a transport
      // failure, so the call is guarded the same way the envelope is narrowed.
      const r = await readClock();
      this.rows.set([{ ...r, clickedAt }, ...this.rows.get()].slice(0, 6));
    } catch {
      this.error.set('The read failed. Is the server still running?');
    } finally {
      this.busy.set(false);
    }
  }

  async bump() {
    if (this.busy.get()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      // A mutation returns the ActionResult envelope, so narrow on success.
      const r = await bumpClock();
      if (!r.success) this.error.set(r.error ?? 'The bump failed.');
    } catch {
      this.error.set('The bump failed. Is the server still running?');
    } finally {
      this.busy.set(false);
    }
  }

  render() {
    const rows = this.rows.get();
    return html`
      <div class="${cardClass()} grid gap-4 p-5 max-w-[520px]">
        <div class="flex flex-wrap gap-2">
          <button type="button" @click=${() => this.read()} ?disabled=${this.busy.get()}
            aria-busy=${this.busy.get() ? 'true' : 'false'}
            class=${buttonClass()}>Read</button>
          <button type="button" @click=${() => this.bump()} ?disabled=${this.busy.get()}
            aria-busy=${this.busy.get() ? 'true' : 'false'}
            class=${buttonClass({ variant: 'secondary' })}>Bump the counter</button>
        </div>
        <!-- The results are swapped in after a click, so they are announced. -->
        <div role="status" aria-live="polite">
          ${rows.length
            ? html`
                <ul class="m-0 grid gap-1 list-none p-0 font-mono text-sm">
                  ${rows.map((r) => html`
                    <li class="flex justify-between gap-4">
                      <span class="text-foreground">reading #${r.reading}, served ${r.serving} at ${this.clock(r.at)}</span>
                      <span class="text-muted-foreground">clicked ${r.clickedAt}</span>
                    </li>
                  `)}
                </ul>
              `
            : html`<p class="m-0 text-sm text-muted-foreground">Press Read twice in a row, then bump and read again.</p>`}
        </div>
        ${this.error.get() ? html`<p role="alert" class="m-0 text-sm text-destructive">${this.error.get()}</p>` : ''}
      </div>
    `;
  }
}
ClockReader.register('clock-reader');
