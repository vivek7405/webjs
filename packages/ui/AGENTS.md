# AGENTS.md : @webjsdev/ui

The webjs **AI-first component library + CLI**, `webjsui init` / `add` /
`list` / `view` / `diff` / `info` / `build`. Ships 32 primitives across two
tiers: class-helper functions for visual components, custom elements only
where state matters. Variant names, sizes, and data-attribute conventions
mirror shadcn so existing shadcn knowledge transfers directly.

Framework-wide rules live in the root [`../../AGENTS.md`](../../AGENTS.md) and
apply here. Read that first. This file only covers what's specific to
`@webjsdev/ui`.

## Architecture : composition-first, two tiers

`@webjsdev/ui` ships **class-helper functions** (returning Tailwind class
strings) and **a small set of stateful custom elements**, never bundled
wrappers around native form controls.

### Tier 1 : class helpers (the majority)

Pure functions returning Tailwind class strings. Compose with whatever
native element you want.

```ts
import { buttonClass, cardClass, inputClass, labelClass, fieldClass, hintClass }
  from '@/components/ui';

html`
  <div class=${cardClass()}>
    <form class=${formClass()}>
      <div class=${fieldClass()}>
        <label class=${labelClass()} for="email">Email</label>
        <input class=${inputClass()} type="email" id="email" name="email"
               aria-describedby="email-hint" required>
        <p class=${hintClass()} id="email-hint">We never share it.</p>
      </div>
      <button class=${buttonClass()} type="submit">Sign up</button>
    </form>
  </div>
`
```

Helpers that take options accept an object: `buttonClass({ variant: 'outline', size: 'sm' })`.

### Tier 2 : stateful custom elements

For things the browser doesn't provide natively: dialogs, alert-dialogs,
tabs, dropdowns, tooltips, hover-cards, toggle / toggle-group, sonner.
Tier-2 components extend the `WebComponent({ ... })` factory from
`@webjsdev/core` and are Lit-shaped: the factory shape declares reactive
attributes, `render()`
returning an `` html`...` `` template, declarative bindings (`@click`,
`?attr`, `attr=`, `.prop`), and `<slot></slot>` for projecting authored
children. Light DOM throughout, full shadow-DOM slot parity.

popover, accordion, and collapsible used to live here but migrated to
Tier 1 once their behaviour could be expressed by native primitives
(the HTML Popover API + `<details>` / `<summary>` + CSS Anchor
Positioning).

```ts
html`
  <ui-dialog>
    <ui-dialog-trigger>
      <button class=${buttonClass({ variant: 'outline' })}>Edit</button>
    </ui-dialog-trigger>
    <ui-dialog-content>
      <div class=${dialogHeaderClass()}>
        <h2 class=${dialogTitleClass()}>Edit profile</h2>
        <p class=${dialogDescriptionClass()}>Make changes here.</p>
      </div>
      <!-- a real form inside; submission works normally -->
      <form action="/profile" method="post" class=${formClass()}>…</form>
    </ui-dialog-content>
  </ui-dialog>
`
```

## Module map

```
packages/ui/
  bin/
    webjsui.js                    standalone binary entry
  src/
    index.js                      CLI entry (Commander program + dispatch)
    commands/
      init.js                     init, writes components.json, theme CSS, lib/utils/cn.ts (defaults are fixed constants)
      add.js                      add, resolve registry items + write into project + install deps
      list.js                     list, show all registry items
      view.js                     view, print a component's source
      diff.js                     diff, compare local vs registry
      info.js                     info, project diagnostics
      build.js                    build, compile a custom registry (for registry authors)
    registry/
      schema.js                   zod schemas (wire-compatible with shadcn's)
      local.js                    LOCAL-FIRST composer: read the packaged registry from disk (no network)
      fetcher.js                  network GET + cache; local-vs-network dispatch (getRegistryItem/Index)
      example.js                  extract / strip the module-JSDoc @example block
      extract.js                  shared kit projector (view + MCP `ui` tool): inventory + per-component helpers/example/deps
      resolver.js                 walk registryDependencies transitively
    utils/
      get-config.js               read components.json
      theme.js                    ensureTheme(): install the design tokens (init hard-fails, add self-heals)
      logger.js                   kleur-based logger
  test/
    schema.test.js                schema validation
    resolver.test.js              transitive deps + npm dedupe
    init-command.test.js          the components.json init writes + its fixed defaults
    get-config.test.js            config read/write/round-trip

  packages/registry/              the registry (internal, not published)
    components/                   .ts files, one per component
    lib/utils.ts                  cn() helper + layout/typography helpers (Tier-2 components extend WebComponent from @webjsdev/core directly)
    themes/
      index.css                   @theme block + CSS variables (light + dark, neutral defaults)
      base-colors.js              per-base-colour overrides (stone/zinc/mauve/olive/mist/taupe) + mergeThemeCss
    registry.json                 manifest (item names + types + file paths + deps)
```

