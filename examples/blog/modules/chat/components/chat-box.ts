import { WebComponent, html, connectWS, signal } from '@webjsdev/core';
import { inputClass } from '#components/ui/input.ts';
import { buttonClass } from '#components/ui/button.ts';

type Line = { id: number; text: string; kind: 'say' | 'meta' };
type ChatMessage =
  | { kind: 'say'; text: string; at: number }
  | { kind: 'join' | 'leave'; count: number };

// 'initial' is the SSR-emitted state, "we haven't tried to connect
// yet"; we show "Connecting…" with a neutral indicator so the first
// paint doesn't look like a broken reconnect. 'live' is after the
// first successful open. 'reconnecting' is after a real close, which
// is the only state where the alarming warning indicator should show.
type ChatStatus = 'initial' | 'live' | 'reconnecting';

/**
 * `<chat-box>`: terminal-leaning live chat panel against /api/chat.
 */
export class ChatBox extends WebComponent {
  lines = signal<Line[]>([]);
  status = signal<ChatStatus>('initial');
  count = signal(0);

  _conn: ReturnType<typeof connectWS> | null = null;
  _nextId = 0;

  connectedCallback() {
    super.connectedCallback();
    this._conn = connectWS('/api/chat', {
      onOpen:  () => { this.status.set('live'); },
      onClose: () => { this.status.set('reconnecting'); },
      onMessage: (msg: ChatMessage) => {
        const lines = this.lines.get().slice();
        if (msg.kind === 'say') {
          lines.push({ id: ++this._nextId, text: msg.text, kind: 'say' });
        } else if (msg.kind === 'join') {
          lines.push({ id: ++this._nextId, text: 'someone joined', kind: 'meta' });
          this.count.set(msg.count);
          this.lines.set(lines.slice(-50));
          return;
        } else if (msg.kind === 'leave') {
          lines.push({ id: ++this._nextId, text: 'someone left', kind: 'meta' });
          this.count.set(msg.count);
          this.lines.set(lines.slice(-50));
          return;
        }
        this.lines.set(lines.slice(-50));
      },
    });
  }
  disconnectedCallback() { this._conn?.close(); this._conn = null; }

  onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const text = String(new FormData(form).get('message') ?? '').trim();
    if (!text || !this._conn) return;
    this._conn.send({ text });
    form.reset();
  }

  render() {
    const lines = this.lines.get();
    const status = this.status.get();
    const live = status === 'live';
    const count = this.count.get();
    // SSR-emitted initial state shows a neutral "Connecting…" instead
    // of the alarming "Reconnecting…" copy. The warning state only
    // appears after a real close event, which is the only time the
    // user has actually lost connectivity.
    const dotClass =
      status === 'live'
        ? 'w-[7px] h-[7px] rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success)_30%,transparent)]'
        : status === 'reconnecting'
          ? 'w-[7px] h-[7px] rounded-full bg-primary'
          : 'w-[7px] h-[7px] rounded-full bg-muted-foreground/40 animate-pulse';
    const statusText =
      status === 'live'
        ? html`Live · ${Math.max(0, count - 1)} other${count - 1 !== 1 ? 's' : ''} online`
        : status === 'reconnecting'
          ? html`Reconnecting…`
          : html`Connecting…`;
    const placeholder =
      status === 'live' ? 'Say hi…' : status === 'reconnecting' ? 'Disconnected' : 'Connecting…';
    return html`
      <div class="block border border-border rounded-xl bg-card shadow overflow-hidden font-sans">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
          <span class=${dotClass}></span>
          ${statusText}
        </div>
        <div class="h-[220px] overflow-y-auto p-4 text-sm leading-relaxed font-sans scroll-smooth bg-secondary">
          ${lines.length === 0
            ? html`<p class="m-0 text-muted-foreground/70 italic">No messages yet: say something.</p>`
            : lines.map((l) =>
                l.kind === 'meta'
                  ? html`<p class="m-0 mb-2 text-foreground"><em class="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70 not-italic">${l.text}</em></p>`
                  : html`<p class="m-0 mb-2 text-foreground">${l.text}</p>`)}
        </div>
        <form class="flex gap-2 px-4 py-3 border-t border-border bg-muted" @submit=${(e: SubmitEvent) => this.onSubmit(e)}>
          <input name="message" class="${inputClass()} flex-1"
                 placeholder=${placeholder}
                 ?disabled=${!live} autocomplete="off">
          <button class=${buttonClass({ size: 'sm' })} ?disabled=${!live}>Send</button>
        </form>
      </div>
    `;
  }
}
ChatBox.register('chat-box');
