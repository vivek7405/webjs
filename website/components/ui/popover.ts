/**
 * Popover: floating panel anchored to a trigger button, built on the
 * native HTML Popover API (`popover` attribute + `popovertarget`).
 *
 * Tier-1 (no custom element). The browser handles open / close state,
 * top-layer rendering, light-dismiss on outside click (with
 * `popover="auto"`), Escape-to-close, focus restoration to the invoker,
 * and CSS Anchor Positioning's implicit anchor (a popover invoked via
 * `popovertarget` is automatically anchored to its invoker, no
 * `anchor-name` / `position-anchor` inline style needed for the common
 * case). CSS Anchor Positioning ships in Chrome 125+, Safari 26+,
 * Firefox 134+.
 *
 * shadcn parity:
 *   Popover               → <button popovertarget="id"> + <div id="id" popover>
 *   PopoverContent        → popoverContentClass({ side, align, sideOffset, alignOffset })
 *   PopoverHeader         → popoverHeaderClass()
 *   PopoverTitle          → popoverTitleClass()
 *   PopoverDescription    → popoverDescriptionClass()
 *
 * The `positionFloating` helper is also exported (used by the Tier-2
 * tooltip / hover-card / dropdown-menu components for imperative
 * positioning where CSS Anchor Positioning isn't enough). Migrated from
 * the prior <ui-popover> custom element set.
 *
 * Design tokens used: --popover, --popover-foreground, --border.
 *
 * @example
 * ```html
 * <!-- Single invoker, implicit anchor, zero inline style. -->
 * <button popovertarget="filter" class=${buttonClass({ variant: 'outline' })}>Filter</button>
 * <div id="filter" popover
 *      class=${popoverContentClass({ side: 'bottom', align: 'start', sideOffset: 4 })}>
 *   <div class=${popoverHeaderClass()}>
 *     <h3 class=${popoverTitleClass()}>Filter posts</h3>
 *     <p class=${popoverDescriptionClass()}>By tag and status.</p>
 *   </div>
 * </div>
 *
 * <!-- Explicit anchor, for multiple invokers or anchoring to a different element. -->
 * <span style="anchor-name: --picker">@vivek</span>
 * <button popovertarget="profile">Show</button>
 * <div id="profile" popover style="position-anchor: --picker"
 *      class=${popoverContentClass({ side: 'bottom' })}>
 *   <div class=${popoverHeaderClass()}>
 *     <h3 class=${popoverTitleClass()}>Vivek Khandelwal</h3>
 *     <p class=${popoverDescriptionClass()}>@vivek</p>
 *   </div>
 * </div>
 * ```
 */

// --------------------------------------------------------------------------
// Class helpers
// --------------------------------------------------------------------------

/**
 * Popover content options, mirror shadcn's `<PopoverContent>` props.
 * `side` and `align` map to CSS Anchor Positioning's `position-area`;
 * `sideOffset` maps to a directional margin so the popover sits a few
 * pixels off the anchor's edge.
 *
 * `sideOffset` is restricted to a discrete set so Tailwind 4's static
 * scanner sees each emitted class literal. For arbitrary values,
 * override the margin via inline style on the popover element.
 */
export type PopoverSideOffset = 0 | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24;
export type PopoverAlignOffset = 0 | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24;

export interface PopoverContentOptions {
  /** Which side of the trigger the popover appears on. Default 'bottom'. */
  side?: PopoverSide;
  /** Alignment along the chosen side. Default 'center'. */
  align?: PopoverAlign;
  /** Pixels between the trigger and the popover. Default 4 (shadcn default). */
  sideOffset?: PopoverSideOffset;
  /**
   * Pixels offset along the align axis. Positive values push away from
   * the aligned edge toward the opposite edge. No-op for align='center'.
   * Default 0 (matches shadcn).
   */
  alignOffset?: PopoverAlignOffset;
}

// position-area combinations baked as literal class strings so Tailwind 4's
// scanner generates CSS for every (side, align) pair the helper can return.
// Underscores become spaces in arbitrary CSS values.
const POSITION_AREA_CLASS: Record<string, string> = {
  'top-start': '[position-area:top_span-right]',
  'top-center': '[position-area:top]',
  'top-end': '[position-area:top_span-left]',
  'bottom-start': '[position-area:bottom_span-right]',
  'bottom-center': '[position-area:bottom]',
  'bottom-end': '[position-area:bottom_span-left]',
  'left-start': '[position-area:left_span-bottom]',
  'left-center': '[position-area:left]',
  'left-end': '[position-area:left_span-top]',
  'right-start': '[position-area:right_span-bottom]',
  'right-center': '[position-area:right]',
  'right-end': '[position-area:right_span-top]',
};

