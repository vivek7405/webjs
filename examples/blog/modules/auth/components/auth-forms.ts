import { WebComponent, html } from 'webjs';

/**
 * `<auth-forms>` — tabbed sign-in / sign-up, 2026 spotlight style.
 * Pill-switcher, serif heading, mono field labels, amber CTA.
 */
type Mode = 'login' | 'signup';
type State = { mode: Mode; busy: boolean; error: string | null };

export class AuthForms extends WebComponent {
  static tag = 'auth-forms';
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
    return html`
      <div class="p-7 px-6 bg-bg-elev border border-border rounded-2xl shadow">
        <div class="grid grid-cols-2 p-1 mb-5 rounded-full bg-bg-subtle border border-border" role="tablist">
          <button role="tab"
                  class="${mode === 'login'
                    ? 'py-2.5 px-3 font-sans text-xs font-semibold tracking-[0.02em] border-0 rounded-full cursor-pointer transition-all duration-150 bg-bg-elev text-fg shadow-sm'
                    : 'py-2.5 px-3 font-sans text-xs font-semibold tracking-[0.02em] border-0 rounded-full cursor-pointer transition-all duration-150 bg-transparent text-fg-muted'}"
                  @click=${() => this.setState({ mode: 'login', error: null })}>Sign in</button>
          <button role="tab"
                  class="${mode === 'signup'
                    ? 'py-2.5 px-3 font-sans text-xs font-semibold tracking-[0.02em] border-0 rounded-full cursor-pointer transition-all duration-150 bg-bg-elev text-fg shadow-sm'
                    : 'py-2.5 px-3 font-sans text-xs font-semibold tracking-[0.02em] border-0 rounded-full cursor-pointer transition-all duration-150 bg-transparent text-fg-muted'}"
                  @click=${() => this.setState({ mode: 'signup', error: null })}>Create account</button>
        </div>
        <form class="grid gap-4" @submit=${(e) => this.onSubmit(e)}>
          ${mode === 'signup'
            ? html`<label class="grid gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-fg-subtle">Name (optional)
                <input class="font-sans text-[15px] leading-normal py-3 px-4 rounded border border-border-strong bg-bg text-fg transition-all duration-150 focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-tint)]"
                       name="name" autocomplete="name" />
              </label>`
            : ''}
          <label class="grid gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-fg-subtle">Email
            <input class="font-sans text-[15px] leading-normal py-3 px-4 rounded border border-border-strong bg-bg text-fg transition-all duration-150 focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-tint)]"
                   name="email" type="email" autocomplete="email" required />
          </label>
          <label class="grid gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-fg-subtle">Password
            <input class="font-sans text-[15px] leading-normal py-3 px-4 rounded border border-border-strong bg-bg text-fg transition-all duration-150 focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-tint)]"
                   name="password" type="password"
                   autocomplete=${mode === 'login' ? 'current-password' : 'new-password'}
                   minlength="8" required />
          </label>
          <button type="submit"
                  class="mt-2 font-sans text-[13px] font-semibold tracking-[0.02em] py-3 rounded-full border-0 bg-accent text-accent-fg cursor-pointer transition-all duration-150 hover:bg-accent-hover active:translate-y-px disabled:opacity-50 disabled:cursor-progress"
                  ?disabled=${busy}>
            ${busy ? '…' : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
          ${error ? html`<p class="m-0 p-3 rounded bg-[color-mix(in_oklch,var(--bg-elev)_80%,var(--accent))] text-accent font-mono text-[13px] leading-snug">${error}</p>` : ''}
        </form>
      </div>
    `;
  }
}
AuthForms.register();
