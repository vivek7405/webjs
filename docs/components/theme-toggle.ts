import { WebComponent, html, css } from 'webjs';

/**
 * `<theme-toggle>` — three-state theme switcher: system → light → dark → system.
 *
 * State is mirrored to localStorage (`webjs_theme`) and reflected as
 * `<html data-theme>`. The initial theme is set by the synchronous bootstrap
 * script in layout.js so there's no FOUC on page load.
 */
type Theme = 'system' | 'light' | 'dark';

export class ThemeToggle extends WebComponent {
  static tag = 'theme-toggle';
  declare state: { theme: Theme };
  static styles = css`
    :host { display: inline-flex; }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px; height: 36px;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--bg-elev);
      color: var(--fg-muted);
      cursor: pointer;
      transition: color var(--t-fast), background var(--t-fast),
                  border-color var(--t-fast), transform var(--t-fast);
    }
    button:hover { color: var(--fg); border-color: var(--border-strong); }
    button:active { transform: scale(0.94); }
    button:focus-visible {
      outline: 0;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-tint);
    }
    svg { width: 16px; height: 16px; stroke: currentColor; fill: none;
          stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .label {
      font: 600 10px/1 var(--font-mono);
      letter-spacing: 0.12em;
      margin-left: 6px;
      text-transform: uppercase;
      color: var(--fg-subtle);
    }
  `;

  constructor() {
    super();
    this.state = { theme: 'light' };
  }

  connectedCallback() {
    super.connectedCallback();
    let saved: string | null = null;
    try { saved = localStorage.getItem('webjs_theme'); } catch {}
    const theme: Theme = saved === 'light' || saved === 'dark' ? saved : 'light';
    this.setState({ theme });
  }

  cycle() {
    const next: Theme =
      this.state.theme === 'system' ? 'light'
      : this.state.theme === 'light' ? 'dark' : 'system';
    this.setState({ theme: next });
    try {
      if (next === 'system') localStorage.removeItem('webjs_theme');
      else localStorage.setItem('webjs_theme', next);
    } catch {}
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  }

  render() {
    const t = this.state.theme;
    const label = t === 'system' ? 'AUTO' : t === 'light' ? 'LIGHT' : 'DARK';
    const icon = t === 'light' ? ICONS.sun : t === 'dark' ? ICONS.moon : ICONS.system;
    return html`
      <button @click=${() => this.cycle()} aria-label="Cycle theme (currently ${label})" title="Theme: ${label.toLowerCase()}">
        ${icon}
      </button>
    `;
  }
}

const ICONS = {
  sun: html`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  moon: html`<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>`,
  system: html`<svg viewBox="0 0 24 24"><path d="M3 5h18v11H3zM8 20h8M12 16v4"/></svg>`,
};

ThemeToggle.register(import.meta.url);
