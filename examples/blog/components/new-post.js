import { WebComponent, html, css } from 'webjs';
// IMPORTANT: imported from a client component — the dev server rewrites this
// `*.server.js` module into an RPC stub at load time, so the real implementation
// never ships to the browser.
import { createPost } from '../actions/posts.server.js';

/**
 * `<new-post>` — form that creates a post via a server action.
 * Demonstrates: server actions called from client, form handling, navigation.
 */
export class NewPost extends WebComponent {
  static tag = 'new-post';
  static styles = css`
    :host { display: block; }
    form { display: grid; gap: 8px; max-width: 480px; }
    input, textarea, button {
      font: inherit; padding: 8px; border: 1px solid #888; border-radius: 6px;
    }
    button { cursor: pointer; background: #111; color: #fff; border-color: #111; }
    button:disabled { opacity: 0.6; cursor: progress; }
    .err { color: #b00; }
  `;

  constructor() {
    super();
    this.state = { busy: false, error: null };
  }

  async onSubmit(e) {
    e.preventDefault();
    const form = /** @type HTMLFormElement */ (e.currentTarget);
    const data = new FormData(form);
    this.setState({ busy: true, error: null });
    try {
      const post = await createPost({
        title: String(data.get('title') || ''),
        body: String(data.get('body') || ''),
      });
      location.href = `/blog/${post.slug}`;
    } catch (err) {
      this.setState({ busy: false, error: err?.message || 'Failed' });
    }
  }

  render() {
    const { busy, error } = this.state;
    return html`
      <form @submit=${(e) => this.onSubmit(e)}>
        <input name="title" placeholder="Title" required />
        <textarea name="body" placeholder="Body" rows="4" required></textarea>
        <button ?disabled=${busy}>${busy ? 'Saving…' : 'Create post'}</button>
        ${error ? html`<p class="err">${error}</p>` : ''}
      </form>
    `;
  }
}
NewPost.register();
