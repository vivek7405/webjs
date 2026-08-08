/**
 * Tiny class-name merger. Drop-in replacement for the clsx + tailwind-merge
 * pair used in shadcn.
 *
 * - Concatenates truthy arguments separated by spaces.
 * - Later Tailwind utilities win when they target the same property, mimicking
 *   `tailwind-merge`'s behaviour for the cases components actually hit
 *   (background colour, image, clip, origin, blend mode, position, size,
 *   repeat, attachment; text colour, size, alignment, wrapping, overflow;
 *   box-shadow and text-shadow, each split into size and colour; padding,
 *   margin, width, height, border, rounded, opacity, display).
 *
 * For projects that want the full tailwind-merge behaviour, install
 * `clsx` + `tailwind-merge` and replace this file:
 *
 *   import { clsx, type ClassValue } from 'clsx';
 *   import { twMerge } from 'tailwind-merge';
 *   export function cn(...inputs: ClassValue[]) {
 *     return twMerge(clsx(inputs));
 *   }
 */
export type ClassValue = string | number | null | false | undefined | ClassValue[] | Record<string, unknown>;

export function cn(...inputs: ClassValue[]): string {
  const flat: string[] = [];
  walk(inputs, flat);
  return dedupeUtilities(flat.join(' ')).trim();
}

function walk(value: ClassValue, out: string[]): void {
  if (!value) return;
  if (typeof value === 'string' || typeof value === 'number') {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, out);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (v) out.push(k);
    }
  }
}

