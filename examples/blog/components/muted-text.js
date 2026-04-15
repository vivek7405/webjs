import { WebComponent, html, css } from 'webjs';

/**
 * `<muted-text>` — inline grey text for timestamps and secondary labels.
 * Encapsulates the "small grey text" pattern so pages don't repeat inline styles.
 */
export class MutedText extends WebComponent {
  static tag = 'muted-text';
  static styles = css`
    :host {
      color: #888;
      font-size: 0.9em;
    }
  `;
  render() {
    return html`<slot></slot>`;
  }
}
MutedText.register(import.meta.url);
