# @webjsdev/ui

An **AI-first component library** for the web. Source-copied into your project , 
you own the code.

Two-tier composition designed for AI agents who reason about real HTML +
function calls, not for a layered React abstraction over every primitive:

- **Tier 1, class-helper functions** (`buttonClass`, `cardClass`,
  `inputClass`, `labelClass`, `alertClass`, `popoverContentClass`,
  `accordionItemClass`, `collapsibleTriggerClass`, …). Pure functions that
  return Tailwind class strings. You spread them onto raw native elements
 , including `<button class=${buttonClass({ variant: 'outline' })}>`,
  `<details name="faq" class=${accordionItemClass()}>`, and
  `<div popover class=${popoverContentClass()}>`, so real native elements
  participate in form submission, autocomplete, screen readers, the
  Popover API ancestry, and devtools as themselves.
- **Tier 2, stateful custom elements** (`<ui-dialog>`, `<ui-alert-dialog>`,
  `<ui-tabs>`, `<ui-tooltip>`, `<ui-hover-card>`, `<ui-dropdown-menu>`,
  `<ui-sonner>`, …). Reserved for the behavior the browser still doesn't
  give you for free: hover-with-delay tooltips, roving-focus keyboard nav
  for menus and tabs, toast queue with stack and dismiss. Dialog and
  alert-dialog wrap the native `<dialog>.showModal()`, so focus trap,
  Escape, and backdrop overlay all come from the platform. Light DOM
  throughout (no shadow DOM); authored children project through `<slot>`.

**This is the component library for WebJs apps.** It is what `webjs ui init`
and `webjs ui add` install, and WebJs is the only host it is tested and
supported on. The output is plain Tailwind CSS v4 classes and standard custom
elements, so nothing stops it rendering elsewhere, but no other framework is a
supported target and none is detected or defaulted for. Variant names, sizes,
and data-attribute conventions mirror shadcn's so an AI agent's existing
knowledge of shadcn maps directly.

Tier-2 elements extend the `WebComponent({ ... })` factory from
`@webjsdev/core`, a tiny Lit-shaped base class whose factory shape declares
reactive attributes,
`render()` returning an `` html`...` `` template, and declarative
bindings (`@click`, `?attr`, `attr=`). Light DOM throughout, so Tailwind
utility classes on authored children apply directly. The `webjsui add`
CLI installs `@webjsdev/core` automatically when you add a Tier-2
component.

## Accessibility

Tier-2 elements are accessible out of the box: they wire their own WAI-ARIA
pattern, so you do not hand-add ARIA. Tabs cross-links triggers and panels and
reports orientation, toggle-group uses roving tabindex with Arrow / Home / End,
dropdown-menu declares orientation and reflects `aria-disabled`, dialog and
alert-dialog name themselves from their title and description, tooltip wires
`aria-describedby`, hover-card exposes `aria-haspopup` / `aria-expanded`, and
sonner is a live region.

Tier-1 class helpers return only classes, so the semantic element and ARIA are
yours to supply. Each one's JSDoc carries an `A11y (required for accessible
output)` block stating exactly what to add: a name on an icon-only button, a
role on an alert, `scope` on table headers, `alt` on an avatar image, a
labelled `<nav>` with `aria-current="page"` on pagination and breadcrumb, and
so on. Follow that block and the markup is fully accessible.

## Install

### Option A : through `@webjsdev/cli` (the normal path)

Nothing to install. `@webjsdev/ui` is a hard dependency of `@webjsdev/cli`,
so a global webjs install already includes it. Apps scaffolded with
`webjs create` reach it the same way. The scaffold deliberately does not pin
it, because the kit copies source into your project rather than being
imported at runtime, so the CLI resolves it from its own install.

```sh
webjs ui init
webjs ui add button card dialog
```

### Option B : the standalone binary

The `webjsui` binary does not require `@webjsdev/cli`, so a WebJs app that
skipped the global install can reach the kit with two npm installs, the CLI
and the runtime base class:

```sh
npm install -D @webjsdev/ui
npm install @webjsdev/core
npx webjsui init
npx webjsui add button card dialog
```

Both paths write the same `components.json`. `init` takes no reading of the
host project: the defaults below are fixed, and `--css <path>` overrides the
stylesheet it appends the tokens to. Re-running it preserves what an existing
project already declared (its aliases, stylesheet path, and base color) and
leaves an existing helper file as you edited it, so it is safe as a repair
step. Pass `--overwrite` to reset those instead.

## What `init` writes

- `components.json`, your project's UI config (aliases, base color, Tailwind path)
- `lib/utils/cn.ts`, the `cn()` class-merge helper, and `lib/utils/dom.ts`
  beside it for the client-only `onBeforeCache()` helper
- Tailwind tokens + CSS variables appended to `styles/globals.css`

## What `add` does

Copies the component's `.ts` source into `components/ui/<name>.ts` (or your
configured alias). Resolves transitive deps via `registryDependencies` and
auto-installs npm deps like `@floating-ui/dom` for popover-style components. For
a Tier-1 class-helper component it copies the helpers plus a lean header and a
one-line pointer, and leaves the worked structural example OUT of the file (get
it on demand with `npx @webjsdev/ui view <name>`, which is what the pointer it
leaves behind says too). It also self-heals the theme tokens if
they are missing.

Resolution is LOCAL-FIRST: `init` / `add` / `list` / `view` read the registry
that ships inside the installed `@webjsdev/ui` package, so they work with no
network. Point at a custom registry with `--registry <url>`; `webjsui diff`
always compares against the live upstream.

## Commands

| Command | Effect |
|---|---|
| `webjsui init` | Initialize a project (writes `components.json`, `lib/utils/cn.ts`, the theme tokens). Preserves an existing project's settings and helper files; `-o, --overwrite` resets them. Exits non-zero if the tokens cannot be written. |
| `webjsui add <names...>` | Add components (copies helpers + a pointer for Tier-1, self-heals theme tokens) |
| `webjsui list` | List all available components |
| `webjsui view <name>` | Print a component's projected view (helpers + paste-ready example) and full source |
| `webjsui diff [name]` | Show diff between your local copy and the live registry |
| `webjsui info` | Print project diagnostics |
| `webjsui build` | (For registry authors) Compile a custom registry |

## Tag convention

Every component uses a single `ui-` prefix:

```html
<ui-button variant="default">Click me</ui-button>
<ui-card>
  <ui-card-header>
    <ui-card-title>Title</ui-card-title>
    <ui-card-description>Description</ui-card-description>
  </ui-card-header>
  <ui-card-content>Content here</ui-card-content>
</ui-card>
```

## License

MIT
