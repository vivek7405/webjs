# Styling

## What This Covers

- Tailwind-first: the strong default for pages AND light-DOM components, and the Lit reflex it counters
- The light-DOM tag-prefix invariant when raw CSS is unavoidable
- Extracting a repeated Tailwind bundle into a `lib/utils/ui.ts` `html` fragment (not `@apply`)
- Design tokens: `:root` / `@theme` in the root layout
- Light-DOM host `display: block` behaviour (and shadow hosts via `:host`)
- When to use `static styles` (shadow DOM)
- Accessible native controls (label association, `aria-pressed`, `aria-label`)
- `position: fixed`, not `sticky`, for a pinned header (the iOS WebKit flicker)
- Even-grid / no-reflow layout tips

Read this when a task touches a class list, a `<style>`, a design token, a pinned header, or a grid/board/card layout. Sibling ref: `components.md` (light vs shadow DOM, `static styles`, host behaviour in depth).

## Tailwind-first is the strong default

Use Tailwind utilities for pages AND light-DOM components (the default DOM mode). Layout, spacing, color (via `@theme` tokens), typography, borders, radius, shadows, and interaction states (hover/focus/active/disabled, dark mode) are all utility-expressible. Light DOM does not scope styles, so a utility class on a light-DOM element resolves against the global stylesheet exactly as it does on a page. That is why utilities are the right tool there, not an exception.

### The Lit muscle-memory trap

In Lit a component owns a shadow root and scopes its CSS with `static styles = css\`\``, so the reflex is to author scoped CSS or an inline `<style>` with semantic class names (`.hero`, `.card`, `.btn`) per component. In WebJs the default is light DOM, which does NOT scope. A `css` block does nothing without `static shadow = true` (the framework warns at runtime), and an inline `<style>` with bare semantic class names leaks those names into the global namespace. Reach for Tailwind utilities instead. When the same bundle repeats, extract a `lib/utils/ui.ts` helper returning an `html` fragment (below), NOT a CSS class.

### The custom-CSS allowlist

Reserve raw CSS for what utilities genuinely cannot express. This is the exhaustive list, anything outside it should be a utility or a `lib/utils/ui.ts` helper:

- design-token `:root` + `@theme` definitions (palette, fonts, fluid type scale, motion durations, declared once in the root layout),
- `@property` animated custom properties paired with `@keyframes`,
- `::-webkit-scrollbar` and `scrollbar-color` (no utility surface),
- `prefers-reduced-motion` blocks,
- complex `color-mix()` or gradient effects a utility cannot spell.

When custom CSS IS unavoidable inside a light-DOM component, the tag-prefix invariant holds (every class selector is prefixed with the component tag). Shadow-DOM components (`static shadow = true`) legitimately author `static styles = css\`\``, the right home for scoped CSS. The Tailwind-first steer is about the LIGHT-DOM default, not shadow DOM.

## DRY via a JS helper, not `@apply`

When the same Tailwind bundle repeats across 2+ places, extract it into a helper that returns an `html` fragment (SSR-time, no client runtime, output identical to inline classes). Where the helper LIVES follows the narrowest-owner rule, so pick the tier by who consumes it:

| Consumers | Home |
|---|---|
| routes across the app (a heading, a lede, a back link) | `lib/utils/ui.ts` |
| one feature (a board, a match card, a comment row) | `modules/<feature>/utils/ui/<name>.ts` |

One file per fragment under `utils/ui/`, because a feature accumulates several and one-per-file keeps them greppable. A fragment promotes from the feature tier to `lib/` only when a second feature genuinely consumes it.

The `ui` segment is the part that carries meaning, so keep it at both tiers: inside `modules/<feature>/`, `components/` holds custom elements, `utils/ui/` holds functions returning a `TemplateResult`, and the rest of `utils/` holds functions returning data. Dropping it lands a view fragment beside a pure data helper with nothing in the path to tell them apart.

