# The `@webjsdev/ui` component kit

Load this when the app uses `@webjsdev/ui` (a `components.json` is present), OR
when you are about to add a UI primitive (button, card, input, badge) to a fresh
app that has not initialised the kit yet: running `npx webjsdev ui init` then
`npx webjsdev ui add <name>` is HOW the kit comes to exist, and it is the default for a
repeated primitive over hand-writing one from scratch. `@webjsdev/ui` is the shadcn-style
kit for WebJs. The source is copied into your repo (`components/ui/`), so you own
and edit it exactly as freely as code you wrote yourself, and can add, remove,
restructure, or theme it however your app needs. Two tiers:

- **Tier 1, class helpers (23 components).** Pure functions returning Tailwind
  class strings (`buttonClass({ variant })`, `cardClass()`), composed with
  whatever native element you write. Reach for these instead of expanding
  Tailwind by hand: the call site is a fraction of the tokens and the class list
  cannot drift.
- **Tier 2, stateful custom elements (9 components).** `<ui-dialog>`, `<ui-tabs>`,
  `<ui-dropdown-menu>`, and friends own their ARIA (focus trap, roving tabindex,
  `aria-controls` / `inert`, live regions). Write the tag and the accessible
  behaviour comes with it. Do NOT hand-roll these; the wiring is easy to get
  subtly wrong.

## The workflow: query for the structure, do not guess it

`add` copies a Tier-1 component's class helpers plus a lean header (what each
helper is, the accessibility obligations) and a one-line pointer. It does NOT
copy the worked structural example, because that example is guidance you consume
once while composing, not code that should sit in your repo. Get the full
paste-ready structure on demand:

- **MCP `ui` tool** (preferred when available): call `ui` with no args for the
  kit inventory (each component's tier, helper signatures, npm deps); pass
  `{ name: "accordion" }` for one component's helper signatures, the paste-ready
  structural example, the accessibility header, and deps.
- **CLI**: `npx webjsdev ui list` (inventory), `npx webjsdev ui view <name>` (the projected
  view plus the full source). Same data as the MCP tool (one shared projector).

So the loop is: `add` the component, then query `ui <name>` (MCP) or
`npx webjsdev ui view <name>` for the accessible structure, paste it, and fill it in.

## Setup and resolution

- `npx webjsdev ui init` writes `components.json`, `lib/utils/cn.ts`, and the CSS design
  tokens the helpers render against (`--background`, `--foreground`,
  `--destructive`, ...). It HARD-FAILS if the tokens cannot be written, so a
  clean exit means the kit is styled. Re-running it is safe on an existing
  project: it keeps the aliases, stylesheet path, and base color already in
  `components.json` and leaves an edited `cn.ts` / `dom.ts` alone, so it only
  fills in what is missing (`--overwrite` resets them instead). `add` self-heals the tokens if they go
  missing.
- Resolution is LOCAL-FIRST: `init` / `add` / `list` / `view` read the registry
  that ships inside the installed `@webjsdev/ui`, with no network. This pins you
  to the installed version; run `npx webjsdev ui diff` to see where your local copies
  drift from the upstream (that command alone compares against the live registry).

## Inventory (run `npx webjsdev ui list` or the MCP `ui` tool for the authoritative, current set)

**Tier 1 (class helpers):** accordion, alert, aspect-ratio, avatar, badge,
breadcrumb, button, card, checkbox, collapsible, description-list, empty-state,
field-group, input, kbd, label, native-select, page-header, pagination, popover,
progress, radio-group, separator, skeleton, stat, switch, table, textarea,
timeline.

Six of those are the design primitives, and they are the ones an agent is most
likely to hand-roll instead: **empty-state** (what a region says when it has
nothing to show, which seeded data hides), **stat** (a number with its label,
where the value outweighs the label), **page-header** (the page's one `<h1>` and
its one primary action), **field-group** (fieldset grouping, input addons, and
the reserved error space), **description-list** (labelled values, replacing a
label and a colon on one line), and **timeline** (events in order). See
`references/design.md` for when each belongs on a screen.

**Tier 2 (custom elements, own their ARIA):** alert-dialog, dialog,
dropdown-menu, hover-card, sonner, tabs, tooltip, plus toggle and toggle-group
(these two register an element AND export a `*Class` helper).

## Idioms

- A helper is a function, so compose it: `class=${buttonClass({ variant: 'outline' })}`.
  The unquoted `${...}` is a normal `html` attribute hole.
- Tier-1 helpers assume the design tokens exist; if a component paints unstyled,
  the tokens are missing (re-run `npx webjsdev ui init` or let `add` self-heal them).
- Custom elements are display-only-safe at SSR and hydrate in the browser, the
  standard WebJs component model (`references/components.md`).
- A registry module should do no work at module scope, because the elision
  analyser reads a module-scope call or a `document` reference as client work
  and then the page that imports it ships whole (#1320). `cn` itself is clean,
  so importing it never pins a page. Six modules still trip the analyser and DO
  pin an importing page: `checkbox`, `radio-group`, `pagination`, `progress`,
  `sonner`, `tabs`. The first two inject a stylesheet for real; the other four
  are an analyser precision gap (an arrow with an expression body puts its call
  at brace depth 0). Either way the page ships, so treat the list as fact rather
  than as a technicality. Keep your own copies clean when you edit them, and run
  `npx webjsdev elision`, which names the blocker whenever a page ships.
- `native-select`'s `<option>` colours ride the design tokens, not the module.
  An app with no theme block gets the browser default `<option>` colours along
  with everything else unstyled, fixed the same way (re-run `init`, or let `add`
  plant the block). An app whose block predates the rule keeps the default until
  the rule is added by hand, because `init` never rewrites an existing block.

Full per-package reference lives in the installed `@webjsdev/ui/AGENTS.md`.
