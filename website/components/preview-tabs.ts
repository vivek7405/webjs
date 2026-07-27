import { WebComponent, html, css, signal } from '@webjsdev/core';

/**
 * `<preview-tabs>`: a Preview / Code segmented toggle wrapping a live
 * component demo and its source snippet, the way shadcn's docs let you flip a
 * preview to the markup that produced it.
 *
 * Why shadow DOM plus slots (not a light-DOM re-render): the live demo is
 * projected through `slot="preview"`, so it stays in light DOM (Tailwind and
 * the shadcn preview tokens still apply) and, crucially, it is projected once
 * and never rebuilt. A WebComponent that emitted the demo from its own
 * `render()` would tear down and re-instantiate every `ui-*` custom element on
 * each toggle (their `connectedCallback` captures `innerHTML`, so a rebuild is
 * destructive). The shadow root owns only the segmented control and hides the
 * inactive slot; both slots stay in the tree so the projected demo is assigned
 * exactly once.
 *
 * Progressive enhancement: with JS off the DSD-rendered shadow shows the
 * default Preview slot and the buttons are inert. The full source is also
 * printed at the bottom of every component page, so no information is lost.
 */
export class PreviewTabs extends WebComponent {
  static shadow = true;

  /** Which pane is visible. Instance signal, so each toggle is component-local. */
  mode = signal<'preview' | 'code'>('preview');

  static styles = css`
    :host { display: block; }
    .bar {
      display: inline-flex;
      gap: 2px;
      padding: 3px;
      margin-bottom: 10px;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: var(--bg-elev);
    }
    .tab {
      font: 500 12.5px/1 var(--font-sans, system-ui, sans-serif);
      color: var(--fg-muted);
      background: transparent;
      border: 0;
      border-radius: 6px;
      padding: 6px 13px;
      cursor: pointer;
      transition: color 140ms ease, background 140ms ease;
    }
    .tab:hover { color: var(--fg); }
    .tab[data-active='true'] {
      color: var(--fg);
      background: var(--bg-subtle);
    }
    .tab:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px var(--accent-tint);
    }
    [hidden] { display: none !important; }
  `;

  render() {
    const mode = this.mode.get();
    const isPreview = mode === 'preview';
    return html`
      <div class="bar" role="tablist" aria-label="Preview and code">
        <button
          type="button"
          class="tab"
          role="tab"
          data-active=${String(isPreview)}
          aria-selected=${isPreview ? 'true' : 'false'}
          @click=${() => this.mode.set('preview')}
        >Preview</button>
        <button
          type="button"
          class="tab"
          role="tab"
          data-active=${String(!isPreview)}
          aria-selected=${!isPreview ? 'true' : 'false'}
          @click=${() => this.mode.set('code')}
        >Code</button>
      </div>
      <slot name="preview" ?hidden=${!isPreview}></slot>
      <slot name="code" ?hidden=${isPreview}></slot>
    `;
  }
}

PreviewTabs.register('preview-tabs');
