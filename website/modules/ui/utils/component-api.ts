/**
 * Per-component API metadata used to render the "Variants", "Sizes",
 * and "API Reference" sections of /docs/components/<name>.
 *
 * Mirrors shadcn's docs anatomy:
 *   apps/v4/content/docs/components/radix/<name>.mdx
 *
 * Each component there has one <ComponentPreview> per variant + per size
 * under "## Examples", plus a prop table under "## API Reference". We
 * generate the same layout from this data, so the docs page stays in
 * sync with the type exports rather than drifting across hand-written
 * MDX.
 *
 * Keep `variants` / `sizes` arrays in the SAME order as the keys appear
 * in the source `VARIANTS` / `SIZES` consts in packages/registry, the
 * audit script and CLI list will eventually consume both.
 */

export interface ComponentApi {
  /** Display variants, in source order. Triggers the "Variants" section. */
  variants?: string[];
  /**
   * Optional heading override for the variants section. Defaults to
   * "Variants". Set this when the values aren't visual variants in the
   * usual sense, e.g. `separator` uses "Orientation" because its
   * horizontal/vertical options are layout axes, not aesthetic styles.
   */
  variantsLabel?: string;
  /** Display sizes, in source order. Triggers the "Sizes" section. */
  sizes?: string[];
  /** Optional heading override for the sizes section. Defaults to "Sizes". */
  sizesLabel?: string;
  /**
   * Icon-only sizes (e.g. button's icon / icon-xs / icon-sm / icon-lg)
   * that visually need to be demoed without text labels. Rendered as a
   * separate "Icon" section after "Sizes", mirrors shadcn's split of
   * Size + Icon examples on the button page. Keys must have matching
   * entries in ICON_SIZE_EXAMPLES.
   */
  iconSizes?: string[];
  /** Optional heading override for the icon-sizes section. Defaults to "Icon". */
  iconSizesLabel?: string;
  /**
   * Suppress the Variants section even when `variants` is defined.
   * Useful when the hero preview already shows every variant side-by-
   * side and a separate section would just duplicate it (e.g. button).
   * The metadata stays, the API Reference table still lists the
   * variant keys + types, only the live-preview section is hidden.
   */
  hideVariantsSection?: boolean;
  /** Same idea, for the Sizes section. */
  hideSizesSection?: boolean;
  /**
   * 'combined' (default), every variant rendered into one flex-wrap
   * preview pane. Use when each variant's example markup is self-
   * explanatory (e.g. button text reads "Default" / "Destructive" /
   * etc., so the user sees each variant labelled by name).
   *
   * 'cards', each variant gets its own preview pane with a heading
   * above it. Use when the example markup is identical across
   * variants and only the visual style differs, without per-variant
   * headings the user can't tell which is which. Tabs is the canonical
   * case: each variant renders the same Account/Password tabs UI;
   * only the styling differs.
   */
  variantsPreviewMode?: 'combined' | 'cards';
  sizesPreviewMode?: 'combined' | 'cards';
  /**
   * Compound subcomponents (Tier-2 tag names or Tier-1 class-helper
   * names). Listed in the API Reference table under "Parts".
   */
  subcomponents?: Array<{ name: string; description: string }>;
  /** Configurable attributes / props on the main element. */
  props?: Array<{ name: string; type: string; default?: string; description?: string }>;
  /** DOM events fired by the component (Tier-2 only). */
  events?: Array<{ name: string; detail?: string; description?: string }>;
}

