import { html } from '@webjsdev/core';
import { cardClass } from '#components/ui/card.ts';
import { badgeClass } from '#components/ui/badge.ts';
import { FEATURE_GROUPS, EXAMPLES } from '#modules/gallery/nav.ts';

export const metadata = {
  title: 'WebJs Gallery',
  description: 'Explore WebJs features, interactive components, and real working examples.',
};

// The hover affordance for a whole-card link. cardClass() takes the panel's own
// extra classes as a string, so the hover state composes with the base surface.
const CARD_LINK = cardClass('transition-colors hover:border-border-strong');

export default function Home() {
  // Flatten the groups here rather than at module scope, so the card can label
  // itself with the group it came from (NavItem itself carries no category).
  const features = FEATURE_GROUPS.flatMap((g) => g.items.map((item) => ({ ...item, category: g.label })));
  return html`
    <div class="py-8 flex flex-col items-center gap-16">
      <!-- Hero -->
      <section class="flex flex-col items-center text-center gap-5">
        <h1 class="text-5xl sm:text-6xl font-bold tracking-tight leading-none m-0 break-words bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-transparent" style="font-family: var(--font-display); letter-spacing: -0.02em;">
          Explore the gallery
        </h1>
        <p class="text-base sm:text-lg text-muted-foreground max-w-lg leading-relaxed m-0">
          Each demo isolates a single WebJs capability in real, runnable code. Read the ones you need, then build your app on the same patterns.
        </p>
      </section>

      <!-- Single-Feature Demos Grid -->
      <section class="w-full flex flex-col gap-6">
        <div class="flex items-center justify-between gap-4 border-b border-border pb-3">
          <h2 class="text-xl font-bold tracking-tight m-0" style="font-family: var(--font-display)">
            Feature Cards
          </h2>
          <span class="text-xs text-muted-foreground font-mono">
            ${features.length} single-concept demos
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${features.map(f => html`
            <a href=${f.href} class="${CARD_LINK} p-5 flex flex-col gap-3 group no-underline text-inherit">
              <div class="flex items-start justify-between gap-2">
                <span class="font-bold text-base group-hover:text-foreground transition-colors" style="font-family: var(--font-display)">
                  ${f.title}
                </span>
                <span class="${badgeClass({ variant: 'outline' })} font-mono text-[10px]">
                  ${f.category}
                </span>
              </div>
              <p class="text-xs text-muted-foreground leading-relaxed m-0 flex-1">
                ${f.blurb}
              </p>
              <div class="flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors mt-1">
                <span>View demo</span>
                <svg class="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </a>
          `)}
        </div>
      </section>

      <!-- Example Apps Grid -->
      ${EXAMPLES.length > 0 ? html`
        <section class="w-full flex flex-col gap-6">
          <div class="flex items-center justify-between gap-4 border-b border-border pb-3">
            <h2 class="text-xl font-bold tracking-tight m-0" style="font-family: var(--font-display)">
              Example Apps
            </h2>
            <span class="text-xs text-muted-foreground font-mono">
              Complete app demos
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${EXAMPLES.map(e => html`
              <a href=${e.href} class="${CARD_LINK} p-6 flex flex-col gap-3 group no-underline text-inherit">
                <div class="flex items-start justify-between gap-2">
                  <span class="font-bold text-lg group-hover:text-foreground transition-colors" style="font-family: var(--font-display)">
                    ${e.title}
                  </span>
                  <span class="${badgeClass()} font-mono text-xs">
                    Full App
                  </span>
                </div>
                <p class="text-sm text-muted-foreground leading-relaxed m-0 flex-1">
                  ${e.blurb}
                </p>
                <div class="flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors mt-2">
                  <span>Open app</span>
                  <svg class="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </a>
            `)}
          </div>
        </section>
      ` : ''}
    </div>
  `;
}
