// Routing basics: a static page that links to a dynamic route. app/ is routing
// only; a folder maps to a URL segment, and [id] is a dynamic segment read from
// `params`. See app/features/routing/[id]/page.ts.
import { html } from '@webjsdev/core';
import type { Metadata } from '@webjsdev/core';
import { pageHeading, lede } from '#lib/utils/ui.ts';

export const metadata: Metadata = { title: 'Routing (dynamic params) | features' };

export default function RoutingExample() {
  return html`
    ${pageHeading('Routing')}
    ${lede(html`A folder is a URL segment; a <code>[id]</code> folder is a dynamic param.`)}
    <ul class="list-disc pl-5 mb-4">
      <li><a class="text-primary underline underline-offset-2" href="/features/routing/42">/features/routing/42</a></li>
      <li><a class="text-primary underline underline-offset-2" href="/features/routing/hello">/features/routing/hello</a></li>
      <li><a class="text-primary underline underline-offset-2" href="/features/routing/legacy">/features/routing/legacy</a> throws <code class="font-mono">redirect()</code> back here</li>
    </ul>
    <p class="text-muted-foreground text-sm">
      Routes are type-safe: <code class="font-mono">webjs types</code> (run by
      <code class="font-mono">webjs dev</code>) generates a
      <code class="font-mono">Route</code> union, and the
      <code class="font-mono">[id]</code> page types its props with
      <code class="font-mono">PageProps&lt;'/features/routing/[id]'&gt;</code>
      so <code class="font-mono">params</code> is checked against the real routes.
    </p>
    <p class="text-muted-foreground text-sm">
      Programmatic navigation is checked too:
      <code class="font-mono">navigate(url)</code> takes that
      <code class="font-mono">Route</code> union, so
      <code class="font-mono">navigate('/random/42')</code> is a compile error in
      your editor and <code class="font-mono">webjs typecheck</code>. (Plain
      <code class="font-mono">&lt;a href&gt;</code> strings are not checked, so
      prefer <code class="font-mono">navigate()</code> for internal links you want
      verified.)
    </p>
    <p class="text-muted-foreground text-sm">
      Changing route in code, two sides:
      <code class="font-mono">navigate(url)</code> runs in the browser (a soft,
      in-place client-router nav from an event handler, no reload), while
      <code class="font-mono">redirect(url)</code> runs on the server (throw it in
      a page or an <code class="font-mono">action</code> to bail before render and
      return an HTTP 3xx). Throw
      <code class="font-mono">redirect()</code> on the server, call
      <code class="font-mono">navigate()</code> on the client.
    </p>
    <p class="text-muted-foreground text-sm">
      A page can also THROW to short-circuit rendering:
      <code class="font-mono">notFound()</code> (404),
      <code class="font-mono">forbidden()</code> (403), and
      <code class="font-mono">unauthorized()</code> (401), each rendering the
      nearest matching boundary file. See the
      <a class="text-primary underline underline-offset-2" href="/features/boundaries">Boundaries</a> demo.
    </p>
  `;
}
