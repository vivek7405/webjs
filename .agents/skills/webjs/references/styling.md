# Styling

## What This Covers

- Tailwind-first: the strong default for pages AND light-DOM components, and the Lit reflex it counters
- The light-DOM tag-prefix invariant when raw CSS is unavoidable
- Extracting a repeated Tailwind bundle into a `lib/utils/ui.ts` `html` fragment (not `@apply`)
- Where static CSS lives: the compiled stylesheet, NOT a page or sub-layout `<style>` (the navigation flash)
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

## Where static CSS lives: the compiled stylesheet, not a page `<style>`

**Static CSS goes in `public/input.css`** (compiled to the `public/tailwind.css` the ROOT layout links). Not in a `<style>` a page or a sub-layout renders. This is a correctness rule, not tidiness (#1109).

A page never hydrates, so a `<style>` in one is safe from the raw-text-hole trap that bites components. That is a statement about HYDRATION, and it says nothing about NAVIGATION. The client router swaps the DOM between the keyed boundary comments each layout emits around its children, so a `<style>` a page or a NON-ROOT layout renders sits inside that range:

```
<!--wj:children:/:/-->                              <- root layout's boundary opens
  <!--wj:children:/docs:/docs-->                    <- the docs sub-layout's
    <style> ... the sub-layout's rules ... </style> <- removed and re-inserted on every crossing
    <!--wj:children:/docs/routing:/docs/routing-->
      ... the page ...
```

(The marker is `<!--wj:children:<segmentPath>:<routeKey>-->`. The root layout's segment path is `/`, not `root`.)

Crossing between two routes that own different ones removes a stylesheet and inserts another. Adding or removing a stylesheet mutates the document CSSOM, and **a CSSOM mutation invalidates style for the ENTIRE document, including the DOM the router deliberately preserved.** The layout you kept mounted repaints anyway. That is expensive exactly where it is most visible: `oklch()` tokens, `color-mix()`, and a `backdrop-filter` header all have to re-resolve, so the symptom is an intermittent one-frame flash of the whole page, navbar included. It was reported on webjs.dev crossing in and out of `/docs`, where the crossing swung the document's inline CSS from 9199 to 17046 bytes.

Next.js sidesteps the same effect from the other side, and the way it does so is worth knowing. Its build extracts CSS imports into FILES, and the router renders them as `<link rel="stylesheet" precedence="next">`, which is React's stylesheet-hoisting contract: React lifts them into `<head>` and dedupes by href, so a sheet both routes need is simply never removed. Page CSS therefore never sits in the swapped tree at all. (Next's dev-only stylesheet GC also delays a superseded sheet's removal behind a `setTimeout`, commented "Delay the removal of the stylesheet to avoid FOUC", which is a useful independent datapoint that swapping sheets mid-navigation flashes, though it is a development-mode cleanup rather than the production strategy.)

WebJs has no build step to extract CSS imports into files, so the equivalent is authoring the static rules in the compiled stylesheet yourself. Same destination, one fewer moving part.

**The rule:**

| Where | Swapped on nav? | Use it for |
|---|---|---|
| `public/input.css` (compiled, linked by the root layout) | No, loaded above every boundary | **Every static rule.** Tokens, prose scales, tag-prefixed component CSS, scrollbars, media queries. |
| Root layout `<style>` (`app/layout.ts` exactly) | No, it renders outside `${children}` | Anything that must be in the document itself rather than a linked file (the pre-paint theme bootstrap's token values). The compiled sheet is the default even here. |
| Page / non-root-layout `<style>` | **Yes** | Only CSS that is genuinely per-request (a value computed from `params`). Static rules do not belong here. |
| Component `static styles` (shadow DOM) | No, adopted per element | Scoped shadow CSS. |

A long-form prose scale is the case that most often tempts a sub-layout `<style>`, because doc or article bodies are bare HTML and Tailwind cannot target unclassed elements. Descendant selectors under one wrapper class are the right tool for that (`@tailwindcss/typography` does the same), so keep the selectors and move the FILE:

```css
/* public/input.css, after @import "tailwindcss" and UNLAYERED, which is what
   keeps these above Tailwind's preflight regardless of source order. */
.prose-docs h1 { font: 700 var(--text-doc-h1)/1.12 var(--font-serif); }
.prose-docs ul { list-style: disc; padding-left: 24px; }   /* preflight strips this */
```

```ts
// app/docs/layout.ts, no <style> at all
export default function DocsLayout({ children }: { children: unknown }) {
  return html`<div class="prose-docs">${children}</div>`;
}
```

To verify, assert the property rather than eyeballing it. The flash is intermittent, so a green instrumented run proves little. Compare the `<style>` set served for two routes and require them to be identical, which is cheap at SSR and localizes any regression:

```ts
const stylesOf = (html: string) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
assert.deepEqual(stylesOf(await body('/docs/routing')), stylesOf(await body('/')));
```

## DRY via a JS helper, not `@apply`

When the same Tailwind bundle repeats across 2+ places, extract it into a helper in `lib/utils/ui.ts` that returns an `html` fragment (SSR-time, no client runtime, output identical to inline classes):

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
| 2 to 3 times, identical | Extract to `lib/utils/ui.ts`. |
| Varies by 1 to 2 props | Extract with a small parameter (`mb: 'sm' \| 'md'`). |
| Radically different per call site | Keep inline, do not force-fit. |

Avoid `@apply`: it hides which utilities a class uses and creates a second source of truth. A JS helper keeps the bundle visible at the definition site, composes with conditional classes and active states, and runs at SSR time.

### A design system for repeated PRIMITIVES: class helpers built on `@webjsdev/ui`

An `html`-fragment helper is right for a repeated CHUNK of markup (the rubric above). For a repeated UI PRIMITIVE (button, input, card, badge) that needs variants and sizes, use a class helper instead: a function that returns a Tailwind class STRING you spread onto a native element. That is exactly what `@webjsdev/ui` ships (`buttonClass({ variant, size })`, `cardClass()`, `inputClass()`, `badgeClass({ variant })`), and it is what the scaffold gallery uses in `components/ui/`. To style a ONE-OFF that a variant does not cover (a circular icon button, a pill), compose the helper and override the bespoke bits with `cn()`: `cn(buttonClass({ variant: 'secondary', size: 'none' }), 'w-9 h-9 rounded-full')`. `cn` resolves Tailwind conflicts so a later class wins, including a shorthand over the axis it subsumes (`p-0` beats an earlier `px-4 py-2`), so an override just works. For an icon button prefer `size: 'none'` (it states "I supply my own box" by dropping the helper's padding + radius) over layering a `p-0` on top of the default size.

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
