import { html } from '@webjsdev/core';

/**
 * The brand marks.
 *
 * The drawing is the original Velocity lockup and is deliberately NOT
 * re-derived here. Two properties of it are load-bearing and were lost when it
 * was redrawn once already:
 *
 * - The wordmark is ITALIC, so it leans with the W instead of standing upright
 *   beside it. An upright wordmark breaks the whole idea.
 * - The monogram IS the W of "WebJs". The mark is not a separate badge sitting
 *   next to the name, it is the name's first letter, and one horizontal slice
 *   cuts the lockup as a single object.
 *
 * The files are served as images rather than inlined, because the wordmark
 * carries an embedded variable italic face and re-outlining it is not
 * currently safe: opentype.js applies this font's variable deltas wrongly,
 * silently dropping the "Js" and deforming the "b". Until the face can be
 * subset properly the authored file is the source of truth. That costs one
 * cached request per theme, which is the right trade against shipping a
 * corrupted logo.
 *
 * The light and dark files differ only in the two PAINTED fills. The #fff
 * inside the <mask> is the mask channel and must stay white in both, or the
 * mark disappears entirely.
 */

const LOCKUP_DARK = '/public/brand/webjs-lockup-on-dark.svg';
const LOCKUP_LIGHT = '/public/brand/webjs-lockup-on-light.svg';

/**
 * The full lockup, theme-aware.
 *
 * Both variants are emitted and one is hidden per theme rather than applying a
 * CSS filter to a single file. `invert()` on the dark file does not produce the
 * light one: it inverts the paper as well as the ink, so the mark stops sitting
 * on the page background.
 *
 * `height` is in px and drives the box; width follows the intrinsic ratio.
 */
export function brandLockup(_id: string, opts: { height?: number } = {}) {
  const h = opts.height ?? 22;
  const cls = `block w-auto`;
  return html`
    <span class="inline-flex items-center" style="height:${h}px">
      <img src=${LOCKUP_DARK} alt="WebJs" class="${cls} hidden dark:block" style="height:${h}px" />
      <img src=${LOCKUP_LIGHT} alt="WebJs" class="${cls} dark:hidden" style="height:${h}px" />
    </span>
  `;
}

/**
 * The monogram on its own, theme-aware. Greyscale: the mark carries no colour
 * in any variant, which is why there is nothing here to tint.
 *
 * `height` drives the box, width follows the ratio, the same as the lockup.
 * For a square placement that needs its own background (favicon, avatar, app
 * icon) use the tiled file at /public/brand/webjs-monogram.svg instead.
 */
export function brandMark(_id: string, opts: { height?: number } = {}) {
  const h = opts.height ?? 24;
  return html`
    <span class="inline-flex items-center" style="height:${h}px">
      <img src="/public/brand/webjs-mark-on-dark.svg" alt="WebJs" class="block w-auto hidden dark:block" style="height:${h}px" />
      <img src="/public/brand/webjs-mark-on-light.svg" alt="WebJs" class="block w-auto dark:hidden" style="height:${h}px" />
    </span>
  `;
}
