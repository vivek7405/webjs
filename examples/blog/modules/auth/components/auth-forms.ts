import { WebComponent, html } from 'webjs';

/**
 * `<auth-forms>` — tabbed sign-in / sign-up.
 * Light DOM with Tailwind utilities.
 */
type Mode = 'login' | 'signup';
type State = { mode: Mode; busy: boolean; error: string | null };

export class AuthForms extends WebComponent {
  static tag = 'auth-forms';
  static shadow = false;
  static properties = { then: { type: String } };
  then: string = '/dashboard';
  declare state: State;

  constructor() {
    super();
    this.state = { mode: 'login', busy: false, error: null };
  }

  async onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget as HTMLFormElement));
    this.setState({ busy: true, error: null });
    try {
      const url = this.state.mode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `${r.status}`);
      }
      location.href = this.then || '/dashboard';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ busy: false, error: msg });
    }
  }

  render() {
    const { mode, busy, error } = this.state;
    const tabBase = 'py-2.5 px-3 text-xs font-semibold tracking-wide bg-transparent border-0 rounded-full cursor-pointer transition-all duration-150';
    const tabActive = `${tabBase} bg-bg-elev text-fg shadow-sm`;
    const tabInactive = `${tabBase} text-fg-muted`;
    return html`
      <div class="p-8 bg-bg-elev border border-border rounded-2xl shadow-lg">
        <div class="grid grid-cols-2 p-1 mb-5 rounded-full bg-bg-subtle border border-border" role="tablist">
          <button role="tab" class=${mode === 'login' ? tabActive : tabInactive}
                  @click=${() => this.setState({ mode: 'login', error: null })}>Sign in</button>
          <button role="tab" class=${mode === 'signup' ? tabActive : tabInactive}
                  @click=${() => this.setState({ mode: 'signup', error: null })}>Create account</button>
        </div>
        <form @submit=${(e: SubmitEvent) => this.onSubmit(e)} class="grid gap-4">
          ${mode === 'signup'
            ? html`<label class="grid gap-1.5 font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle">Name (optional)
                <input name="name" autocomplete="name" class="text-[15px] font-sans leading-normal py-3 px-4 rounded-lg border border-border-strong bg-bg text-fg transition-all duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint" />
              </label>`
            : ''}
          <label class="grid gap-1.5 font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle">Email
            <input name="email" type="email" autocomplete="email" required class="text-[15px] font-sans leading-normal py-3 px-4 rounded-lg border border-border-strong bg-bg text-fg transition-all duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint" />
          </label>
          <label class="grid gap-1.5 font-mono text-[10px] font-semibold tracking-[0.15em] uppercase text-fg-subtle">Password
            <input name="password" type="password"
                   autocomplete=${mode === 'login' ? 'current-password' : 'new-password'}
                   minlength="8" required class="text-[15px] font-sans leading-normal py-3 px-4 rounded-lg border border-border-strong bg-bg text-fg transition-all duration-150 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-tint" />
          </label>
          <button type="submit" ?disabled=${busy} class="mt-2 text-[13px] font-semibold tracking-wide py-3 rounded-full border-0 bg-accent text-accent-fg cursor-pointer transition-all duration-150 hover:bg-accent-hover active:translate-y-px disabled:opacity-50 disabled:cursor-progress">
            ${busy ? '…' : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
          ${error ? html`<p class="m-0 p-3 rounded-lg bg-bg-elev text-accent font-mono text-[13px] leading-snug">${error}</p>` : ''}
        </form>
      </div>
    `;
  }
}
AuthForms.register(import.meta.url);
