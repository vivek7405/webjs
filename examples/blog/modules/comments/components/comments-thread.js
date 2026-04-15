import { WebComponent, html, css, repeat, connectWS } from 'webjs';
import '../../../components/muted-text.js';

/**
 * `<comments-thread post-id="42" initial="[{…}]" ?signed-in>` — live
 * comment thread for a post.
 */
export class CommentsThread extends WebComponent {
  static tag = 'comments-thread';
  static properties = {
    postId: { type: String },
    initial: { type: Object },
    signedIn: { type: Boolean },
  };
  static styles = css`
    :host { display: block; }

    .empty {
      padding: var(--sp-5);
      text-align: center;
      color: var(--fg-subtle);
      font-style: italic;
      border: 1px dashed var(--border);
      border-radius: var(--rad-lg);
      margin-bottom: var(--sp-4);
    }

    ul {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--sp-5);
      display: grid;
      gap: var(--sp-3);
    }
    li {
      padding: var(--sp-4);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--rad);
      box-shadow: var(--shadow-sm);
    }
    .meta {
      font-size: 12px;
      color: var(--fg-subtle);
      margin-bottom: 4px;
      letter-spacing: 0.02em;
    }
    .meta strong { color: var(--fg); font-weight: 600; text-transform: none; letter-spacing: 0; }
    .body { color: var(--fg); font-size: 15px; line-height: 1.5; }

    form {
      display: flex;
      gap: var(--sp-2);
      padding: var(--sp-3);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--rad);
      box-shadow: var(--shadow-sm);
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

    .signin {
      padding: var(--sp-4);
      color: var(--fg-muted);
      background: var(--bg-subtle);
      border: 1px dashed var(--border);
      border-radius: var(--rad);
      text-align: center;
      font-size: 14px;
    }
    .signin a { color: var(--accent); text-decoration: none; font-weight: 600; }
    .signin a:hover { text-decoration: underline; }

    .err { margin-top: var(--sp-2); color: var(--danger); font-size: 13px; }
  `;

  constructor() {
    super();
    this.postId = '';
    this.initial = [];
    this.signedIn = false;
    this.state = { comments: [], busy: false, error: null };
    this._conn = null;
  }

  connectedCallback() {
    super.connectedCallback();
    const seeded = Array.isArray(this.initial) ? this.initial : [];
    this.setState({ comments: seeded });

    this._conn = connectWS(`/api/comments/${this.postId}`, {
      onMessage: (msg) => {
        const cur = this.state.comments;
        if (cur.some((c) => c.id === msg.id)) return;
        this.setState({ comments: [...cur, msg] });
      },
    });
  }

  disconnectedCallback() { this._conn?.close(); }

  async onSubmit(e) {
    e.preventDefault();
    const input = e.currentTarget.querySelector('input');
    const body = input.value.trim();
    if (!body) return;
    this.setState({ busy: true, error: null });
    try {
      const r = await fetch(`/api/comments/${this.postId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `${r.status}`);
      }
      input.value = '';
      this.setState({ busy: false });
    } catch (err) {
      this.setState({ busy: false, error: err.message });
    }
  }

  render() {
    const { comments, busy, error } = this.state;
    return html`
      ${comments.length === 0
        ? html`<div class="empty">No comments yet — be the first.</div>`
        : html`<ul>${repeat(
            comments,
            (c) => c.id,
            (c) => html`
              <li>
                <div class="meta">
                  <strong>${c.authorName}</strong>
                  · ${new Date(c.createdAt).toLocaleString()}
                </div>
                <div class="body">${c.body}</div>
              </li>
            `
          )}</ul>`}

      ${this.signedIn
        ? html`<form @submit=${(e) => this.onSubmit(e)}>
            <input placeholder="Add a comment…" ?disabled=${busy} autocomplete="off" />
            <button ?disabled=${busy}>Post</button>
          </form>
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
