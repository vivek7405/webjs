import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';
import '#modules/server-actions/components/greeter.ts';
import '#modules/server-actions/components/clock-reader.ts';

export const metadata: Metadata = { title: 'Server actions (.server vs use server) | features' };

export default function ServerActionsExample() {
  return html`
    ${pageHeading('Server actions')}
    ${lede(html`A 'use server' action is RPC-callable from the client; a plain .server.ts is a server-only utility you never import into a component.`)}
    <p class="text-muted-foreground mb-4">
      This action also declares <code class="font-mono">export const middleware</code>: a
      chain that runs around it on every boundary. The auth middleware reads the
      real signed session (from the <a class="text-primary underline underline-offset-2" href="/features/auth">auth card</a>) and
      sets the caller on the request context (read back with <code class="font-mono">actionContext()</code>),
      or 401s before the action runs. The action threads
      <code class="font-mono">actionSignal()</code>, the request AbortSignal, through
      its work so a client disconnect or a superseded render stops it early.
    </p>
    <p class="text-muted-foreground mb-4 text-sm">Signed out, the greeter returns a real 401. <a class="text-primary underline underline-offset-2" href="/features/auth/login">Sign in</a> first to see it succeed. (This card depends on the auth card; prune both together.)</p>
    <server-greeter></server-greeter>

    <h2 class="text-xl font-semibold mt-10 mb-3">HTTP verbs and caching</h2>
    <p class="text-muted-foreground mb-4">
      An action declares its HTTP semantics through reserved sibling exports the
      framework reads statically, the same way a page declares
      <code class="font-mono">export const revalidate</code>. The read below sets
      <code class="font-mono">method = 'GET'</code>, so its args ride the URL, it is
      CSRF-exempt, and it carries a weak ETag, so a revalidated read whose result has
      not changed answers 304. Caching itself is opted into by the
      <code class="font-mono">cache</code> export below, not by the verb: a GET without
      one is <code class="font-mono">no-store</code>. An action with no
      <code class="font-mono">method</code> export is a POST mutation. Seeding is a
      separate mechanism and needs no verb: an action invoked during a fully
      buffered SSR render has its result serialized into the page, so the first
      client call reads that seed instead of making a hydration round-trip. A page
      that streams (a <code class="font-mono">Suspense</code> or
      <code class="font-mono">&lt;webjs-suspense&gt;</code> boundary) emits no seed
      block, so its actions do call out on hydration.
    </p>
    <p class="text-muted-foreground mb-4">
      <code class="font-mono">cache = 10</code> is the max-age in seconds, and it is
      <strong class="text-foreground">private</strong> by default. Reach for
      <code class="font-mono">{ public: true }</code> only when the data is identical
      for every visitor, because a shared cache keys the entry on the URL and args
      alone. That is the same safety rule as a page's
      <code class="font-mono">export const revalidate</code>. The number is shorthand
      for the object form, so
      <code class="font-mono">cache = { maxAge: 10, swr: 30 }</code> keeps serving an
      expired entry for another thirty seconds while the browser revalidates it in
      the background. There is no separate <code class="font-mono">swr</code> export.
    </p>
    <p class="text-muted-foreground mb-4">
      <code class="font-mono">tags</code> labels the cached entry and
      <code class="font-mono">invalidates</code> on the mutation evicts it by name.
      The read reports how many times it actually ran on the server, so press Read twice
      inside ten seconds and that count does not move: the second answer came from the
      browser cache without reaching the server. Then bump the counter and read again.
      The count moves and the value is fresh, because the mutation reported its
      invalidated tag and the next read bypassed the stale entry instead of waiting out
      the window.
    </p>
    <clock-reader></clock-reader>
  `;
}
