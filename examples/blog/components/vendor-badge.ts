import { WebComponent, html } from '@webjsdev/core';
import dayjs from 'dayjs';

/**
 * `<vendor-badge>` is a purely presentational web component whose ONLY
 * non-core dependency is the `dayjs` vendor package. It formats a fixed
 * date with dayjs at render time and prints a short rubric. No events,
 * no reactive properties, no lifecycle hooks, no signals, no slot, so
 * the framework classifies it as display-only.
 *
 * Note the binding import of `dayjs` rather than a reactive property
 * declared through the `WebComponent({ ... })` factory. A non-state
 * reactive property is an interactivity signal that would force the
 * component to ship; a binding import is not, so the component stays
 * elidable while still using the package server-side.
 *
 * It exists to e2e-pin a specific elision claim. A vendor package used
 * ONLY by a display-only component is never fetched by the browser, and
 * its importmap entry is pruned when the map is resolved live. Because
 * `<vendor-badge>` is elided, the bare-import scan skips this file, so
 * `dayjs` never enters the importmap and the browser never downloads it
 * from the CDN. The SSR'd text (computed with dayjs server-side) is the
 * complete output.
 */
// A plain date, not an instant. dayjs formats in LOCAL time, so a UTC instant
// renders as the PREVIOUS day on any host west of UTC, which made a release
// badge read differently depending on where it was served from and left the
// e2e assertion on its year green only on a UTC machine. A date string parses
// as local midnight, so it formats to the same day everywhere.
const RELEASED_AT = '2026-01-01';

export class VendorBadge extends WebComponent {
  render() {
    const formatted = dayjs(RELEASED_AT).format('MMM D, YYYY');
    return html`<span
      class="font-mono text-[11px] tracking-[0.12em] uppercase text-muted-foreground/70"
      >released ${formatted} · zero JS for this badge</span
    >`;
  }
}
VendorBadge.register('vendor-badge');
