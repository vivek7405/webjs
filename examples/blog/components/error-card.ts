import { WebComponent, html } from 'webjs';

/**
 * `<error-card message="…">` — inline error surface.
 * Light DOM with Tailwind utilities.
 */
export class ErrorCard extends WebComponent {
  static tag = 'error-card';
  static shadow = false;
  static properties = { message: { type: String } };
  message = '';

  render() {
    return html`
      <div class="block p-6 rounded-xl bg-bg-elev border border-border-strong text-fg shadow-lg">
        <div class="font-mono text-[11px] font-semibold tracking-[0.15em] uppercase text-accent mb-2">Error</div>
        <h2 class="font-serif text-[1.4rem] font-bold tracking-tight m-0 mb-3">Something went wrong</h2>
        <p class="m-0 mb-3 text-fg-muted"><code class="font-mono text-[0.9em] text-fg">${this.message}</code></p>
        <p class="m-0"><a href="/" class="text-accent underline underline-offset-[3px] decoration-accent/40 transition-colors duration-150 hover:decoration-current">← Back home</a></p>
      </div>
    `;
  }
}
ErrorCard.register(import.meta.url);
