# AGENTS.md for the WebJs gallery

This app is the **canonical source of the feature gallery every scaffolded app
ships**, and a live app in its own right (deployed at gallery.webjs.dev). Read
this before editing anything here, because a change in this directory changes
what `webjs create` emits for every future WebJs app.

The repo-wide contract is the root `AGENTS.md`; the framework reference is the
skill at `.agents/skills/webjs/SKILL.md`. This file covers only what is
special about `gallery/`.

## The gallery lives ONCE, here

`packages/cli/templates/gallery/` is **generated**, not authored. `packages/cli`
runs `scripts/sync-scaffold-gallery.mjs` at `prepack` to bundle this directory
into the npm tarball (npm's `files` cannot reach a repo-root path from inside a
package), and again with `--clean` at `postpack` to delete the copy. It is
gitignored, so it exists only for the seconds between those two hooks.

Never edit it, never commit it, never point a test at it. `webjs create` reads
the bundled copy when installed from npm and falls back to this directory in
monorepo dev, and both paths are filtered identically, so the two modes emit
byte-identical apps.

## Four files here are NOT scaffold payload

This is a runnable app, so it needs a root layout, a home page, a theme toggle,
and `cn()`. The scaffold generates its own versions of all four, carrying things
this app's copies cannot: the new app's `displayName`, the `cspNonce()` wiring,
`LayoutProps` typing, the `metadata.icons` favicon, and a `cn.ts` copied
verbatim from the `@webjsdev/ui` registry so `webjs ui add` stays in lockstep.

So these four are excluded from both the copy and the bundle:

```
app/layout.ts
app/page.ts
components/theme-toggle.ts
lib/utils/cn.ts
```

The list is `packages/cli/lib/gallery-shell-files.js`, read by BOTH
`copyGallery()` in `packages/cli/lib/create.js` and the prepack sync script. If
this app ever needs another app-only file inside `app/`, `components/`, `lib/`,
`modules/`, or `test/`, add it there in the same change, or it lands in every
scaffolded app.

Everything else in those five directories IS payload and ships verbatim.

**`public/` is gallery-only too, and is the other half of the boundary.** Both
copiers iterate `app`, `modules`, `test`, `components` and `lib`, so nothing
under `public/` is ever read. That is where this app's brand assets live (the
lockup SVGs in `public/brand/`, the self-hosted woff2 files in `public/fonts/`,
and the hand-written `public/input.css`), and it is why they can exist at all
without reaching a generated app.

**A brand helper belongs INLINE in a shell file, never in a new module.** The
reflex is to mirror the website, which keeps its logo in
`website/lib/design/brand.ts` and its footer in `website/lib/ui/site-footer.ts`.
Both of those paths are payload here, so either one would ship the WebJs mark
into every generated app. The header lockup and the footer are written inline in
`app/layout.ts` for exactly that reason.

The boundary is now GUARDED rather than only documented, by
`test/repo-health/gallery-payload-boundary.test.mjs`. Note what actually holds
it: the generator writes its own `app/layout.ts`, `app/page.ts` and
`components/theme-toggle.ts` AFTER `copyGallery()` runs, so those overwrite
whatever the copy left. The shell-file filter is defence-in-depth on top of
that write order, not the mechanism itself.

## Rules for a demo

- **One concept per card.** A demo under `app/features/<name>/` shows a single
  capability, with its logic in `modules/<name>/`. Whole apps composing several
  features go under `app/examples/<name>/`.
- **Comment densely.** These files are read as reference far more often than
  they are run. Explain why the idiom is the idiom, not what the line does.
- **Ship verbatim.** No `{{APP_NAME}}` substitution happens on the way into a
  scaffolded app, so a demo may reference only `@webjsdev/*`, drizzle, `#db/*`,
  `#lib/*`, `#modules/*`, `#components/*`, and other demos.
- **Update `gallery:clear` in the same change.**
  `packages/cli/templates/scripts/clear-gallery.mjs` drops `app/features` and
  `app/examples` whole, so a new route under those needs nothing. Everything it
  removes BY NAME does: a new `modules/<feature>/`, a shared component, a
  `lib/utils/` helper, a schema table. Miss one and `gallery:clear` leaves it
  behind, so the reset is not a blank slate.
  `test/scaffolds/scaffold-gallery.test.js` asserts `modules/` and
  `components/` are EMPTY after a clear.
- **The coverage gate points here.** `test/scaffolds/gallery-coverage.test.js`
  reconciles the live `@webjsdev/core` / `@webjsdev/server` surface against
  `test/scaffolds/gallery-coverage.json`, whose `demo` pointers are paths inside
  this directory. A new export is red in CI until it is demoed or exempted.

## Running and testing it

```sh
npm run dev:gallery                          # from the repo root, port 5005
cd gallery && cp .env.example .env           # first run
cd gallery && npm run db:migrate             # the auth + todo cards need real tables
cd gallery && npm test                       # node + browser
cd gallery && npx webjs check                # from INSIDE the app, never the repo root
```

CI runs `typecheck` plus `npm test` for this workspace in the in-repo app job,
and `webjs check` plus `webjs doctor` in the conventions job.

**Migrate the database before trusting a green run.** `test/auth/auth.test.ts`
SKIPS rather than fails when the `users` table is missing, so an unmigrated
database reports the auth card as passing while asserting nothing.

Browser tests live in a `browser/` directory next to the code they exercise
(`modules/<feature>/components/browser/*.test.js`), run under the runner's mocha
`tdd` globals, and are excluded from `tsconfig.json` for that reason.