export const COMPONENT_API: Record<string, ComponentApi> = {
  // ----- Tier 1, class helpers -----

  alert: {
    variants: ['default', 'destructive'],
    subcomponents: [
      { name: 'alertClass({ variant })', description: 'Container styling.' },
      { name: 'alertTitleClass()', description: 'Heading inside an alert.' },
      { name: 'alertDescriptionClass()', description: 'Body text inside an alert.' },
    ],
    props: [
      {
        name: 'variant',
        type: '"default" | "destructive"',
        default: '"default"',
        description: 'Severity of the alert.',
      },
    ],
  },

  badge: {
    variants: ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'],
    // Hero preview shows all 6 variants side-by-side with name labels , 
    // dedicated Variants section would be a literal duplicate. Same
    // pattern as button. API Reference table at the bottom still lists
    // every variant key + type.
    hideVariantsSection: true,
    subcomponents: [{ name: 'badgeClass({ variant })', description: 'Apply to a span, link, or button.' }],
    props: [
      {
        name: 'variant',
        type: '"default" | "secondary" | "destructive" | "outline" | "ghost" | "link"',
        default: '"default"',
        description: 'Visual style. The extra "ghost" and "link" variants are webjs additions beyond shadcn’s four.',
      },
    ],
  },

  button: {
    variants: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    // Hide the Variants section, the hero preview already shows all 6
    // variants side-by-side with their names. Repeating them in a
    // dedicated section would just be a second copy of the same thing.
    // The API Reference table at the bottom still lists every variant
    // key + type for anyone who wants the precise enum.
    hideVariantsSection: true,
    // Text-button sizes only, icon sizes split into iconSizes below so
    // each section's preview is internally consistent (text buttons of
    // varying heights vs cog icons of varying box sizes).
    sizes: ['default', 'xs', 'sm', 'lg'],
    iconSizes: ['icon-xs', 'icon-sm', 'icon', 'icon-lg'],
    subcomponents: [{ name: 'buttonClass({ variant, size })', description: 'Apply to a native <button> or any element you want to look like one.' }],
    props: [
      {
        name: 'variant',
        type: '"default" | "destructive" | "outline" | "secondary" | "ghost" | "link"',
        default: '"default"',
      },
      {
        name: 'size',
        type: '"default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"',
        default: '"default"',
        description: 'The "xs" and "icon-xs / icon-sm / icon-lg" sizes are webjs additions beyond shadcn’s four.',
      },
    ],
  },

  toggle: {
    variants: ['default', 'outline'],
    sizes: ['default', 'sm', 'lg'],
    subcomponents: [
      { name: 'toggleClass({ variant, size })', description: 'Apply to a native <button> for the controlled pattern.' },
      { name: '<ui-toggle>', description: 'Stateful custom element, manages aria-pressed + data-state for you.' },
    ],
    props: [
      { name: 'variant', type: '"default" | "outline"', default: '"default"' },
      { name: 'size', type: '"default" | "sm" | "lg"', default: '"default"' },
      { name: 'pressed', type: 'boolean (attribute)', default: 'false', description: 'On <ui-toggle>, initial pressed state.' },
      { name: 'disabled', type: 'boolean (attribute)', default: 'false' },
    ],
    events: [
      { name: 'ui-pressed-change', detail: '{ pressed: boolean }', description: 'Fired when the pressed state changes.' },
    ],
  },

  avatar: {
    sizes: ['default', 'sm', 'lg'],
    subcomponents: [
      { name: 'avatarClass({ size })', description: 'Root container, circle with overflow clip.' },
      { name: 'avatarImageClass()', description: 'Img child filling the avatar.' },
      { name: 'avatarFallbackClass()', description: 'Initials / icon shown when the image is missing.' },
      { name: 'avatarBadgeClass()', description: 'Small status dot positioned at the corner.' },
      { name: 'avatarGroupClass()', description: 'Inline-flex wrapper for overlapping avatars.' },
      { name: 'avatarGroupCountClass()', description: 'Trailing "+N" indicator inside a group.' },
    ],
    props: [
      { name: 'size', type: '"default" | "sm" | "lg"', default: '"default"', description: 'webjs extension, shadcn has no size prop.' },
    ],
  },

  switch: {
    sizes: ['default', 'sm'],
    subcomponents: [
      { name: 'switchInputClass()', description: 'Hidden native checkbox that holds the state.' },
      { name: 'switchTrackClass({ size })', description: 'Visible track with the sliding thumb pseudo-element.' },
    ],
    props: [
      { name: 'size', type: '"default" | "sm"', default: '"default"', description: 'webjs extension, shadcn has no size prop.' },
      { name: 'checked', type: 'boolean (on the <input>)', default: 'false' },
      { name: 'disabled', type: 'boolean', default: 'false' },
    ],
  },

  tabs: {
    variants: ['default', 'underline'],
    // Each variant renders the same Account/Password tab UI, only
    // the styling differs (filled list vs underline-indicator). Use
    // per-variant cards with headings so users can tell which is which.
    variantsPreviewMode: 'cards',
    subcomponents: [
      { name: '<ui-tabs>', description: 'Owns the active value + orientation.' },
      { name: '<ui-tabs-list>', description: 'Trigger row. Accepts variant="default | underline".' },
      { name: '<ui-tabs-trigger>', description: 'Tab button, value prop links to a matching content.' },
      { name: '<ui-tabs-content>', description: 'Tab panel, value prop matches its trigger.' },
      { name: 'tabsListClass({ variant })', description: 'Class helper for the list.' },
    ],
    props: [
      { name: 'value', type: 'string', description: 'On <ui-tabs>, controlled active value.' },
      { name: 'orientation', type: '"horizontal" | "vertical"', default: '"horizontal"', description: 'On <ui-tabs>.' },
      { name: 'variant', type: '"default" | "underline"', default: '"default"', description: 'On <ui-tabs-list>, webjs name for shadcn’s underline-style list.' },
    ],
    events: [
      { name: 'ui-value-change', detail: '{ value: string }', description: 'Fired on <ui-tabs> when the active value changes.' },
    ],
  },

  'native-select': {
    sizes: ['default', 'sm'],
    subcomponents: [
      { name: 'nativeSelectWrapperClass()', description: 'Relative wrapper that positions the chevron icon.' },
      { name: 'nativeSelectClass()', description: 'Apply to a native <select>.' },
      { name: 'nativeSelectIconClass()', description: 'Apply to the chevron <svg> rendered absolutely inside the wrapper.' },
      { name: 'nativeSelectOptionClass()', description: 'Advanced override, auto-applied via stylesheet, exported for users who need to inline.' },
    ],
    props: [
      { name: 'data-size', type: '"default" | "sm"', default: '"default"', description: 'Set on the <select> element.' },
    ],
  },

  // ----- Tier 2, stateful custom elements that don't take variant/size but have a rich prop surface -----

  accordion: {
    subcomponents: [
      { name: '<details name="...">', description: 'One row. Items sharing the same name attribute form an exclusive group (Radix type="single"); omit name for independent items (type="multiple").' },
      { name: '<summary>', description: 'Clickable header inside a <details>. Apply accordionTriggerClass() and hide the native ::marker.' },
      { name: 'accordionClass()', description: 'Wrapper around the column of <details> rows.' },
      { name: 'accordionItemClass()', description: 'Applied to each <details>. Adds `group` so the trigger chevron can rotate on `group-open:`.' },
      { name: 'accordionTriggerClass()', description: 'Applied to each <summary>. Hides the native disclosure marker.' },
      { name: 'accordionContentClass()', description: 'Applied to the content wrapper inside <details>.' },
    ],
    props: [
      { name: 'open', type: 'boolean (HTML attribute on <details>)', default: 'absent', description: 'Set on a <details> to render it expanded on first paint.' },
      { name: 'name', type: 'string (HTML attribute on <details>)', default: 'absent', description: 'Items sharing a name form an exclusive group (only one open at a time).' },
      { name: 'disabled', type: 'boolean (argument to accordionTriggerClass)', default: 'false', description: 'Visual disabled state on the <summary>. Combine with the standard `inert` attribute on the <details> for full keyboard prevention, native <details> has no `disabled` attribute.' },
      { name: 'orientation="horizontal"', type: ',  not supported', description: 'Native <details>/<summary> is always vertical (summary above, content below). For a horizontal disclosure, use <ui-tabs> instead.' },
    ],
  },

  'alert-dialog': {
    // size lives on <ui-alert-dialog-content>. The component reflects
    // a `size` attribute into `data-size`, so users can write
    // <ui-alert-dialog-content size="sm">. The preview cards under
    // "Sizes" render the content panel statically (without the modal
    // overlay) so both sizes are visible side-by-side without the user
    // having to open two dialogs.
    sizes: ['default', 'sm'],
    subcomponents: [
      { name: '<ui-alert-dialog>', description: 'Root, owns the open state.' },
      { name: '<ui-alert-dialog-trigger>', description: 'Opens the dialog on click.' },
      { name: '<ui-alert-dialog-content>', description: 'Modal panel. Backed by native <dialog>.showModal() with role="alertdialog"; native Escape close is cancelled via the dialog cancel event, and backdrop click is intentionally not wired (user MUST choose Cancel or Action).' },
      { name: '<ui-alert-dialog-action>', description: 'Primary action button, applies buttonClass automatically. Accepts `variant` (default "default") and `size` (default "default"). Closes the dialog on click.' },
      { name: '<ui-alert-dialog-cancel>', description: 'Cancel button, applies buttonClass automatically. Accepts `variant` (default "outline") and `size` (default "default"). Closes the dialog on click.' },
      { name: 'alertDialogHeaderClass() / TitleClass() / DescriptionClass() / FooterClass() / OverlayClass()', description: 'Class helpers for the static prose layout.' },
    ],
    props: [
      { name: 'open', type: 'boolean (attribute)', default: 'false' },
      { name: 'size', type: '"default" | "sm"', default: '"default"', description: 'On <ui-alert-dialog-content>. Reflected to data-size.' },
      { name: 'variant', type: 'ButtonVariant', default: '"default" (Action), "outline" (Cancel)', description: 'On Action / Cancel. Forwarded to buttonClass on the host.' },
      { name: 'size (button)', type: 'ButtonSize', default: '"default"', description: 'On Action / Cancel. Forwarded to buttonClass.' },
    ],
  },

  dialog: {
    subcomponents: [
      { name: '<ui-dialog>', description: 'Root, owns the open state.' },
      { name: '<ui-dialog-trigger>', description: 'Opens the dialog on click.' },
      { name: '<ui-dialog-content>', description: 'Modal panel. Backed by native <dialog>.showModal(): top-layer rendering, focus trap, Escape to close, and ::backdrop overlay are all provided by the browser. We add body-scroll lock + auto-injected X close button in the top-right corner unless show-close-button="false".' },
      { name: '<ui-dialog-footer show-close-button>', description: 'Footer row. Optionally auto-appends a "Close" outline button when show-close-button is set.' },
      { name: '<ui-dialog-close>', description: 'Close button, wrap any element to close on click.' },
      { name: 'dialogHeaderClass() / TitleClass() / DescriptionClass() / FooterClass() / ContentClass() / OverlayClass() / CloseButtonClass()', description: 'Class helpers for prose layout + close-button positioning.' },
    ],
    props: [
      { name: 'open', type: 'boolean (attribute)', default: 'false' },
      { name: 'show-close-button (on content)', type: '"true" | "false" (attribute)', default: '"true"', description: 'On <ui-dialog-content>. Set to "false" to opt out of the auto-injected X close button in the top-right corner (matches shadcn DialogContent showCloseButton prop).' },
      { name: 'show-close-button (on footer)', type: 'boolean (attribute)', default: 'absent', description: 'On <ui-dialog-footer>. When present, auto-appends an outline-styled "Close" button to the footer (matches shadcn DialogFooter showCloseButton).' },
    ],
  },

  'dropdown-menu': {
    // The `variant` here is on <ui-dropdown-menu-item>, not on the
    // root component, so a top-level "Variants" section misrepresents
    // the API surface. Keep the variant keys in metadata (the API
    // Reference table documents them as part of <ui-dropdown-menu-item>'s
    // props), but hide the preview section. The hero already shows
    // both default items (Profile / Billing / Settings) AND a
    // destructive item (Sign out) inside one realistic menu, which
    // covers both variants in context.
    variants: ['default', 'destructive'],
    hideVariantsSection: true,
    subcomponents: [
      { name: '<ui-dropdown-menu>', description: 'Root, owns the open state and document-level event handlers.' },
      { name: '<ui-dropdown-menu-trigger>', description: 'Toggles the menu.' },
      { name: '<ui-dropdown-menu-content>', description: 'Popover panel, role="menu". Accepts side / align / side-offset.' },
      { name: '<ui-dropdown-menu-item>', description: 'Clickable row. variant="default | destructive", inset boolean.' },
      { name: '<ui-dropdown-menu-label>', description: 'Section header, smaller, semibold, muted.' },
      { name: '<ui-dropdown-menu-separator>', description: 'Horizontal divider.' },
      { name: '<ui-dropdown-menu-shortcut>', description: 'Keyboard shortcut hint, right-aligned.' },
      { name: '<ui-dropdown-menu-group>', description: 'Wraps a set of related items with role="group".' },
      { name: '<ui-dropdown-menu-sub>', description: 'Submenu root.' },
      { name: '<ui-dropdown-menu-sub-trigger>', description: 'Item that opens a submenu, auto-injects a right chevron.' },
      { name: '<ui-dropdown-menu-sub-content>', description: 'Submenu popover panel.' },
    ],
    props: [
      { name: 'open', type: 'boolean (attribute)', default: 'false' },
      { name: 'variant', type: '"default" | "destructive"', default: '"default"', description: 'On <ui-dropdown-menu-item>.' },
      { name: 'inset', type: 'boolean (attribute)', default: 'false', description: 'On <ui-dropdown-menu-item>, <ui-dropdown-menu-label>, and <ui-dropdown-menu-sub-trigger>, left-pad for icon alignment so the row aligns with sibling items that have leading icons.' },
      { name: 'side', type: '"top" | "right" | "bottom" | "left"', default: '"bottom" (content) / "right" (sub-content)' },
      { name: 'align', type: '"start" | "center" | "end"', default: '"start"' },
      { name: 'side-offset', type: 'number (px)', default: '4 (content) / -4 (sub-content)', description: 'Attribute on <ui-dropdown-menu-content> and <ui-dropdown-menu-sub-content>.' },
      { name: 'align-offset', type: 'number (px)', default: '0', description: 'Attribute on <ui-dropdown-menu-content> and <ui-dropdown-menu-sub-content>. Pixels offset along the align axis.' },
      { name: 'text-value', type: 'string (attribute)', description: 'On <ui-dropdown-menu-item>. Override the string matched during typeahead. Defaults to the item textContent. Matches shadcn/Radix textValue.' },
    ],
  },

  popover: {
    subcomponents: [
      { name: '<button popovertarget="id">', description: 'Invoker. The browser toggles the matching popover on click and restores focus on close.' },
      { name: '<div popover id="id">', description: 'Floating panel. Native UA hides it until the invoker fires.' },
      { name: 'popoverContentClass({ side, align, sideOffset })', description: 'Applied to the popover element. Same shape as shadcn `<PopoverContent>` placement props, side / align / sideOffset are encoded into CSS Anchor Positioning utilities.' },
      { name: 'popoverHeaderClass() / TitleClass() / DescriptionClass()', description: 'Class helpers for prose inside the content.' },
      { name: 'positionFloating(trigger, content, opts)', description: 'Imperative positioning utility for callers that cannot yet rely on CSS anchor positioning. Also used internally by tooltip / hover-card / dropdown-menu.' },
    ],
    props: [
      { name: 'side', type: '"top" | "right" | "bottom" | "left"', default: '"bottom"', description: 'Argument to popoverContentClass. Encoded via CSS `position-area`.' },
      { name: 'align', type: '"start" | "center" | "end"', default: '"center"', description: 'Argument to popoverContentClass. Encoded via CSS `position-area`.' },
      { name: 'sideOffset', type: '0 | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24', default: '4', description: 'Argument to popoverContentClass. Pixels between the trigger and the popover. For other values, override margin-{top|bottom|left|right} via inline style.' },
      { name: 'alignOffset', type: '0 | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24', default: '0', description: 'Argument to popoverContentClass. Pixels offset along the align axis (no-op for align="center"). Emitted as a Tailwind translate utility.' },
      { name: 'popover', type: '"auto" | "manual" (HTML attribute)', default: '"auto"', description: 'Auto gets light dismiss + Escape close for free. Manual is JS-driven.' },
      { name: 'popovertarget', type: 'string (HTML attribute on the invoker)', description: 'id of the popover element to toggle. Also wires the invoker as the implicit anchor, no anchor-name / position-anchor needed for the common case.' },
      { name: 'anchor-name / position-anchor', type: 'CSS properties (inline style, optional)', description: 'Only needed when you have multiple invokers for the same popover or want to anchor to a different element than the invoker.' },
    ],
  },

  tooltip: {
    subcomponents: [
      { name: '<ui-tooltip>', description: 'Root, delay-duration attribute controls hover delay.' },
      { name: '<ui-tooltip-trigger>', description: 'Wraps the focusable target.' },
      { name: '<ui-tooltip-content>', description: 'Floating label, side / align / side-offset.' },
    ],
    props: [
      { name: 'delay-duration', type: 'number (ms)', default: '700', description: 'Hover dwell before the tooltip opens.' },
      { name: 'skip-delay-duration', type: 'number (ms)', default: '300', description: 'Window after one tooltip closes during which the next tooltip skips its delay-duration. Matches shadcn TooltipProvider.skipDelayDuration.' },
      { name: 'side', type: '"top" | "right" | "bottom" | "left"', default: '"top"', description: 'Attribute on <ui-tooltip-content>.' },
      { name: 'align', type: '"start" | "center" | "end"', default: '"center"', description: 'Attribute on <ui-tooltip-content>.' },
      { name: 'side-offset', type: 'number (px)', default: '4', description: 'Attribute on <ui-tooltip-content>.' },
      { name: 'align-offset', type: 'number (px)', default: '0', description: 'Attribute on <ui-tooltip-content>. Pixels offset along the align axis (no-op for align="center").' },
    ],
  },

  'hover-card': {
    subcomponents: [
      { name: '<ui-hover-card>', description: 'Root, open-delay / close-delay attributes.' },
      { name: '<ui-hover-card-trigger>', description: 'Hoverable anchor.' },
      { name: '<ui-hover-card-content>', description: 'Floating card.' },
    ],
    props: [
      { name: 'open-delay', type: 'number (ms)', default: '700' },
      { name: 'close-delay', type: 'number (ms)', default: '300' },
      { name: 'side', type: '"top" | "right" | "bottom" | "left"', default: '"bottom"', description: 'Attribute on <ui-hover-card-content>.' },
      { name: 'align', type: '"start" | "center" | "end"', default: '"center"', description: 'Attribute on <ui-hover-card-content>.' },
      { name: 'side-offset', type: 'number (px)', default: '4', description: 'Attribute on <ui-hover-card-content>.' },
      { name: 'align-offset', type: 'number (px)', default: '0', description: 'Attribute on <ui-hover-card-content>. Pixels offset along the align axis.' },
    ],
  },

  collapsible: {
    subcomponents: [
      { name: '<details>', description: 'Root, owns the open state natively. Click or Enter on the <summary> toggles.' },
      { name: '<summary>', description: 'Clickable header. Apply collapsibleTriggerClass() so the native disclosure triangle is hidden and the typography matches.' },
      { name: 'collapsibleClass()', description: 'Applied to the <details>. Marks the disclosure as a `group` so descendants react to `group-open:`.' },
      { name: 'collapsibleTriggerClass()', description: 'Applied to <summary>. Hides the native ::marker.' },
      { name: 'collapsibleContentClass()', description: 'Typography for the content wrapper inside the <details>.' },
    ],
    props: [
      { name: 'open', type: 'boolean (HTML attribute on <details>)', default: 'absent', description: 'Initial state. After mount, toggle via `el.open = true | false` or by clicking the summary.' },
      { name: 'disabled', type: 'boolean (argument to collapsibleTriggerClass)', default: 'false', description: 'Visual disabled state on the <summary>. Combine with the standard `inert` attribute on the <details> for full keyboard prevention, native <details> has no `disabled` attribute.' },
    ],
  },

  progress: {
    subcomponents: [{ name: 'progressClass()', description: 'Apply to the native <progress value max> element. Browser draws the bar via the ::-webkit-progress-value and ::-moz-progress-bar pseudo-elements.' }],
    props: [
      { name: 'value', type: 'number (0-max)', default: 'absent', description: 'Native <progress> attribute. Omit for indeterminate state, which animates the track with pulse.' },
      { name: 'max', type: 'number', default: '1', description: 'Native <progress> attribute.' },
    ],
  },

  'toggle-group': {
    // variant and size are root-level <ui-toggle-group> attributes that
    // propagate to every <ui-toggle-group-item>. Preview cards show a
    // full 3-item group per variant / size so the cascade is visible.
    variants: ['default', 'outline'],
    sizes: ['default', 'sm', 'lg'],
    // Items always read B / I / U regardless of variant or size, the
    // example content is identical across cards, so per-card headings
    // ("Default" / "Outline" / "sm" / "default" / "lg") are the only
    // way to disambiguate which is which.
    variantsPreviewMode: 'cards',
    sizesPreviewMode: 'cards',
    subcomponents: [
      { name: '<ui-toggle-group>', description: 'Root, type="single | multiple", variant, size, spacing, value.' },
      { name: '<ui-toggle-group-item>', description: 'One toggle button in the group.' },
    ],
    props: [
      { name: 'type', type: '"single" | "multiple"', default: '"single"' },
      { name: 'variant', type: '"default" | "outline"', default: '"default"' },
      { name: 'size', type: '"default" | "sm" | "lg"', default: '"default"' },
      { name: 'spacing', type: '"0" | "default"', default: '"0"', description: '"0" joins items into a single rounded bar (shared edges); "default" gaps each item with gap-1 + rounded borders.' },
      { name: 'orientation', type: '"horizontal" | "vertical"', default: '"horizontal"', description: 'Reflected to data-orientation. Vertical stacks items in a column via flex-col.' },
      { name: 'value', type: 'string | string[]', description: 'Controlled active value(s).' },
    ],
    events: [{ name: 'ui-value-change', detail: '{ value: string | string[] }' }],
  },

  sonner: {
    // Toast TYPE goes in the variants slot, each card fires the
    // matching imperative API so the icon + colour treatment for each
    // type is visible.
    variants: ['default', 'success', 'error', 'info', 'warning', 'loading'],
    variantsLabel: 'Toast types',
    // Position reuses the sizes slot with a custom label. Each card
    // mounts its own <ui-sonner position="..."> + a Show button that
    // calls the viewport's addToast() method directly (bypassing the
    // singleton toaster.add routing). Combined mode works because
    // each button is self-labelled "Show top-left" etc.
    sizes: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
    sizesLabel: 'Position',
    subcomponents: [
      { name: '<ui-sonner>', description: 'Toast viewport, position attribute. Mount once per page.' },
      { name: 'toast(msg, opts?)', description: 'Imperative API. Variants: toast.success / toast.error / toast.info / toast.warning / toast.loading / toast.promise / toast.dismiss.' },
    ],
    props: [
      {
        name: 'position',
        type: '"top-left" | "top-right" | "top-center" | "bottom-left" | "bottom-right" | "bottom-center"',
        default: '"bottom-right"',
        description: 'On <ui-sonner>. Viewport corner the toasts stack toward.',
      },
      {
        name: 'duration',
        type: 'number (ms)',
        default: '4000 (0 for loading toasts)',
        description: 'On any toast call. 0 = persistent.',
      },
    ],
  },

  // ----- Tier 1, pure class helpers, no variant/size, just prose -----

  'aspect-ratio': {
    subcomponents: [{ name: 'aspectRatioClass()', description: 'Pairs with the standard Tailwind aspect-* utilities.' }],
  },
  breadcrumb: {
    subcomponents: [
      { name: 'breadcrumbListClass()', description: 'Outer <ol>.' },
      { name: 'breadcrumbItemClass()', description: 'Single <li>.' },
      { name: 'breadcrumbLinkClass()', description: 'Anchor inside an item.' },
      { name: 'breadcrumbPageClass()', description: 'Current-page marker (last item).' },
      { name: 'breadcrumbSeparatorClass()', description: 'Slash / chevron between items.' },
      { name: 'breadcrumbEllipsisClass()', description: '"..." overflow indicator.' },
    ],
  },
  card: {
    sizes: ['default', 'sm'],
    sizesPreviewMode: 'cards',
    subcomponents: [
      { name: 'cardClass({ size })', description: 'Container. size="sm" yields gap-3/py-3; default is gap-6/py-6.' },
      { name: 'cardHeaderClass()', description: 'Header row. Picks up tighter padding when parent card has data-size="sm".' },
      { name: 'cardTitleClass() / cardDescriptionClass()', description: 'Prose inside the header. Title shrinks to text-sm under data-size="sm".' },
      { name: 'cardActionClass()', description: 'Right-aligned action area inside the header.' },
      { name: 'cardContentClass()', description: 'Body padding. Tighter under data-size="sm".' },
      { name: 'cardFooterClass()', description: 'Footer row. Tighter under data-size="sm".' },
    ],
    props: [
      { name: 'size', type: '"default" | "sm"', default: '"default"', description: 'Pass to cardClass AND set data-size on the same host so child helpers (header / title / content / footer) pick up the compact layout via group-data-[size=…]/card.' },
    ],
  },
  checkbox: {
    subcomponents: [{ name: 'checkboxClass()', description: 'Apply to a native <input type="checkbox" data-slot="checkbox">. SVG checkmark auto-paints via :checked.' }],
    props: [
      { name: 'checked', type: 'boolean', default: 'false' },
      { name: 'indeterminate', type: 'IDL property', description: 'Set via JS to paint the indeterminate dash.' },
    ],
  },
  'radio-group': {
    variants: ['vertical', 'horizontal'],
    variantsLabel: 'Orientation',
    // Same Basic/Pro/Enterprise content per orientation, header
    // disambiguates which is which.
    variantsPreviewMode: 'cards',
    subcomponents: [
      { name: 'radioGroupClass({ orientation })', description: 'Apply to <div role="radiogroup">.' },
      { name: 'radioClass()', description: 'Apply to native <input type="radio" data-slot="radio">. Dot SVG auto-paints via :checked.' },
    ],
    props: [
      { name: 'orientation', type: '"vertical" | "horizontal"', default: '"vertical"', description: 'Vertical stacks rows in a grid (Radix default). Horizontal lays radios in a wrapping flex row.' },
    ],
  },
  input: { subcomponents: [{ name: 'inputClass()', description: 'Apply to native <input>.' }] },
  textarea: { subcomponents: [{ name: 'textareaClass()', description: 'Apply to native <textarea>.' }] },
  label: { subcomponents: [{ name: 'labelClass()', description: 'Apply to native <label>.' }] },
  kbd: {
    subcomponents: [
      { name: 'kbdClass()', description: 'Apply to a native <kbd>.' },
      { name: 'kbdGroupClass()', description: 'Inline-flex wrapper for sequences like ⌘ + K.' },
    ],
  },
  separator: {
    // "horizontal" / "vertical" aren't visual variants in the usual
    // sense, they're layout axes. variantsLabel overrides the
    // section heading so /docs/components/separator shows
    // "Orientation" rather than "Variants" above the two preview
    // cards, matching shadcn's docs vocabulary.
    variants: ['horizontal', 'vertical'],
    variantsLabel: 'Orientation',
    // Surrounding markup differs but orientation is the point, header
    // disambiguates which axis each card demos.
    variantsPreviewMode: 'cards',
    subcomponents: [{ name: 'separatorClass({ orientation })', description: 'Apply to <div role="separator">.' }],
    props: [{ name: 'orientation', type: '"horizontal" | "vertical"', default: '"horizontal"' }],
  },
  skeleton: { subcomponents: [{ name: 'skeletonClass()', description: 'Apply to a div with explicit width/height.' }] },
  table: {
    subcomponents: [
      { name: 'tableContainerClass()', description: 'Scroll wrapper.' },
      { name: 'tableClass()', description: 'Apply to <table>.' },
      { name: 'tableHeaderClass() / BodyClass() / FooterClass()', description: 'Apply to <thead>, <tbody>, <tfoot>.' },
      { name: 'tableRowClass()', description: 'Apply to <tr>.' },
      { name: 'tableHeadClass() / CellClass()', description: 'Apply to <th>, <td>.' },
      { name: 'tableCaptionClass()', description: 'Apply to <caption>.' },
    ],
  },
  pagination: {
    // No Sizes section: `size` on paginationLinkClass is a forwarded
    // ButtonSize prop with a sensible default of "icon" (compact
    // square, the canonical pagination look). Demoing competing
    // "default" vs "icon" pagination layouts misrepresents the API:
    // text-padded pagination links aren't a real use case shadcn
    // showcases either. The `size` prop is still documented in the
    // Props table for advanced users; it just doesn't warrant a
    // dedicated preview section.
    subcomponents: [
      { name: 'paginationClass() / ContentClass()', description: 'Outer <nav> + <ul>.' },
      { name: 'paginationLinkClass({ isActive, size })', description: 'Numbered page link.' },
      { name: 'paginationPreviousClass() / NextClass()', description: 'Prev/next nav buttons.' },
      { name: 'paginationEllipsisClass()', description: 'Overflow indicator.' },
    ],
    props: [
      { name: 'isActive', type: 'boolean', description: 'On paginationLinkClass, marks the current page.' },
      { name: 'size', type: 'ButtonSize', default: '"icon"', description: 'Forwarded to buttonClass. The default "icon" gives the compact square page-number style typical of pagination. Override only if you need a non-standard look.' },
    ],
  },
};

/** Lookup helper. Returns `null` when no metadata is defined. */
export function getComponentApi(name: string): ComponentApi | null {
  return COMPONENT_API[name] ?? null;
}