// Conflict groups: classes with the same group key: last one wins.
// Covers ~95% of in-component overrides the registry exposes.
//
// IMPORTANT: text-size (text-sm, text-xs, text-base, text-lg, …) and
// text-color (text-primary, text-foreground, …) are DIFFERENT properties
// and must be in different groups. Same for bg-size vs bg-color etc.
const GROUPS: Array<[RegExp, string]> = [
  [/^p-/, 'p'], [/^px-/, 'px'], [/^py-/, 'py'], [/^pt-/, 'pt'], [/^pr-/, 'pr'], [/^pb-/, 'pb'], [/^pl-/, 'pl'],
  [/^m-/, 'm'], [/^mx-/, 'mx'], [/^my-/, 'my'], [/^mt-/, 'mt'], [/^mr-/, 'mr'], [/^mb-/, 'mb'], [/^ml-/, 'ml'],
  [/^w-/, 'w'], [/^h-/, 'h'], [/^size-/, 'size'],
  // A `bg-[url(…)]` / `bg-[linear-gradient(…)]` background image is classified
  // by its FUNCTION, since it carries no type hint to classify it by. The
  // hinted forms are handled centrally, in `hintedGroup`.
  [/^bg-\[(url\(|linear-gradient|radial-gradient|conic-gradient)/, 'bg-image'],
  [/^bg-(linear|gradient|conic|radial|none)/, 'bg-image'],
  [/^bg-(no-repeat|repeat|repeat-x|repeat-y|repeat-round|repeat-space)$/, 'bg-repeat'],
  [/^bg-(fixed|local|scroll)$/, 'bg-attach'],
  [/^bg-(auto|cover|contain)$/, 'bg-size'],
  [/^bg-size-/, 'bg-size'],
  // Two entries rather than one alternation: the first covers the live v4
  // compounds (`bg-top-left`), the second the bare keywords plus the v4.1
  // deprecated reversed compounds (`bg-left-top`), which tailwind-merge still
  // carries. An unmatched `bg-*` token falls into the colour catch-all below and
  // evicts a real colour, so admitting a dead spelling is the safe direction.
  [/^bg-(top|bottom)(-(left|right))?$/, 'bg-position'],
  [/^bg-(left|right|center)(-(top|bottom))?$/, 'bg-position'],
  [/^bg-position-/, 'bg-position'],
  // Clip, origin, and blend mode are three more properties under the same
  // prefix. Each sat in `bg-color` before, so `bg-clip-text` evicted a real
  // background colour (the gradient-text idiom lost its clip silently).
  [/^bg-clip-(border|padding|content|text)$/, 'bg-clip'],
  [/^bg-origin-(border|padding|content)$/, 'bg-origin'],
  [/^bg-blend-(normal|multiply|screen|overlay|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity)$/, 'bg-blend'],
  [/^bg-/, 'bg-color'],
  // text-shadow is its own property, and its size scale and its colour are two
  // properties again. All three entries precede the text- patterns below, which
  // is what keeps a `text-shadow-*` token out of `text-size` and `text-color`.
  [/^text-shadow(-(2xs|xs|sm|md|lg|none))?(\/([\d.]+|\[[^\]]*\]))?$/, 'text-shadow'],
  [/^text-shadow-(\[(inset|-|\.|\d|var\()|\(--)/, 'text-shadow'],
  [/^text-shadow-/, 'text-shadow-color'],
  // Font size: explicit list of Tailwind size scale.
  [/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/, 'text-size'],
  // Alignment, wrapping, and overflow are three more properties under the same
  // prefix. Each was previously excluded from text-color by a lookahead and then
  // matched nothing at all, so two alignments never collapsed.
  [/^text-(left|center|right|justify|start|end)$/, 'text-align'],
  [/^text-(wrap|nowrap|balance|pretty)$/, 'text-wrap'],
  [/^text-(ellipsis|clip)$/, 'text-overflow'],
  // Text color: anything else under the prefix. The specific groups above are
  // the whole carve-out, so no negative lookahead is needed here as well.
  [/^text-/, 'text-color'],
  // Border sub-properties that are neither a width nor a colour. These come
  // FIRST so the width / colour classifier below never sees them.
  [/^border-(collapse|separate)$/, 'border-collapse'],
  [/^border-spacing(-[xy])?-/, 'border-spacing'],
  [/^border-(solid|dashed|dotted|double|hidden|none)$/, 'border-style'],
  ...borderGroups(),
  [/^rounded(-[a-z]+)?$/, 'rounded'],
  [/^rounded-/, 'rounded'],
  [/^opacity-/, 'opacity'],
  [/^font-(thin|light|normal|medium|semibold|bold|black|extralight|extrabold)$/, 'font-weight'],
  // Box-shadow SIZE and box-shadow COLOUR are two properties (`box-shadow` and
  // `--tw-shadow-color`), so they need two groups. `shadow-none` is a size,
  // `shadow-inherit` / `shadow-initial` are colours, and Tailwind accepts an
  // alpha modifier on a size as well as on a colour, so `shadow-lg/25` has to
  // stay on the size side. An unhinted arbitrary value is a SIZE when it opens
  // with `inset`, a sign, a dot, or a digit (a shadow offset list) and also
  // when it is a bare `var()` or the `(--x)` variable shorthand: Tailwind
  // itself resolves an ambiguous arbitrary shadow to `box-shadow` unless the
  // value is provably a colour, and `shadow-[var(--shadow-glow)]` is the normal
  // way to write a design-token shadow. This is the one place the
  // `borderGroups()` convention inverts, because a bare `border-[var(--x)]` is
  // far more often a colour while a bare `shadow-[var(--x)]` is far more often
  // a shadow. The size entries must precede the colour catch-all, or every
  // size lands in the colour group and the bug inverts rather than being fixed.
  [/^shadow(-(2xs|xs|sm|md|lg|xl|2xl|inner|none))?(\/([\d.]+|\[[^\]]*\]))?$/, 'shadow'],
  [/^shadow-(\[(inset|-|\.|\d|var\()|\(--)/, 'shadow'],
  // A bare name the size scale does not list reads as a colour, because
  // `shadow-primary` is overwhelmingly more common than a `@theme`-extended
  // `--shadow-card`. A project that adds a custom shadow NAME is the residual
  // gap, and the docs say so rather than claiming the split is total.
  [/^shadow-/, 'shadow-color'],
  [/^z-/, 'z'],
  // A bare `flex` / `grid` is a DISPLAY value, not a member of the flex / grid
  // sub-property groups below, so it must never dedupe against them: an element
  // can be both a flex container and a flex child (`class="flex flex-1"`), and
  // collapsing the two silently drops `display:flex`. It still belongs to a
  // group of its own, alongside every other display keyword, so a repeated one
  // collapses and `cn('hidden', open && 'flex')` resolves to one display.
  [/^(inline-block|inline-flex|inline-grid|inline-table|inline|block|flex|grid|flow-root|contents|hidden|list-item|table-caption|table-cell|table-column-group|table-column|table-footer-group|table-header-group|table-row-group|table-row|table)$/, 'display'],
  // Each sub-utility below gets the group of the real CSS property it sets, so
  // none of them collapses against the display value or against each other.
  [/^flex-(row|row-reverse|col|col-reverse)$/, 'flex-direction'],
  [/^flex-(wrap|wrap-reverse|nowrap)$/, 'flex-wrap'],
  [/^flex-(\d+|auto|initial|none|\[[^\]]*\])$/, 'flex'],
  [/^grid-cols-/, 'grid-cols'],
  [/^grid-rows-/, 'grid-rows'],
  [/^grid-flow-/, 'grid-flow'],
];

/**
 * Border WIDTH and border COLOUR share the `border-` prefix but are different
 * CSS properties, so they need different groups: `cn('border-2',
 * 'border-primary')` must keep BOTH, while `cn('border-border',
 * 'border-accent')` must keep only the later colour (today the winner is
 * decided by compiled stylesheet order, which silently loses whenever the
 * override sorts alphabetically earlier).
 *
 * Classification, after an optional side / axis segment: a bare or numeric
 * value is a width (`border`, `border-2`, `border-t-4`), an arbitrary value
 * that opens with a digit, a dot, or `length:` is a width (`border-[3px]`,
 * `border-[length:var(--w)]`), and everything else is a colour
 * (`border-primary`, `border-red-500/50`, `border-[#fff]`). An ambiguous
 * `border-[var(--x)]` falls to colour, which is the far more common intent.
 *
 * Each side is its own group so a per-side utility only overrides its own side,
 * and the shorthand / axis subsumption is declared in CONFLICTS below, exactly
 * like padding and margin. The logical inline sides (`border-s-*`,
 * `border-e-*`) get their own groups but are subsumed only by the all-sides
 * shorthand, never by `border-x-*`: which physical side they land on depends on
 * the writing direction, so an axis override there would be a guess.
 */
function borderGroups(): Array<[RegExp, string]> {
  const width = '(\\d+(\\.\\d+)?|\\[(length:|\\d|\\.)[^\\]]*\\])';
  const out: Array<[RegExp, string]> = [];
  // Sides before the bare form: `border-t-primary` must match the `t` colour
  // group, not be swallowed by the side-less `^border-` colour pattern.
  const sides = ['x', 'y', 't', 'r', 'b', 'l', 's', 'e', ''];
  for (const side of sides) {
    const seg = side ? `-${side}` : '';
    out.push([new RegExp(`^border${seg}(-${width})?$`), `border-w${seg}`]);
  }
  for (const side of sides) {
    const seg = side ? `-${side}` : '';
    out.push([new RegExp(`^border${seg}-`), `border-color${seg}`]);
  }
  return out;
}

/**
 * An arbitrary value may carry a Tailwind TYPE HINT: `bg-[image:var(--g)]`,
 * `text-[length:14px]`, `shadow-[color:red]`. The hint exists precisely because
 * the utility prefix is ambiguous, so the PREFIX cannot decide the group and
 * the hint must. Letting a hinted value fall into the prefix's default group
 * evicts a class that sets an entirely different property (`shadow-[color:red]`
 * would eat `shadow-lg`).
 *
 * Every `<prefix>:<hint>` pair listed here names the group it belongs to; an
 * empty string means the hint names the prefix's OWN default property, so the
 * GROUPS table above is already right for it and matching falls through. A pair
 * that is NOT listed gets a group of its own, so it can only ever collide with
 * the identical hint under the identical prefix, never with the prefix's
 * default. That is the safe direction to fail: an extra class renders, a
 * dropped one does not.
 *
 * This is central rather than per-prefix on purpose. Handling only the prefixes
 * that came to mind is how `shadow-[color:red]` was left evicting `shadow-lg`
 * while `bg-` and `text-` were correct.
 *
 * These reach the matcher at all only because `variantPrefix` splits on the
 * last colon OUTSIDE brackets; see the comment there.
 */
const HINTED_GROUPS: Record<string, string> = {
  'bg:color': '',
  'bg:image': 'bg-image',
  'bg:position': 'bg-position',
  'bg:size': 'bg-size',
  'bg:length': 'bg-size',
  'text:color': '',
  'text:length': 'text-size',
  // Both shadow prefixes carry a colour that is a DIFFERENT property from the
  // prefix's own default (the size), so the hint has a named group to point at
  // and must, or `shadow-[color:red]` keeps an isolated bucket and stops
  // deduping against `shadow-red-500`, which sets the identical property.
  'shadow:color': 'shadow-color',
  'text-shadow:color': 'text-shadow-color',
};

/**
 * The group for a hinted arbitrary value, `null` when the normal GROUPS table
 * should decide it, `undefined` when the token carries no hint at all.
 */
function hintedGroup(bare: string): string | null | undefined {
  const m = /^([a-z][a-z-]*)-\[([a-z][a-z-]*):/.exec(bare);
  if (!m) return undefined;
  const prefix = m[1];
  const hint = m[2];
  const key = `${prefix}:${hint}`;
  if (key in HINTED_GROUPS) return HINTED_GROUPS[key] || null;
  // A border width or colour hint is read by `borderGroups()`'s value parser,
  // which already classifies `border-[length:2px]` as a width and everything
  // else after `border-` as a colour. The side list MUST match the one
  // `borderGroups()` enumerates, logical inline sides included, or the hinted
  // and plain spellings of one utility land in different groups.
  if (/^border(-[xytrbles])?$/.test(prefix) && (hint === 'length' || hint === 'color')) return null;
  return `hint:${key}`;
}

// Directional shorthand conflicts (the tailwind-merge model): a shorthand
// utility invalidates the axis/side utilities it SUBSUMES (`p-0` beats an earlier
// `px-4 py-2`), but a later axis only refines a shorthand (both survive). Keyed
// by the group of a newly-seen token; the value lists the EARLIER groups it removes.
const CONFLICTS: Record<string, string[]> = {
  p: ['px', 'py', 'pt', 'pr', 'pb', 'pl'],
  px: ['pl', 'pr'],
  py: ['pt', 'pb'],
  m: ['mx', 'my', 'mt', 'mr', 'mb', 'ml'],
  mx: ['ml', 'mr'],
  my: ['mt', 'mb'],
  size: ['w', 'h'],
  'border-w': ['border-w-x', 'border-w-y', 'border-w-t', 'border-w-r', 'border-w-b', 'border-w-l', 'border-w-s', 'border-w-e'],
  'border-w-x': ['border-w-l', 'border-w-r'],
  'border-w-y': ['border-w-t', 'border-w-b'],
  'border-color': ['border-color-x', 'border-color-y', 'border-color-t', 'border-color-r', 'border-color-b', 'border-color-l', 'border-color-s', 'border-color-e'],
  'border-color-x': ['border-color-l', 'border-color-r'],
  'border-color-y': ['border-color-t', 'border-color-b'],
};

function dedupeUtilities(input: string): string {
  const tokens = input.split(/\s+/).filter(Boolean);
  // `${prefix}::${group}` -> index of the last SURVIVING token in that group.
  const lastByKey = new Map<string, number>();
  const result: Array<string | null> = [];

  for (const token of tokens) {
    // Strip variant prefix (`hover:`, `dark:md:`, …) before testing each dedupe
    // regex so `hover:bg-red-500` still matches the `bg-color` group. Conflicts
    // only apply WITHIN the same variant (`px-4 hover:p-0` keeps both).
    const prefix = variantPrefix(token);
    const bare = prefix ? token.slice(prefix.length) : token;
    // A type-hinted arbitrary value is classified by its HINT, which overrides
    // the prefix-keyed table below (`hintedGroup` returns null when the hint
    // names the prefix's own default property and the table is already right).
    const hinted = hintedGroup(bare);
    let gk: string | null = hinted ?? null;
    if (hinted === undefined || hinted === null) {
      for (const [re, g] of GROUPS) {
        if (re.test(bare)) { gk = g; break; }
      }
    }
    if (gk) {
      // Remove earlier survivors in this group AND in every group it subsumes.
      for (const g of [gk, ...(CONFLICTS[gk] ?? [])]) {
        const k = `${prefix}::${g}`;
        const idx = lastByKey.get(k);
        if (idx !== undefined) { result[idx] = null; lastByKey.delete(k); }
      }
      lastByKey.set(`${prefix}::${gk}`, result.length);
    }
    result.push(token);
  }
  return result.filter(Boolean).join(' ');
}

function variantPrefix(token: string): string {
  // Capture leading variants like `hover:`, `dark:`, `md:`: overrides only
  // conflict within the same variant set. The split is the last colon OUTSIDE
  // square brackets, because an arbitrary value can contain one of its own
  // (`border-[length:2px]`, `bg-[url(https://x/y.png)]`, `text-[color:var(--c)]`).
  // Splitting on the last colon anywhere hands the group matcher a fragment
  // like `2px]`, which matches nothing, so the utility silently stops
  // deduping against its own property.
  let depth = 0;
  let i = -1;
  for (let n = 0; n < token.length; n += 1) {
    const c = token[n];
    if (c === '[') depth += 1;
    else if (c === ']') depth -= 1;
    else if (c === ':' && depth === 0) i = n;
  }
  return i === -1 ? '' : token.slice(0, i + 1);
}

// ---------------------------------------------------------------------------
// Layout helpers: encode the design-system rhythm (spacing between label /
// input / hint, between form fields, between sections). Change one helper to
// retune the whole app: call sites stay readable inline Tailwind.
// ---------------------------------------------------------------------------

/** Vertical rhythm inside a single form field: label ↔ control ↔ hint/error. */
export const fieldClass = () => 'grid gap-2';

/** Horizontal field layout: label on the left, control on the right. */
export const fieldRowClass = () => 'flex items-center gap-3';

/** Gap step for `stackClass({ gap })`. */
export type StackGap = 'sm' | 'md' | 'lg';

/**
 * Stack of form fields. `sm` for tight groupings, `lg` for spaced-out sections.
 *
 * Object-arg shape matches the rest of the kit (`buttonClass({ variant, size })`,
 * `badgeClass({ variant })`, etc.): predictable across all helpers and
 * extensible if a second dimension (e.g. `direction`) is ever added.
 */
export const stackClass = (opts: { gap?: StackGap } = {}): string => {
  const gap = opts.gap ?? 'md';
  return gap === 'sm' ? 'grid gap-3' : gap === 'lg' ? 'grid gap-8' : 'grid gap-6';
};

/** Form body: same rhythm as a `lg` stack; semantic name for `<form>` content. */
export const formClass = () => 'grid gap-6';

/** Top-level section separation (between form groups, between sections of a page). */
export const sectionClass = () => 'grid gap-8';

// ---------------------------------------------------------------------------
// Typography helpers: fixed text styles used across the design system.
// ---------------------------------------------------------------------------

/** Form-field label: `<label>` text style. */
export const fieldLabelClass = () =>
  'text-sm leading-none font-medium select-none group-data-[disabled=true]/field:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50';

/** Subdued helper / hint text below a form field. */
export const hintClass = () => 'text-sm text-muted-foreground';

/** Tertiary help text (smaller than hint). */
export const helpClass = () => 'text-xs text-muted-foreground';

/** Validation error text: replaces hint when the field is invalid. */
export const errorClass = () => 'text-sm font-medium text-destructive';
