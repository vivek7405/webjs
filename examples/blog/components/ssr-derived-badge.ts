import { WebComponent, html, prop } from '@webjsdev/core';

/**
 * e2e fixture for the SSR pre-render lifecycle (#217). This component
 * derives its rendered text in `willUpdate` and flips a reflect:true
 * `ready` boolean there. Because the SSR walker now runs `willUpdate`
 * (and reflects properties) before `render()`, the derived text AND the
 * reflected `ready` attribute appear in the served HTML before any
 * JavaScript loads. The e2e probe fetches the page (a JS-off view) to
 * assert that, then loads it in a real browser to assert hydration does
 * not change either (no flash).
 *
 * The doc prose avoids literal tag-in-angle-brackets, which is a habit from
 * before #179: comments are masked before every signal scan now, so prose
 * naming a tag registers as nothing.
 */
export class SsrDerivedBadge extends WebComponent({
  seed: String,
  ready: prop(Boolean, { reflect: true }),
}) {
  declare label: string;

  constructor() {
    super();
    this.seed = '';
    this.ready = false;
    this.label = 'placeholder';
  }

  willUpdate() {
    this.label = `derived-from-${this.seed}`;
    this.ready = true;
  }

  render() {
    return html`<span
      class="font-mono text-[11px] tracking-[0.12em] uppercase text-muted-foreground/70"
      data-label=${this.label}
      >${this.label}</span
    >`;
  }
}
SsrDerivedBadge.register('ssr-derived-badge');
