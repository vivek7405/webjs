#!/usr/bin/env node
// Clear the scaffold's feature gallery to a clean, buildable base.
//
// The scaffold ships a browsable gallery (single-concept demos under
// app/features/, the app/examples/todo app, their modules/, and example
// metadata routes) so an agent can learn the idioms from real, running code.
// The gallery is reference, NOT part of your product. Learn from the demos
// relevant to your task first (the skill at .agents/skills/webjs/ teaches the
// same patterns and SURVIVES this reset, so nothing is lost), then run this
// once to shed the gallery, then grow the app in place.
//
// It strips the app down to a TRULY BAREBONES blank slate: it removes the
// gallery routes + modules + demo metadata routes, the gallery's example design
// system (components/ui/), the example theme-toggle component, the example test
// suite (test/hello/), and every empty leftover dir, then resets app/page.ts to
// a minimal home AND app/layout.ts to a blank-slate base (the gallery's navbar,
// theme toggle, Google Fonts, AND design-token palette dropped: the reset layout
// carries NO design system, just the OS light/dark system colours, so the agent
// builds the palette as its own, guided by the skill), and drops the demo `todos`
// table plus the auth card's `passwordHash` column from the schema. It KEEPS only
// the buildable base: the agent skill (.agents/skills/webjs/), the reset root
// layout (the Tailwind wiring + a system-colour base, no tokens), the database
// wiring, the example `users` table, and `lib/utils/cn.ts` (the `webjs ui add`
// prerequisite).
//
// Why strip so much: the demos, the design system, and the example component /
// tests are all EXAMPLES to learn FROM, not a base to inherit. Leaving them
// nudges the implementing agent to lean on the scaffold's choices instead of
// building the app's own. The DURABLE knowledge is the pattern itself, which
// lives in the skill (.agents/skills/webjs/, re-read every session): learn it
// from the gallery here, then after this reset build your own (run
// `webjs ui add <name>` for UI primitives, cn.ts is kept for it) themed to your
// app. It is a one-time reset: if the gallery is already gone (no app/features/)
// it does nothing, so a rerun never clobbers an app you built.
import { rmSync, rmdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const rm = (p) => { if (existsSync(join(root, p))) { rmSync(join(root, p), { recursive: true, force: true }); return true; } return false; };
// Remove a directory ONLY if it exists and is empty (used to clean the empty
// parents a partial gallery removal leaves behind, e.g. app/api after its lone
// auth handler is gone). Never touches a dir that still holds files.
const pruneEmpty = (p) => { const abs = join(root, p); if (existsSync(abs) && readdirSync(abs).length === 0) { rmdirSync(abs); return true; } return false; };

// Guard: the gallery is identified by app/features/. If it is absent, the gallery
// was already cleared (or this is not a gallery scaffold), so exit before any
// destructive write. This keeps a rerun safe and never clobbers a built app (a
// customized app/page.ts, a same-named module, or real migrations).
if (!existsSync(join(root, 'app/features'))) {
  console.log('No gallery found (app/features/ is absent); nothing to clear.');
  process.exit(0);
}

// 1) Gallery route trees + example metadata routes. `app/api/auth` is the auth
// card's createAuth handler (it lives at the app root, not under app/features/,
// because createAuth hardcodes /api/auth/*), and `test/auth` + `test/rate-limit`
// are card-owned request-pipeline tests, so they are removed alongside their
// cards. A card that ships a test under test/ MUST be listed here: the prune
// below only removes test/ once it is EMPTY, so a missed entry silently leaves
// the reset app with a test suite for a card it no longer has.
const galleryPaths = [
  'app/features', 'app/examples', 'app/sitemaps', 'app/api/auth', 'test/auth', 'test/rate-limit',
  'app/icon.ts', 'app/apple-icon.ts', 'app/manifest.ts', 'app/opengraph-image.ts',
  'app/twitter-image.ts', 'app/robots.ts', 'app/sitemap.ts',
  'app/global-error.ts', 'app/global-not-found.ts',
  // The gallery's EXAMPLE design system. Removed so the reset app is a blank
  // slate: the agent builds its own components/ui/ (run `webjs ui add`, cn.ts is
  // kept), learning the pattern from the skill, not inheriting the gallery's.
  'components/ui',
  // Example scaffold artifacts (invariant 2): the theme-toggle component and the
  // example test suite are things to learn from, not the agent's app. Removed
  // for a true blank slate; the root layout is reset to a minimal base below
  // (which drops its toggle wiring). The agent writes its own tests + components.
  'components/theme-toggle.ts', 'test/hello',
  // The gallery's markup-chunk helpers. Their only users (the feature pages +
  // the features/examples layouts) are removed above, so drop the example file
  // too; cn.ts + dom.ts (real infrastructure) stay under lib/utils/.
  'lib/utils/ui.ts',
];
// 2) The gallery's feature modules (by name). `auth` is the auth card's server
// modules (createAuth config, password hashing, signup action, current-user
// query), pruned with the rest of the card.
const galleryModules = [
  'async-render', 'auth', 'broadcast', 'caching', 'client-router', 'components',
  'directives', 'file-storage', 'forms', 'frames', 'gallery', 'optimistic-ui',
  'rate-limit', 'route-handler', 'server-actions', 'sessions', 'stream',
  'streaming', 'suspense', 'todo', 'websockets',
].map((m) => `modules/${m}`);

let removed = 0;
for (const p of [...galleryPaths, ...galleryModules]) if (rm(p)) removed++;

// 3) Reset app/page.ts to a minimal home (no gallery grid, no dead links).
writeFileSync(join(root, 'app/page.ts'), MINIMAL_PAGE());

// 4) Drop the demo `todos` table and the auth card's `passwordHash` column from
// the schema (keep the example `users` table and everything else), reverting the
// schema to the minimal base.
const schemaPath = join(root, 'db/schema.server.ts');
if (existsSync(schemaPath)) {
  let s = readFileSync(schemaPath, 'utf8');
  s = s.replace(/\n(?:\/\/[^\n]*\n)*export const todos = table\('todos',[\s\S]*?\n\}\);\n/, '\n');
  s = s.replace(/defineRelations\(\{ users, todos \}/, 'defineRelations({ users }');
  // Strip the auth `passwordHash` column (and its leading comment lines) from the
  // users table; the rest of the table is the minimal example base.
  s = s.replace(/\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*passwordHash: text\(\),\n/, '\n');
  writeFileSync(schemaPath, s);
}

// 5) Reset the root layout to a blank-slate base. The gallery layout ships a
// navbar, a theme toggle, Google Fonts, and a full design-token palette; a blank
// slate should inherit NONE of that, so OVERWRITE it with a minimal layout that
// carries no design system: the Tailwind stylesheet + OS light/dark system
// colours (Canvas / CanvasText) + a bare <main>. The agent then builds the
// palette (CSS tokens + @theme + a light-dark() theme) as its own, guided by
// .agents/skills/webjs/references/styling.md.
// GUARD: overwrite only while the layout still carries the gallery's own navbar
// brand. A hand-customised layout (the brand removed / replaced) is the user's
// work, so it is KEPT and only the dangling references to the removed
// theme-toggle file are stripped surgically.
const layoutPath = join(root, 'app/layout.ts');
if (existsSync(layoutPath)) {
  const current = readFileSync(layoutPath, 'utf8');
  if (current.includes('WebJs Gallery')) {
    writeFileSync(layoutPath, MINIMAL_LAYOUT());
  } else {
    console.log('app/layout.ts looks customised; keeping it (only the theme-toggle wiring is stripped).');
    writeFileSync(
      layoutPath,
      current
        .replace(/^import '#components\/theme-toggle\.ts';\n/m, '')
        .replace(/^\s*<theme-toggle><\/theme-toggle>\n?/m, ''),
    );
  }
}

// 6) Drop generated migrations + the dev database so the next db:generate is
// clean against the reset schema (safe: the scaffold has no real data yet).
rm('db/migrations');
for (const f of ['db/dev.db', 'db/dev.db-shm', 'db/dev.db-wal']) rm(f);

// 7) Prune the empty leftover dirs a partial removal left behind, so the reset
// tree is a clean blank slate: app/api (held only the gallery auth handler),
// test/unit + test/e2e (empty base placeholders), and test/ itself once its
// example suites are gone. modules/ + components/ are kept as empty build
// targets (the reset home + `webjs ui add` land there). Order matters: prune the
// children before test/ so it reads as empty.
for (const d of ['app/api', 'test/unit', 'test/e2e', 'test']) if (pruneEmpty(d)) removed++;

console.log(`Gallery cleared (${removed} paths removed). The agent skill and your database wiring are kept. Build your own design system: run \`npx webjsdev ui add <name>\` and theme it (see .agents/skills/webjs/references/styling.md).`);
console.log('Next: regenerate the database (db:generate then db:migrate), then start the dev server and build your app in app/ and modules/.');

function MINIMAL_PAGE() {
  return `import { html } from '@webjsdev/core';

export const metadata = {
  title: 'Home',
};

export default function Home() {
  return html\`
    <div class="max-w-2xl mx-auto px-6 py-24 flex flex-col items-center text-center gap-6">
      <h1 class="text-4xl font-bold tracking-tight m-0">Your app</h1>
      <p class="text-base leading-relaxed m-0 opacity-70">
        The gallery is cleared. This is <code class="text-[0.9em]">app/page.ts</code>. Build your
        app from here. The guide is <code class="text-[0.9em]">.agents/skills/webjs/SKILL.md</code>.
      </p>
      <nav class="flex items-center gap-5 text-sm opacity-70">
        <a href="https://webjs.dev/docs" target="_blank" rel="noopener" class="hover:opacity-100 transition-opacity no-underline">Docs</a>
        <a href="https://github.com/webjsdev/webjs" target="_blank" rel="noopener" class="hover:opacity-100 transition-opacity no-underline">GitHub</a>
      </nav>
    </div>
  \`;
}
`;
}

function MINIMAL_LAYOUT() {
  return `import { html, asset } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';

/**
 * Root layout: the ONLY file that writes the document shell. It links the
 * Tailwind stylesheet and renders \${children} in a bare container. This is a
 * BLANK SLATE with no design system: it uses the OS light/dark system colours
 * (Canvas / CanvasText) so it reads fine immediately, and it is where YOU build
 * the app's look. The recommended setup, CSS custom-property tokens mapped into
 * Tailwind via @theme (so bg-background / text-foreground work), a DRY
 * light-dark() palette, a header/nav, and the ui class helpers, is taught in
 * .agents/skills/webjs/references/styling.md. Run \`npx webjsdev ui add <name>\`
 * to pull primitives, then theme them here.
 */

// Favicon via metadata.icons so the framework emits the <link> into <head> (a
// hand-written <link> in the template body is ignored by browsers).
export const metadata = { icons: '/public/favicon.svg' };

export default function RootLayout({ children }: LayoutProps) {
  return html\`
    <meta name="color-scheme" content="light dark">
    <!-- asset() content-hashes the url in production, so a deploy that changes
         the CSS changes the url and the framework serves it immutable for a
         year. Without it this stable url can serve the PREVIOUS stylesheet
         from a CDN or a service-worker cache after a deploy. -->
    <link rel="stylesheet" href=\${asset('/public/tailwind.css')}>
    <style>
      html, body { margin: 0; }
      body {
        background: Canvas;
        color: CanvasText;
        font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
    </style>
    <main class="min-h-dvh max-w-3xl mx-auto px-6 py-10">
      \${children}
    </main>
  \`;
}
`;
}
