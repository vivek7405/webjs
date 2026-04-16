import { WebComponent, html, css, repeat, connectWS } from 'webjs';
import '../../../components/muted-text.ts';
import type { CommentFormatted } from '../types.ts';

type State = { comments: CommentFormatted[]; busy: boolean; error: string | null };

/**
 * `<comments-thread>` — live thread. Editorial card list, mono meta,
 * warm accent CTA, empty-state hint.
 */
export class CommentsThread extends WebComponent {
  static tag = 'comments-thread';
  static properties = {
    postId:   { type: String },
    initial:  { type: Object },
    signedIn: { type: Boolean },
  };
  postId: string = '';
  initial: CommentFormatted[] = [];
  signedIn: boolean = false;
  declare state: State;
  _conn: ReturnType<typeof connectWS> | null = null;
  static styles = css`
    :host { display: block; }

    .empty {
      padding: var(--sp-6);
      text-align: center;
      color: var(--fg-subtle);
      font: italic 14px/1.6 var(--font-serif);
      border: 1px dashed var(--border);
      border-radius: var(--rad-lg);
      margin-bottom: var(--sp-5);
    }

    ul {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--sp-5);
      display: grid;
      gap: var(--sp-4);
    }
    li {
      padding: var(--sp-4) var(--sp-5);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--rad);
    }
    .meta {
      display: flex;
      gap: var(--sp-2);
      align-items: baseline;
      font: 600 10px/1 var(--font-mono);
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--fg-subtle);
      margin-bottom: 6px;
    }
    .meta strong { color: var(--fg); font-weight: 700; letter-spacing: 0.08em; }
    .meta .sep   { color: var(--fg-subtle); }
    .body {
      font: 15px/1.65 var(--font-serif);
      color: var(--fg);
    }

    .compose {
      display: flex;
      gap: var(--sp-2);
      padding: var(--sp-3);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--rad);
    }
    input {
      flex: 1;
      font: 14px/1.5 var(--font-sans);
      padding: var(--sp-2) var(--sp-3);
      border: 1px solid var(--border-strong);
      border-radius: var(--rad);
      background: var(--bg);
      color: var(--fg);
      transition: border-color var(--t-fast), box-shadow var(--t-fast);
    }
    input:focus {
      outline: 0;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-tint);
    }
    button {
      font: 600 12px/1 var(--font-sans);
      letter-spacing: 0.02em;
      padding: var(--sp-2) var(--sp-4);
      border-radius: 999px;
      border: 0;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
      transition: background var(--t-fast), transform var(--t-fast);
    }
    button:hover  { background: var(--accent-hover); }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }

    .signin {
      padding: var(--sp-5);
      color: var(--fg-muted);
      background: var(--bg-subtle);
      border: 1px dashed var(--border);
      border-radius: var(--rad);
      text-align: center;
      font: italic 14px/1.6 var(--font-serif);
    }
    .signin a { color: var(--accent); font-weight: 600; text-decoration: none; font-style: normal; }
    .signin a:hover { text-decoration: underline; text-underline-offset: 3px; }

    .err { margin-top: var(--sp-2); color: var(--accent); font: 12px/1.4 var(--font-mono); }
  `;

  constructor() {
    super();
    this.state = { comments: [], busy: false, error: null };
  }

  connectedCallback() {
    super.connectedCallback();
    const seeded = Array.isArray(this.initial) ? this.initial : [];
    this.setState({ comments: seeded });
    this._conn = connectWS(`/api/comments/${this.postId}`, {
      onMessage: (msg: CommentFormatted) => {
        const cur = this.state.comments;
        if (cur.some((c) => c.id === msg.id)) return;
        this.setState({ comments: [...cur, msg] });
      },
    });
  }
  disconnectedCallback() { this._conn?.close(); }

  async postComment() {
    const root = this.shadowRoot ?? this;
    const input = root.querySelector('input') as HTMLInputElement | null;
    if (!input) return;
    const body = input.value.trim();
    if (!body) return;
    this.setState({ busy: true, error: null });
    try {
      const r = await fetch(`/api/comments/${this.postId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const text = await r.text();
      if (!r.ok) {
        let msg = `${r.status}`;
        try { const j = JSON.parse(text); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      // Reload to let SSR render the new comment from the DB.
      location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ busy: false, error: msg });
    }
  }

  render() {
    const { comments, busy, error } = this.state;
    return html`
      ${comments.length === 0
        ? html`<div class="empty">No comments yet — be the first.</div>`
        : html`<ul>${repeat(comments, (c) => c.id, (c) => html`
            <li>
              <div class="meta">
                <strong>${c.authorName}</strong>
                <span class="sep">·</span>
                <span>${new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <div class="body">${c.body}</div>
            </li>`)}
          </ul>`}

      ${this.signedIn
        ? html`<div class="compose">
            <input placeholder="Add a comment…" autocomplete="off" />
            <button @click=${() => this.postComment()}>Post</button>
          </div>
          ${error ? html`<p class="err">${error}</p>` : ''}`
        : html`<p class="signin">
            <a href=${signinHref()}>Sign in</a> to comment.
          </p>`}
    `;
  }
}
CommentsThread.register(import.meta.url);

function signinHref() {
  if (typeof location !== 'undefined') {
    return `/login?then=${encodeURIComponent(location.pathname)}`;
  }
  return '/login';
}
