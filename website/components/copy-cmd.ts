import { WebComponent, html, prop, signal, createRef, ref } from '@webjsdev/core';

/**
 * gtag is installed by the root layout's Google tag snippet. Declaring it
 * here gives the call below a real signature instead of a cast through
 * unknown, and the optional marker keeps a blocked or absent tag safe.
 */
declare global {
  interface Window {
    gtag?: (command: 'event', name: string, params?: Record<string, string>) => void;
  }
}

/**
 * `<copy-cmd>` wraps a shell-command line with a copy-to-clipboard
 * affordance. Light DOM, Tailwind utilities throughout. The whole
 * inner wrapper is the click target (text or icon both trigger copy);
 * the icon is an always-visible visual hint, not a separate focusable
 * element. The command text is the click target's accessible NAME (no
 * aria-label hides it), and `title="Copy command to clipboard"` supplies
 * the accessible DESCRIPTION, so a screen reader announces the payload and
 * the action. The title doubles as a native hover tooltip.
 *
 * The description is a title attribute rather than an aria-describedby
 * reference on purpose. A reference needs a document-unique id, the only
 * way to mint one during SSR is a module-scope counter, and a counter
 * never resets in a long-lived server, so consecutive renders of the same
 * page emit different bytes. That changes the page's ETag on every request
 * and silently kills the 304 path site-wide (#1127). A static attribute
 * needs no id, adds no text content (so selections and _copy see only the
 * command), and keeps the output byte-stable.
 *
 * Usage:
 *   <copy-cmd>npm create webjs@latest my-app</copy-cmd>
 *
 * The `inline` variant is for a command sitting INSIDE a sentence rather
 * than in its own command bar:
 *   Run <copy-cmd inline>bun create webjs@latest my-app</copy-cmd> to ...
 *
 * It renders a `<code>` chip carrying the site's inline-code styling with a
 * small trailing icon, instead of the bar's absolutely-positioned button. The
 * bar reserves `pr-9` for that button and the host is `display: block`
 * (app/layout.ts), both of which would push the chip onto its own line and
 * put a 28px bordered button in the middle of a 22px line of prose. The whole
 * chip is the click target here, so the affordance is the chip itself.
 *
 * On click (or Enter / Space), writes the trimmed text content to the
 * clipboard via navigator.clipboard.writeText and flips the icon to a
 * checkmark for ~1.5s.
 *
 * Implementation. render() drives all host attributes, classes, and
 * event bindings, so there is no imperative setAttribute or
 * addEventListener in lifecycle hooks. Cleanup of the auto-reset
 * timer happens in disconnectedCallback.
 */
export class CopyCmd extends WebComponent({
  /**
   * Renders the in-a-sentence chip instead of the command bar. A plain
   * attribute (`<copy-cmd inline>`), so SSR emits it and the host CSS in
   * app/layout.ts can select it to undo the block display.
   */
  inline: prop(Boolean),
}) {
  copied = signal(false);
  // Increments on every successful copy. The live-region text is keyed off its
  // parity so a repeat copy within the reset window still changes the text node
  // (an aria-live region only announces on a content CHANGE), re-announcing
  // "Copied" even though `copied` is already true.
  private _copies = signal(0);
  private _resetTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The command line, bound through the ref directive rather than looked up
   * with querySelector. render() already owns this element, so a ref keeps the
   * reference flowing out of the template instead of re-finding it by selector
   * on every copy, and it cannot silently return null if the markup moves.
   */
  private _textRef = createRef<HTMLElement>();

  disconnectedCallback() {
    if (this._resetTimer) clearTimeout(this._resetTimer);
    super.disconnectedCallback?.();
  }

  _copy = async () => {
    const text = (this._textRef.value?.textContent || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API blocked (insecure context, perms denied). Fail
      // silently. The whole feature is progressive enhancement.
      return;
    }
    this.copied.set(true);
    this._copies.set(this._copies.get() + 1);
    if (this._resetTimer) clearTimeout(this._resetTimer);
    this._resetTimer = setTimeout(() => this.copied.set(false), 1500);
    // Record install-intent. A copied command (almost always the
    // `npm create webjs@latest` line) is the cleanest human-adoption
    // signal we have, far more trustworthy than npm download counts.
    // gtag is loaded by the root layout; optional-chain it so a blocked
    // or absent tag is a silent no-op. This sits OUTSIDE the clipboard
    // try so it is not the catch that swallows a write failure, and so an
    // absent-gtag access genuinely depends on the `?.` to stay safe.
    window.gtag?.('event', 'copy_command', { command: text });
  };

  _onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._copy();
    }
  };

  render() {
    const isCopied = this.copied.get();
    // Trailing space toggles per copy so the live-region text differs on a
    // repeat copy (forcing a re-announce). trim() still yields "Copied", so a
    // screen reader reads the same word and assertions stay simple.
    const announce = isCopied ? (this._copies.get() % 2 ? 'Copied ' : 'Copied') : '';
    if (this.inline) {
      // The icon sits INSIDE the [data-copy-text] target, which is safe because
      // an svg contributes no text nodes: _copy reads textContent and still gets
      // exactly the command. Keeping it inside is what lets the chip be one
      // unbreakable inline unit (whitespace-nowrap), so the background box can
      // never split across two lines mid-command.
      return html`
        <code
          class="font-mono text-sm bg-fg/8 px-1.5 py-0.5 rounded whitespace-nowrap cursor-copy outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          data-copy-text
          ${ref(this._textRef)}
          role="button"
          tabindex="0"
          title="Copy command to clipboard"
          @click=${this._copy}
          @keydown=${this._onKey}
        ><slot></slot><span class="inline-block ml-1.5 align-[-0.15em] transition-colors duration-[140ms] ${isCopied ? 'text-[oklch(0.66_0.16_150)]' : 'text-fg-subtle'}" aria-hidden="true">${isCopied ? CHECK_ICON : COPY_ICON}</span></code><span class="sr-only" role="status" aria-live="polite">${announce}</span>
      `;
    }
    return html`
      <span class="group relative flex items-center min-w-0">
        <span
          class="scroll-thin flex-1 min-w-0 overflow-x-auto whitespace-nowrap cursor-copy pr-9 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          data-copy-text
          ${ref(this._textRef)}
          role="button"
          tabindex="0"
          title="Copy command to clipboard"
          @click=${this._copy}
          @keydown=${this._onKey}
        ><slot></slot></span>
        <button
          class="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 p-0 rounded-lg border bg-bg-elev cursor-copy opacity-100 transition-[opacity,color,border-color] duration-[140ms] hover:text-fg hover:border-fg-muted ${isCopied ? 'text-[oklch(0.66_0.16_150)] border-accent-tint' : 'text-fg-muted border-border'}"
          type="button"
          aria-hidden="true"
          tabindex="-1"
          @click=${this._copy}
        >${isCopied ? CHECK_ICON : COPY_ICON}</button>
        <span class="sr-only" role="status" aria-live="polite">${announce}</span>
      </span>
    `;
  }
}

const COPY_ICON = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const CHECK_ICON = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

CopyCmd.register('copy-cmd');
