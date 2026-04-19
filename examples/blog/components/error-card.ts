import { WebComponent, html } from '@webjs/core';

/**
 * `<error-card message="…">` — inline error surface, uses the accent tint
 * for a muted alarm.
 */
export class ErrorCard extends WebComponent {
  static properties = { message: { type: String } };
  declare message: string;
  render() {
    return html`
      <div class="block p-5 px-6 rounded-lg bg-bg-elev/85 border border-border-strong/50 text-fg shadow">
        <div class="font-mono font-semibold text-[11px] leading-none tracking-[0.15em] uppercase text-accent mb-2">Error</div>
        <h2 class="font-serif text-[1.4rem] font-bold tracking-tight m-0 mb-3">Something went wrong</h2>
        <p class="m-0 mb-3 text-fg-muted"><code class="font-mono text-[0.9em] text-fg">${this.message}</code></p>
        <p class="m-0 mb-3"><a class="text-accent underline underline-offset-[3px] decoration-accent/40 transition-colors duration-150 hover:decoration-current" href="/">← Back home</a></p>
      </div>
    `;
  }
}
ErrorCard.register('error-card');