The example below is the app-wide tier:

```ts
import { html } from '@webjsdev/core';

/** `● label` kicker: small caps, accent colour, above headings. */
export function rubric(label: string, mb: 'sm' | 'md' = 'md') {
  const mbCls = mb === 'sm' ? 'mb-3' : 'mb-4';
  return html`
    <span class="block font-mono text-[11px] leading-none font-semibold tracking-[0.2em] uppercase text-primary ${mbCls}">● ${label}</span>
  `;
}
```

```ts
// app/blog/[slug]/page.ts
import { rubric } from '#lib/utils/ui.ts';

export default function Post({ params }) {
  return html`${rubric('post')}<h1 class="font-serif ...">${title}</h1>`;
}
```

| Repeats | Action |
|---|---|
| Once | Inline the classes. |
| 2 to 3 times, identical, inside ONE feature | Extract to `modules/<feature>/utils/ui/<name>.ts`. |
| 2 to 3 times, identical, across features or routes | Extract to `lib/utils/ui.ts`. |
| Varies by 1 to 2 props | Extract with a small parameter (`mb: 'sm' \| 'md'`). |
| Radically different per call site | Keep inline, do not force-fit. |

Avoid `@apply`: it hides which utilities a class uses and creates a second source of truth. A JS helper keeps the bundle visible at the definition site, composes with conditional classes and active states, and runs at SSR time.

### Reach for a fragment before a component

A fragment helper, not a display-only component, is the default for read-only markup, and the reason is cost rather than taste. A component that only renders is normally elided from the browser, so making one looks free. It stops being free the moment a SHIPPING island renders it, because a component rendered by a component that ships can no longer be elided: the class downloads, and it upgrades once per instance. A board drawn inside a live `<match-replay>` island is exactly that case, so as a fragment it stays free SSR markup and as a component it becomes shipped JavaScript.

Reach for a component when the markup needs behaviour of its own (state, an event handler, a lifecycle hook), and for nothing less. "It felt tidier as an element" is how free HTML turns into a payload.

### A design system for repeated PRIMITIVES: class helpers built on `@webjsdev/ui`

An `html`-fragment helper is right for a repeated CHUNK of markup (the rubric above). For a repeated UI PRIMITIVE (button, input, card, badge) that needs variants and sizes, use a class helper instead: a function that returns a Tailwind class STRING you spread onto a native element. That is exactly what `@webjsdev/ui` ships (`buttonClass({ variant, size })`, `cardClass()`, `inputClass()`, `badgeClass({ variant })`), and it is what the scaffold gallery uses in `components/ui/`. To style a ONE-OFF that a variant does not cover (a circular icon button, a pill), compose the helper and override the bespoke bits with `cn()`: `cn(buttonClass({ variant: 'secondary', size: 'none' }), 'w-9 h-9 rounded-full')`. `cn` resolves Tailwind conflicts so a later class wins, including a shorthand over the axis it subsumes (`p-0` beats an earlier `px-4 py-2`), so an override just works. Conflicts are keyed on the CSS PROPERTY wherever `cn` can tell the properties apart, rather than on the shared class prefix, so the common prefix collisions do NOT evict: `cn('border-2', 'border-primary')` keeps both (a width and a colour), `cn('flex', 'flex-1')` keeps both (a `display` and a `flex-grow`, the shape an element that is both a flex container and a flex child needs), `cn('shadow-lg', 'shadow-red-500')` keeps both (a box-shadow and its colour), `cn('bg-clip-text', 'bg-primary')` keeps both (a clip and a colour, so the gradient-text idiom survives a later background), and an arbitrary value carrying a type hint is read as the property the hint names (`cn('shadow-lg', 'shadow-[color:red]')` keeps both). It is a small hand-rolled merger, not `tailwind-merge`, so it is still coarse in two ways. A prefix outside the families it knows is not grouped at all, so both classes are emitted and the winner is left to compiled stylesheet order (`inset-shadow-sm` against `inset-shadow-red-500`, `ring-2` against `ring-red-500`). And where one prefix carries two properties it reads the value against Tailwind's DEFAULT scales, so a `@theme`-extended name it cannot know about can still be misread and evict the wrong class: a custom `--shadow-card` makes `shadow-card` a box-shadow, but `cn` sees an unfamiliar name under a prefix whose bare names are usually colours and treats it as one. When an override has to win and you are unsure, pass the one class rather than layering, or install `clsx` + `tailwind-merge` and replace the helper (its header comment shows the swap). For an icon button prefer `size: 'none'` (it states "I supply my own box" by dropping the helper's padding + radius) over layering a `p-0` on top of the default size.

