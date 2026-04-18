import { WebComponent, html, connectWS } from 'webjs';

type Line = { id: number; text: string; kind: 'say' | 'meta' };
type State = { lines: Line[]; connected: boolean; count: number };
type ChatMessage =
  | { kind: 'say'; text: string; at: number }
  | { kind: 'join' | 'leave'; count: number };

/**
 * `<chat-box>` — terminal-leaning live chat panel against /api/chat.
 */
export class ChatBox extends WebComponent {

  declare state: State;
  _conn: ReturnType<typeof connectWS> | null = null;
  _nextId = 0;

  constructor() {
    super();
    this.state = { lines: [], connected: false, count: 0 };
  }

  connectedCallback() {
    super.connectedCallback();
    this._conn = connectWS('/api/chat', {
      onOpen:  () => this.setState({ connected: true }),
      onClose: () => this.setState({ connected: false }),
      onMessage: (msg: ChatMessage) => {
        const lines = this.state.lines.slice();
        if (msg.kind === 'say') {
          lines.push({ id: ++this._nextId, text: msg.text, kind: 'say' });
        } else if (msg.kind === 'join') {
          lines.push({ id: ++this._nextId, text: 'someone joined', kind: 'meta' });
          this.setState({ count: msg.count });
          return;
        } else if (msg.kind === 'leave') {
          lines.push({ id: ++this._nextId, text: 'someone left', kind: 'meta' });
          this.setState({ count: msg.count, lines: lines.slice(-50) });
          return;
        }
        this.setState({ lines: lines.slice(-50) });
      },
    });
  }
  disconnectedCallback() { this._conn?.close(); this._conn = null; }

  onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const input = form.querySelector('input') as HTMLInputElement;
    const text = input.value.trim();
    if (!text || !this._conn) return;
    this._conn.send({ text });
    input.value = '';
  }

  render() {
    const { lines, connected, count } = this.state;
    return html`
      <div class="block border border-border rounded-xl bg-bg-elev shadow overflow-hidden font-sans">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-subtle font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-fg-subtle">
          <span class="${connected
            ? 'w-[7px] h-[7px] rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success)_30%,transparent)]'
            : 'w-[7px] h-[7px] rounded-full bg-accent'}"></span>
          ${connected ? html`Live · ${Math.max(0, count - 1)} other${count - 1 !== 1 ? 's' : ''} online` : html`Reconnecting…`}
        </div>
        <div class="h-[220px] overflow-y-auto p-4 text-sm leading-relaxed font-sans scroll-smooth bg-bg-sunken">
          ${lines.length === 0
            ? html`<p class="m-0 text-fg-subtle italic">No messages yet — say something.</p>`
            : lines.map((l) =>
                l.kind === 'meta'
                  ? html`<p class="m-0 mb-2 text-fg"><em class="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-fg-subtle not-italic">${l.text}</em></p>`
                  : html`<p class="m-0 mb-2 text-fg">${l.text}</p>`)}
        </div>
        <form class="flex gap-2 px-4 py-3 border-t border-border bg-bg-subtle" @submit=${(e) => this.onSubmit(e)}>
          <input class="flex-1 font-sans text-sm leading-normal px-3 py-2 border border-border-strong rounded bg-bg-elev text-fg transition-colors duration-150 focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-tint)]"
                 placeholder=${connected ? 'Say hi…' : 'Disconnected'}
                 ?disabled=${!connected} autocomplete="off" />
          <button class="font-sans text-xs font-semibold tracking-[0.02em] px-4 py-2 rounded-full border-0 bg-accent text-accent-fg cursor-pointer transition-all duration-150 hover:bg-accent-hover active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
                  ?disabled=${!connected}>Send</button>
        </form>
      </div>
    `;
  }
}
ChatBox.register('chat-box');
