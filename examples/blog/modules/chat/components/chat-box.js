import { WebComponent, html, css, connectWS } from 'webjs';

/**
 * `<chat-box>` — global chat against /api/chat over WebSocket.
 */
export class ChatBox extends WebComponent {
  static tag = 'chat-box';
  static styles = css`
    :host {
      display: block;
      border: 1px solid var(--border);
      border-radius: var(--rad-lg);
      background: var(--bg-elev);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .status {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      padding: var(--sp-3) var(--sp-4);
      border-bottom: 1px solid var(--border);
      background: var(--bg-subtle);
      font-size: 13px;
      color: var(--fg-muted);
    }
    .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--fg-subtle);
    }
    .dot.on  { background: var(--success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 20%, transparent); }
    .dot.off { background: var(--accent); }

    .log {
      height: 200px;
      overflow-y: auto;
      padding: var(--sp-3) var(--sp-4);
      font-size: 14px;
      line-height: 1.5;
      scroll-behavior: smooth;
    }
    .log p { margin: 0 0 var(--sp-2); }
    .log em {
      font-style: normal;
      color: var(--fg-subtle);
      font-size: 12px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .empty { color: var(--fg-subtle); font-style: italic; }

    form {
      display: flex;
      gap: var(--sp-2);
      padding: var(--sp-3) var(--sp-4);
      border-top: 1px solid var(--border);
      background: var(--bg-subtle);
    }
    input {
      flex: 1;
      font: 14px/1.5 var(--font-sans);
      padding: var(--sp-2) var(--sp-3);
      border: 1px solid var(--border-strong);
      border-radius: var(--rad);
      background: var(--bg-elev);
      color: var(--fg);
      transition: border-color var(--t-fast), box-shadow var(--t-fast);
    }
    input:focus {
      outline: 0;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-tint);
    }
    button {
      font: 600 14px/1 var(--font-sans);
      padding: var(--sp-2) var(--sp-4);
      border-radius: var(--rad);
      border: 0;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
      transition: background var(--t-fast), transform var(--t-fast);
    }
    button:hover { background: var(--accent-hover); }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
  `;

  constructor() {
    super();
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

  disconnectedCallback() { this._conn?.close(); this._conn = null; }

  onSubmit(e) {
    e.preventDefault();
    const input = e.currentTarget.querySelector('input');
    const text = input.value.trim();
    if (!text || !this._conn) return;
    this._conn.send({ text });
    input.value = '';
  }

  render() {
    const { lines, connected, count } = this.state;
    return html`
      <div class="status">
        <span class=${connected ? 'dot on' : 'dot off'}></span>
        ${connected ? html`live · ${count} online` : html`reconnecting…`}
      </div>
      <div class="log">
        ${lines.length === 0
          ? html`<p class="empty">No messages yet — say something.</p>`
          : lines.map((l) =>
              l.kind === 'meta'
                ? html`<p><em>${l.text}</em></p>`
                : html`<p>${l.text}</p>`
            )}
      </div>
      <form @submit=${(e) => this.onSubmit(e)}>
        <input placeholder=${connected ? 'Say hi…' : 'Disconnected'}
               ?disabled=${!connected} autocomplete="off" />
        <button ?disabled=${!connected}>Send</button>
      </form>
    `;
  }
}
ChatBox.register(import.meta.url);
