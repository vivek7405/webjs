import type { Route } from './routes.js';

export function enableClientRouter(): void;
export function disableClientRouter(): void;
export function navigate(url: Route, opts?: { replace?: boolean }): Promise<void>;
export function loadFrame(
  frameEl: Element,
  url: string,
): Promise<{ ok: boolean; status: number | null; aborted: boolean; applied: boolean }>;
export function revalidate(url?: string): void;
/**
 * Re-render the current url on the server and apply it in place, with no page
 * reload. Records no history entry and never scrolls. `'page'` (the default)
 * morphs the deepest shared boundary, preserving hydrated component state
 * outside it; `'shell'` replaces the whole body, which a layout change needs.
 * Resolves `false` when the refresh did not apply, so the caller can fall back
 * to a full load.
 */
export function refreshPage(mode?: 'page' | 'shell'): Promise<boolean>;
