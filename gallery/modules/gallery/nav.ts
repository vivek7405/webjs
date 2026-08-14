/**
 * The gallery's demo index, ONE source of truth for both the home cards and the
 * left sidebar (so they can never drift). A browser-safe data module (no server
 * imports, no client globals): the home flattens the groups into its card grid,
 * and <gallery-nav> renders them grouped. gallery:clear removes this module.
 *
 * Blurbs are INTENT-shaped, not noun-shaped: each one opens on the job you would
 * be doing when you want this demo, because the index is the first thing an
 * agent reads and a card that only names the feature cannot be found by someone
 * who does not know the feature exists. The skill's cheat sheet
 * (.agents/skills/webjs/SKILL.md, "Reach For The Right Primitive") carries the
 * same set keyed the same way, and the repo's
 * test/repo-health/skill-gallery-intent-parity.test.mjs fails if the two fall
 * out of step.
 */
export interface NavItem { href: string; title: string; blurb: string; }
export interface NavGroup { label: string; items: NavItem[]; }

export const FEATURE_GROUPS: NavGroup[] = [
  {
    label: 'Routing',
    items: [
      { href: '/features/routing', title: 'Routing', blurb: 'Add a URL to the app, static or with a dynamic [id] segment. The file is the route, so there is no table to register it in.' },
      { href: '/features/boundaries', title: 'Boundaries', blurb: 'Abandon a render because something is missing or not allowed. Throw notFound / forbidden / unauthorized and the nearest boundary file catches it.' },
      { href: '/features/metadata', title: 'Metadata', blurb: 'Give a page its own title, description, and social preview without writing head markup yourself.' },
    ],
  },
  {
    label: 'Components',
    items: [
      { href: '/features/components', title: 'Components', blurb: 'Make one part of the page respond to a click or hold state. A page never hydrates, so interactivity lives in a component.' },
      { href: '/features/directives', title: 'Directives', blurb: 'Render a keyed list, or swap a single node when state changes, without re-rendering the component around it.' },
      { href: '/features/async-render', title: 'Async render', blurb: 'Get server data into the first paint. Await it in async render() rather than fetching after mount, which SSR never runs.' },
    ],
  },
  {
    label: 'Data & actions',
    items: [
      { href: '/features/server-actions', title: 'Server actions', blurb: 'Call server code from the browser by importing the function. No fetch, no endpoint to name, and the types survive the trip.' },
      { href: '/features/route-handler', title: 'Route handlers', blurb: 'Expose JSON to a caller outside the app. A server-only route.ts, the WebJs equivalent of a Next route handler.' },
      { href: '/features/forms', title: 'Forms', blurb: 'Write data from a form that still works with JS off. Binding the action to the form is the whole wiring.' },
      { href: '/features/optimistic-ui', title: 'Optimistic UI', blurb: 'Make a mutation feel instant. optimistic() applies the change immediately and rolls it back if the server refuses.' },
    ],
  },
  {
    label: 'Client & streaming',
    items: [
      { href: '/features/client-router', title: 'Client router', blurb: 'Navigate without a full page reload. Automatic the moment a page ships a component, with nothing to import or configure.' },
      { href: '/features/view-transitions', title: 'View transitions', blurb: 'Cross-fade a navigation instead of snapping. One opt-in meta, plus a marker for elements that must survive the swap.' },
      { href: '/features/streaming', title: 'Streaming actions', blurb: 'Show tokens or progress as the server produces them. An action returning an async generator, consumed with for await.' },
      { href: '/features/stream', title: 'Stream updates', blurb: 'Change one element after a write, like appending a row or bumping a count, without redrawing the region around it.' },
      { href: '/features/suspense', title: 'Suspense boundary', blurb: 'Paint the page before a slow region is ready. The fallback flushes on the first byte and the content streams in behind it.' },
      { href: '/features/frames', title: 'Frames', blurb: 'Refresh one region on its own with no navigation, like a filtered list or a tab panel. Zero component JS, full-nav fallback with JS off.' },
    ],
  },
  {
    label: 'Real-time',
    items: [
      { href: '/features/websockets', title: 'WebSockets', blurb: 'Hold a live two-way connection instead of polling. A WS(ws, req) route export on the server, connectWS() on the client.' },
      { href: '/features/broadcast', title: 'Broadcast', blurb: 'Push one update to every client connected on a WebSocket path, so a change made in one of them shows up in the rest. Optionally excluding the sender.' },
    ],
  },
  {
    label: 'Auth & sessions',
    items: [
      { href: '/features/auth', title: 'Auth', blurb: 'Add login and a route only signed-in visitors can open, without rolling password hashing and session cookies yourself.' },
      { href: '/features/sessions', title: 'Sessions', blurb: 'Remember something per visitor across requests. A signed cookie applied by middleware, read and written with getSession().' },
    ],
  },
  {
    label: 'Built-ins',
    items: [
      { href: '/features/caching', title: 'Caching', blurb: 'Stop re-rendering a page that is identical for every visitor. export const revalidate, with the rule for when that is safe.' },
      { href: '/features/env', title: 'Env vars', blurb: 'Read config and secrets at runtime while keeping the secrets server-side. WEBJS_PUBLIC_ is the only prefix the browser sees.' },
      { href: '/features/rate-limit', title: 'Rate limiting', blurb: 'Stop one caller hammering an endpoint. The rateLimit() middleware returns a 429 with Retry-After until the interval resets.' },
      { href: '/features/file-storage', title: 'File storage', blurb: 'Accept an upload and serve it back, streamed both ways, with nothing buffered in memory and nothing written into public/.' },
      { href: '/features/service-worker', title: 'Service worker', blurb: 'Keep the app usable offline. The opt-in service worker, registered from a browser-only lifecycle hook (never a page or layout).' },
    ],
  },
];

/** The whole example apps (composed features), shown after the single-feature demos. */
export const EXAMPLES: NavItem[] = [
  { href: '/examples/todo', title: 'Optimistic todo', blurb: 'See the pieces composed in one real feature: the declarative optimistic() list API, progressive-enhancement forms, accessible labels, the modules split, and SQLite.' },
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
