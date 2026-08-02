// Client-only DOM helpers. Kept SEPARATE from lib/utils.ts because these
// reference `document`: any module that references a client global is treated
// as client-effecting by the elision analyzer, so bundling this with the pure
// `cn()` would pin every page that imports `cn` to the browser (#819). Import
// these ONLY from components (which ship anyway), never from a page/layout.

/**
 * Run `reset` just before the webjs client router snapshots the page into its
 * back/forward cache (the `webjs:before-cache` event). Transient overlays use
 * this to close themselves so a restored snapshot is clean. SSR-safe (a no-op
 * when there is no `document`). Wire it in `connectedCallback` and call the
 * returned disposer in `disconnectedCallback` so it never leaks across navs.
 */
export function onBeforeCache(reset: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('webjs:before-cache', reset);
  return () => document.removeEventListener('webjs:before-cache', reset);
}
