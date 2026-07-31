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
                       see lib/ui/docs-shell.ts.
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
    preview-tabs.ts    Preview / Code toggle around a gallery demo
                       (components/ui/ is intentionally EMPTY here, left free
                       for `webjs ui add` to own, exactly as the scaffold
                       expects. The gallery's preview copies live in
                       modules/ui/components/ instead, see below.)
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
      docs-shell.ts    the sidebar + drawer + .prose-docs typography, SHARED by
                       /docs and /ui so the two sections cannot drift apart
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
- **`/robots.txt`, `/sitemap.xml`, `/llms.txt`** are generated from the
  live content queries, so a new article, comparison, or post needs no
  edit to those files.

## Announcement banner

The layout (`app/layout.ts`) renders a top-of-page announcement strip
just above the sticky header: a small utility-class `<div>` with a "New"
badge and a link (currently the `UI_PATH` link, "Introducing the AI-first
component library"). To swap the announcement, edit that `<div>` (its copy
and the link `href`). The banner shows on every page. Remove the `<div>`
to hide it.

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
- Each section in `page.ts` is a `<section>` wrapper for predictable
  scroll anchors.
- **Code blocks follow three accessibility rules**, enforced by
  `test/ssr/pre-block-a11y.test.ts` across every page that renders one.
  A `<pre>` maps to ARIA role `generic`, where ARIA prohibits an
  author-supplied name, so a named block carries `role="region"` to make
  the name legal. A named region is a landmark, so no two blocks on a
  page may share a name (`aria-label="Example files"` on two cards is
  the mistake to avoid; name each for what it shows). And a block with
  `overflow-x-auto` is a scroll container at some viewport width, so it
  carries `tabindex="0"`, since a scroll container no keyboard can reach
  is unusable without a pointer.

## Run

```sh
cd website && npm run dev       # http://localhost:5001
```

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
