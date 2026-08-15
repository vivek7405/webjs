/**
 * Timeline: events in order, with a marker per event. Tier-1 class helpers;
 * compose with `<ol>` / `<li>` and a real `<time>`.
 *
 * shadcn parity: none. `item.tsx` and `separator.tsx` are the parts it would
 * otherwise be composed from each time.
 *
 * Design: an activity feed is an ORDERED list, and saying so in the markup is
 * most of the design. The marker column gives the eye a single vertical line to
 * follow, so the reader tracks one axis instead of scanning ragged rows, and
 * the connector between markers is what makes it read as a sequence rather than
 * as a stack of unrelated cards. Keep the time quiet: it is context, not
 * content, and a feed where every timestamp is as loud as its event is a feed
 * nobody can skim. Marker variants reuse the semantic roles, so a failed event
 * is `destructive` here for the same reason and in the same colour as it is
 * everywhere else in the app.
 *
 * Design tokens used: --border, --muted-foreground, --success, --warning,
 * --info, --destructive, --background.
 *
 * A11y (required for accessible output):
 *   Use an `<ol>`, not a `<ul>` and not `<div>`s. The order IS the meaning, and
 *   the list role is what tells a screen reader user how many events there are
 *   and where they are in them.
 *   Put the timestamp in a real `<time datetime="…">` with a machine-readable
 *   attribute. A rendered `3d ago` is meaningless out of context and unreadable
 *   to anything parsing the page; the `datetime` attribute carries the truth.
 *   The marker and the connector are DECORATION and must be `aria-hidden="true"`.
 *   A screen reader announcing a bullet glyph before every event adds nothing.
 *   State carried only by marker colour needs words in the event text. A red dot
 *   is invisible to a screen reader user and ambiguous to anyone who cannot
 *   separate the hues, so the text says `failed`, not just the marker.
 *   A feed that appends live goes in a container with `aria-live="polite"`.
 *
 * @example
 * ```html
 * <ol class=${timelineClass()}>
 *   <li class=${timelineItemClass()}>
 *     <span class=${timelineMarkerClass({ variant: 'success' })} aria-hidden="true"></span>
 *     <span class=${timelineConnectorClass()} aria-hidden="true"></span>
 *     <div class=${timelineContentClass()}>
 *       <p class=${timelineTitleClass()}>Delivered to Bristol depot</p>
 *       <time class=${timelineTimeClass()} datetime="2026-08-14T09:24:00Z">09:24</time>
 *     </div>
 *   </li>
 * </ol>
 * ```
 */
import { cn } from '../lib/utils.ts';

/** The feed. Use a real `<ol>`. */
export const timelineClass = (): string => 'grid';

/**
 * One event.
 *
 * The marker column is a fixed width so every marker lines up on one axis, and
 * the row is `relative` so the connector can position against it.
 */
export const timelineItemClass = (): string =>
  'relative grid grid-cols-[1.25rem_1fr] gap-x-3 pb-6 last:pb-0';

export interface TimelineMarkerClassOptions {
  /** Reuses the semantic roles, so state means the same thing it does elsewhere. */
  variant?: 'default' | 'success' | 'warning' | 'info' | 'destructive';
}

const MARKER_VARIANTS = {
  default: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  destructive: 'bg-destructive',
} as const;

/** The dot. Decoration, so aria-hidden. */
export const timelineMarkerClass = (opts: TimelineMarkerClassOptions = {}): string => {
  return cn(
      'relative z-10 mt-1.5 size-2.5 justify-self-center rounded-full ring-4 ring-background',
      MARKER_VARIANTS[opts.variant ?? 'default'],
    );
}

/**
 * The line joining one marker to the next. Decoration, so aria-hidden.
 *
 * It runs the full height of its item and the last item hides it, so the line
 * stops at the final marker instead of trailing off the end of the feed.
 */
export const timelineConnectorClass = (): string =>
  'absolute left-2.5 top-3 h-full w-px -translate-x-1/2 bg-border [li:last-child_&]:hidden';

/** The event's content. */
export const timelineContentClass = (): string => 'grid gap-0.5 pb-1';

/** What happened. */
export const timelineTitleClass = (): string => 'text-sm font-medium';

/** When. Quiet, and always a real `<time datetime>`. */
export const timelineTimeClass = (): string => 'text-xs text-muted-foreground tabular-nums';
