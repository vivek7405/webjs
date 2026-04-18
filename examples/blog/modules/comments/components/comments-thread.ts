import { WebComponent, html, repeat, connectWS } from 'webjs';
import '../../../components/muted-text.ts';
import type { CommentFormatted } from '../types.ts';

type State = { comments: CommentFormatted[]; busy: boolean; error: string | null };

/**
 * `<comments-thread>` — live thread with real-time updates.
 * Light DOM with Tailwind utilities.
 */
export class CommentsThread extends WebComponent {
  static tag = 'comments-thread';
  static shadow = false;
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

  async onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const input = form.querySelector('input') as HTMLInputElement;
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
      const created: CommentFormatted = await r.json();
      const cur = this.state.comments;
      if (!cur.some((c) => c.id === created.id)) {
        this.setState({ comments: [...cur, created], busy: false, error: null });
      } else {
        this.setState({ busy: false });
      }
      input.value = '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ busy: false, error: msg });
    }
  }

  render() {
    const { comments, busy, error } = this.state;
    return html`
      ${comments.length === 0
        ? html`<div class="p-6 text-center text-fg-subtle font-serif italic text-sm leading-relaxed border border-dashed border-border rounded-xl mb-5">No comments yet — be the first.</div>`
        : html`<ul class="list-none p-0 m-0 mb-5 grid gap-4">${repeat(comments, (c) => c.id, (c) => html`
            <li class="p-4 px-5 bg-bg-elev border border-border rounded-lg">
              <div class="flex gap-2 items-baseline font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle mb-1.5">
                <strong class="text-fg font-bold tracking-[0.08em]">${c.authorName}</strong>
                <span class="text-fg-subtle">·</span>
                <span>${new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <div class="font-serif text-[15px] leading-relaxed text-fg">${c.body}</div>
            </li>`)}
          </ul>`}

      ${this.signedIn
        ? html`<form class="flex gap-2 p-3 bg-bg-elev border border-border rounded-lg" @submit=${(e: SubmitEvent) => this.onSubmit(e)}>
            <input placeholder="Add a comment…" ?disabled=${busy} autocomplete="off"
                   class="flex-1 text-sm font-sans py-2 px-3 border border-border-strong rounded-lg bg-bg text-fg transition-all duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint" />
            <button type="submit" ?disabled=${busy}
                    class="text-xs font-semibold tracking-wide px-4 py-2 rounded-full border-0 bg-accent text-accent-fg cursor-pointer transition-all duration-150 hover:bg-accent-hover active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed">Post</button>
          </form>
          ${error ? html`<p class="mt-2 text-accent font-mono text-xs leading-snug">${error}</p>` : ''}`
        : html`<p class="p-5 text-fg-muted bg-bg-subtle border border-dashed border-border rounded-lg text-center font-serif italic text-sm leading-relaxed">
            <a href=${signinHref()} class="text-accent font-semibold no-underline not-italic hover:underline hover:underline-offset-[3px]">Sign in</a> to comment.
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
