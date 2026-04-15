import { WebComponent, html, css } from 'webjs';
// The *.server.js import is rewritten into an RPC stub for the browser.
import { createPost } from '../actions/create-post.server.js';

/**
 * `<new-post>` — compose form for a new post. On success, navigates to
 * the new post's page. Uses design tokens from :root.
 */
export class NewPost extends WebComponent {
  static tag = 'new-post';
  static styles = css`
    :host { display: block; }
    form {
      display: grid;
      gap: var(--sp-3);
      padding: var(--sp-5);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--rad-lg);
      box-shadow: var(--shadow);
    }
    label {
      display: grid;
      gap: var(--sp-2);
      font-size: 13px;
      color: var(--fg-muted);
      font-weight: 600;
      letter-spacing: 0.01em;
      text-transform: uppercase;
    }
    input, textarea {
      font: 15px/1.55 var(--font-sans);
      padding: var(--sp-3);
      border-radius: var(--rad);
      border: 1px solid var(--border-strong);
      background: var(--bg);
      color: var(--fg);
      transition: border-color var(--t-fast), box-shadow var(--t-fast);
    }
    input:focus, textarea:focus {
      outline: 0;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-tint);
    }
    textarea { resize: vertical; min-height: 140px; font-family: var(--font-sans); }
    button {
      justify-self: start;
      font: 600 14px/1 var(--font-sans);
      padding: var(--sp-3) var(--sp-5);
      border-radius: var(--rad);
      border: 0;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
      transition: background var(--t-fast), transform var(--t-fast);
    }
    button:hover { background: var(--accent-hover); }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: 0.5; cursor: progress; }
    .err {
      margin: 0;
      padding: var(--sp-3);
      border-radius: var(--rad);
      background: var(--accent-tint);
      color: var(--danger);
      font-size: 14px;
    }
  `;

  constructor() { super(); this.state = { busy: false, error: null }; }

  async onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    this.setState({ busy: true, error: null });
    try {
      const result = await createPost({
        title: String(data.get('title') || ''),
        body:  String(data.get('body')  || ''),
      });
      if (!result.success) { this.setState({ busy: false, error: result.error }); return; }
      location.href = `/blog/${result.data.slug}`;
    } catch (err) {
      this.setState({ busy: false, error: err?.message || 'Failed' });
    }
  }

  render() {
    const { busy, error } = this.state;
    return html`
      <form @submit=${(e) => this.onSubmit(e)}>
        <label>
          Title
          <input name="title" placeholder="A catchy title" required autofocus />
        </label>
        <label>
          Body
          <textarea name="body" placeholder="Write your post…" rows="6" required></textarea>
        </label>
        <button ?disabled=${busy}>${busy ? 'Publishing…' : 'Publish'}</button>
        ${error ? html`<p class="err">${error}</p>` : ''}
      </form>
    `;
  }
}
NewPost.register(import.meta.url);
