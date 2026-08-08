/**
 * Build a complete `LayoutProps` for an SSR test that only cares about
 * `children`.
 *
 * The server passes a layout all four of `{ children, params, searchParams,
 * url }` (packages/server/src/ssr.js), so `LayoutProps` requires all four and
 * a test calling `RootLayout({ children })` is a type error. That is the type
 * doing its job: a layout really does receive those fields. So the tests build
 * a complete props object here instead of the public type being loosened to
 * make them compile.
 *
 * The only awkward field is the pair the runtime hands over as a thenable
 * (#848): `params` / `searchParams` are synchronously readable AND awaitable,
 * which `Awaitable<T> = T & PromiseLike<T>` expresses. That type is not
 * re-exported from `@webjsdev/core` (packages/core/index.d.ts exports the
 * route props but not `Awaitable`), and `makeThenable` in
 * packages/server/src/thenable-params.js is not on the `@webjsdev/server`
 * exports map, so the shape is rebuilt here rather than reached for through an
 * unexported path. It is six lines and needs no cast.
 */
import type { LayoutProps, TemplateResult } from '@webjsdev/core';

/** Wrap a plain object so it satisfies `Awaitable<T>`: readable now, awaitable later. */
function awaitable<T extends object>(value: T): T & PromiseLike<T> {
  return Object.assign(value, {
    then<A = T, B = never>(
      onfulfilled?: ((v: T) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve({ ...value }).then(onfulfilled, onrejected);
    },
  });
}

/**
 * `layoutProps(html`<main>x</main>`)` is the whole call site. Pass `overrides`
 * when a test needs a specific `url` or a param.
 */
export function layoutProps(
  children: TemplateResult,
  overrides: Partial<LayoutProps> = {},
): LayoutProps {
  return {
    children,
    params: awaitable<Record<string, string>>({}),
    searchParams: awaitable<Record<string, string | string[]>>({}),
    url: 'https://webjs.dev/',
    ...overrides,
  };
}
