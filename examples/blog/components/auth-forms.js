import { WebComponent, html, css } from 'webjs';

/**
 * `<auth-forms then="/dashboard">` — tabbed login + signup.
 * Posts to /api/auth/{login,signup}; on success navigates to `then`.
 */
export class AuthForms extends WebComponent {
  static tag = 'auth-forms';
  static properties = { then: { type: String } };
  static styles = css`
    :host { display: block; max-width: 420px; }
    .tabs { display: flex; gap: 0; margin-bottom: 12px; border-bottom: 1px solid #ddd; }
    .tabs button {
      flex: 1; padding: 8px 12px; font: inherit; background: none; border: 0;
      border-bottom: 2px solid transparent; cursor: pointer; color: #666;
    }
    .tabs button.active { color: #111; border-bottom-color: #111; font-weight: 600; }
    form { display: grid; gap: 8px; }
    input { padding: 8px; font: inherit; border: 1px solid #888; border-radius: 4px; }
    button[type="submit"] {
      font: inherit; padding: 8px 12px; border: 0; border-radius: 4px;
      background: #111; color: #fff; cursor: pointer;
    }
    button[type="submit"]:disabled { opacity: 0.5; cursor: progress; }
    .err { color: #b00; margin: 0; }
  `;

  constructor() {
    super();
    this.then = '/dashboard';
    this.state = { mode: 'login', busy: false, error: null };
  }

  async onSubmit(e) {
    e.preventDefault();
    const form = /** @type HTMLFormElement */ (e.currentTarget);
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
      <div class="tabs">
        <button class=${mode === 'login' ? 'active' : ''} @click=${() => this.setState({ mode: 'login' })}>Sign in</button>
        <button class=${mode === 'signup' ? 'active' : ''} @click=${() => this.setState({ mode: 'signup' })}>Sign up</button>
      </div>
      <form @submit=${(e) => this.onSubmit(e)}>
        ${mode === 'signup'
          ? html`<input name="name" placeholder="Name (optional)" autocomplete="name" />`
          : ''}
        <input name="email" type="email" placeholder="Email" autocomplete="email" required />
        <input name="password" type="password" placeholder="Password (min 8 chars)" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required />
        <button type="submit" ?disabled=${busy}>
          ${busy ? '…' : (mode === 'login' ? 'Sign in' : 'Create account')}
        </button>
        ${error ? html`<p class="err">${error}</p>` : ''}
      </form>
    `;
  }
}
AuthForms.register(import.meta.url);
