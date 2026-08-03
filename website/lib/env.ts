/**
 * The site's canonical origin, read once from the environment.
 *
 * Four modules (app/sitemap.ts, app/robots.ts, app/llms.txt/route.ts, and
 * lib/docs-llms.server.ts) each wrote their own
 * `(globalThis as any).process?.env?.SITE_URL` for this, which is one missing
 * type worked around four times, and four places for the fallback origin to
 * drift apart.
 *
 * The `globalThis` hop rather than a bare `process.env`: every caller today is
 * server-only (two metadata routes, a route handler, and a `.server.ts`), so
 * `process` does exist for all of them. It is written this way so the module
 * stays importable from a browser-loading module too, since the origin is
 * public information already present in the rendered HTML and there is nothing
 * here that needs the server boundary. A bare `process.env` would throw at
 * module load the moment such an importer appeared.
 */
type SiteEnv = { SITE_URL?: string };

/**
 * The canonical origin, with any trailing slash removed so callers can
 * concatenate a path onto it without doubling the separator.
 */
export function siteUrl(): string {
  const env = (globalThis as { process?: { env?: SiteEnv } }).process?.env;
  return (env?.SITE_URL || 'https://webjs.dev').replace(/\/$/, '');
}
