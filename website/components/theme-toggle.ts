import { WebComponent, html, signal } from '@webjsdev/core';
import { THEME_STORAGE_KEY, readTheme, type Theme } from '#lib/theme.ts';

/**
 * `<theme-toggle>`: three-state theme switcher: system → light → dark → system.
 *
 * State is mirrored to localStorage and reflected as `<html data-theme>`. The
 * key and the attribute values come from lib/theme.ts, which the root layout's
 * bootstrap script also reads, so the two cannot drift. The initial theme is
 * set by that bootstrap so there's no FOUC on page load.
 */

export class ThemeToggle extends WebComponent {
  theme = signal<Theme>('system');

  connectedCallback() {
    super.connectedCallback();
    let saved: string | null = null;
    try { saved = localStorage.getItem(THEME_STORAGE_KEY); } catch {}
    this.theme.set(readTheme(saved));
  }

  cycle() {
    const t = this.theme.get();
    const next: Theme =
      t === 'system' ? 'light'
      : t === 'light' ? 'dark' : 'system';
    this.theme.set(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  }

  render() {
    const t = this.theme.get();
    const label = t === 'system' ? 'AUTO' : t === 'light' ? 'LIGHT' : 'DARK';
    const icon = t === 'light' ? ICONS.sun : t === 'dark' ? ICONS.moon : ICONS.system;
    return html`
      <button
        class="inline-flex items-center justify-center w-8.5 h-8.5 p-0 rounded-full border border-border text-fg-muted cursor-pointer transition-all duration-150 hover:text-fg hover:bg-bg-subtle hover:border-border-strong active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
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