// Align-axis translate classes. For align='start', positive offset moves
// the popover AWAY from the start edge (toward the end edge); align='end'
// reverses. align='center' is a no-op. The axis is perpendicular to the
// side: top/bottom sides translate X; left/right sides translate Y.
// All 36 (4 axis-direction combos × 9 offset values) appear literally so
// Tailwind 4 generates each class.
const ALIGN_OFFSET_CLASS: Record<string, Record<PopoverAlignOffset, string>> = {
  'horizontal-start': {
    0: 'translate-x-[0px]',  2: 'translate-x-[2px]',  4: 'translate-x-[4px]',
    6: 'translate-x-[6px]',  8: 'translate-x-[8px]',  12: 'translate-x-[12px]',
    16: 'translate-x-[16px]', 20: 'translate-x-[20px]', 24: 'translate-x-[24px]',
  },
  'horizontal-end': {
    0: 'translate-x-[0px]',  2: 'translate-x-[-2px]',  4: 'translate-x-[-4px]',
    6: 'translate-x-[-6px]',  8: 'translate-x-[-8px]',  12: 'translate-x-[-12px]',
    16: 'translate-x-[-16px]', 20: 'translate-x-[-20px]', 24: 'translate-x-[-24px]',
  },
  'vertical-start': {
    0: 'translate-y-[0px]',  2: 'translate-y-[2px]',  4: 'translate-y-[4px]',
    6: 'translate-y-[6px]',  8: 'translate-y-[8px]',  12: 'translate-y-[12px]',
    16: 'translate-y-[16px]', 20: 'translate-y-[20px]', 24: 'translate-y-[24px]',
  },
  'vertical-end': {
    0: 'translate-y-[0px]',  2: 'translate-y-[-2px]',  4: 'translate-y-[-4px]',
    6: 'translate-y-[-6px]',  8: 'translate-y-[-8px]',  12: 'translate-y-[-12px]',
    16: 'translate-y-[-16px]', 20: 'translate-y-[-20px]', 24: 'translate-y-[-24px]',
  },
};

// Per-side offset margin classes. Side 'bottom' wants margin-top, etc.
// Each value of PopoverSideOffset appears literally for Tailwind's scanner.
const MARGIN_OFFSET_CLASS: Record<PopoverSide, Record<PopoverSideOffset, string>> = {
  top: {
    0: '[margin-bottom:0px]',  2: '[margin-bottom:2px]',  4: '[margin-bottom:4px]',
    6: '[margin-bottom:6px]',  8: '[margin-bottom:8px]',  12: '[margin-bottom:12px]',
    16: '[margin-bottom:16px]', 20: '[margin-bottom:20px]', 24: '[margin-bottom:24px]',
  },
  bottom: {
    0: '[margin-top:0px]',  2: '[margin-top:2px]',  4: '[margin-top:4px]',
    6: '[margin-top:6px]',  8: '[margin-top:8px]',  12: '[margin-top:12px]',
    16: '[margin-top:16px]', 20: '[margin-top:20px]', 24: '[margin-top:24px]',
  },
  left: {
    0: '[margin-right:0px]',  2: '[margin-right:2px]',  4: '[margin-right:4px]',
    6: '[margin-right:6px]',  8: '[margin-right:8px]',  12: '[margin-right:12px]',
    16: '[margin-right:16px]', 20: '[margin-right:20px]', 24: '[margin-right:24px]',
  },
  right: {
    0: '[margin-left:0px]',  2: '[margin-left:2px]',  4: '[margin-left:4px]',
    6: '[margin-left:6px]',  8: '[margin-left:8px]',  12: '[margin-left:12px]',
    16: '[margin-left:16px]', 20: '[margin-left:20px]', 24: '[margin-left:24px]',
  },
};

/**
 * Popover content class. `side` and `align` cover the shadcn
 * `<PopoverContent>` placement props; `sideOffset` sets the gap to
 * the anchor. The visual layer (border, bg, padding, shadow) is
 * fixed to match shadcn's default; width is opinionated at `w-72`
 * (override at the call site).
 *
 * `m-0` clears the UA `margin: auto` so anchor positioning isn't
 * fighting auto-centering, then a single directional margin sets the
 * sideOffset gap.
 */
