import { WebComponent, html, css, repeat, connectWS } from 'webjs';
import '../../../components/muted-text.js';

/**
 * `<comments-thread post-id="42" initial="[{...}]" ?signed-in>` — live
 * comment thread for a post.
 *
 * - Server hydrates with the current comment list via the `initial` attr.
 * - Client opens a WebSocket to `/api/comments/:postId` for live updates.
 * - `repeat()` keeps element identity when new comments stream in.
 * - Posting goes through POST /api/comments/:postId (which the server
 *   publishes to every subscriber including this client).
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
    .empty { color: #888; font-style: italic; }
    ul { list-style: none; padding: 0; margin: 0 0 12px; }
    li { padding: 8px 0; border-bottom: 1px solid #eee; }
    .meta { font-size: 0.85em; color: #888; margin-bottom: 2px; }
    form { display: flex; gap: 6px; }
    input { flex: 1; font: inherit; padding: 8px; border: 1px solid #888; border-radius: 4px; }
    button { font: inherit; padding: 8px 14px; border-radius: 4px; border: 0; background: #111; color: #fff; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .signin { color: #888; font-style: italic; }
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
        // Dedup by id (the poster also receives their own message).
        const cur = this.state.comments;
        if (cur.some((c) => c.id === msg.id)) return;
        this.setState({ comments: [...cur, msg] });
      },
    });
  }

  disconnectedCallback() { this._conn?.close(); }

  async onSubmit(e) {
    e.preventDefault();
    const input = /** @type HTMLInputElement */ (e.currentTarget.querySelector('input'));
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
        ? html`<p class="empty">No comments yet — be the first.</p>`
        : html`<ul>${repeat(
            comments,
            (c) => c.id,
            (c) => html`
              <li>
                <div class="meta">
                  <strong>${c.authorName}</strong>
                  · ${new Date(c.createdAt).toLocaleString()}
                </div>
                <div>${c.body}</div>
              </li>
            `
          )}</ul>`}

      ${this.signedIn
        ? html`<form @submit=${(e) => this.onSubmit(e)}>
            <input placeholder="Add a comment…" ?disabled=${busy} autocomplete="off" />
            <button ?disabled=${busy}>Post</button>
          </form>
          ${error ? html`<p style="color:#b00">${error}</p>` : ''}`
        : html`<p class="signin">
            <a href=${signinHref()}>Sign in</a> to comment.
          </p>`}
    `;
  }
}
CommentsThread.register(import.meta.url);

/** Server-safe "Sign in" link with return-path. */
function signinHref() {
  if (typeof location !== 'undefined') {
    return `/login?then=${encodeURIComponent(location.pathname)}`;
  }
  return '/login';
}
