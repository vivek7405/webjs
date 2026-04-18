/**
 * `<muted-text>` — small all-caps mono rubric for timestamps and meta.
 * Use for everything that isn't prose: dates, authors, labels, statuses.
 *
 * Pure HTMLElement — no render step. Children are preserved as-is;
 * Tailwind utility classes are applied directly to the host.
 */
class MutedText extends HTMLElement {
  connectedCallback() {
    this.classList.add('text-fg-subtle', 'font-mono', 'text-[11px]', 'font-medium', 'leading-snug', 'tracking-[0.12em]', 'uppercase');
  }
}
customElements.define('muted-text', MutedText);