export function popoverContentClass(opts: PopoverContentOptions = {}): string {
  const side = opts.side ?? 'bottom';
  const align = opts.align ?? 'center';
  const sideOffset = opts.sideOffset ?? 4;
  const alignOffset = opts.alignOffset ?? 0;
  // align='center' has no align axis to offset along, skip the translate.
  let alignClass = '';
  if (align !== 'center' && alignOffset !== 0) {
    const axis = side === 'top' || side === 'bottom' ? 'horizontal' : 'vertical';
    alignClass = ALIGN_OFFSET_CLASS[`${axis}-${align}`][alignOffset];
  }
  return [
    'w-72 m-0 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden',
    POSITION_AREA_CLASS[`${side}-${align}`],
    MARGIN_OFFSET_CLASS[side][sideOffset],
    alignClass,
  ].filter(Boolean).join(' ');
}

export const popoverHeaderClass = (): string => 'flex flex-col gap-1 text-sm';
export const popoverTitleClass = (): string => 'font-medium';
export const popoverDescriptionClass = (): string => 'text-muted-foreground';

// --------------------------------------------------------------------------
// Imperative positioning helper. Still exported for the tier-2 tooltip /
// hover-card / dropdown-menu components, which need exact placement before
// CSS anchor positioning is universally available.
// --------------------------------------------------------------------------

export type PopoverSide = 'top' | 'bottom' | 'left' | 'right';
export type PopoverAlign = 'start' | 'center' | 'end';

export function positionFloating(
  trigger: HTMLElement,
  content: HTMLElement,
  opts: {
    side?: PopoverSide;
    align?: PopoverAlign;
    sideOffset?: number;
    alignOffset?: number;
  } = {},
): void {
  const side = opts.side ?? 'bottom';
  const align = opts.align ?? 'center';
  const sideOffset = opts.sideOffset ?? 4;
  const alignOffset = opts.alignOffset ?? 0;
  const tr = trigger.getBoundingClientRect();
  const cr = content.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 0;
  let left = 0;
  let actualSide = side;

  const fitsBottom = tr.bottom + sideOffset + cr.height <= vh;
  const fitsTop = tr.top - sideOffset - cr.height >= 0;
  const fitsRight = tr.right + sideOffset + cr.width <= vw;
  const fitsLeft = tr.left - sideOffset - cr.width >= 0;

  if (side === 'bottom' && !fitsBottom && fitsTop) actualSide = 'top';
  else if (side === 'top' && !fitsTop && fitsBottom) actualSide = 'bottom';
  else if (side === 'right' && !fitsRight && fitsLeft) actualSide = 'left';
  else if (side === 'left' && !fitsLeft && fitsRight) actualSide = 'right';

  if (actualSide === 'bottom') top = tr.bottom + sideOffset;
  else if (actualSide === 'top') top = tr.top - sideOffset - cr.height;
  else if (actualSide === 'right' || actualSide === 'left') {
    if (align === 'start') top = tr.top;
    else if (align === 'end') top = tr.bottom - cr.height;
    else top = tr.top + (tr.height - cr.height) / 2;
  }

  if (actualSide === 'right') left = tr.right + sideOffset;
  else if (actualSide === 'left') left = tr.left - sideOffset - cr.width;
  else {
    if (align === 'start') left = tr.left;
    else if (align === 'end') left = tr.right - cr.width;
    else left = tr.left + (tr.width - cr.width) / 2;
  }

  // alignOffset shifts the popover along the align axis. For align='start',
  // positive shifts AWAY from the start edge; align='end' reverses; center
  // is a no-op. Axis is perpendicular to the chosen side.
  if (align !== 'center' && alignOffset !== 0) {
    const dir = align === 'start' ? 1 : -1;
    if (actualSide === 'top' || actualSide === 'bottom') {
      left += dir * alignOffset;
    } else {
      top += dir * alignOffset;
    }
  }

  left = Math.max(8, Math.min(left, vw - cr.width - 8));
  top = Math.max(8, Math.min(top, vh - cr.height - 8));

  content.style.top = `${top}px`;
  content.style.left = `${left}px`;
  content.setAttribute('data-side', actualSide);
  content.setAttribute('data-align', align);
}
