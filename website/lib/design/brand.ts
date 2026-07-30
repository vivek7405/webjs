import { html } from '@webjsdev/core';

/**
 * The brand marks.
 *
 * The drawing is the original Velocity lockup. As of the design-review round
 * the wordmark is OUTLINED PATHS (2.8 KB per variant), generated from the
 * authored geometry with the embedded face instanced at weight 900, so the
 * files no longer carry a 56 KB font and render identically in browsers,
 * markdown viewers, and design tools. Regenerate via
 * scratchpad fonttool/outline-lockup.cjs if the drawing ever changes.
 *
 * Each variant is a separate file rather than one CSS-inverted image because
 * inverting flips the paper along with the ink. Both <img>s carry explicit
 * width/height so the header composes before any fetch, and at ~3 KB each the
 * hidden variant's download is noise.
 */

const LOCKUP_DARK = '/public/brand/webjs-lockup-on-dark.svg';
const LOCKUP_LIGHT = '/public/brand/webjs-lockup-on-light.svg';

/** Intrinsic aspect of the lockup files (722 x 190). */
const RATIO = 722 / 190;

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
      <img src=${LOCKUP_DARK} alt="WebJs" width=${Math.round(h * RATIO)} height=${h} class="${cls} hidden dark:block" style="height:${h}px" />
      <img src=${LOCKUP_LIGHT} alt="WebJs" width=${Math.round(h * RATIO)} height=${h} class="${cls} dark:hidden" style="height:${h}px" />
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
