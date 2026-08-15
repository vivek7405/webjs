/**
 * DESIGN EXEMPLAR: a dashboard.
 *
 * The other demos in this gallery each teach one framework feature. This one
 * teaches what a screen should LOOK like, because code teaches harder than
 * prose and an agent that reads a hierarchy-flat example will write
 * hierarchy-flat screens no matter what the reference file says.
 *
 * Every design decision below is commented with the REASON, not the rule. The
 * rules live in `.agents/skills/webjs/references/design.md`; this is what they
 * look like applied to a real screen with awkward real data in it.
 *
 * The four decisions that matter most here:
 *
 *   1. ONE primary action. Everything else is secondary or ghost. A dashboard is
 *      where the action pyramid collapses first, because every control feels
 *      important to whoever built it.
 *   2. The label is quieter than the value. A reader scans a dashboard for
 *      numbers, so the number carries the weight and the label goes to
 *      text-muted-foreground. This is the inversion `stat.ts` exists for.
 *   3. Every list has an empty branch, written at the same time as the list.
 *      Seeded data hides the blank region; the first real user does not.
 *   4. State goes through the semantic roles, never a raw palette colour, so a
 *      failed delivery is the same red here as everywhere else in the app.
 *
 * It is a PAGE, so it never hydrates and its markup is free in the browser.
 * Everything here is static markup and server data, which is why there is no
 * component in this file at all: the filter is a plain form that navigates.
 */