```ts
// components/ui/button.ts  (npx webjsdev ui add button, themed to your app)
import { cn } from '#lib/utils/cn.ts';
const BASE = 'inline-flex cursor-pointer items-center justify-center ...';
const VARIANTS = { default: 'bg-primary text-primary-foreground ...', secondary: '...' } as const;
const SIZES = { default: 'px-4 py-2 rounded-xl', sm: '...' } as const;
export function buttonClass(o: { variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES } = {}) {
  return cn(BASE, VARIANTS[o.variant ?? 'default'], SIZES[o.size ?? 'default']);
}
```

```ts
// a page or component
import { buttonClass } from '#components/ui/button.ts';
html`<button class=${buttonClass({ variant: 'secondary', size: 'sm' })} @click=${...}>Reset</button>`;
```

Why a class helper (not a `<ui-button>` wrapper): it adds NO indirection, so the element stays native (`@click`, `?disabled`, form submission, focus, a11y all just work) and the markup stays readable, while every button shares one source of truth (so no button can forget `cursor-pointer` or drift). Put the affordance every variant needs (like `cursor-pointer`) on the shared BASE.

**Default: `npx webjsdev ui add`, then modify. Do not hand-write a primitive from scratch.** For a repeated primitive with variants, run `npx webjsdev ui add <name>` then adapt the copied source (add, remove, restructure, or theme it as your app needs). The scaffold already ships the `cn` prerequisite at `lib/utils/cn.ts`, so `add` works out of the box (a non-scaffold app runs `npx webjsdev ui init` once first to write `components.json`, the `cn` util, and the design tokens). The kit is shadcn-style, so `add` COPIES the helper's source INTO your `components/ui/` and you own and edit it exactly as freely as code you typed yourself. That is the key point: `add`-then-modify and hand-writing end at the SAME place (owned, editable class-helper source), so the difference is only the STARTING POINT. `add` starts you from vetted, variant-complete source you then adapt (and the copied header spells out the primitive's accessibility obligations), where hand-writing starts from a blank file and re-derives all of it for no benefit. You own the copied source and can add, remove, restructure, or theme it however your app needs: change the class values so the helper produces YOUR look (rather than bending your app to the kit's defaults), keep only the parts you use (the gallery's `cardClass` is surface-only, since its panels vary their own padding and layout), and add variants the kit does not ship. Hand-author a primitive yourself ONLY for a one-off the kit does not cover, or a deliberate opt-out of the kit. Reserve `lib/utils/ui.ts` `html`-fragment helpers for repeated markup chunks; reserve `components/ui/*` class helpers for themed primitives with variants.

## Accessible native controls

Even with the kit, an app hand-authors SOME markup (a one-off primitive the kit does not cover, or the native element you wrap a class helper around), and there accessibility is your job (the `@webjsdev/ui` primitives carry their own, but a raw `<button>` / `<input>` does not). Three habits keep hand-authored interactive markup accessible on BOTH the JS and no-JS paths:

