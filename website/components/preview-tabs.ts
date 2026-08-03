import { WebComponent, html, css, signal, createRef, ref } from '@webjsdev/core';

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

  /**
   * The two tab buttons, bound through the ref directive. Keyboard selection
   * has to move focus to the newly-selected tab (the roving-tabindex half of
   * the APG pattern), and a ref is how render() hands that element back, in
   * place of reaching into the shadow root with a selector built from the
   * mode string.
   */
  private _tabRefs = {
    preview: createRef<HTMLButtonElement>(),
    code: createRef<HTMLButtonElement>(),
  };

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

  /**
   * Arrow / Home / End move between the two tabs, per the APG tab pattern.
   *
   * The roles this element declares (`tablist` / `tab` / `tabpanel`) promise
   * this behaviour, so it has to actually be here: a widget that announces
   * itself as tabs but only responds to clicks is worse than one that never
   * claimed to be tabs. Paired with the roving tabindex below, so Tab enters
   * the group once and lands on the selected tab rather than walking both.
   */
  private onKeydown(e: KeyboardEvent) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const next: 'preview' | 'code' =
      e.key === 'Home' ? 'preview'
      : e.key === 'End' ? 'code'
      : this.mode.get() === 'preview' ? 'code'
      : 'preview';
    this.mode.set(next);
    // Follow-focus selection, the APG default for a tablist whose panels are
    // already in the DOM (both slots stay mounted here).
    //
    // Deferred behind updateComplete so focus lands after the roving tabindex
    // has been committed rather than while the target still reads
    // tabindex="-1". Ordering only: focusing a tabindex="-1" element
    // programmatically is legal, so both orders currently pass, and the
    // browser test cannot tell them apart. Kept because the committed order is
    // the one the ARIA state actually describes.
    this.updateComplete.then(() => this._tabRefs[next].value?.focus());
  }

  render() {
    const mode = this.mode.get();
    const isPreview = mode === 'preview';
    // The ids are scoped to this shadow root, so several toggles on one page
    // cannot collide on them.
    return html`
      <div class="bar" role="tablist" aria-label="Preview and code" @keydown=${(e: KeyboardEvent) => this.onKeydown(e)}>
        <button
          type="button"
          id="tab-preview"
          ${ref(this._tabRefs.preview)}
          class="tab"
          role="tab"
          aria-controls="panel-preview"
          data-active=${String(isPreview)}
          aria-selected=${isPreview ? 'true' : 'false'}
          tabindex=${isPreview ? '0' : '-1'}
          @click=${() => this.mode.set('preview')}
        >Preview</button>
        <button
          type="button"
          id="tab-code"
          ${ref(this._tabRefs.code)}
          class="tab"
          role="tab"
          aria-controls="panel-code"
          data-active=${String(!isPreview)}
          aria-selected=${!isPreview ? 'true' : 'false'}
          tabindex=${!isPreview ? '0' : '-1'}
          @click=${() => this.mode.set('code')}
        >Code</button>
      </div>
      <!-- The panel IS the slot, so the projected demo is assigned exactly
           once and never rebuilt (see the note above on why that matters for
           ui-* elements). Each carries the panel role and the label pointing
           back at its tab, which is what the tablist above promises. -->
      <slot
        name="preview"
        id="panel-preview"
        role="tabpanel"
        aria-labelledby="tab-preview"
        ?hidden=${!isPreview}
      ></slot>
      <slot
        name="code"
        id="panel-code"
        role="tabpanel"
        aria-labelledby="tab-code"
        ?hidden=${isPreview}
      ></slot>
    `;
  }
}

PreviewTabs.register('preview-tabs');
