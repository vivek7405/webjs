// A shared broadcast room. Same connectWS() client as the websockets demo, but
// the server fans each message out to all connected sockets, so every open tab
// shows the same feed. The socket opens in connectedCallback (browser-only) and
// closes in disconnectedCallback. At SSR it renders the disconnected state, so
// the page still reads with JS off (a live feed has no no-JS equivalent).
import { WebComponent, signal, html, connectWS } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { inputClass } from '#components/ui/input.ts';

export class BroadcastFeed extends WebComponent {
  private connected = signal(false);
  private lines = signal<string[]>([]);
  #conn: ReturnType<typeof connectWS> | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.#conn = connectWS('/features/broadcast/feed', {
      onOpen: () => this.connected.set(true),
      onClose: () => this.connected.set(false),
      onMessage: (msg: unknown) => this.lines.set([...this.lines.get(), String(msg)]),
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#conn?.close();
    this.#conn = null;
  }

  private send(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.elements.namedItem('msg') as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    this.#conn?.send(text);
    input.value = '';
  }

  render() {
    const on = this.connected.get();
    return html`
      <div class="grid gap-4 max-w-[420px]">
        <div class="flex items-center gap-2 text-sm">
          <span class="w-2 h-2 rounded-full ${on ? 'bg-primary' : 'bg-muted-foreground/40'}"></span>
          <span class="text-muted-foreground">${on ? 'in the room' : 'connecting (the live room needs JavaScript)'}</span>
        </div>
        <form @submit=${(e: SubmitEvent) => this.send(e)} class="flex gap-2">
          <input name="msg" autocomplete="off" placeholder="Message everyone"
            class=${inputClass('flex-1 min-w-0')} />
          <button type="submit"
            class=${buttonClass({ size: 'sm' })}>Send</button>
        </form>
        <ul class="grid gap-1.5 list-none m-0 p-0">
          ${this.lines.get().map((line) => html`
            <li class="px-3 py-2 rounded-xl bg-card border border-border text-[15px] text-foreground">${line}</li>
          `)}
        </ul>
      </div>
    `;
  }
}
BroadcastFeed.register('broadcast-feed');
