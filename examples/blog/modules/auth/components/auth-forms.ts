import { WebComponent, html, css } from 'webjs';

/**
 * `<auth-forms>` — tabbed sign-in / sign-up, 2026 spotlight style.
 * Pill-switcher, serif heading, mono field labels, amber CTA.
 */
type Mode = 'login' | 'signup';
type State = { mode: Mode; busy: boolean; error: string | null };

export class AuthForms extends WebComponent {
  static tag = 'auth-forms';
  static shadow = false;
  static properties = { then: { type: String } };
  then: string = '/dashboard';
  declare state: State;
  static styles = css`
    :host { display: block; }
    .card {
      padding: var(--sp-7) var(--sp-6);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--rad-xl);
      box-shadow: var(--shadow);
    }

    .tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 4px;
      margin-bottom: var(--sp-5);
      border-radius: 999px;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
    }
    .tabs button {
      padding: 10px 12px;
      font: 600 12px/1 var(--font-sans);
      letter-spacing: 0.02em;
      background: transparent;
      color: var(--fg-muted);
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      transition: color var(--t-fast), background var(--t-fast);
    }
    .tabs button.active {
      background: var(--bg-elev);
      color: var(--fg);
      box-shadow: var(--shadow-sm);
    }

    form   { display: grid; gap: var(--sp-4); }
    label  {
      display: grid;
      gap: 6px;
      font: 600 10px/1 var(--font-mono);
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--fg-subtle);
    }
    input {
      font: 15px/1.5 var(--font-sans);
      padding: var(--sp-3) var(--sp-4);
      border-radius: var(--rad);
      border: 1px solid var(--border-strong);
      background: var(--bg);
      color: var(--fg);
      transition: border-color var(--t-fast), box-shadow var(--t-fast);
    }
    input:focus {
      outline: 0;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-tint);
    }
    button[type='submit'] {
      margin-top: var(--sp-2);
      font: 600 13px/1 var(--font-sans);
      letter-spacing: 0.02em;
      padding: var(--sp-3);
      border-radius: 999px;
      border: 0;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
      transition: background var(--t-fast), transform var(--t-fast);
    }
    button[type='submit']:hover  { background: var(--accent-hover); }
    button[type='submit']:active { transform: translateY(1px); }
    button[type='submit']:disabled { opacity: 0.5; cursor: progress; }

    .err {
      margin: 0;
      padding: var(--sp-3);
      border-radius: var(--rad);
      background: color-mix(in oklch, var(--bg-elev) 80%, var(--accent));
      color: var(--accent);
      font: 13px/1.4 var(--font-mono);
    }
  `;

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
      <div class="card">
        <div class="tabs" role="tablist">
          <button role="tab" class=${mode === 'login' ? 'active' : ''}
                  @click=${() => this.setState({ mode: 'login', error: null })}>Sign in</button>
          <button role="tab" class=${mode === 'signup' ? 'active' : ''}
                  @click=${() => this.setState({ mode: 'signup', error: null })}>Create account</button>
        </div>
        <form @submit=${(e) => this.onSubmit(e)}>
          ${mode === 'signup'
            ? html`<label>Name (optional)
                <input name="name" autocomplete="name" />
              </label>`
            : ''}
          <label>Email
            <input name="email" type="email" autocomplete="email" required />
          </label>
          <label>Password
            <input name="password" type="password"
                   autocomplete=${mode === 'login' ? 'current-password' : 'new-password'}
                   minlength="8" required />
          </label>
          <button type="submit" ?disabled=${busy}>
            ${busy ? '…' : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
          ${error ? html`<p class="err">${error}</p>` : ''}
        </form>
      </div>
    `;
  }
}
AuthForms.register(import.meta.url);
