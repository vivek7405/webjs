/**
 * The gallery's demo index, ONE source of truth for both the home cards and the
 * left sidebar (so they can never drift). A browser-safe data module (no server
 * imports, no client globals): the home flattens the groups into its card grid,
 * and <gallery-nav> renders them grouped. gallery:clear removes this module.
 */
export interface NavItem { href: string; title: string; blurb: string; }
export interface NavGroup { label: string; items: NavItem[]; }

export const FEATURE_GROUPS: NavGroup[] = [
  {
    label: 'Routing',
    items: [
      { href: '/features/routing', title: 'Routing', blurb: 'A static route plus a dynamic [id] segment that reads params. The file-based router in miniature.' },
      { href: '/features/boundaries', title: 'Boundaries', blurb: 'The control-flow throws (forbidden / unauthorized / notFound) and the nearest boundary file that catches each.' },
      { href: '/features/metadata', title: 'Metadata', blurb: 'Static metadata plus generateMetadata(ctx), which reads the request to compute the title and Open Graph tags.' },
    ],
  },
  {
    label: 'Components',
    items: [
      { href: '/features/components', title: 'Components', blurb: 'The WebComponent factory, reactive props, instance signals, and slot projection in light DOM.' },
      { href: '/features/directives', title: 'Directives', blurb: 'The lit-html directive set: repeat for keyed lists, watch(signal) for a fine-grained node swap.' },
      { href: '/features/async-render', title: 'Async render', blurb: 'A component that awaits server data in async render(), so the resolved value is in the first paint.' },
    ],
  },
  {
    label: 'Data & actions',
    items: [
      { href: '/features/server-actions', title: 'Server actions', blurb: 'A use-server RPC action next to a server-only .server.ts utility, plus the HTTP-verb config exports that make a read a cached GET.' },
      { href: '/features/route-handler', title: 'Route handlers', blurb: 'A server-only route.ts HTTP endpoint returning JSON, the WebJs equivalent of a Next route handler.' },
      { href: '/features/forms', title: 'Forms', blurb: 'A no-JS progressive-enhancement form bound to a server action, with server-side validation errors.' },
      { href: '/features/optimistic-ui', title: 'Optimistic UI', blurb: 'The imperative optimistic(signal, value, action) flip: instant update, automatic rollback on failure.' },
    ],
  },
  {
    label: 'Client & streaming',
    items: [
      { href: '/features/client-router', title: 'Client router', blurb: 'Automatic soft navigation: fragment-only fetches, hover prefetch, scroll restore, and graceful no-JS fallback.' },
      { href: '/features/view-transitions', title: 'View transitions', blurb: 'The opt-in view-transition meta cross-fades a soft navigation, with a data-webjs-permanent element persisted across the swap.' },
      { href: '/features/streaming', title: 'Streaming actions', blurb: 'A use-server action that returns an async generator, streamed to the call site token by token with for await.' },
      { href: '/features/stream', title: 'Stream updates', blurb: 'The <webjs-stream> element: renderStream() applies surgical append / replace / remove DOM updates by target id, no region redraw.' },
      { href: '/features/suspense', title: 'Suspense boundary', blurb: 'The <webjs-suspense> element: a first-paint fallback for a SLOW component, with the resolved content streamed in.' },
      { href: '/features/frames', title: 'Frames', blurb: 'A webjs-frame region that swaps a filtered sub-list in place from a link, shipping zero component JS, with a no-JS full-nav fallback.' },
    ],
  },
  {
    label: 'Real-time',
    items: [
      { href: '/features/websockets', title: 'WebSockets', blurb: 'A WS(ws, req) route endpoint plus the connectWS() client, echoing messages over a live socket.' },
      { href: '/features/broadcast', title: 'Broadcast', blurb: 'Fan a message out to every connected client on a WebSocket path, so all open tabs stay in sync.' },
    ],
  },
  {
    label: 'Auth & sessions',
    items: [
      { href: '/features/auth', title: 'Auth', blurb: 'Password login on createAuth, a signed session cookie, and a real protected route that redirects anonymous visitors to login.' },
      { href: '/features/sessions', title: 'Sessions', blurb: 'A signed-cookie session applied by a segment middleware, read and written per visitor with getSession() in a route.' },
    ],
  },
  {
    label: 'Built-ins',
    items: [
      { href: '/features/caching', title: 'Caching', blurb: 'export const revalidate caches the page HTML per URL, with the safety rule for when a shared cache is allowed.' },
      { href: '/features/env', title: 'Env vars', blurb: 'The server-only vs WEBJS_PUBLIC_ boundary, read during SSR so secrets never reach the browser.' },
      { href: '/features/rate-limit', title: 'Rate limiting', blurb: 'The rateLimit() middleware scoped to one endpoint, returning a 429 with Retry-After once the interval resets.' },
      { href: '/features/file-storage', title: 'File storage', blurb: 'A no-JS multipart upload streamed into the FileStore, then served back through a streaming route.' },
      { href: '/features/service-worker', title: 'Service worker', blurb: 'The opt-in offline enhancement, registered from a browser-only lifecycle hook (never a page or layout).' },
    ],
  },
];

/** The whole example apps (composed features), shown after the single-feature demos. */
export const EXAMPLES: NavItem[] = [
  { href: '/examples/todo', title: 'Optimistic todo', blurb: 'A whole app composing several features: the declarative optimistic() list API, progressive-enhancement forms, accessible labels, the modules split, and SQLite.' },
];

/**
 * Flattened single-feature list (for the home card grid).
 *
 * This is a function, not a `const` initialised by a top-level `.flatMap()`
 * call. A top-level call is a module side effect, so the const form pinned
 * every page importing this module into the browser bundle, even a home page
 * with no client behaviour at all. Call it inside the render function.
 */
export function featureList(): NavItem[] {
  return FEATURE_GROUPS.flatMap((g) => g.items);
}
