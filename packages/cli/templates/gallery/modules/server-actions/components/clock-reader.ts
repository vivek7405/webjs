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
  at: string;
  readAt: string;
}

export class ClockReader extends WebComponent {
  private rows = signal<Row[]>([]);
  private busy = signal(false);

  private now(): string {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
  }

  async read() {
    this.busy.set(true);
    try {
      const r = await readClock();
      this.rows.set([{ ...r, readAt: this.now() }, ...this.rows.get()].slice(0, 6));
    } finally {
      this.busy.set(false);
    }
  }

  async bump() {
    this.busy.set(true);
    try {
      await bumpClock();
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
            class=${buttonClass()}>Read</button>
          <button type="button" @click=${() => this.bump()} ?disabled=${this.busy.get()}
            class=${buttonClass({ variant: 'secondary' })}>Bump the counter</button>
        </div>
        ${rows.length
          ? html`
              <ul class="m-0 grid gap-1 list-none p-0 font-mono text-sm">
                ${rows.map((r) => html`
                  <li class="flex justify-between gap-4">
                    <span class="text-foreground">reading #${r.reading}, server ${r.at}</span>
                    <span class="text-muted-foreground">read at ${r.readAt}</span>
                  </li>
                `)}
              </ul>
            `
          : html`<p class="m-0 text-sm text-muted-foreground">Press Read twice in a row, then bump and read again.</p>`}
      </div>
    `;
  }
}
ClockReader.register('clock-reader');
