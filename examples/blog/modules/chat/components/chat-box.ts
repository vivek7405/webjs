import { WebComponent, html, connectWS } from 'webjs';

type Line = { id: number; text: string; kind: 'say' | 'meta' };
type State = { lines: Line[]; connected: boolean; count: number };
type ChatMessage =
  | { kind: 'say'; text: string; at: number }
  | { kind: 'join' | 'leave'; count: number };

/**
 * `<chat-box>` — live chat panel against /api/chat.
 * Light DOM with Tailwind utilities.
 */
export class ChatBox extends WebComponent {
  static tag = 'chat-box';
  static shadow = false;

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
    const dotCls = connected
      ? 'w-[7px] h-[7px] rounded-full bg-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.3)]'
      : 'w-[7px] h-[7px] rounded-full bg-accent';
    return html`
      <div class="block border border-border rounded-xl bg-bg-elev shadow-lg overflow-hidden font-sans">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-subtle font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle">
          <span class=${dotCls}></span>
          ${connected ? html`Live · ${Math.max(0, count - 1)} other${count - 1 !== 1 ? 's' : ''} online` : html`Reconnecting…`}
        </div>
        <div class="h-[220px] overflow-y-auto p-4 text-sm leading-relaxed scroll-smooth bg-bg-subtle/30">
          ${lines.length === 0
            ? html`<p class="m-0 text-fg-subtle italic">No messages yet — say something.</p>`
            : lines.map((l) =>
                l.kind === 'meta'
                  ? html`<p class="m-0 mb-2 text-fg"><em class="font-mono text-[10px] font-medium tracking-[0.15em] uppercase text-fg-subtle not-italic">${l.text}</em></p>`
                  : html`<p class="m-0 mb-2 text-fg">${l.text}</p>`)}
        </div>
        <form @submit=${(e: SubmitEvent) => this.onSubmit(e)} class="flex gap-2 px-4 py-3 border-t border-border bg-bg-subtle">
          <input
            placeholder=${connected ? 'Say hi…' : 'Disconnected'}
            ?disabled=${!connected}
            autocomplete="off"
            class="flex-1 text-sm font-sans py-2 px-3 border border-border-strong rounded-lg bg-bg-elev text-fg transition-all duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint"
          />
          <button ?disabled=${!connected} class="font-semibold text-xs tracking-wide px-4 py-2 rounded-full border-0 bg-accent text-accent-fg cursor-pointer transition-all duration-150 hover:bg-accent-hover active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed">Send</button>
        </form>
      </div>
    `;
  }
}
ChatBox.register(import.meta.url);
