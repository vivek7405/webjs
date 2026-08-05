import type { LayoutProps } from '@webjsdev/core';
import { docsShell } from '#lib/ui/docs-shell.ts';
import '#components/docs-drawer.ts';
import { loadRegistryIndex } from '#modules/ui/queries/registry.server.ts';
import { splitByTier } from '#modules/ui/utils/tier.ts';

/**
 * Component-library sub-layout: the same shell as /docs (lib/ui/docs-shell.ts),
 * with the component list in the sidebar instead of the docs page tree.
 *
 * This is a NON-ROOT layout (invariant 8), so it writes no document shell.
 * The header, footer, theme toggle, fonts, and design tokens all come from
 * app/layout.ts, exactly as they do on /docs and /what-is-webjs. That is the
 * point of serving the gallery from webjs.dev instead of ui.webjs.dev: one
 * design system, one set of tokens, no parallel shell to drift.
 *
 * The sidebar is generated from the registry index at request time so adding
 * a new component to the registry shows up here automatically. Section
 * headers are deliberately just "Tier 1" / "Tier 2" (the intro page explains
 * what the tiers mean; the sidebar only needs to group).
 *
 * There is no landing page: /ui opens straight onto this shell with the
 * introduction in the content column, the way /docs opens on Getting
 * Started.
 */

// The kit is framework-neutral, so this says where it comes from without
// scoping who it is for. It reads as a search snippet for every page under
// /ui, the same surface the npm description is, and a Next or Astro reader
// bouncing off "for WebJs" is the exact loss both are written to avoid.
const UI_DESCRIPTION =
  'The AI-first component library from WebJs: 32 primitives in two tiers, class-helper functions for visuals and custom elements only where state matters, source-copied into your project. Works in any Tailwind v4 project, not only a WebJs app.';
const UI_OG_TITLE = 'WebJs UI components';

/**
 * UI-scoped metadata, merged over the root layout's for every page under
 * /ui. Same shallow-merge caveat as the docs layout: `openGraph` and
 * `twitter` REPLACE the root's objects, so every field is restated here.
 * Keep these in step with app/layout.ts.
 */
export function generateMetadata(ctx: { url: string }) {
  const { origin, pathname } = new URL(ctx.url);
  const image = `${origin}/public/og.png`;
  return {
    description: UI_DESCRIPTION,
    openGraph: {
      type: 'article',
      title: UI_OG_TITLE,
      description: UI_DESCRIPTION,
      url: origin + pathname,
      image,
      'image:width': '1200',
      'image:height': '630',
      'image:alt': UI_OG_TITLE,
      'site_name': 'WebJs',
    },
    twitter: {
      card: 'summary_large_image',
      title: UI_OG_TITLE,
      description: UI_DESCRIPTION,
      image,
    },
  };
}

export default async function UiLayout({ children }: LayoutProps) {
  const all = await loadRegistryIndex();
  const { tier1, tier2 } = splitByTier(all.filter((i) => i.type === 'registry:ui'));

  return docsShell({
    nav: [
      {
        title: 'Getting Started',
        items: [{ href: '/ui', label: 'Introduction' }],
      },
      {
        title: 'Tier 1',
        count: tier1.length,
        items: tier1.map((c) => ({ href: `/ui/${c.name}`, label: c.name })),
      },
      {
        title: 'Tier 2',
        count: tier2.length,
        items: tier2.map((c) => ({ href: `/ui/${c.name}`, label: c.name })),
      },
    ],
    label: 'Component library',
    menuLabel: 'Components menu',
    // No prose wrapper: the component pages carry live previews that the
    // unlayered .prose-docs rules would restyle (they win over Tailwind
    // utilities). Pages wrap their genuinely prose regions themselves.
    contentClass: '',
    children,
  });
}
