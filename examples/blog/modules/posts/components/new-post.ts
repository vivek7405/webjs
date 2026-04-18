import { WebComponent, html } from 'webjs';
// Server action — dev server rewrites this import into an RPC stub for the
// browser. At type-check time TS resolves the real source so createPost's
// input + return types flow across the RPC boundary.
import { createPost } from '../actions/create-post.server.ts';

type State = { busy: boolean; error: string | null };

export class NewPost extends WebComponent {

  declare state: State;

  constructor() {
    super();
    this.state = { busy: false, error: null };
  }

  firstUpdated() {
    const titleInput = this.querySelector<HTMLInputElement>('input[name="title"]');
    titleInput?.focus();
  }

  async onSubmit(e: SubmitEvent) {
    e.preventDefault();
    // Use querySelector as a fallback — e.currentTarget can be null in
    // some re-render scenarios with light DOM event delegation.
    const form = (e.currentTarget || this.querySelector('form')) as HTMLFormElement;
    if (!form) return;
    const data = new FormData(form);
    const title = String(data.get('title') || '');
    const body = String(data.get('body') || '');
    if (!title || !body) {
      this.setState({ error: 'Title and body are required' });
      return;
    }
    this.setState({ busy: true, error: null });
    try {
      const result = await createPost({ title, body });
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
      <form class="grid gap-5 p-6 px-[clamp(1rem,4vw,1.5rem)] bg-bg-elev border border-border rounded-xl shadow" @submit=${(e: SubmitEvent) => this.onSubmit(e)}>
        <label class="grid gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-fg-subtle">
          Title
          <input class="font-serif font-bold text-[clamp(1.4rem,calc(1.1rem+1vw),1.75rem)] leading-tight tracking-tight text-fg bg-transparent border-0 border-b border-border-strong py-3 px-0 transition-colors duration-150 focus:outline-none focus:border-accent"
                 name="title" placeholder="A bold title…" required />
        </label>
        <label class="grid gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-fg-subtle">
          Body
          <textarea class="font-serif text-base leading-relaxed resize-y min-h-[220px] text-fg bg-transparent border border-border-strong rounded p-4 transition-all duration-150 focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-tint)]"
                    name="body" placeholder="Write your post — markdown not required." required></textarea>
        </label>
        <button class="justify-self-start font-sans text-[13px] font-semibold tracking-[0.02em] py-3 px-5 rounded-full border-0 bg-accent text-accent-fg cursor-pointer transition-all duration-150 hover:bg-accent-hover active:translate-y-px disabled:opacity-50 disabled:cursor-progress"
                ?disabled=${busy}>${busy ? 'Publishing…' : 'Publish'}</button>
        ${error ? html`<p class="m-0 p-3 rounded bg-[color-mix(in_oklch,var(--bg-elev)_80%,var(--accent))] text-accent font-mono text-[13px] leading-snug">${error}</p>` : ''}
      </form>
    `;
  }
}
customElements.define('new-post', NewPost);