The gallery and the registry API moved onto the marketing site in #1099. They
now live outside this package:

```
website/                          the marketing site, at the repo root
  app/ui/page.ts                  /ui, the gallery introduction
  app/ui/layout.ts                the sidebar shell, shared with /docs
  app/ui/[name]/page.ts           /ui/<name>, one page per component
  app/ui/registry/route.ts               GET /ui/registry, full manifest
  app/ui/registry/index.json/route.ts    GET /ui/registry/index.json, flat list
  app/ui/registry/[name]/route.ts        GET /ui/registry/<name>.json (the CLI fetches here)
  modules/ui/queries/registry.server.ts  composes registry JSON on demand from THIS package
  modules/ui/components/, lib/utils/{cn,dom}.ts   GITIGNORED mirror of ../registry/, written by scripts/copy-registry.mjs
```

### ⚠️ Mirror footgun : do NOT hand-write files into the marketing site's `modules/ui/components/`

The marketing site is a consumer of this kit (its `/ui` pages import the
components to render live previews), so `website/components/ui/` and
`website/lib/ui/` are gitignored: `website/scripts/copy-registry.mjs`
regenerates them via `webjs.dev.before` / `webjs.start.before` (#550) by
mirroring `../registry/` with each component's `'../lib/utils.ts'` import
rewritten to the site's depth. **Anything hand-written you put in those two
directories is invisible to git, never reaches the deploy, and breaks SSR with
a prod 500** (this has happened, see git log for the favicon / theme-toggle
incidents on the old ui site).

The scope narrowed with #1099: only the `ui/` SUBDIRECTORIES are generated, so
the site's own `components/*.ts` and `lib/*.ts` are ordinary tracked source and
a hand-written site component goes there the normal way. The old
`app/_components/` workaround is gone along with the app that needed it.

This trap exists ONLY in the marketing site. Scaffolded user apps,
`examples/blog`, and every other WebJs app keep `components/ui/` as normal
tracked source, the standard shadcn "you own it" pattern.

## v1 component inventory (32 components)

| Tier | Component | Surface |
|---|---|---|
| 1a | `button` | `buttonClass({ variant, size })`, 6 variants × 8 sizes |
| 1a | `badge` | `badgeClass({ variant })`, 6 variants |
| 1a | `alert` | `alertClass({ variant })`, `alertTitleClass`, `alertDescriptionClass` |
| 1a | `card` | `cardClass`, `cardHeaderClass`, `cardTitleClass`, `cardDescriptionClass`, `cardActionClass`, `cardContentClass`, `cardFooterClass` |
| 1a | `input` / `textarea` / `label` | `inputClass`, `textareaClass`, `labelClass` |
| 1a | `checkbox` | `checkboxClass`, native `<input type="checkbox">` with SVG check on `:checked`. REQUIRES `data-slot="checkbox"` on the input for the check to render. |
| 1a | `radio-group` | `radioGroupClass`, `radioClass`, native `<input type="radio">`. REQUIRES `data-slot="radio"` on the input for the dot to render. |
| 1a | `switch` | `switchInputClass`, `switchTrackClass({ size })`, hidden native checkbox + visible track |
| 1a | `native-select` | `nativeSelectWrapperClass`, `nativeSelectClass`, `nativeSelectIconClass`, `nativeSelectOptionClass`, `nativeSelectOptGroupClass` |
| 1a | `avatar` | `avatarClass`, `avatarImageClass`, `avatarFallbackClass`, `avatarBadgeClass`, `avatarGroupClass`, `avatarGroupCountClass` |
| 1a | `separator` | `separatorClass({ orientation })` |
| 1a | `skeleton` | `skeletonClass` |
| 1a | `aspect-ratio` | `aspectRatioClass`, use Tailwind `aspect-[16/9]` directly |
| 1a | `kbd` | `kbdClass`, `kbdGroupClass` |
| 1a | `table` | `tableContainerClass`, `tableClass`, `tableHeaderClass`, `tableBodyClass`, `tableFooterClass`, `tableRowClass`, `tableHeadClass`, `tableCellClass`, `tableCaptionClass` |
| 1a/2 | `toggle` | Hybrid: exports `toggleClass({ variant, size })` (pair with a native `<button>`) AND registers `<ui-toggle>`. Because it registers an element, the kit tooling (`webjs ui view` / the MCP `ui` tool / the `add` strip) treats it as Tier-2 and keeps its file whole. |
| 1a | `breadcrumb` | `breadcrumbListClass`, `breadcrumbItemClass`, `breadcrumbLinkClass`, `breadcrumbPageClass`, `breadcrumbSeparatorClass`, `breadcrumbEllipsisClass` |
| 1a | `pagination` | `paginationClass`, `paginationContentClass`, `paginationLinkClass({ isActive, size })`, `paginationPreviousClass`, `paginationNextClass`, `paginationEllipsisClass` |
| 1b | `popover` | `popoverContentClass`, `popoverHeaderClass`, `popoverTitleClass`, `popoverDescriptionClass`. Compose with `<button popovertarget="id">` + `<div popover id="id">`; positioning via CSS anchor positioning or the exported `positionFloating` helper. |
| 1b | `accordion` | `accordionClass`, `accordionItemClass`, `accordionTriggerClass`, `accordionContentClass`. Compose with `<details name="...">` + `<summary>`; `name` provides exclusive-open behavior natively. |
| 1b | `collapsible` | `collapsibleClass`, `collapsibleTriggerClass`, `collapsibleContentClass`. Compose with `<details>` + `<summary>`. |
| 1b | `progress` | `progressClass()`, apply to native `<progress value max>`. Browser draws the bar via `::-webkit-progress-value` and `::-moz-progress-bar`. Omit `value` for the indeterminate / pulse state. |
| 2  | `toggle-group` | `<ui-toggle-group type value variant size>` + `<ui-toggle-group-item value disabled>`. Roving tabindex (one Tab stop) with Arrow / Home / End navigation, plus `aria-pressed` per item. A `disabled` item reports `aria-disabled`, refuses activation, and is skipped by navigation and by the tab stop. |
| 2  | `dialog` | `<ui-dialog>` + `<ui-dialog-trigger>` / `<ui-dialog-content>` / `<ui-dialog-close>`. Built on native `<dialog>.showModal()`, top-layer rendering, ::backdrop overlay, focus trap, Escape close, and focus restoration are all platform-provided. We add a scroll lock (refcounted, and shift-free for a `position: fixed` header, see invariant 5) + class helpers for `dialogHeader/Title/Description/Footer`. On open it wires `aria-labelledby` / `aria-describedby` to the `data-slot="dialog-title"` / `dialog-description` nodes (falling back to the first heading / paragraph). |
| 2  | `alert-dialog` | Like dialog, role=alertdialog. Native Escape close is cancelled via the `cancel` event; no backdrop-click dismissal. `<ui-alert-dialog-action>` / `<ui-alert-dialog-cancel>`. Wires `aria-labelledby` / `aria-describedby` to its `alert-dialog-title` / `alert-dialog-description` the same way. |
| 2  | `tooltip` | `<ui-tooltip delay-duration>`, hover/focus + delay. Content uses `popover="manual"` for top-layer rendering. The trigger references the tip via `aria-describedby` (APG tooltip wiring). Escape dismisses a showing tip without moving focus; a closed tip never consumes Escape. |
| 2  | `hover-card` | `<ui-hover-card open-delay close-delay>`, hover with linger-keep-open, mirrored for focus so in-card content is Tab-reachable. Content uses `popover="manual"` for top-layer rendering. The trigger (focusable, also opens on focus) gets `aria-haspopup` / `aria-expanded` / `aria-controls`; the `role="dialog"` panel is always named (author name, then a title node, then the trigger) and Escape dismisses it, returning focus to the trigger. |
| 2  | `tabs` | `<ui-tabs value orientation>` + List / Trigger / Content. Arrow / Home / End move focus AND selection via a roving tabindex (one Tab stop). Triggers carry `aria-controls`, panels `aria-labelledby` (cross-linked per group), the list `aria-orientation`, and an inactive panel is `inert`. |
| 2  | `dropdown-menu` | `<ui-dropdown-menu>` + Trigger / Content / Item (variant, `type="checkbox"` / `type="radio"` + `checked` / `value`) / Label / Separator / Shortcut / Group. Content uses `popover="manual"` for top-layer rendering. ArrowUp/Down nav, Home/End, typeahead, and synthesized Enter / Space activation (a `div[role=menuitem]` gets none natively). Escape closes the menu holding focus (a submenu first) and Tab closes and moves on; both return focus to the trigger, as do item activation and an outside click that did not itself land focus. Each submenu panel is named by its sub-trigger. Menu declares `aria-orientation`, a `data-disabled` item reflects `aria-disabled`, a checkable item carries `menuitemcheckbox` / `menuitemradio` + `aria-checked`, and the trigger gets `aria-haspopup` / `aria-expanded` / `aria-controls`. Emits a cancelable `ui-item-select`. |
| 2  | `sonner` | `<ui-sonner position>` + `toast()` / `toast.success` / `toast.error` / `toast.promise` API, with `action` and `cancel` per toast. The viewport is a persistent `aria-live` region so inserted toasts are announced (an `error` toast is `role=alert`), and every toast carries a labelled close button so even a never-auto-dismissing `toast.loading()` can be dismissed by hand. |

## Accessibility

The kit aims for 100% accessibility out of the box, but the responsibility
splits by tier, and an agent MUST know which half it owns.

**Tier-2 custom elements own their ARIA.** Because the element renders its own
markup, it wires the WAI-ARIA pattern itself, with zero author effort: tabs
cross-links triggers and panels (`aria-controls` / `aria-labelledby`), reports
`aria-orientation`, and marks an inactive panel `inert`; toggle-group uses
roving tabindex plus Arrow / Home / End and skips `disabled` items; toggle
forwards the host's `aria-label` onto the inner button it renders;
dropdown-menu declares `aria-orientation`, reflects `aria-disabled` on a
`data-disabled` item, gives the trigger `aria-haspopup` / `aria-expanded` /
`aria-controls`, returns focus to that trigger on EVERY close path (Escape, Tab, activation, and
an outside click that did not itself put focus somewhere), synthesizes Enter /
Space activation because a `div[role=menuitem]` gets none natively, names each
submenu panel from its sub-trigger, and
exposes `menuitemcheckbox` / `menuitemradio` + `aria-checked` for a
`type="checkbox"` / `type="radio"` item; dialog and alert-dialog name
themselves from their title and description on open, falling back to a generic
`aria-label` so an unnamed modal is impossible; tooltip references its tip with
`aria-describedby` and dismisses on Escape; hover-card exposes the popup
relationship on its (focus-openable) trigger, always names its `role="dialog"`
panel, dismisses on Escape, and keeps itself open while focus is inside so its
content is Tab-reachable; sonner is a persistent `aria-live` region whose every
toast carries a labelled close button. Do not hand-add these attributes; the
element already has.

**The focusable element is the one that needs the ARIA.** The recurring bug
class in this kit (#1078, and finding 1 of #1080) is a Tier-2 element whose host
is NOT the control the browser focuses: the host renders an inner `<button>` or
`<div role="...">`, and ARIA put on the host never reaches it, because a name on
a generic-role element does not contribute to a descendant's name. When adding
or changing a Tier-2 component, ask which element actually takes focus and put
the role, the name, and the state THERE, forwarding from the host if that is
where the author writes it. A browser test asserting the attribute on the
FOCUSABLE node, not on the host, is what catches a regression.

**A popover panel needs its focus restored before it hides.** Every overlay here
renders `popover="manual"`, so hiding the panel while a descendant holds focus
drops focus to `<body>`. Move focus out FIRST, then hide, and do it on EVERY
close path, not just the keyboard one (a delayed hover-close and an outside tap
can both fire while the panel holds focus).

Guard the restore on focus still being inside the overlay, so a close that
deliberately moved focus elsewhere does not have it yanked back. For a
POINTER-driven dismiss that guard cannot be evaluated at click time: clicking a
non-focusable area has usually already blurred the panel's focused descendant to
`<body>` by then, so a check there cannot tell "clicked away from everything"
(restore) from "clicked another control" (leave it). Sample focus-inside on
`pointerdown` instead, before the browser moves focus, and read it at click time
(`dropdown-menu.ts` `_onDocPointerDown`).

**Tier-1 class helpers push their ARIA to YOU.** A helper returns only Tailwind
classes, so the semantic element, role, and ARIA are the caller's job. Every
component's JSDoc carries an `A11y` block stating exactly what to supply, and
`test/registry-contents.test.js` enforces that a block is PRESENT on every
component and sits above `@example` so the agent-facing projection does not drop
it (the claim used to be aspirational and was false for ten components). Most are
headed `A11y (required for accessible output)`; a component whose native
primitive already carries the pattern says so instead (accordion and collapsible
use `A11y (mostly handled by the native primitives)`), and a Tier-2 element's
block states what it OWNS rather than what you supply. The recurring
obligations:

- `button`: an icon-only button needs `aria-label`; an overlay trigger needs `aria-haspopup` + `aria-expanded`.
- `alert`: choose `role="alert"` (urgent) or `role="status"` (polite).
- `separator`: `role="separator"` + `aria-orientation`, or `role="none"` when decorative.
- `skeleton`: `aria-hidden="true"` (or `aria-busy` on the region), since it is a placeholder.
- `avatar`: an `alt` that names the person, plus the text fallback.
- `table`: `scope="col"` / `scope="row"` on header cells, and a `<caption>`.
- `pagination` / `breadcrumb`: a labelled `<nav>`, `aria-current="page"`, and hidden separators / icon-only control names.
- `progress`: an `aria-label` (the native element supplies the role + value).
- **form controls** (`input` / `textarea` / `native-select` / `checkbox` / `radio-group` / `switch`): a real `<label for>` (or a wrapping `<label>`) is the accessible name, and a `placeholder` is not one. On failure, `aria-invalid="true"` plus an `aria-describedby` pointing at error text that EXISTS on the page. A standalone switch needs `aria-label`, since its visible track is a `<span>` and the real input is `sr-only`. Group radios by a shared `name` and NAME the group (`aria-labelledby` on the `role="radiogroup"`, or `<fieldset>` + `<legend>`).
- **`checkbox` / `radio-group` also need `data-slot`** on the input (`data-slot="checkbox"` / `data-slot="radio"`). The injected stylesheet keys the checkmark and the radio dot on it, and neither class carries a fallback fill, so without it the checked state reads as colour alone (WCAG 1.4.1). Source tests assert the examples keep the pairing.
- `popover`: the biggest Tier-1 obligation, because the panel is a bare `<div popover>` with no role and no name. Supply `role="dialog"` + `aria-labelledby` to the `popoverTitleClass()` heading, `aria-haspopup="dialog"` + a `toggle`-event-synced `aria-expanded` on the trigger, and prefer `popover` (auto) over `popover="manual"` so the platform still gives you light-dismiss, Escape, and focus restoration.
- `card`: use a REAL heading for `cardTitleClass()`, at the level the surrounding document wants, and never wrap a whole card in one `<a>`.
- `kbd`: a symbol-only key (`⌘`) needs a spoken name, but NOT via `aria-label` on the `<kbd>`: that maps to `role=generic`, where a name is prohibited and ignored. Hide the glyph (`aria-hidden`) and put the spoken form in an `sr-only` sibling. For a chord, wrap the group in `role="img"` + `aria-label`, which supports a name AND makes children presentational, so it is announced once.
- `label`: put the classes on a real `<label>` linked by `for` / `id` or by nesting. The same classes on a `<span>` name nothing.
- `accordion` / `collapsible`: build on `<details>` + `<summary>` and put the trigger classes on the `<summary>` ITSELF. Nesting a `<button>` inside a `<summary>` is the #1078 bug class.
- `aspect-ratio`: layout only, so the obligations belong to the content (`alt`, `title`, captions).

Browser tests for the Tier-2 guarantees live in
`test/components/browser/ui-a11y.test.js`. Every behavioural fix there ships
with a counterfactual, an assertion that fails against the pre-fix code, so a
later change cannot quietly make the test non-discriminating.

## Public commands (binary: `webjsui`)

| Command | What it does |
|---|---|
| `webjsui init` | Initialize a project, writes `components.json`, copies the `cn()` helper to `lib/utils/cn.ts` (plus `lib/utils/dom.ts` beside it), installs the theme tokens. Its defaults are fixed constants, not derived from the host project (#1129). NON-DESTRUCTIVE on a re-run: an existing `components.json` keeps its settings (aliases, `tailwind.css`, base color, and any unknown keys) and an existing helper file is left alone, since both are yours; a config that cannot be parsed at all is a hard error rather than a silent replacement. `--overwrite` opts into replacing them. HARD-FAILS (non-zero exit) when the tokens cannot be written (an unstyled install with a clean exit code was the old trap). |
| `webjsui add <names...>` | Resolve transitive deps, copy component sources, install npm deps. Self-heals missing theme tokens. Leaves an existing `cn()` / dom helper alone (see the placement section); `--overwrite` replaces it. For a Tier-1 helper it strips the worked `@example` and leaves a pointer (see Registry resolution). |
| `webjsui list [filter]` | List components in the registry |
| `webjsui view <name>` | Print a component's source to stdout (the human / offline path to the full example) |
| `webjsui diff [name]` | Show diffs between local and registry (against the LIVE upstream) |
| `webjsui info` | Print cwd + config + registry URL |
| `webjsui build [file]` | Compile a custom registry (for registry authors) |

### Where the shared helpers land (#1129)

`cn()` and the client-only `onBeforeCache()` follow the project's **`utils`
alias**, not the `target` the registry manifest pins on the `lib-utils` /
`lib-dom` items. `add` resolves them through one `helperTarget()` that reads
the same alias `rewriteUtilsImport` retargets component imports to, so the file
it writes and the file the components import are the same file by construction.
The DOM helper is always the utils file's SIBLING (`lib/utils/dom.ts` next to
`cn.ts`), which is the adjacency the rewrite assumes and the layout `init` and
`webjs create` both emit.

Honouring the manifest `target` instead is what produced the #1129 orphan bug:
`add` wrote `lib/utils.ts` while every component resolved to `lib/utils/cn.ts`,
so each install left a dead copy behind. The manifest `target` still governs
every OTHER registry item. It is deliberately NOT honoured for these two, in
any registry, including a custom one authored against the shadcn wire format
(invariant 3): the rewrite always points component imports at the alias, so a
write that went anywhere else would recreate the orphan. The two answers have
to agree, and the alias is the one that has consumers.

Both files are also treated as user-owned once they exist. `init` and `add`
leave them alone (`add`'s `--yes` suppresses prompts but does not license
replacing them); only an explicit `--overwrite` replaces one.

### Registry resolution: LOCAL-FIRST (#983)

The registry sources ship inside this npm package (`package.json` `files`
includes `packages/registry`), so `init` / `add` / `list` / `view` resolve
components from disk with NO network round-trip. This makes an agent's install
deterministic and offline-safe. The network path (`fetcher.js`) is used ONLY
when the caller passes an explicit custom `--registry <url>`.

- `getRegistryItem(name, url)` / `getRegistryIndex(url)` in `fetcher.js` are the
  dispatch: local unless `url` is a custom (non-default) registry. `local.js` is
  the on-disk composer (the plain-JS twin of the marketing site's
  `modules/ui/queries/registry.server.ts`).
- **`webjsui diff` is the deliberate carve-out**: it compares local files
  against the LIVE upstream, so it stays on the network path (local-first would
  compare the package against itself). It also compares each local file against
  what `add` WOULD write (import-rewrite + example-strip via
  `transformForProject`, shared with `add`), so a pristine install diffs clean.
- **On-demand example delivery**: a Tier-1 helper file's accessible structure
  lives in its module-JSDoc `@example` block. That worked example is build-time
  guidance, so `add` STRIPS it from the copied file and leaves a one-line pointer
  (`example.js` `pointerLine`, the explicit `npx @webjsdev/ui view <name>` form
  every printed hint uses, per invariant 8); the full snippet is
  served on demand by `webjsui view` and the MCP `ui` tool. Tier-2
  custom-element files are left whole (the element IS the component). A
  version-skew note: local-first pins `add`/`view` to the INSTALLED ui version,
  and `diff` is how a user detects upstream drift. The scaffold no longer
  pre-copies ui components (it initialises the app for `webjs ui add` and the
  gallery cards style with plain Tailwind), so components are added on demand.

## Webjs‑CLI subcommand

`webjs ui <subcmd>` proxies to `@webjsdev/ui`. Implementation lives in
[`../cli/bin/webjs.js`](../cli/bin/webjs.js) under `case 'ui':`.

## Package-specific invariants

1. **`@webjsdev/ui` is a hard dependency of `@webjsdev/cli`.** Global
   `webjs` install ships with the UI CLI out of the box.

2. **No third-party runtime deps.** No clsx, no tailwind-merge, no
   class-variance-authority, no Radix, no `@floating-ui/dom`, no `sonner`.
   Hand-rolled `cn()` in `lib/utils.ts`, hand-rolled positioning in
   `popover.ts` (re-used by tooltip and hover-card via export),
   hand-rolled focus trap in `dialog.ts`, hand-rolled toast queue in
   `sonner.ts`.

3. **Registry wire format mirrors shadcn's `registryItemSchema`.**
   Same shape, so a shadcn-compatible client could in principle consume
   our registry (modulo TS vs TSX extensions).

4. **Light DOM + Tailwind everywhere.** Tier-2 custom elements extend
   `WebComponent` from `@webjsdev/core` and use Lit-shaped `render()` +
   `html` `` templates with declarative bindings. Light DOM means
   Tailwind utility classes apply directly to authored children that
   project through `<slot>`. No shadow root anywhere; full shadow-DOM
   slot parity in light DOM.

5. **API parity with shadcn.** Variant names, size names, subcomponent
   breakdown, `data-state` / `data-orientation` / `data-side` /
   `data-align` attribute conventions all match shadcn 1:1. An AI agent
   trained on shadcn maps its knowledge directly:
   - `<DialogContent>` → `<ui-dialog-content>`
   - `variant="destructive"` → `variant="destructive"` (same)
   - `onValueChange={fn}` → `addEventListener('ui-value-change', fn)`
   - `asChild` → drop the wrapper, apply the class helper directly

   **Deliberate divergence, dialog scroll lock (#1144).** shadcn (via Radix)
   compensates the hidden scrollbar by padding the body only, which leaves a
   `position: fixed` header sliding right by half the scrollbar width. Since
   WebJs recommends exactly that pinned-header pattern (#610), our lock instead
   reserves the scrollbar gutter (unless the page already declared its own), and
   where the engine ignores `scrollbar-gutter` (measured on WebKit, honoured on
   Chromium) it pads `<html>` by the measured residual and publishes it as
   `--wj-scrollbar-compensation` for a fixed element to opt into. Nothing branches
   on the engine: the residual is measured, so an engine nobody tested behaves
   correctly either way. The refcount is shared across both component copies via
   `globalThis`, because release order is not guaranteed to be LIFO. This is
   presentation and lifecycle, not API: every tag, variant, and data attribute
   still matches shadcn.

6. **Native form controls participate in `<form>` submission natively.**
   `<input type="checkbox" class=${checkboxClass()}>` is a real input , 
   no `ElementInternals`, no `setFormValue` proxying. Submission,
   autofill, browser autocomplete, native validation all work.

7. **The kit targets WebJs apps, and only WebJs apps (#1129).** There is no
   host-project detection and no per-framework branching anywhere in the
   package. `init` writes one fixed set of defaults (`styles/globals.css`, and
   the alias map whose `utils` entry is `lib/utils/cn`), which are the same
   values `webjs create` scaffolds, so `init` on a bare app and a scaffolded
   app land on the same layout. The output is plain Tailwind classes and
   standard custom elements, so it will render in a non-WebJs host, but that
   is not a supported, tested, or advertised path: point `--css` somewhere
   else and hand-edit `components.json` at your own risk. Do NOT reintroduce a
   `detectProject()` in any form. A switch that picks paths per framework buys
   about thirty lines of defaults in exchange for a cross-framework promise
   the rest of the package does not keep.

8. **A command a reader is told to RUN names `npx @webjsdev/ui <cmd>`, never a
   bare `webjsui <cmd>` (#1264).** `webjsui` is a bin declared inside this
   package, not a published package name, and the registry 404s on it, so `npx
   webjsui` resolves through a `node_modules/.bin/webjsui` link or not at all.
   Whether that link is where npx looks depends on the reader's tree, and the
   layouts vary (a global-only install with nothing local, a nested layout
   where the kit sits under `@webjsdev/cli`'s own `node_modules`). Do not try
   to enumerate them, which is how this invariant was wrong twice. The point is
   that a printed hint cannot know, while `npx @webjsdev/ui <cmd>` names a real
   published package and resolves either way. Every hint `init`, `add`, `diff`,
   `info`, and the registry fetcher print does this, asserted one per site in
   `init-command.test.js`, `add-command.test.js`, `diff-command.test.js`,
   `list-view-info.test.js`, and `local-registry.test.js`.

   The rule reaches an instruction, not a mention, so a line that NAMES the
   binary without telling anyone to type it keeps the bare form:
   `.name('webjsui')` in `index.js`, which is the bin's real identifier and
   what the commander banner echoes, the command tables here and in
   `README.md`, and prose describing what a command does. An instruction
   directly under an install that supplies the bin is the one place the bare
   form is still an instruction and still correct, as in `README.md`'s Option B
   and the root `README.md`'s UI bullet.

## Component tag convention (Tier 2)

Single `ui-` prefix; sub-components hyphenated. Matches shadcn's React tag
names mechanically:

```html
<ui-dialog>          <!-- = <Dialog> -->
  <ui-dialog-trigger>  <!-- = <DialogTrigger> -->
  <ui-dialog-content>  <!-- = <DialogContent> -->
```

## Class-helper conventions (Tier 1)

- Helpers with no parameters: `cardClass()`, `inputClass()`, etc.
- Helpers with variants: `buttonClass({ variant, size })`, object arg, all keys optional.
- All `.ts` files in `components/` export named functions. No default exports.
- Use `cn()` from `'../lib/utils.ts'` to merge a helper's output with
  user-supplied classes when needed: `<button class=${cn(buttonClass(), 'rounded-full')}>`.
- **A `cn()` conflict group is one CSS PROPERTY, never one class prefix.**
  Utilities that merely share a prefix must land in different groups, or the
  merger silently drops one of them. Two defects came from getting this wrong:
  `^flex(-|$)` lumped the `flex` DISPLAY value in with `flex-1` / `flex-row` /
  `flex-wrap` and dropped `display:flex` (#1072), and border colour had no
  group at all, so an override's winner was decided by compiled stylesheet
  order rather than class order (#1065). When a value can mean two properties
  under one prefix, classify by parsing the VALUE (`border-[3px]` is a width,
  `border-[#fff]` is a colour), and give each side its own group with the
  shorthand subsumption declared in `CONFLICTS`, the way padding does.
- `lib/utils.ts` is the canonical copy, and the repo-root
  `examples/blog/lib/utils/cn.ts` is a hand-synced duplicate with no mechanical
  link, so any change here lands in both. The repo-root
  `test/ui/cn-copies-in-sync.test.mjs` (not this package's `test/`) merges a
  token battery through both copies and fails on drift. Those TWO are the whole
  inventory of hand-synced sources. Every OTHER `cn.ts` on disk is a copy of
  this one, produced by some generator (`website/lib/utils/cn.ts` via
  `website/scripts/copy-registry.mjs`; an app's copy via `webjs create`,
  `webjsui init`, or `webjsui add`, which pulls `lib-utils` as a transitive
  registry dependency). Never hand-edit one: a stale copy is a generator that
  has not been re-run, not drift, so there is nothing for the sync test to
  cover. Which sources a given generator reads, and when it goes to the
  network, is the registry-resolution question, answered by the LOCAL-FIRST
  section above, so do not restate it here.
- A variant prefix is split on the last colon OUTSIDE square brackets, because
  an arbitrary value carries colons of its own (`border-[length:2px]`,
  `bg-[url(https://x/y.png)]`). Splitting on the last colon anywhere hands the
  group matcher a fragment like `2px]`, so the utility silently stops deduping.
- Once a bracketed value reaches the matcher, its TYPE HINT names the property
  and picks the group, since the prefix alone cannot: `text-[length:14px]` is a
  font size and `bg-[url(...)]` is an image, so routing either by prefix would
  collapse it against a colour. That lives in `hintedGroup()` and the
  `HINTED_GROUPS` map, and it is deliberately CENTRAL rather than a pattern per
  prefix: handling only the prefixes that came to mind is how
  `shadow-[color:red]` was left evicting `shadow-lg` while `bg-` and `text-`
  were already correct. A `<prefix>:<hint>` pair the map does not cover gets a
  group of its own, so it collides only with the identical hint under the
  identical prefix and never with the prefix's default, which is the safe
  direction to fail (an extra class renders, a dropped one does not).
- The merger is coarse by design and does NOT claim full `tailwind-merge`
  fidelity. Some prefixes are still grouped by prefix alone (`bg-clip-*` and
  `bg-origin-*` sit in `bg-color`; `shadow-lg` and `shadow-red-500` share
  `shadow`), so a less common pair can still collide. Say that plainly in any
  doc you write about it rather than stating the property rule as absolute.

## Layout + typography helpers (the design system)

These live in `lib/utils.ts` and are foundational, encode the spacing
and typography rhythm.

| Helper | Returns | Use for |
|---|---|---|
| `fieldClass()` | `grid gap-2` | Vertical rhythm: label ↔ input ↔ hint |
| `fieldRowClass()` | `flex items-center gap-3` | Horizontal label-and-input |
| `stackClass({ gap })` | `grid gap-{3\|6\|8}` | Multiple form fields stacked |
| `formClass()` | `grid gap-6` | `<form>` body rhythm |
| `sectionClass()` | `grid gap-8` | Page sections |
| `fieldLabelClass()` | label typography | `<label>` text style |
| `hintClass()` | `text-sm text-muted-foreground` | Helper text below input |
| `helpClass()` | `text-xs text-muted-foreground` | Tertiary muted text |
| `errorClass()` | `text-sm font-medium text-destructive` | Validation error text |

Change one helper to retune the entire app, every form field that uses
`fieldClass()` updates atomically.

## Tests

```sh
npm test --workspace=@webjsdev/ui    # schema + resolver + init defaults + config
```

Tests live in **`packages/ui/test/`** as flat files for the CLI
helpers (`schema.test.js`, `resolver.test.js`,
`init-command.test.js`, etc.) plus `test/registry-contents.test.js`
which smoke-validates the component sources (reads
`components/*.ts` and verifies Tier-1/Tier-2 shape + hallmark
class strings, that every component carries an `A11y` JSDoc block above
`@example`, and that the checkbox / radio examples keep the `data-slot`
their stylesheets key on).

**`test/ssr-aria.test.js` is the SSR layer, and it is not optional for an ARIA
change.** It renders Tier-2 components through `renderToString` and asserts the
ARIA in the SERVED markup. It exists because the browser suite runs only the
CLIENT renderer, which removes a nullish attribute hole while the server
stringifies it to `attr=""`. So a component that "omits" ARIA via a null hole
passes every browser assertion while serving the empty attribute, and SSR then
disagrees with the hydrated DOM. Three real defects shipped that way before this
layer existed. Any conditional ARIA needs an assertion here, not just in the
browser suite.

Real-browser tests for the kit live under
`packages/ui/test/components/browser/`
(`ui-overlay.test.js`, `ui-stateful.test.js`, `ui-a11y.test.js` for the Tier-2
ARIA + keyboard guarantees) and run via the
top-level `npm run test:browser`. See
[`references/testing.md`](../../.agents/skills/webjs/references/testing.md) for
the overall layout.

## Building / running

```sh
npm run dev --workspace=@webjsdev/website   # the gallery at localhost:5001/ui
```

**No registry build step.** Registry JSON is composed on demand by the route
handlers on the marketing site (see its
`modules/ui/queries/registry.server.ts`, which reads the sources in this
package). Source of truth is `packages/registry/components/*.ts` +
`registry.json` + `themes/base-colors.js`. Cached in memory after first
request.

Theme synthesis: only `theme-neutral` is declared in `registry.json`
(canonical CSS lives at `themes/index.css`). The other 6 base colours , 
`theme-stone`, `theme-zinc`, `theme-mauve`, `theme-olive`, `theme-mist`,
`theme-taupe`, are synthesized on demand by merging per-colour
overrides from `themes/base-colors.js` into the neutral CSS. All 7
themes return the same `files: [{ target: 'app/globals.css', content }]`
shape so `webjsui init --base-color <name>` works uniformly.

## Deferred to v2 (not in the registry)

These shadcn components are NOT shipped in v1, their old-pattern source
files have been **removed entirely** from `packages/registry/components/`.
When v2 starts, write fresh files following the Tier-1 / Tier-2 conventions
above:

button-group, calendar, carousel, chart, combobox, command, context-menu,
direction, drawer, empty, field, form, input-group, input-otp, item,
menubar, navigation-menu, resizable, scroll-area, select (rich), sheet,
sidebar, slider, spinner.

Each will get a "v2" docs page that explains the scope cut and a workaround
(native equivalent, or recommended alternative library) until shipped.

---

Framework-wide rules and full API reference:

@../../AGENTS.md
