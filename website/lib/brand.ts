import { html } from '@webjsdev/core';

/**
 * The brand marks, in one place.
 *
 * The identity is the Velocity W: a forward-leaning W drawn as a single
 * stroked path, cut by a horizontal band of negative space (the "slice").
 * The lean and the slice together are what make it read as motion rather
 * than as a letter.
 *
 * Two things here are deliberate and easy to get wrong if this is ever
 * re-drawn:
 *
 * 1. The slice is a MASK, not a painted bar. An earlier draft drew it as a
 *    rect filled with the page background, which only looks correct on the
 *    one background it was sampled from and paints a dark stripe across the
 *    mark everywhere else (a light theme, a coloured card, a sticker). A mask
 *    removes the pixels instead, so whatever is behind the mark shows through
 *    and the mark is correct on every surface.
 *
 * 2. The gradient is declared per instance with a unique id. SVG ids are
 *    document-global, so two lockups on one page with a shared id would both
 *    resolve to whichever gradient parsed last. Every call site passes its own
 *    `id`.
 *
 * The in-page marks paint with the theme custom properties, so they retrack
 * the palette on a theme switch with no second asset. The downloadable files
 * in public/brand/ are the same geometry with the colours resolved, because a
 * detached asset has no page to inherit from.
 */

/** The W geometry, shared by every rendering of the mark. */
const W_PATH = 'M10 16 L22 48 L32 30 L42 48 L54 16';

/**
 * The monogram: the Velocity W in a 64x64 box.
 *
 * `fill` picks the paint. 'grad' uses the brand ramp, 'currentColor' inherits
 * the surrounding text colour (used where the mark sits inline in a link and
 * should dim with it).
 */
export function brandMark(id: string, opts: { size?: number; fill?: 'grad' | 'currentColor' } = {}) {
  const size = opts.size ?? 26;
  const paint = opts.fill === 'currentColor' ? 'currentColor' : `url(#${id}-g)`;
  return html`
    <svg width=${size} height=${size} viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shrink-0">
      <defs>
        <linearGradient id="${id}-g" x1="6" y1="8" x2="58" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="var(--logo-from)"/>
          <stop offset="52%" stop-color="var(--accent-mid)"/>
          <stop offset="100%" stop-color="var(--logo-to)"/>
        </linearGradient>
        <!-- The slice sits LOW and thin on purpose. Cut any thicker, or any
             higher than the middle apex, and it severs the W into floating
             fragments that stop reading as a letter at large sizes. Down here
             it crosses only the lower legs, so the mark stays whole, and at
             favicon sizes it falls below a pixel and degrades to a plain W
             rather than to mush. -->
        <mask id="${id}-slice">
          <rect width="64" height="64" fill="#fff"/>
          <rect x="0" y="38" width="64" height="1.8" fill="#000"/>
        </mask>
      </defs>
      <g mask="url(#${id}-slice)">
        <g transform="translate(6.8,0) skewX(-12)">
          <path d=${W_PATH} stroke=${paint} stroke-width="8" stroke-linejoin="miter" stroke-linecap="butt"/>
        </g>
      </g>
    </svg>
  `;
}

/**
 * The full lockup: monogram plus wordmark, as used in the header and footer.
 *
 * The wordmark is live text in the display face rather than an outlined path,
 * which is the right call for the site itself: it inherits the theme colour,
 * it is selectable and readable by a screen reader through the surrounding
 * link, and it costs no extra bytes because Inter Tight is already the
 * preloaded display face. The outlined version exists only in the
 * downloadable assets, where there is no guarantee the font is installed.
 */
export function brandLockup(id: string, opts: { size?: number; text?: number } = {}) {
  const text = opts.text ?? 19;
  return html`
    <span class="inline-flex items-center gap-[9px]">
      ${brandMark(id, { size: opts.size ?? 26 })}
      <span class="font-display font-extrabold tracking-[-0.03em] leading-none" style="font-size:${text}px">webjs</span>
    </span>
  `;
}
