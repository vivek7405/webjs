import { WebComponent, html, css, connectWS } from 'webjs';

/**
 * `<chat-box>` — minimal real-time chat demo against /api/chat.
 *
 * Demonstrates `connectWS`: auto-reconnecting client with JSON messages.
 * Incoming messages are appended to state; outgoing messages are JSON
 * objects. Shadow-DOM styles as usual.
 */
export class ChatBox extends WebComponent {
  static tag = 'chat-box';
  static styles = css`
    :host { display: block; border: 1px solid #ddd; border-radius: 8px; padding: 12px; font-family: system-ui, sans-serif; }
    .status { font-size: 0.8em; color: #888; margin-bottom: 8px; }
    .log {
      height: 160px; overflow-y: auto; margin-bottom: 8px;
      padding: 6px 8px; background: #fafafa; border-radius: 4px; font-size: 0.95em;
    }
    .log p { margin: 0 0 2px; }
    .log em { color: #888; font-style: normal; font-size: 0.85em; }
    form { display: flex; gap: 6px; }
    input { flex: 1; padding: 6px 8px; font: inherit; border: 1px solid #888; border-radius: 4px; }
    button { font: inherit; padding: 6px 12px; border: 1px solid #111; border-radius: 4px; background: #111; color: #fff; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
  `;

  constructor() {
    super();
    /** @type {{lines: Array<{id:number, text:string, kind:string}>, connected: boolean, count: number}} */
    this.state = { lines: [], connected: false, count: 0 };
    this._conn = null;
    this._nextId = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this._conn = connectWS('/api/chat', {
      onOpen: () => this.setState({ connected: true }),
      onClose: () => this.setState({ connected: false }),
      onMessage: (msg) => {
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

  disconnectedCallback() {
    this._conn?.close();
    this._conn = null;
  }

  onSubmit(e) {
    e.preventDefault();
    const input = /** @type HTMLInputElement */ (e.currentTarget.querySelector('input'));
    const text = input.value.trim();
    if (!text || !this._conn) return;
    this._conn.send({ text });
    input.value = '';
  }

  render() {
    const { lines, connected, count } = this.state;
    return html`
      <div class="status">
        ${connected ? html`connected (${count} online)` : html`reconnecting…`}
      </div>
      <div class="log">
        ${lines.length === 0
          ? html`<p><em>no messages yet — say something.</em></p>`
          : lines.map((l) =>
              l.kind === 'meta'
                ? html`<p><em>${l.text}</em></p>`
                : html`<p>${l.text}</p>`
            )}
      </div>
      <form @submit=${(e) => this.onSubmit(e)}>
        <input placeholder=${connected ? 'Type a message…' : 'Disconnected — typing disabled'}
               ?disabled=${!connected} autocomplete="off" />
        <button ?disabled=${!connected}>Send</button>
      </form>
    `;
  }
}
ChatBox.register(import.meta.url);
