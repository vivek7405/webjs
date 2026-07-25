/**
 * docs.webjs.dev is now a redirect-only host.
 *
 * The documentation moved onto the main domain at webjs.dev/docs. A
 * subdomain accrues its own authority in search rather than contributing to
 * webjs.dev, and it carried a second layout that drifted from the marketing
 * site's. Both problems go away by serving the docs as a path.
 *
 * This host MUST keep resolving indefinitely, not just through a migration
 * window. Framework error messages in ALREADY-PUBLISHED npm packages point
 * at docs.webjs.dev (see packages/core/src/component.js and
 * packages/server/src/actions.js), and a published version can never be
 * retroactively corrected, so old installs will keep sending people here for
 * as long as they run. Every one of those must land on real documentation.
 *
 * The redirect is path-preserving and permanent, so /docs/routing lands on
 * webjs.dev/docs/routing rather than dumping every visitor at a hub page and
 * making them find their topic again. A 301 also passes the accumulated
 * ranking signal to the new URL, which is the point of the move.
 */
const TARGET = (process.env.SITE_URL || 'https://webjs.dev').replace(/\/$/, '');

export default async function redirectToSite(
  req: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const { pathname, search } = new URL(req.url);

  // The framework's own endpoints stay local, handled by the framework rather
  // than answered here. The health and readiness probes are actually served
  // before app middleware runs, so they never reach this line, but the rest of
  // the namespace does, and answering it with a canned body would break it
  // rather than leave it alone.
  if (pathname.startsWith('/__webjs/')) return next();

  // A bare visit to the host means "the documentation", not "the marketing
  // home page", so root lands on the docs hub rather than at /.
  const target = pathname === '/' ? `${TARGET}/docs` : `${TARGET}${pathname}${search}`;

  return new Response(null, {
    status: 301,
    headers: {
      location: target,
      // Long-lived and public: this host now has exactly one behaviour, so
      // an intermediary caching the redirect is correct and saves the hop.
      'cache-control': 'public, max-age=86400',
    },
  });
}
