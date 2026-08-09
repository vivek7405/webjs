// Boundaries: the four control-flow throws and their boundary files. A page (or
// a page `action`) can THROW to short-circuit rendering, and the framework
// renders the NEAREST matching boundary file in the route's ancestor chain
// (innermost wins), exactly like an error boundary:
//   notFound()      -> the nearest not-found.ts       (404)
//   forbidden()     -> the nearest forbidden.ts       (403, authenticated but not allowed)
//   unauthorized()  -> the nearest unauthorized.ts    (401, not authenticated)
//   redirect(url)   -> an HTTP 3xx (no boundary file; it sends a Location)
// Two boundaries are ROOT-ONLY, so they live at the app root, not here under a
// feature folder: global-error.ts (the app-wide catch-all, owns its own <html>)
// and global-not-found.ts (a 404 for a URL that matches nothing anywhere).
//
// This demo ships two live sub-routes. Visit each and the page throws, so you
// see the nearest boundary render in place of the page:
//   /features/boundaries/gated   throws forbidden()    -> gated/forbidden.ts
//   /features/boundaries/private throws unauthorized() -> private/unauthorized.ts
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export const metadata: Metadata = { title: 'Boundaries (throws + boundary files) | features' };

export default function BoundariesExample() {
  return html`
    ${pageHeading('Boundaries')}
    ${lede(html`
      Throw a control-flow function from a page (or a page
      <code class="font-mono">action</code>) to short-circuit the render. The
      framework catches it and renders the nearest matching boundary file in the
      route's chain, innermost wins.
    `)}
    <ul class="list-disc pl-5 mb-4">
      <li>
        <a class="text-primary underline underline-offset-2" href="/features/boundaries/gated">/features/boundaries/gated</a>
        throws <code class="font-mono">forbidden()</code>, caught by
        <code class="font-mono">gated/forbidden.ts</code> (403).
      </li>
      <li>
        <a class="text-primary underline underline-offset-2" href="/features/boundaries/private">/features/boundaries/private</a>
        throws <code class="font-mono">unauthorized()</code>, caught by
        <code class="font-mono">private/unauthorized.ts</code> (401).
      </li>
      <li>
        <a class="text-primary underline underline-offset-2" href="/features/boundaries/crash">/features/boundaries/crash</a>
        throws a render error, caught by this segment's
        <code class="font-mono">error.ts</code> (500).
      </li>
      <li>
        <a class="text-primary underline underline-offset-2" href="/features/boundaries/does-not-exist">/features/boundaries/does-not-exist</a>
        matches nothing, caught by the nearest
        <code class="font-mono">not-found.ts</code> (404).
      </li>
    </ul>
    <p class="text-muted-foreground text-sm">
      <code class="font-mono">forbidden()</code> is for an authenticated user who
      lacks permission (403); <code class="font-mono">unauthorized()</code> is for
      a request that is not authenticated at all (401). Both import from
      <code class="font-mono">@webjsdev/core</code> and are thrown, never returned.
    </p>
    <p class="text-muted-foreground text-sm">
      Same throw model as <code class="font-mono">notFound()</code> (renders the
      nearest <code class="font-mono">not-found.ts</code>) and
      <code class="font-mono">redirect(url)</code> (sends an HTTP 3xx). Inside a
      <code class="font-mono">'use server'</code> RPC action, return an
      <code class="font-mono">ActionResult</code> for an auth failure instead of
      throwing, since a raw throw there is a generic 500.
    </p>
    <p class="text-muted-foreground text-sm">
      Two boundaries are root-only and live at the app root:
      <code class="font-mono">app/global-error.ts</code> (the app-wide catch-all,
      which renders its own <code class="font-mono">&lt;html&gt;</code> document)
      and <code class="font-mono">app/global-not-found.ts</code> (a 404 for a URL
      that matches nothing anywhere).
    </p>
    <p class="mt-3"><a class="text-primary underline underline-offset-2" href="/">Back to the gallery</a></p>
  `;
}
