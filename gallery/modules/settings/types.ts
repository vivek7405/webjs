// Shared, browser-safe types and constants for the settings exemplar. A plain
// `.ts` module: a `'use server'` file may export only async functions
// (invariant 2), and the client stub the framework generates carries only the
// action names, so a const declared there could never be imported anyway.
//
// The page and the action BOTH import this list. They used to hand-maintain
// two copies of the same six names, so renaming a field on one side would
// silently break the checkbox restore, which is the exact lost-input defect
// the settings exemplar exists to demonstrate.

/** The six notification toggles, by their form field names. */
export const NOTIFICATION_KEYS = [
  'appointment-booked',
  'appointment-cancelled',
  'reminder-sent',
  'payment-received',
  'staff-added',
  'weekly-summary',
] as const;

/** The label shown beside each toggle. */
export const NOTIFICATION_LABELS: Record<(typeof NOTIFICATION_KEYS)[number], string> = {
  'appointment-booked': 'An appointment is booked',
  'appointment-cancelled': 'An appointment is cancelled',
  'reminder-sent': 'A reminder goes out',
  'payment-received': 'A payment arrives',
  'staff-added': 'Someone joins the practice',
  'weekly-summary': 'The weekly summary',
};

/** Ticked on a first paint, before the reader has saved anything. */
export const NOTIFICATION_DEFAULTS: string[] = ['appointment-booked', 'weekly-summary'];
