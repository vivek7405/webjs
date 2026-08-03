/**
 * Browser-safe reads of the handful of env vars the site's chrome and its
 * metadata routes need.
 *
 * `process` is a server global, and several of the modules that want these
 * values (lib/links.ts, imported by the root layout) also load in the browser,
 * so the read has to survive `process` being undefined. Five call sites each
 * wrote their own `(globalThis as any).process?.env` for that, which is an
 * `any` cast repeated five times to work around one missing type.
 *
 * Declaring the shape once gives every caller a real type: `env()` returns a
 * partial string record, so a missing var is `undefined` rather than a value
 * TypeScript will let you do anything with. WEBJS_PUBLIC_-prefixed vars are
 * the ones the framework exposes to the browser; SITE_URL is read only during
 * SSR and metadata generation, where `process` genuinely exists.
 */
type SiteEnv = Partial<Record<'SITE_URL' | 'NODE_ENV' | (string & {}), string>>;

/** The process env if there is one, else an empty record. Never throws. */
export function env(): SiteEnv {
  return (globalThis as { process?: { env?: SiteEnv } }).process?.env ?? {};
}

/**
 * The canonical origin, with any trailing slash removed so callers can
 * concatenate a path onto it without doubling the separator.
 */
export function siteUrl(): string {
  return (env().SITE_URL || 'https://webjs.dev').replace(/\/$/, '');
}
