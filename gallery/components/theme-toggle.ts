import { WebComponent, html, signal } from '@webjsdev/core';

/**
 * `<theme-toggle>`: three-state theme switcher: system → light → dark → system.
 *
 * State is mirrored to localStorage (`webjs_theme`) and reflected as
 * `<html data-theme>`. The initial theme is set by the synchronous bootstrap
 * script in layout.js so there's no FOUC on page load.
 */
type Theme = 'system' | 'light' | 'dark';

export class ThemeToggle extends WebComponent {
  theme = signal<Theme>('system');

  connectedCallback() {
    super.connectedCallback();
    let saved: string | null = null;
    try { saved = localStorage.getItem('webjs_theme'); } catch {}
    this.theme.set(saved === 'light' || saved === 'dark' ? saved : 'system');
  }

  cycle() {
    const t = this.theme.get();
    const next: Theme =
      t === 'system' ? 'light'
      : t === 'light' ? 'dark' : 'system';
    this.theme.set(next);
    try {
      if (next === 'system') localStorage.removeItem('webjs_theme');
      else localStorage.setItem('webjs_theme', next);
    } catch {}
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    // Mirror the effective theme onto the .dark class too. data-theme drives the
    // app palette blocks; the .dark class is what the @webjsdev/ui kit's dark:
    // variants read, so both signals must move together (see the skill's references/styling.md).
    const osLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const dark = next === 'dark' || (next === 'system' && !osLight);
    document.documentElement.classList.toggle('dark', dark);
  }

  render() {
    const t = this.theme.get();
    const label = t === 'system' ? 'AUTO' : t === 'light' ? 'LIGHT' : 'DARK';
    const icon = t === 'light' ? ICONS.sun : t === 'dark' ? ICONS.moon : ICONS.system;
    return html`
      <button
        class="inline-flex items-center justify-center w-9 h-9 p-0 border border-border rounded-full bg-card text-muted-foreground cursor-pointer transition-all duration-150 hover:text-foreground hover:border-border active:scale-[0.94] focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-tint"
        @click=${() => this.cycle()}
        aria-label="Cycle theme (currently ${label})"
        title="Theme: ${label.toLowerCase()}"
      >${icon}</button>
    `;
  }
}

const ICONS = {
  sun: html`<svg class="w-4 h-4 stroke-current fill-none" style="stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M3 12h2M19 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  moon: html`<svg class="w-4 h-4 stroke-current fill-none" style="stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>`,
  system: html`<svg class="w-4 h-4 stroke-current fill-none" style="stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M3 5h18v11H3zM8 20h8M12 16v4"/></svg>`,
};

ThemeToggle.register('theme-toggle');
