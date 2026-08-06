import { html } from '@webjsdev/core';
import '#components/observed-badge.ts';
import '#components/observe-badge.ts';
import '#components/ssr-derived-badge.ts';
import '#components/forced-badge.ts';
// The same-run NEGATIVE control for the forced-badge probe (#1308): display-only
// with no override and nothing observing it, so it must stay elided on a run
// where forced-badge ships. Without a control on THIS page the probe would also
// pass if elision had stopped working altogether.
import '#components/build-stamp.ts';

export const metadata = {
  title: 'Observed badge · WebJs Blog',
  description: 'Pins the cross-module-registration elision fix (#169).',
};

/**
 * `/observed` renders a display-only `<observed-badge>` AND imports a
 * module that observes its registration via `whenDefined`. The observation
 * forces the otherwise-elidable badge to ship, so the e2e probe can assert
 * the browser actually downloads `observed-badge.ts`.
 *
 * It also renders `<forced-badge>`, the same shape forced by the explicit
 * `static interactive = true` override instead of by observation, so one
 * probe covers both routes to a ship (#1308).
 */
export default function Observed() {
  return html`
    <section class="mb-8">
      <h1 class="font-serif text-display leading-[1.02] tracking-[-0.035em] font-bold m-0 mb-4">
        Observed badge
      </h1>
      <p class="text-lede leading-[1.5] text-muted-foreground max-w-[56ch] m-0 mb-6">
        This page waits for the badge to upgrade, so the framework keeps its
        module on the wire even though the badge itself only renders static
        markup.
      </p>
      <observed-badge></observed-badge>
      <forced-badge></forced-badge>
      <build-stamp></build-stamp>
      <ssr-derived-badge seed="42"></ssr-derived-badge>
    </section>
  `;
}
