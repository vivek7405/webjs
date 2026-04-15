import { WebComponent, html, css } from 'webjs';
// Server action — dev server rewrites this import into an RPC stub for the
// browser. At type-check time TS resolves the real source so createPost's
// input + return types flow across the RPC boundary.
import { createPost } from '../actions/create-post.server.ts';

type State = { busy: boolean; error: string | null };

export class NewPost extends WebComponent {
  static tag = 'new-post';
  static styles = css`
    :host { display: block; }
    form {
      display: grid;
      gap: var(--sp-5);
      padding: var(--sp-6) clamp(var(--sp-4), 4vw, var(--sp-6));
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--rad-lg);
      box-shadow: var(--shadow);
    }
    label {
      display: grid;
      gap: var(--sp-2);
      font: 600 10px/1 var(--font-mono);
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--fg-subtle);
    }
    input[name='title'] {
      font: 700 clamp(1.4rem, 1.1rem + 1vw, 1.75rem)/1.15 var(--font-serif);
      letter-spacing: -0.02em;
      color: var(--fg);
      background: transparent;
      border: 0;
      border-bottom: 1px solid var(--border-strong);
      padding: var(--sp-3) 0;
      transition: border-color var(--t-fast);
    }
    textarea {
      font: 16px/1.65 var(--font-serif);
      resize: vertical;
      min-height: 220px;
      color: var(--fg);
      background: transparent;
      border: 1px solid var(--border-strong);
      border-radius: var(--rad);
      padding: var(--sp-4);
      transition: border-color var(--t-fast), box-shadow var(--t-fast);
    }
    input:focus, textarea:focus {
      outline: 0;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-tint);
    }
    input[name='title']:focus { box-shadow: none; }
    button {
      justify-self: start;
      font: 600 13px/1 var(--font-sans);
      letter-spacing: 0.02em;
      padding: var(--sp-3) var(--sp-5);
      border-radius: 999px;
      border: 0;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
      transition: background var(--t-fast), transform var(--t-fast);
    }
    button:hover  { background: var(--accent-hover); }
    button:active { transform: translateY(1px); }
    button:disabled { opacity: 0.5; cursor: progress; }
    .err {
      margin: 0;
      padding: var(--sp-3);
      border-radius: var(--rad);
      background: color-mix(in oklch, var(--bg-elev) 80%, var(--accent));
      color: var(--accent);
      font: 13px/1.4 var(--font-mono);
    }
  `;

  declare state: State;

  constructor() {
    super();
    this.state = { busy: false, error: null };
  }

  async onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    this.setState({ busy: true, error: null });
    try {
      const result = await createPost({
        title: String(data.get('title') || ''),
        body:  String(data.get('body')  || ''),
      });
      if (!result.success) {
        this.setState({ busy: false, error: result.error });
        return;
      }
      // TS knows result.data is PostFormatted here.
      location.href = `/blog/${result.data.slug}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ busy: false, error: msg });
    }
  }

  render() {
    const { busy, error } = this.state;
    return html`
      <form @submit=${(e: SubmitEvent) => this.onSubmit(e)}>
        <label>
          Title
          <input name="title" placeholder="A bold title…" required autofocus />
        </label>
        <label>
          Body
          <textarea name="body" placeholder="Write your post — markdown not required." required></textarea>
        </label>
        <button ?disabled=${busy}>${busy ? 'Publishing…' : 'Publish'}</button>
        ${error ? html`<p class="err">${error}</p>` : ''}
      </form>
    `;
  }
}
NewPost.register(import.meta.url);
