import { WebComponent, html } from 'webjs';
import { createPost } from '../actions/create-post.server.ts';

type State = { busy: boolean; error: string | null };

/**
 * `<new-post>` — post creation form.
 * Light DOM with Tailwind utilities.
 */
export class NewPost extends WebComponent {
  static tag = 'new-post';
  static shadow = false;

  declare state: State;

  constructor() {
    super();
    this.state = { busy: false, error: null };
  }

  firstUpdated() {
    // Defer focus so Tailwind CDN has time to generate focus styles.
    requestAnimationFrame(() => {
      this.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    });
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
      location.href = `/blog/${result.data.slug}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ busy: false, error: msg });
    }
  }

  render() {
    const { busy, error } = this.state;
    const inputCls = 'text-fg bg-transparent transition-all duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint';
    return html`
      <form @submit=${(e: SubmitEvent) => this.onSubmit(e)} class="grid gap-5 p-6 bg-bg-elev border border-border rounded-xl shadow-lg">
        <label class="grid gap-2 font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle">
          Title
          <input name="title" placeholder="A bold title…" required
                 class="font-serif text-xl font-bold tracking-tight border border-border-strong rounded-lg py-3 px-4 ${inputCls}" />
        </label>
        <label class="grid gap-2 font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle">
          Body
          <textarea name="body" placeholder="Write your post — markdown not required." required
                    class="font-serif text-base leading-relaxed resize-y min-h-[220px] border border-border-strong rounded-lg p-4 ${inputCls}"></textarea>
        </label>
        <button ?disabled=${busy} class="justify-self-start text-[13px] font-semibold tracking-wide py-3 px-5 rounded-full border-0 bg-accent text-accent-fg cursor-pointer transition-all duration-150 hover:bg-accent-hover active:translate-y-px disabled:opacity-50 disabled:cursor-progress">
          ${busy ? 'Publishing…' : 'Publish'}
        </button>
        ${error ? html`<p class="m-0 p-3 rounded-lg bg-bg-elev text-accent font-mono text-[13px] leading-snug">${error}</p>` : ''}
      </form>
    `;
  }
}
NewPost.register(import.meta.url);
