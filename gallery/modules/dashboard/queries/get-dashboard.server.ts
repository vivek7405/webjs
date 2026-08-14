'use server';
// The dashboard's data, in ONE query, because the screen is one thing.
//
// A read is a `'use server'` action so SSR and the client both reach it through
// the normal import. `method = 'GET'` rides args in the URL and is CSRF-exempt.
//
// The rows are derived rather than stored: this is a design exemplar, and a
// second table would teach nothing the todo example does not already teach
// better. What it DOES need is data with awkward shapes in it, because a layout
// built around tidy data breaks the first time real data arrives. So there is a
// depot name long enough to wrap, a zero in the series, and a failed delivery.
import type { Delivery, DashboardData } from '../types.ts';

export const method = 'GET';

const DEPOTS = ['Bristol', 'Leeds', 'Milton Keynes Central', 'Glasgow'];

const RECENT: Delivery[] = [
  { id: 'NW-4471', route: 'Bristol to Leeds', driver: 'A. Okonkwo', state: 'delivered', pallets: 12, at: '2026-08-14T09:24:00Z' },
  { id: 'NW-4469', route: 'Glasgow to Bristol', driver: 'M. Whitfield', state: 'in-transit', pallets: 4, at: '2026-08-14T08:51:00Z' },
  { id: 'NW-4468', route: 'Leeds to Milton Keynes Central', driver: 'R. Palmer', state: 'failed', pallets: 9, at: '2026-08-14T08:02:00Z' },
  { id: 'NW-4465', route: 'Milton Keynes Central to Glasgow', driver: 'S. Dhillon', state: 'delivered', pallets: 21, at: '2026-08-13T17:40:00Z' },
  { id: 'NW-4464', route: 'Bristol to Glasgow', driver: 'A. Okonkwo', state: 'booked', pallets: 6, at: '2026-08-13T16:12:00Z' },
];

export async function getDashboard(depot?: string): Promise<DashboardData> {
  const recent = depot ? RECENT.filter((d) => d.route.includes(depot)) : RECENT;
  return {
    depots: DEPOTS,
    depot: depot ?? null,
    stats: {
      delivered: { value: 1284, delta: 12, direction: 'up' },
      inTransit: { value: 37, delta: 0, direction: 'flat' },
      failed: { value: 3, delta: 2, direction: 'up' },
    },
    // A zero in the middle, on purpose. A sparkline that assumes every value is
    // positive draws a gap or divides by zero on real data.
    series: [1180, 1240, 1310, 0, 1290, 1350, 1284],
    recent,
  };
}
