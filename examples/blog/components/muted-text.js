import { WebComponent, html, css } from 'webjs';

/**
 * `<muted-text>` — inline secondary text (timestamps, metadata, labels).
 */
export class MutedText extends WebComponent {
  static tag = 'muted-text';
  static styles = css`
    :host {
      color: var(--fg-subtle);
      font-size: 0.875em;
      letter-spacing: 0.005em;
    }
  `;
  render() { return html`<slot></slot>`; }
}
MutedText.register(import.meta.url);