import { html } from '@webjsdev/core';
import type { Metadata, PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import {
  pageHeaderClass,
  pageHeaderTitleClass,
  pageHeaderDescriptionClass,
  pageHeaderActionsClass,
} from '#components/ui/page-header.ts';
import {
  statGroupClass,
  statClass,
  statLabelClass,
  statValueClass,
  statDeltaClass,
} from '#components/ui/stat.ts';
import {
  timelineClass,
  timelineItemClass,
  timelineMarkerClass,
  timelineConnectorClass,
  timelineContentClass,
  timelineTitleClass,
  timelineTimeClass,
} from '#components/ui/timeline.ts';
import {
  emptyStateClass,
  emptyStateTitleClass,
  emptyStateDescriptionClass,
  emptyStateActionsClass,
} from '#components/ui/empty-state.ts';
import { getDashboard } from '#modules/dashboard/queries/get-dashboard.server.ts';
import type { Delivery, DeliveryState, Stat } from '#modules/dashboard/types.ts';

export const metadata: Metadata = {
  title: 'Dashboard (design exemplar) | examples',
  description: 'What a dashboard looks like when hierarchy, the action pyramid, and empty states are applied.',
};

/** Marker colour per state, through the semantic roles rather than a palette. */
const STATE_MARKER: Record<DeliveryState, 'default' | 'success' | 'warning' | 'info' | 'destructive'> = {
  booked: 'default',
  loaded: 'info',
  'in-transit': 'info',
  delivered: 'success',
  failed: 'destructive',
};

/** Human wording per state. The marker is decoration; this is what is announced. */
const STATE_WORD: Record<DeliveryState, string> = {
  booked: 'booked',
  loaded: 'loaded',
  'in-transit': 'in transit',
  delivered: 'delivered',
  failed: 'failed',
};

function stat(label: string, s: Stat, describe: (n: number) => string) {
  return html`
    <dl class=${statClass({ variant: 'card' })}>
      <!-- The label is a <dt> and the value a <dd>. That association is the
           only thing telling a screen reader which label owns which number,
           and on a row of stats a pile of <div>s is unusable. -->
      <dt class=${statLabelClass()}>${label}</dt>
      <dd class=${statValueClass()}>${s.value.toLocaleString('en-GB')}</dd>
      <dd class=${statDeltaClass({ direction: s.direction })}>
        <!-- The arrow is decoration and the words carry the meaning, because
             colour and a glyph are both unavailable to a screen reader user. -->
        <span aria-hidden="true">${s.direction === 'up' ? '↑' : s.direction === 'down' ? '↓' : '→'}</span>
        ${describe(s.delta)}
      </dd>
    </dl>
  `;
}

function activityItem(d: Delivery) {
  return html`
    <li class=${timelineItemClass()}>
      <span class=${timelineMarkerClass({ variant: STATE_MARKER[d.state] })} aria-hidden="true"></span>
      <span class=${timelineConnectorClass()} aria-hidden="true"></span>
      <div class=${timelineContentClass()}>
        <p class=${timelineTitleClass()}>${d.id} ${STATE_WORD[d.state]}</p>
        <!-- Route and driver are context, so they are quieter than the event
             itself. Three lines at one weight would make the feed unskimmable. -->
        <p class="text-muted-foreground text-sm">${d.route}, ${d.driver}, ${d.pallets} pallets</p>
        <!-- A real <time datetime>. The rendered text can be friendly; the
             attribute carries the truth for anything parsing the page. -->
        <time class=${timelineTimeClass()} datetime=${d.at}>
          ${new Date(d.at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
        </time>
      </div>
    </li>
  `;
}

export default async function DashboardExample({ searchParams }: PageProps) {
  const depot = typeof searchParams?.depot === 'string' && searchParams.depot ? searchParams.depot : undefined;
  const data = await getDashboard(depot);

  return html`
    <!-- The page header holds the ONE <h1>, the one-line explanation, and the
         page-scoped actions. Export is secondary and New booking is default, so
         the pyramid is visible at a glance rather than argued about. -->
    <header class=${pageHeaderClass({ variant: 'bordered' })}>
      <div>
        <h1 class=${pageHeaderTitleClass()}>Deliveries</h1>
        <p class=${pageHeaderDescriptionClass()}>
          What is moving today, and what needs attention.
        </p>
      </div>
      <div class=${pageHeaderActionsClass()}>
        <button class=${buttonClass({ variant: 'secondary' })} type="button">Export</button>
        <button class=${buttonClass()} type="button">New booking</button>
      </div>
    </header>

    <div class="grid gap-8 pt-6">
      <!-- The filter is a plain GET form, so it works with JS off and needs no
           component at all. A page never hydrates, so anything interactive here
           would have to be a component; navigating is not interactive. -->
      <form class="flex flex-wrap items-end gap-3" method="get">
        <div class="grid gap-1">
          <label class="text-sm font-medium" for="depot">Depot</label>
          <select class="border-input h-9 rounded-md border px-3 text-sm shadow-e1" id="depot" name="depot">
            <option value="">All depots</option>
            ${data.depots.map(
              (d) => html`<option value=${d} ?selected=${d === data.depot}>${d}</option>`,
            )}
          </select>
        </div>
        <button class=${buttonClass({ variant: 'secondary', size: 'sm' })}>Apply</button>
        ${data.depot
          ? html`<a class=${buttonClass({ variant: 'ghost', size: 'sm' })} href="/examples/dashboard">Clear</a>`
          : ''}
      </form>

      <!-- Stats first, because the number that triggers action is what the
           reader came for and the eye starts at the top left. -->
      <section class="grid gap-3">
        <h2 class="text-muted-foreground text-sm font-medium">Today</h2>
        <div class=${statGroupClass({ columns: 3 })}>
          ${stat('Delivered', data.stats.delivered, (n) => `up ${n}% from yesterday`)}
          ${stat('In transit', data.stats.inTransit, () => 'unchanged from yesterday')}
          ${stat('Failed', data.stats.failed, (n) => `up ${n} from yesterday`)}
        </div>
      </section>

      <section class="grid gap-3">
        <h2 class="text-muted-foreground text-sm font-medium">Delivered, last 7 days</h2>
        <!-- A bar per day, in plain markup. A chart library would be the reflex
             and it would ship JavaScript for something that is seven divs.
             The zero bar is why min-height exists: a bar of height 0 vanishes
             and the day silently disappears from the series. -->
        <div class="border-border flex h-24 items-end gap-2 rounded-lg border p-3" role="img"
             aria-label=${`Delivered per day, last 7 days: ${data.series.join(', ')}`}>
          ${data.series.map((v) => {
            const max = Math.max(...data.series, 1);
            return html`<div class="bg-primary/70 min-h-0.5 flex-1 rounded-sm"
                              style=${`height: ${Math.round((v / max) * 100)}%`}></div>`;
          })}
        </div>
      </section>

      <section class="grid gap-3">
        <h2 class="text-muted-foreground text-sm font-medium">Recent activity</h2>
        <!-- The empty branch is written HERE, beside the list, not added later.
             With a depot filter applied this is the state most easily reached,
             and a blank region reads as broken rather than as empty. Note it is
             a no-RESULTS message with a way out, not a first-run invitation:
             those are different states and want different words. -->
        ${data.recent.length
          ? html`<ol class=${timelineClass()}>${data.recent.map(activityItem)}</ol>`
          : html`
              <div class=${emptyStateClass({ variant: 'bordered' })}>
                <h3 class=${emptyStateTitleClass()}>No activity for ${data.depot}</h3>
                <p class=${emptyStateDescriptionClass()}>
                  Nothing has moved through this depot today. Other depots may still be busy.
                </p>
                <div class=${emptyStateActionsClass()}>
                  <a class=${buttonClass({ variant: 'secondary' })} href="/examples/dashboard">Show all depots</a>
                </div>
              </div>
            `}
      </section>
    </div>
  `;
}