- **Associate a label with its control.** `<label for="email">` paired with `<input id="email">` (or wrap the control in the `<label>`), so a click on the label focuses the field and a screen reader announces it.
- **State a toggle's pressed state.** A button that toggles carries `aria-pressed=${on}` so assistive tech announces on/off, not just "button".
- **Name an icon-only button.** A button whose only content is an icon has no accessible name, so give it `aria-label="Delete task"`.

Native `<button>` / `<a>` / `<input>` already have correct focus + keyboard behaviour, which is the main reason to prefer them (and the `buttonClass()` / `inputClass()` class helpers) over a custom `<div role>` element.

## Design tokens and theming

The default stack is a static compiled Tailwind stylesheet (`css:build` compiles `public/input.css` to the linked `public/tailwind.css`, so it works with JS off) plus `@theme` design tokens declared once in the root layout. You consume them as utility classes (`bg-background`, `text-foreground`, `bg-card`, `border-border`, `font-serif`).

**Two halves.** (1) `public/input.css` MAPS token names into Tailwind with `@theme inline` (`--color-background: var(--background)`), so `bg-background` resolves to `var(--background)`. That is infrastructure; leave it. (2) The root layout (`app/layout.ts`) DEFINES the values as plain CSS custom properties in a `<style>` block. That is your palette; make it your own. A freshly cleared app (after `npm run gallery:clear`) ships only the OS system-colour base (`Canvas` / `CanvasText`) with NO tokens, so building this palette is your first styling step.

**`@theme` and `@theme inline` differ in whether the token reaches `:root`, and the difference is silent.** Measured on `tailwindcss@4.3.0`, a token mapped in a theme block is emitted as a real `:root` custom property when:

| block | token used only through a utility (`border-border`) | token written as a raw `var(--color-x)` in any SCANNED file | token unused |
|---|---|---|---|
| `@theme` | emitted | emitted | not emitted |
| `@theme inline` | NOT emitted (the value is substituted into the utility) | emitted | not emitted |

The one cell that bites is `inline` plus utility-only usage. Nothing on the page can then inherit `--color-x`, so a raw `var(--color-x)` written somewhere Tailwind never scanned resolves to nothing and the declaration falls back to its initial value (a border or outline silently becomes `currentColor`).

"Scanned" is wider than it looks, and this is the part worth knowing: Tailwind scans source files as raw text, so a `var(--color-ring)` inside a component's `static styles` template DOES count and forces emission, exactly like one in the stylesheet. That is why the `@webjsdev/ui` kit theme works despite using `inline`. So the rule is not "shadow components need a plain `@theme`". It is: **if a token is only ever used through utilities, and something outside the scanned source needs to inherit it, map that token with a plain `@theme`.** Anything under a configured `@source` is scanned and needs no special handling.

Whichever form you use, a token nothing references is dropped in both, so an unused mapping is dead configuration rather than a safety net.

**Light and dark, defined once (DRY).** Write each colour token ONE time with the native CSS `light-dark(LIGHT, DARK)` function and let `color-scheme` pick the side. The default `color-scheme: light dark` follows the OS; a `[data-theme]` attribute forces one. No duplicated light/dark blocks:

```html
<style>
  :root {
    --font-sans: ui-sans-serif, system-ui, sans-serif;
    color-scheme: light dark;                        /* follow the OS by default */
    --background:       light-dark(#ffffff, #1e2226);
    --foreground:       light-dark(#191c20, #dee2e6);
    --card:             light-dark(#f7f8fa, #313539);
    --primary:          light-dark(#1e2226, #dee2e6);
    --secondary:        light-dark(#eef0f3, #3a3f45);
    --muted:            light-dark(#f1f3f5, #2a2e33);
    --muted-foreground: light-dark(#565c64, #94989c);
    --accent:           light-dark(#e9ecef, #383d43);
    --border:           light-dark(#e2e5e9, #3d434b);
    --ring:             light-dark(#9aa1a9, #6c737b);
    --destructive:      light-dark(#b3261e, #f2b8b5);
    /* a derived token tracks BOTH themes for free via var(--primary) */
    --primary-tint: color-mix(in srgb, var(--primary) 22%, transparent);
  }
  :root[data-theme='light'] { color-scheme: light; }  /* the toggle forces a scheme */
  :root[data-theme='dark']  { color-scheme: dark; }
</style>
```

