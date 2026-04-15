import { WebComponent, html, css } from 'webjs';

/**
 * `<auth-forms then="/dashboard">` — tabbed login + signup.
 * Posts to /api/auth/{login,signup}; on success navigates to `then`.
 */
export class AuthForms extends WebComponent {
  static tag = 'auth-forms';
  static properties = { then: { type: String } };
  static styles = css`
    :host { display: block; max-width: 420px; margin: 0 auto; }

    .card {
      padding: var(--sp-6);
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--rad-lg);
      box-shadow: var(--shadow);
    }

    .tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      margin-bottom: var(--sp-5);
      padding: 4px;
      border-radius: var(--rad);
      background: var(--bg-subtle);
      border: 1px solid var(--border);
    }
    .tabs button {
      padding: var(--sp-2) var(--sp-3);
      font: 600 14px/1 var(--font-sans);
      background: transparent;
      color: var(--fg-muted);
      border: 0;
      border-radius: calc(var(--rad) - 4px);
      cursor: pointer;
      transition: color var(--t-fast), background var(--t-fast);
    }
    .tabs button.active {
      background: var(--bg-elev);
      color: var(--fg);
      box-shadow: var(--shadow-sm);
    }

    form { display: grid; gap: var(--sp-3); }
    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--fg-muted);
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    input {
      font: 15px/1.5 var(--font-sans);
      padding: var(--sp-3);
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
    button[type="submit"] {
      margin-top: var(--sp-2);
      font: 600 14px/1 var(--font-sans);
      padding: var(--sp-3);
      border-radius: var(--rad);
      border: 0;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
      transition: background var(--t-fast), transform var(--t-fast);
    }
    button[type="submit"]:hover { background: var(--accent-hover); }
    button[type="submit"]:active { transform: translateY(1px); }
    button[type="submit"]:disabled { opacity: 0.5; cursor: progress; }

    .err {
      margin: 0;
      padding: var(--sp-3);
      border-radius: var(--rad);
      background: var(--accent-tint);
      color: var(--danger);
      font-size: 14px;
    }
  `;

  constructor() {
    super();
    this.then = '/dashboard';
    this.state = { mode: 'login', busy: false, error: null };
  }

  async onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
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
      this.setState({ busy: false, error: err.message });
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
