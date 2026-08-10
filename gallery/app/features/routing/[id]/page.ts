// A dynamic route: `params.id` is the URL segment. The default export is a
// (possibly async) function receiving { params, searchParams, url }; it runs
// ONLY on the server. Throw notFound() / redirect() to short-circuit.
//
// params / searchParams are BOTH synchronously readable AND awaitable: read
// `params.id` directly, or `const { id } = await params` (the Next 15/16
// pattern, supported so that muscle memory transfers). Either form is correct.
//
// Type-safe routes: instead of hand-typing `{ params: { id: string } }`, type
// the props with PageProps<'<route>'>. `webjs types` (run automatically by
// `webjs dev`) generates .webjs/routes.d.ts with a Route union and per-route
// params, so PageProps<'/features/routing/[id]'>['params'] narrows to
// { id: string } automatically. Rename the folder and the type follows; pass a
// route literal that does not exist and it is a compile error.
import { html, notFound } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { pageHeading } from '#lib/utils/ui.ts';

export default async function RoutingParam({ params }: PageProps<'/features/routing/[id]'>) {
  // The Next-style await also works; `params.id` sync would be identical.
  const { id } = await params;
  // Throw notFound() to short-circuit into the nearest not-found boundary (404).
  // Here the reserved id "missing" stands in for "no such record"; in a real app
  // you throw this after a DB lookup returns nothing. Try /features/routing/missing.
  if (id === 'missing') notFound();
  return html`
    ${pageHeading('Route param')}
    <p>The <code>[id]</code> segment is: <strong>${id}</strong></p>
    <p class="text-muted-foreground text-sm">
      Typed with <code class="font-mono">PageProps&lt;'/features/routing/[id]'&gt;</code>,
      so <code class="font-mono">params.id</code> is a checked
      <code class="font-mono">string</code> from the generated route union.
      <code class="font-mono">params</code> is awaitable too:
      <code class="font-mono">const { id } = await params</code> works, same value.
    </p>
    <p class="text-muted-foreground text-sm">
      Throwing wins over rendering: <a class="text-primary underline underline-offset-2" href="/features/routing/missing">/features/routing/missing</a>
      throws <code class="font-mono">notFound()</code> and renders the nearest
      not-found boundary at 404. See the
      <a class="text-primary underline underline-offset-2" href="/features/boundaries">Boundaries</a> demo for
      <code class="font-mono">forbidden()</code> and
      <code class="font-mono">unauthorized()</code>.
    </p>
    <p class="mt-3"><a class="text-primary underline underline-offset-2" href="/features/routing">Back</a></p>
  `;
}
