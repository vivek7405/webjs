// Shared types for the dashboard exemplar. A plain `.ts` module (no
// `'use server'`, no DB import), so it is browser-safe and the page and any
// component can both import it.

export type DeliveryState = 'booked' | 'loaded' | 'in-transit' | 'delivered' | 'failed';

export interface Delivery {
  id: string;
  route: string;
  driver: string;
  state: DeliveryState;
  pallets: number;
  /** ISO 8601. A real `<time datetime>` needs a machine-readable value. */
  at: string;
}

export interface Stat {
  value: number;
  delta: number;
  direction: 'up' | 'down' | 'flat';
}

export interface DashboardData {
  depots: string[];
  depot: string | null;
  stats: { delivered: Stat; inTransit: Stat; failed: Stat };
  series: number[];
  recent: Delivery[];
}
