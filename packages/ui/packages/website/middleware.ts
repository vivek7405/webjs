/**
 * ui.webjs.dev is now a redirect-only host.
 *
 * The component library moved onto the main domain at webjs.dev/ui. A
 * subdomain accrues its own authority in search rather than contributing to
 * webjs.dev, and it carried a second layout that had drifted from the
 * marketing site's. Both problems go away by serving the gallery as a path.
 *
 * This host MUST keep resolving indefinitely, and it carries a harder
 * constraint than the docs host does: `/registry/*` is a LIVE API. Every
 * already-published @webjsdev/ui and @webjsdev/cli fetches components from
 * `https://ui.webjs.dev/registry/<name>.json` when a user runs
 * `webjs ui add`, and a published version can never be corrected after the
 * fact. If this host stops answering, `webjs ui add` breaks for everyone on
 * an older install, permanently.
 *
 * A 301 is safe there, which was verified before the move rather than assumed:
 * the real published 0.3.1 and 0.3.8 tarballs were pointed at a host that
 * 301s cross-origin, and both followed it and parsed the result (fetch follows
 * redirects by default). Since 0.3.9 the kit resolves LOCAL-first (#983), so
 * `add` / `list` / `view` do not even reach the network on the default
 * registry; only `webjsui diff` and an explicit custom --registry do.
 *
 * The mapping is path-aware, not a blind prefix, because the old URL shapes
 * are not the new ones (see PATHS below).
 */
const TARGET = (process.env.SITE_URL || 'https://webjs.dev').replace(/\/$/, '');

/**
 * Old path to new path. Order matters: the first match wins, so the specific
 * component-page rule is tested before the generic /docs one.
 *
 * The old site had two human-facing shapes, a landing page at `/` and docs at
 * `/docs`, and the new site has neither: /ui IS the gallery, opening straight
 * on the introduction. So both collapse onto /ui.
 */
function mapPath(pathname: string): string {
  // The registry API. Preserved shape-for-shape, including the reserved
  // `index` / `registry` slugs the CLI relies on.
  if (pathname === '/registry' || pathname.startsWith('/registry/')) {
    return '/ui' + pathname;
  }

  // Assets keep their path INSTEAD of moving under /ui, because the marketing
  // site serves the same filenames at the same place. The deleted root layout
  // published /public/og.png as its og:image and /public/favicon-192.png,
  // /public/favicon.svg, and /public/apple-touch-icon.png as its icons, so
  // every social card already scraped from this host, and every embed of that
  // image, points at those URLs. Sending them to /ui/public/... would resolve
  // them to nothing; sending them to /public/... resolves them to the
  // equivalent asset on the new host.
  if (pathname.startsWith('/public/') || pathname === '/favicon.ico') return pathname;
  // A component page: /docs/components/button becomes /ui/button.
  const component = pathname.match(/^\/docs\/components\/([^/]+)\/?$/);
  if (component) return '/ui/' + component[1];

  // The old docs root and the old landing page both mean "the gallery".
  if (pathname === '/' || pathname === '/docs' || pathname === '/docs/') return '/ui';

  // Anything else under /docs keeps its tail under /ui.
  if (pathname.startsWith('/docs/')) return '/ui/' + pathname.slice('/docs/'.length);

  // Everything else (including the schema paths, which have always 404'd)
  // moves under /ui unchanged, so a stray link lands somewhere coherent
  // rather than on the marketing home page.
  return '/ui' + pathname;
}

export default async function redirectToSite(
  req: Request,
  next: () => Promise<Response>,
): Promise<Response> {
  const { pathname, search } = new URL(req.url);

  // The framework's own endpoints stay local, handled by the framework rather
  // than answered here. The health and readiness probes are served before app
  // middleware runs, so they never reach this line, but the rest of the
  // namespace does, and answering it with a redirect would break it rather
  // than leave it alone.
  if (pathname.startsWith('/__webjs/')) return next();

  return new Response(null, {
    status: 301,
    headers: {
      location: TARGET + mapPath(pathname) + search,
      // Long-lived and public: this host now has exactly one behaviour, so an
      // intermediary caching the redirect is correct and saves the hop.
      'cache-control': 'public, max-age=86400',
      // The registry is fetched cross-origin by tooling. A redirect that a
      // browser-context consumer cannot follow is as good as a failure, so the
      // CORS header rides the 301 the same way it rode the 200.
      'access-control-allow-origin': '*',
    },
  });
}