`light-dark()` is a native CSS function (CSS Color 5, Baseline 2024), not a library, so nothing to import. A single-theme app drops the `[data-theme]` rules and gives each token one colour.

**A manual theme toggle** writes `data-theme` on `<html>` (`light` / `dark`, or removes it for "follow the OS"). If you use `@webjsdev/ui` components, ALSO keep the `.dark` class in sync (the ui kit keys its own tokens off `.dark`), and apply the saved choice in a tiny inline `<script>` in the layout head so there is no first-paint flash. Verify dark mode in a real browser. Light mode passing proves nothing about dark.

**Edge cases.** `light-dark()` is COLOUR-only. A colour needed in just one theme sets the unused side to a no-op (`light-dark(#fff, transparent)`). A derived token that references a `light-dark()` one (like `--primary-tint` above) tracks both themes automatically. A NON-colour token that must differ per theme (a shadow's geometry, a gradient, a size, an image) cannot use `light-dark()`; give it a `:root[data-theme='dark']` override plus an `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ... } }` rule for the OS default.

**The ui class helpers build on these tokens.** `buttonClass()` / `cardClass()` / `inputClass()` / `badgeClass()` emit Tailwind utilities that reference the same tokens (`bg-primary`, `border-border`), so theming the tokens re-skins every helper at once.

**Focus rings.** The design system applies ONE themed, keyboard-only focus ring globally in the theme CSS: `@layer base { * { @apply border-border outline-ring/50 } }` themes the outline COLOUR to `--ring/50`, and a `:focus-visible { outline: 2px solid color-mix(in oklab, var(--color-ring) 50%, transparent); outline-offset: 2px }` forces a SOLID outline. That second rule matters: `outline-ring/50` alone leaves `outline-style: auto`, so the browser draws its OWN focus ring (which can look thick and white and ignore the colour). So every focusable element (button, link, input) shares one `--ring`-coloured ring with no per-element styling (a native `<button>` renders it a touch wider than a link, a Chromium form-control quirk, but the colour is the same). Do NOT re-add a focus style on a light-DOM element (`buttonClass` deliberately carries none), and NEVER remove it (`outline: none` with no replacement fails WCAG 2.4.7). `:focus-visible` already limits the ring to keyboard / programmatic focus, not a mouse click. A SHADOW-DOM component is the ONE exception: a document rule cannot cross the shadow boundary, so it styles its own focus in `static styles`, matching the global ring EXACTLY (`--ring` at 50%, the same as `outline-ring/50`): `button:focus-visible { outline: 2px solid color-mix(in oklab, var(--color-ring) 50%, transparent); outline-offset: 2px }`. Without it, its controls fall back to the raw browser outline (thick, light on a dark theme, and shown on window-refocus).

## Light-DOM host display, and shadow hosts

A custom element is `display: inline` in plain CSS, which collapses a component used as a block container to its content size. WebJs marks every LIGHT-DOM host `data-wj-host` and defaults it to `display: block` via one head rule in a low-priority cascade layer (`@layer webjs-host { :where([data-wj-host]) { display: block } }`), so a container component does not collapse. The layer keeps it overridable: any author style INCLUDING a Tailwind utility (`class="flex"`, `grid`, `hidden`) wins over it, and `[hidden]` still hides the host so `?hidden=${cond}` works. Opt into an inline light component with a tag-prefixed rule (`my-badge { display: inline }`).

Shadow-DOM hosts are NOT marked (a document rule would override the shadow tree's own `:host`), so a shadow component sets its host display the idiomatic way in `static styles`:

```ts
static styles = css`:host { display: block }`;   // a shadow host with no :host display stays inline
```

**Size the HOST, not just an inner wrapper.** The host custom element is the box the parent lays out. A host that is a flex/grid item in a centering parent (`flex justify-center`, `grid place-items-center`) is sized to its content unless it carries width itself. Put the sizing classes on the host (`w-full max-w-[400px]`), not only on an inner `<div>`. Symptom: a board or card renders tiny even though its inner grid says `w-full max-w-[400px]`. Fix: move the sizing onto the host.

## Section rhythm: one gap, defined once

Per-element margins can never give consistent vertical spacing: each element controls only one side, so a block's gap-above (the previous element's margin) drifts from its gap-below (its own). For a content column (a docs page, a demo page, an article), make the COLUMN own the spacing with a flex stack, and zero the children's own margins so only the one gap applies:

```css
.stack { --section-gap: 1.5rem; display: flex; flex-direction: column; gap: var(--section-gap); }
.stack > * { margin: 0; }
```

Every top-level child (heading, paragraph, component, list) is then equally spaced from ONE variable, and a spacing change is a one-line edit. Flex `gap` beats forcing `display: block` + margins on children: a `grid`/`flex` child keeps its own layout (a blanket `display: block` clobbers it), an inline shadow-DOM host is blockified as a flex item so it honours the gap, a `display: contents` element (a streaming `<webjs-suspense>`) is replaced by its children which become the flex items, and a `display: none` node (a streaming `<script>`/`<template>`) is not an item at all, so it gets no phantom gap. A group that must stay tight (a caption directly above its code block) wraps in one child `<div>` and keeps its own inner spacing. The gallery's `/features` layout (`demo-stack`) is the worked example.

## Even grids, no reflow

The reflow bug (a cell grows when it gets content while the others shrink) comes from `auto`-sized grid rows. Size the tracks explicitly so every cell is an equal fraction regardless of content:

```html
<!-- a 3x3 board whose cells stay equal and square as it fills -->
<div class="grid gap-2 aspect-square [grid-template-columns:repeat(3,1fr)] [grid-template-rows:repeat(3,1fr)]">
  ${cells.map((c) => html`
    <button class="grid place-items-center min-h-0 overflow-hidden text-[clamp(1rem,8cqi,3rem)]">${c}</button>
  `)}
</div>
```

- `aspect-ratio` (e.g. `aspect-square`) on the CONTAINER plus `repeat(N,1fr)` columns AND rows keeps every cell an equal square that does not resize as marks are placed. Putting `aspect-square` on the CELLS is the common mistake that produces uneven rows.
- `min-h-0` + `overflow-hidden` on a cell stops its content forcing the track taller (a grid/flex child has an implicit `min-height: auto`).
- Size text relative to the cell (`clamp()`, container-query units `cqi`) so the glyph scales with the board rather than dictating the cell size.

Verify a layout by USING it, not by glancing at the first paint. A layout bug only shows mid-interaction: play through every state (fill the board, win, reload) and confirm nothing resizes.

## Pin a header with `position: fixed`, never `sticky`

A `position: sticky` header (the common `sticky top-0` pattern) flickers its background for one frame on iOS WebKit (every iOS browser uses WebKit) during a client-router forward navigation. The router's scroll-to-top after the content swap drives a sticky recompute that WebKit mis-repaints. It is iOS-only (fine on desktop and Android, invisible in DevTools emulation), and neither compositor promotion (`translateZ(0)` / `will-change`) nor changing the swap paint timing fixes it. Preserving the header across nav is correct and standard, only the `sticky` positioning is the problem.

The fix is `position: fixed`. A fixed header is always pinned and never does the scroll-relative recompute, so the repaint bug never fires. Because fixed leaves normal flow, reserve the header height on the content below with a single `--header-h` custom property (kept exact with a `ResizeObserver`, degrading fine with no JS):

```css
:root  { --header-h: 56px; }              /* sane SSR first-paint default */
header { position: fixed; inset-inline: 0; top: 0; }
body   { padding-top: var(--header-h); }
```
```js
const hdr = document.querySelector('header');
const apply = () => document.documentElement.style.setProperty('--header-h', hdr.offsetHeight + 'px');
apply();
new ResizeObserver(apply).observe(hdr);
```

For a dashboard, an alternative is an app-shell scroll container (a non-scrolling `100dvh` flex column with `<main>` as the internal scroller), which needs no offset but changes the scroll model.

### A fixed header and a modal that locks scroll

Anything that locks page scroll (a modal, a drawer, an off-canvas menu) hides the page scrollbar, and a classic scrollbar takes real layout width, so hiding it widens the viewport. The usual compensation is padding the body, which holds in-flow content still. **It does nothing for a fixed header**, because a fixed box lays out against the initial containing block, never against the body's padding box, so the header widens with the viewport and its centred content slides right by half the scrollbar width.

`@webjsdev/ui`'s `<ui-dialog>` / `<ui-alert-dialog>` handle this for you (#1144). Their scroll lock reserves the scrollbar gutter for its duration, so the viewport width never changes and nothing moves. It leaves the gutter alone if your page already declared its own `scrollbar-gutter`, on the assumption that a page which made that choice meant it.

Engines differ, and the lock does not need to know which one it is on. Where the gutter is honoured (measured on Chromium) nothing moves and the lock does nothing else. Where it is ignored (measured on WebKit) the viewport does widen, so the lock measures how much, pads `<html>` by it to hold in-flow content still (added to any padding you already had, and restored on close), and publishes the amount as `--wj-scrollbar-compensation` so a fixed element can opt in with one line:

```css
header { position: fixed; inset-inline: 0; top: 0; border-right: var(--wj-scrollbar-compensation, 0px) solid transparent; }
```

A transparent border rather than `padding-right`, for two reasons. It composes with whatever padding the element already has, where a padding form has to restate that base value and restate it again per responsive variant. And a background still paints across a border, so a header that carries its own background stays full bleed instead of ending short of the edge. Declare it after your Tailwind link if you use the `border-*` utilities, since those set `border-right-color` too.

The property is only set while a lock is active AND the viewport actually widened, so the `0px` fallback covers every other moment and the two mechanisms never double-compensate. If you find inline `padding-right` on your `<html>` while a modal is open, that is this, and it comes off on close.

**Put it on the element that is both viewport-width and painting.** Both halves are load-bearing, and getting either wrong fails quietly.

- **Viewport-width**, or a left-aligned child still moves. Insetting a `max-width` container holds its CENTRED children still but not its leading ones, because the container's own box is not what widened. This is easy to miss: measure a left-aligned child, not just a centred one.
- **Painting**, or the background stops short of the widened edge. Insetting a wrapper that paints nothing insets the child that does, which leaves an unpainted strip.

In this repo `examples/blog` has one element that is both (the fixed header paints its own chrome, so the border goes straight on it), and `website` has a non-painting fixed wrapper around a painting header around a centring bar, where the header is the one that qualifies.

Rolling your own scroll lock? Three things the kit learned the hard way, and the first is that almost every implementation of this (including Next's own dev overlay and Radix) gets the fixed case wrong by design.

1. Reserve the gutter rather than relying on padding alone, or a fixed element will jump however carefully you compensate the body.
2. When you do pad, pad `<html>`, not `<body>`. A `max-width` body does not widen when the viewport does, so padding it misses the shift entirely, while padding the root holds in-flow content whatever the body's width is.
3. Measure the root's own border box to decide the amount. `documentElement.clientWidth` can grow while nothing actually moved (Chromium reports exactly that under a reserved gutter), and a `position: fixed` probe reads its pre-lock box on WebKit until the next rendering update, so both mislead.
