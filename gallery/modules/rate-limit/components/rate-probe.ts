// A small probe for the rate-limited endpoint. Each click fetches
// /features/rate-limit/ping and records the status plus the X-RateLimit-Remaining
// header the middleware stamped on. This is a legitimate hand-written fetch: the
// target is a route.ts HTTP endpoint (not a server action, which you would
// import and call instead). The button is the interactivity signal, so this
// component ships and hydrates.
import { WebComponent, signal, html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';

interface Probe { n: number; status: number; remaining: string }

export class RateProbe extends WebComponent {
  private log = signal<Probe[]>([]);
  private busy = signal(false);
  #n = 0;

  private async ping() {
    if (this.busy.get()) return;
    this.busy.set(true);
    try {
      const res = await fetch('/features/rate-limit/ping', { headers: { accept: 'application/json' } });
      this.#n += 1;
      this.log.set([
        { n: this.#n, status: res.status, remaining: res.headers.get('x-ratelimit-remaining') ?? '?' },
        ...this.log.get(),
      ].slice(0, 8));
    } finally {
      this.busy.set(false);
    }
  }

  render() {
    return html`
      <div class="grid gap-4 max-w-[420px]">
        <button @click=${() => this.ping()}
          class="${buttonClass({ size: 'sm' })} w-fit">Ping the endpoint</button>
        <ul class="grid gap-1.5 list-none m-0 p-0">
          ${this.log.get().map((p) => html`
            <li class="flex items-center justify-between px-3 py-2 rounded-xl bg-card border border-border text-sm">
              <span class="text-muted-foreground">#${p.n}</span>
              <span class="font-mono ${p.status === 429 ? 'text-destructive' : 'text-primary'}">${p.status === 429 ? '429 limited' : '200 ok'}</span>
              <span class="text-muted-foreground text-[13px]">remaining: ${p.remaining}</span>
            </li>
          `)}
        </ul>
      </div>
    `;
  }
}
RateProbe.register('rate-probe');
