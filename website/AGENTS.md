# AGENTS.md for the landing site

The webjs marketing / landing site, built on webjs itself. All
framework-wide rules (file conventions, public API, workflow, scaffold
rules, persistence rules, autonomous-mode behaviour) live in the
**framework root [`../AGENTS.md`](../AGENTS.md)** and apply here. Read
that first.

This file only covers what's specific to the landing site.

## Layout

```
website/
  app/
    layout.ts          root layout (head, OG/Twitter metadata,
                       header/footer chrome, Tailwind tokens)
    page.ts            /  → the entire one-page landing site.
                           Hero, features grid, code samples, and agent
                           badges all live here. The header and footer
                           chrome are in layout.ts (shared by every page).
    changelog/page.ts  /changelog. Reads ../../../changelog/<pkg>/*.md
                       at SSR time and renders the unified release
                       feed. The deployment image must include the
                       changelog/ tree at the repo root, the
                       Dockerfile's `COPY changelog ./changelog` line
                       is what ships it on Railway.
    blog/              /blog hub + /blog/[slug]. Reads ../../../blog/*.md.
                       WebJs design notes (dated). Emits per-post JSON-LD
                       (BlogPosting + BreadcrumbList). No FAQ.
    articles/          /articles hub + /articles/[slug]. Reads
                       ../../../articles/*.md. Evergreen keyword explainers
                       (tags, no dates). Emits TechArticle + BreadcrumbList
                       + FAQPage.
    compare/           /compare hub + /compare/[slug]. Reads
                       ../../../compare/*.md. Emits per-page JSON-LD
                       (TechArticle + BreadcrumbList + FAQPage).
    docs/              /docs/<topic>, the reference documentation (#1098 moved
                       it here from docs.webjs.dev). layout.ts holds the nav
                       tree + docs-scoped metadata; the shell itself is shared,
                       see lib/ui/docs-shell.ts. Nav labels and section titles
                       are Title Case, the convention the Next.js and Rails
                       docs follow, rather than Tailwind's sentence case. A
                       code identifier keeps its own casing inside a label
                       (createAuth, Drizzle), which is what every comparable
                       docs site does. A doc page's h1 reads exactly as its
                       nav label. Both rules are enforced, by the
                       test/ssr/docs-links.test.ts tests "every docs sidebar
                       label and section title is Title Case" and "a doc page
                       h1 matches its sidebar label". The /ui sidebar is
                       deliberately exempt: its labels are component names
                       from the live registry, so they are identifiers by
                       construction.
    ui/                /ui, the @webjsdev/ui component gallery (#1099 moved it
                       here from ui.webjs.dev). page.ts is the introduction,
                       [name]/page.ts one page per component, layout.ts the
                       sidebar built from the live registry index, and
                       registry/** the JSON API that shipped CLI versions fetch
                       (see modules/ui/ below). No landing page: /ui opens on
                       the introduction, the way /docs opens on Getting Started.
    sitemap.ts         /sitemap.xml (enumerates docs + ui + articles + compare + blog)
    robots.ts          /robots.txt (allow-all, points at the sitemap)
    llms.txt/route.ts  /llms.txt (llmstxt.org overview for AI agents)
  components/
    theme-toggle.ts    system/light/dark cycle
    copy-cmd.ts        click-to-copy command line (light DOM, always-on button)
    doc-search.ts      the docs sidebar search field
    code-block.ts      every code sample on the site: renders the <pre> (the
                       keyboard focus stop, the optional landmark name) and
                       colours the docs samples in the browser with the one
                       grammar from lib/utils/highlight.ts
    preview-tabs.ts    Preview / Code toggle around a gallery demo
    docs-drawer.ts     the /docs + /ui sidebar shell and its mobile drawer:
                       backdrop, toggle, aside, open state, every close path
    site-nav-menu.ts   the header's mobile menu, wrapping a native <details>
                       so it still opens with JS off
                       (components/ui/ is intentionally EMPTY here, left free
                       for `webjs ui add` to own, exactly as the scaffold
                       expects, and gitignored so it stays that way. The
                       gallery's preview copies live in modules/ui/components/
                       instead, see below. Enforced by
                       test/ssr/kit-surfaces.test.ts, because eleven copies of
                       that mirror were once committed here by accident and
                       sat unimported until someone read the directory.)
  lib/
    design/            the design system, one subsystem in one folder
      recipes.ts       class recipes + the scale (BTN_*, EYEBROW, layout widths)
      brand.ts         the logo lockup and monogram fragments
      tokens.ts        the palette as data, painted by /brand
    ui/                composed page fragments, one per file. SSR-time functions
                       returning `html`; nothing here registers a custom element
      page-header.ts   hub eyebrow + title + lede
      cta-panel.ts     the closing call to action
      site-footer.ts   the footer, rendered by the root layout on every page
      docs-shell.ts    the shell stylesheet (.prose-docs typography, the sticky
                       desktop column) plus the function that turns a nav tree
                       into markup and slots it into <docs-drawer>. SHARED by
                       /docs and /ui so the two sections cannot drift apart.
                       The drawer's markup and behaviour are NOT here, they are
                       components/docs-drawer.ts
    scroll-lock.ts     refcounted page scroll lock, sharing the UI kit's
                       globalThis counter so a drawer and a <ui-dialog>
                       interoperate. Measures and compensates the viewport
                       widening that hiding the scrollbar causes (#1147)
    theme.ts           the theme storage key and forced values, read by BOTH
                       the layout's bootstrap script and theme-toggle.ts
    escape-target.ts   the one rule deciding whether an Escape press belongs to
                       the field the reader is editing. Shared, because every
                       dismissible surface has to answer it identically
    utils/             pure helpers (compute, never render)
      highlight.ts     SSR syntax highlighter for the code samples
      frontmatter.ts   parse changelog/blog markdown frontmatter
      faq.ts           parse a `## FAQ` markdown section into FAQPage JSON-LD
      cn.ts dom.ts     GITIGNORED. The kit's helpers, mirrored to the exact
                       path `webjs ui add` writes them to in a real app
    links.ts           cross-app URLs + in-app paths for the header and footer
    samples.ts         the code samples shown on the marketing pages
    docs-llms.server.ts  enumerates the doc pages on disk (sitemap, llms.txt)
  modules/
    ui/components/     GITIGNORED mirror of the @webjsdev/ui registry sources,
                       written by scripts/copy-registry.mjs. NEVER hand-write
                       here: it is wiped every dev cycle. It lives under the
                       gallery's own module rather than in components/ui/
                       because it is gallery INFRASTRUCTURE (live previews),
                       not this site's UI kit. That keeps components/ui/ free
                       so `webjs ui add` works here the same way it does in a
                       scaffolded app.
    ui/queries/registry.server.ts  composes the registry JSON on demand from
                       packages/ui/packages/registry/ (the source of truth).
                       This is what /ui/registry/** serves.
    ui/utils/          tier classification, per-component examples + API metadata
  scripts/             manual dev tools, NOT part of build/deploy
    fetch-fonts.mjs    download the self-hosted variable woff2 fonts
    generate-og.mjs    regenerate the OG social card (needs playwright + ImageMagick)
    copy-registry.mjs  mirror the kit sources into modules/ui/components/ +
                       lib/utils/{cn,dom}.ts.
                       Runs via webjs.dev.before / webjs.start.before and is
                       baked into the deploy image (#526), so a component page
                       never boots without its imports.
  public/              favicon, og image, self-hosted fonts, static assets
```

## How lib/ grows

The scaffold starts flat (a lone `lib/utils/ui.ts` and nothing else), and this
site follows the same rule it grew by: a file stays loose at `lib/*.ts` while
it is a standalone app-wide value, and a SUBSYSTEM gets its own `lib/<name>/`
folder once it reaches about three related files. The design system
(`lib/design/`) and the composed page fragments (`lib/ui/`) both crossed that
bar; `links.ts` and `samples.ts` have not, so they stay loose. Fragments in
`lib/ui/` are one file per fragment for the same reason the framework keeps
one action per file: the filename is the index.

The site is intentionally one page in long-form scroll. When you edit
copy, find the section in `app/page.ts` (search for the visible text
that needs to change) and update inline.

## How to add a feature card

The features grid is driven by the `PILLARS` array near the top of
`app/page.ts`. Each entry is `{ icon, title, desc }`, where `icon` is a
key into the local `ICON` map (for example `ICON.bolt`). Add a new entry
in the correct order and the grid reflows automatically. If no existing
icon fits, add one to the `ICON` map first.

## SEO surfaces (articles, blog, comparisons, structured data)

The site targets real search keywords ("web components framework", "no
build javascript framework", and so on) and "WebJs vs X" queries. Content
is split by editorial intent, which is what decides where a piece goes:

- **`/articles`** is evergreen, keyword-targeted explainers on the web
  platform ("what a web components framework is", "run TypeScript with no
  build step"). Timeless reference, presented WITHOUT dates. An article is
  an `articles/<slug>.md` file. Only write one for a term with real search
  demand where WebJs is a legitimate answer (validate the query first; a
  coined phrase nobody searches does not belong here). Articles carry a
  `## FAQ` (SEO landing pages, like `/compare`).
- **`/blog`** is dated WebJs design notes ("the decisions, the trade-offs,
  the things that did not work"). A `blog/<slug>.md` post, FAQ-free, in
  the author's first-person voice. A general web-platform explainer does
  NOT belong here (that is why the split exists); it goes in `/articles`.
- **`/compare`** is "WebJs vs <framework>" head-to-heads (`compare/<slug>.md`).
- Do NOT let two pages chase the same exact keyword (cannibalization);
  an article owns the general term, a blog post owns the WebJs-specific angle.
- **FAQ convention.** End an article or comparison body with a `## FAQ`
  section, each question a `### <question>` heading followed by its answer
  paragraph. `lib/utils/faq.ts` (`parseFaq`) turns that into a `FAQPage` JSON-LD
  block. The FAQ is BOTH rendered (normal markdown) and emitted as schema,
  so the two never drift (Google discounts FAQ schema that is not visible
  on the page). Blog posts do NOT use FAQ.
- **JSON-LD** is set via `metadata.jsonLd` (the framework emits a
  `<script type="application/ld+json">`): `TechArticle` + `BreadcrumbList`
  + `FAQPage` on articles and comparisons, `BlogPosting` + `BreadcrumbList`
  on blog posts, and `WebSite` + `Organization` + `SoftwareApplication` on
  the home page (jsonLd-only `export const metadata`, so it does not split
  the layout-sourced title). Article schemas carry an `image`. Keep the
  schema honest: it must match the visible page content.
- **Entity nodes carry an `@id` and share one `sameAs`.** Several nodes name
  the project with the same `name` and `url`, so each declares an `@id`
  (`#website`, `#organization`, `#software`) or a crawler cannot tell one
  entity described several ways from several entities. The
  `SoftwareApplication` on `/what-is-webjs` reuses `#software` deliberately,
  so its richer description merges into the home node. Every node that
  identifies the project reads the shared `SAME_AS` export from
  `lib/links.ts` rather than listing properties inline, and
  `test/docs/site-entity-graph.test.mjs` fails if a new one does neither.
- **`/robots.txt`, `/sitemap.xml`, `/llms.txt`** are generated from the
  live content queries, so a new article, comparison, or post needs no
  edit to those files.

## Header

`app/layout.ts` renders the site header on every page. It is
`position: fixed`, NOT sticky: a sticky header flickers on iOS WebKit during
a client-router navigation (#610), so the height is reserved on the content
through a `--header-h` offset, measured by the inline script in the layout
head and defaulted on `:root` for no-JS and first paint.

There is no announcement banner. One used to sit above the header, and
`--header-h` is why its removal is not free: re-adding a strip means the
measurement has to cover it too.

The header's mobile menu is `components/site-nav-menu.ts`, and the fixed
position is why it carries
`border-right: var(--wj-scrollbar-compensation, 0px) solid transparent`. A
scroll lock hides the page scrollbar, which widens the viewport, and a fixed
element lays out against the initial containing block where no padding can
reach it. `lib/scroll-lock.ts` publishes that measured width for it to opt into
(#1144, #1147).

## What stays inline script in the root layout

Only two things, and both are genuinely boot work rather than interactivity:

- the **theme bootstrap**, which must run before first paint or a reader who
  chose dark sees the light palette flash. It cannot import, so it interpolates
  the storage key from `lib/theme.ts`.
- the **`--header-h` measurement**, which backs the fixed-header offset above.

Everything else that used to live there is a component now. The drawer and the
header menu were once one delegated click listener plus one delegated keydown
listener reaching across the document with `querySelector` and body attributes,
with the markup in a different file. If you find yourself adding a third
delegated listener here, write a component instead.

TWO cross-component contracts run between the drawer and the header menu, and
both are easy to break by accident.

**The first is priority.** The drawer listens for Escape in the CAPTURE phase
and calls `preventDefault()`, and the header menu listens in the BUBBLE phase
and bails on `defaultPrevented`. That is what makes one Escape close only the drawer when
both are open, without either component importing the other, and it holds
whatever order the elements registered in.

It holds at the TARGET too. The dispatch algorithm walks the propagation path
twice, invoking each node once per traversal and honouring the capture flag on
both, so a capture listener on `document` runs before a bubble listener on
`document` even for an event dispatched directly at `document` and even when the
bubble one registered first. Measured in Chromium: registering bubble then
capture and dispatching on `document` yields `capture, bubble`.

What a test DOES have to get right is `cancelable: true`. `preventDefault()` on a
non-cancelable event is a silent no-op, so `defaultPrevented` stays false and
both surfaces close. Dispatching from inside the tree rather than at `document`
is worth doing for realism, but it is not what makes the priority work.

**The second is deferral, and it does NOT run through `defaultPrevented`.** When
an Escape belongs to the field the reader is editing (a non-empty, mutable
`input[type=search]`, the only field Escape natively clears), every open surface
must decline it, and each one decides that by calling the same
`escapeBelongsToField` from `lib/escape-target.ts`. Two rules follow from that
and neither is obvious:

- The drawer must **not** call `preventDefault()` on the deferral path. It is
  the natural way to tell the menu "this press is taken", and it is wrong,
  because suppressing the default cancels the native clear the deferral exists
  to protect. Agreement comes from both surfaces applying the same rule, not
  from a flag on the event.
- The rule is intentionally document-wide rather than scoped to the surface that
  contains the field, because a field inside ONE surface must also stop the
  OTHER dismissing, and a containment test in the other surface answers false
  for exactly that case.

Both surfaces also close on `popstate` and `webjs:before-cache`, not only on
`webjs:navigate`. A back or forward that hits the router's snapshot cache
applies the swap and returns before `webjs:navigate` is dispatched, so popstate
is the only timely signal there, and `webjs:before-cache` strips the open state
before the snapshot is serialized so a forward restore does not bring the
surface back open.

`webjs:before-cache` carries a timing trap worth knowing. The router dispatches
it synchronously and reads `documentElement.outerHTML` in the same task, a
couple of statements later with no await in between, so ONLY a synchronous
mutation is captured. Setting a reactive property is not enough on its own,
because the host attribute reflects at once while EVERY template hole is a
render-time write committed a microtask later and misses the snapshot.

Both surfaces therefore write their child state directly in the handler. The
menu closes its `<details>` element, which is what shows the panel and drives
the icon swap. The drawer writes `aria-expanded` on its toggle, which is not
visual (its CSS selects the reflected host attribute, so a restored page looks
right) but would otherwise announce an expanded drawer that is closed. If you
add a hole that encodes dismissible state, it belongs in that handler too.

## How to update headline / hero copy

`app/page.ts`: the hero block is at the top of the default-exported
function. Edit the inline `<h1>` / `<p>` text.

## SSR action seeding is OFF for this app

`package.json` sets `"webjs": { "seed": false }`. Seeding (#472) serializes
every `'use server'` result invoked during SSR into the page so a shipping
async component can skip its refetch on hydration. Nothing here consumes that:
no component on this site does an async render or calls an action, and a page
function never re-runs in the browser, so the payload was pure page weight.

It was not small. Before turning it off, `/changelog` carried 304KB of seed in
a 1.1MB response and `/ui/dropdown-menu` 35KB in 141KB, roughly a quarter of
each page, duplicating content already in the visible HTML.

If you add a component here that genuinely wants seeding (an async render
calling an action), re-enable it and delete the assertion in
`test/ssr/ui-gallery.test.ts` that pins this off.

## Style

- Light DOM, Tailwind utilities, `@theme` tokens from the root layout
  (same palette / type scale as the blog and docs).
- **Each per-theme colour is declared ONCE, as `light-dark(LIGHT, DARK)`**,
  and the three `color-scheme` declarations in `app/layout.ts` pick the side
  (the default follows the OS; the toggle's `[data-theme]` forces one). This
  is the rule the framework teaches its own users, in the skill at
  `.agents/skills/webjs/references/styling.md`. A token that is NOT a colour
  (`--glow-strength`, `--cta-mix`, `--shadow-spread`) cannot ride
  `light-dark()`, so it keeps an explicit override pair: the OS media query
  plus the attribute rule. Nothing else may. The same rule governs the
  `.ui-preview` kit palette in `public/input.css`. Both are pinned by
  `test/ssr/design-tokens.test.ts` and `test/ssr/kit-surfaces.test.ts`.
- Each section in `page.ts` is a `<section>` wrapper for predictable
  scroll anchors.
- **A code sample under `/docs` or `/ui` is a `<code-block>`, never a bare
  `<pre>`.** `components/code-block.ts` renders the `<pre>` and colours the
  code. Write `<code-block>your code</code-block>` and pass nothing else;
  `label` (which also adds `role="region"`) and `pre-class` exist for the rare
  block that needs them. A bare `<pre>` there loses both the highlighting and
  the focus stop, silently, which is how the site ended up with 480 of them.
  A marketing page holds its samples as JS strings instead, so it writes its
  own `<pre>` around `highlight(SAMPLE)` and colours them at SSR, and it is
  then responsible for the accessibility rules below on its own. Pick by where
  the sample lives: inline template text is a `<code-block>`, a string is a
  `highlight()` call.
- **Code blocks follow three accessibility rules**, and the element is how the
  first two are satisfied without anyone remembering them. A named block takes
  `role="region"`, because ARIA prohibits an author-supplied name on the
  `generic` role a `<pre>` maps to; no two blocks on a page share a name,
  because a named region is a landmark; and a block that can scroll takes
  `tabindex="0"`, because a scroll container no keyboard can reach is unusable
  without a pointer. `test/ssr/pre-block-a11y.test.ts` enforces all three
  across the marketing pages, the error boundary, the markdown post body
  (shared by `/blog/[slug]`, `/articles/[slug]`, and `/compare/[slug]`), every
  page under `app/docs/` and `app/ui/`, and every gallery detail page. It does
  not keep a list: the section pages are DISCOVERED from the file system and
  the gallery components come from the same registry index the sidebar is
  built from, so a page or a component added tomorrow is covered. It reads
  scrollability from the rendered document, not from the tag, since a docs
  block scrolls because of `.prose-docs pre { overflow-x: auto }` in
  `lib/ui/docs-shell.ts` and nothing on the tag records that.
- **One tokenizer, in `lib/utils/highlight.ts`.** The marketing pages and the
  blog markdown renderer call it at SSR; `<code-block>` calls the same
  `tokenize()` in the browser, because the docs samples are authored as inline
  template text with `&lt;` and `&#123;` escapes and so give the server no
  string to tokenize. There used to be a second ES5 copy served out of
  `public/`, kept in sync by hand, and it drifted. Do not add another.

## Run

```sh
cd website && npm run dev       # http://localhost:5001
cd website && npm run typecheck # tsc --noEmit, the same gate CI runs
```

`npm run typecheck` mirrors the kit sources in before it runs `webjs typecheck`,
because the mirror is gitignored and without it `tsc` reports 45 errors that
have nothing to do with your change (17 unresolved-module, 19 implicit-any, 9
side-effect-import) and bury any real one. The CI `apps` job runs the same
script, so a type break reds the build instead of riding onto `main` unnoticed
(#1260).

What it covers is exactly the tsconfig `include`: `app/`, `components/`,
`lib/`, and `modules/`. **`test/` is deliberately outside it.** Adding
`test/**/*` surfaces 17 pre-existing errors across 5 of its 25 TypeScript
files (a `never` argument in the sitemap test, `LayoutProps` calls missing
`params` / `searchParams` / `url`, and an `unknown` not assignable to
`TemplateResult` in the determinism test), so including it would red the gate
on day one. Fixing those is its own task.

Across apps the gate covers `website/` only, which is a SCOPE decision rather
than a claim about the others. Measured: `examples/blog` is genuinely red (13
errors), but `docs/` and `packages/ui/packages/website` both typecheck clean
today, so gating them is a small, separate change and not a blocked one.

`npm run dev` and `webjs dev` behave identically (#550): `webjs.dev.before`
mirrors the kit sources in and compiles `public/tailwind.css`, and
`webjs.dev.regenerate` (#967) re-runs both on request when a source changes, so
neither the mirror nor the stylesheet goes stale without a live watcher. The
mirror has to be refreshed as part of that command rather than only in
`before`, because the generated sources are a scanned `@source`: recompiling
the stylesheet against a stale mirror silently omits the utility classes the
gallery previews need. In prod, `npm start` and `webjs start` are equivalent
too, via `webjs.start.before`.

Every nav entry is an in-app route and needs no env var: Blog, Changelog, Docs, and the UI gallery. (Docs and the gallery used to
need one each. They were separate `docs.webjs.dev` and `ui.webjs.dev` apps
until #1098 and #1099 moved them here under `app/docs/` and `app/ui/`, so
`DOCS_URL` and `UI_URL` are both gone.)

---

Framework-wide rules and full API reference:

@../AGENTS.md
