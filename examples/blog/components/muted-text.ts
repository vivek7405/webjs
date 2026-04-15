import { WebComponent, html, css } from 'webjs';

/**
 * `<muted-text>` — small all-caps mono rubric for timestamps and meta.
 * Use for everything that isn't prose: dates, authors, labels, statuses.
 */
export class MutedText extends WebComponent {
  static tag = 'muted-text';
  static styles = css`
    :host {
      color: var(--fg-subtle);
      font: 500 11px/1.4 var(--font-mono);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
  `;
  render() { return html`<slot></slot>`; }
}
MutedText.register(import.meta.url);
