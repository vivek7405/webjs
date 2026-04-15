/**
 * Utilities used by routes inside app/. Lives under _utils/ — any folder
 * whose name starts with `_` is private: the router ignores it completely,
 * so this file cannot accidentally become a route.
 */
export function relativeTime(dateish: string | Date): string {
  const then = new Date(dateish).getTime();
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(then).toLocaleDateString();
}
