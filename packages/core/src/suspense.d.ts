export interface SuspenseBoundary {
  _$webjsSuspense: true;
  fallback: unknown;
  children: unknown;
}

export function Suspense(props: { fallback: unknown; children: unknown | Promise<unknown> }): SuspenseBoundary;
export function isSuspense(x: unknown): x is SuspenseBoundary;
export const SUSPENSE: unique symbol;
