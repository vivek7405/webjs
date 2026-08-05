import { WebComponent, html, prop, signal } from '@webjsdev/core';
import { tokenize, tokenClass, trimBlock } from '#lib/utils/highlight.ts';

/**
 * `<code-block>` is the one code sample on this site. It owns the `<pre>`
 * markup (the keyboard focus stop, the optional landmark name) and the
 * client-side pass that colors the documentation's samples.
 *
 * Usage, light DOM, the code as plain text children:
 *
 *   <code-block>npm create webjs@latest my-app</code-block>
 *   <code-block label="root layout">export default function Layout() {}</code-block>
 *
 * Why the `<pre>` lives here rather than at each of the ~480 call sites: both
 * of the attributes that matter are easy to forget and invisible when missing.
 * A `<pre>` that scrolls horizontally with no `tabindex` can only be scrolled
 * with a pointer, which is axe's scrollable-region-focusable and unusable for
 * a keyboard or switch user, and the docs shell makes every `<pre>` under
 * `.prose-docs` a scroll container. Declaring the markup once is what stops
 * that drifting back one page at a time.
 *
 * `label` is optional and usually omitted. A named block also takes
 * `role="region"`, because a `<pre>` maps to ARIA role `generic` and ARIA
 * prohibits an author-supplied name there, so a bare `aria-label` is a name a
 * spec-following screen reader will not announce. A named region is also a
 * landmark, so two blocks on one page must not share a name. A block with no
 * genuinely distinct name takes the focus stop alone, which is valid, and
 * that is why most callers pass nothing.
 *
 * Highlighting. The documentation's samples are authored as inline template
 * text (with `&lt;` and `&#123;` escapes, since a raw `<` would open a tag
 * and a raw `${` would open a hole), not as JS strings, so the server has no
 * string to tokenize and the coloring has to happen in the browser. That is
 * what `connectedCallback` does: it reads the block's text once, before the
 * first client render replaces the light DOM, and renders tokens from it.
 * The grammar is imported from lib/utils/highlight.ts, the same one the
 * marketing pages and the blog renderer use at SSR, so the palette matches
 * everywhere and there is no second copy to keep in sync.
 *
 * At SSR `connectedCallback` never runs (it is a browser-only hook), so the
 * server renders the `<slot>` branch and the code is projected into the
 * `<pre>` as plain text. That is the no-JS reading path, and it is also the
 * first paint: the color arrives on upgrade, the content never does.
 *
 * There is no MutationObserver and no `data-hl` guard, which is the point of
 * being an element rather than a script. A custom element upgrades whenever
 * its tag enters the DOM, so a hard load, a soft navigation into the docs,
 * and a soft navigation between two docs pages are all the same event, with
 * no site-wide observer left running on the marketing pages to catch them.
 */
export class CodeBlock extends WebComponent({
  /** Optional landmark name. Adds `role="region"`; must be unique per page. */
  label: prop(String),
  /**
   * Extra utility classes for the `<pre>` itself, for the rare block that
   * needs its own box (the gallery's source pane caps its height and scrolls
   * vertically). It goes on the `<pre>` rather than the host because the
   * scrollbar has to render inside the element that scrolls.
   */
  preClass: prop(String, { attribute: 'pre-class' }),
}) {
  /**
   * The block's source text, captured on upgrade. Null until then, and the
   * null branch is what the server renders, so the two states are "the
   * browser has not read this yet" and "here are its tokens", never "empty".
   */
  private _code = signal<string | null>(null);

  connectedCallback() {
    super.connectedCallback?.();
    // Read before the first client render, which replaces the light DOM with
    // this component's own template. Works from either starting point: the
    // authored children on a fresh element, or the server's projected text on
    // hydration. Both spell the same code, so re-connecting is idempotent.
    if (this._code.get() === null) this._code.set(trimBlock(this.textContent ?? ''));
  }

  render() {
    const code = this._code.get();
    const body = code === null
      ? html`<slot></slot>`
      : tokenize(code).map((tok) => {
        const cls = tokenClass(tok.t);
        return cls ? html`<span class=${cls}>${tok.v}</span>` : html`${tok.v}`;
      });
    const cls = this.preClass || '';
    // Two branches rather than one with empty attributes: `role=""` and
    // `aria-label=""` are not the same as the attributes being absent, and an
    // unnamed block must carry neither.
    return this.label
      ? html`<pre class=${cls} tabindex="0" role="region" aria-label=${this.label}><code>${body}</code></pre>`
      : html`<pre class=${cls} tabindex="0"><code>${body}</code></pre>`;
  }
}

CodeBlock.register('code-block');
