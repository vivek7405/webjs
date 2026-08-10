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
 * unexported path.
 *
 * Rebuilt means rebuilt exactly, including the part that is easy to drop.
 * `then` MUST be non-enumerable, and the promise it returns MUST resolve to a
 * copy that does not carry it. Install it with `Object.assign` instead and the
 * copy is itself a thenable, so `Promise.resolve` adopts it, calls its `then`,
 * gets another thenable, and `await params` never settles: not a slow test, a
 * hung one, with the microtask queue starved so thoroughly that timers stop
 * firing. `Object.keys(params)` would also report `['then']`. The framework
 * file says the same thing in its own comment; this is the one detail that
 * makes the shape work.
 */
import type { LayoutProps, TemplateResult } from '@webjsdev/core';

/** Wrap a plain object so it satisfies `Awaitable<T>`: readable now, awaitable later. */
function awaitable<T extends object>(value: T): T & PromiseLike<T> {
  Object.defineProperty(value, 'then', {
    value: <A = T, B = never>(
      onfulfilled?: ((v: T) => A | PromiseLike<A>) | null,
      onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> => {
      // A shallow copy taken through a spread does NOT carry the
      // non-enumerable `then`, so the awaited value is a plain object and
      // nothing re-adopts it.
      const plain: T = { ...value };
      return Promise.resolve(plain).then(onfulfilled, onrejected);
    },
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return value as T & PromiseLike<T>;
}

/**
 * The overrides a test may pass. `params` / `searchParams` are taken as PLAIN
 * records and wrapped here, because `awaitable` is private to this module and
 * a caller has no way to build an `Awaitable<T>` itself.
 */
type LayoutPropsOverrides = Partial<Omit<LayoutProps, 'params' | 'searchParams'>> & {
  params?: Record<string, string>;
  searchParams?: Record<string, string | string[]>;
};

/**
 * `layoutProps(html`<main>x</main>`)` is the whole call site. Pass `overrides`
 * when a test needs a specific `url` or a param:
 * `layoutProps(children, { url: 'https://webjs.dev/blog', params: { slug: 'x' } })`.
 */
export function layoutProps(
  children: TemplateResult,
  overrides: LayoutPropsOverrides = {},
): LayoutProps {
  const { params, searchParams, ...rest } = overrides;
  return {
    children,
    params: awaitable<Record<string, string>>({ ...params }),
    searchParams: awaitable<Record<string, string | string[]>>({ ...searchParams }),
    url: 'https://webjs.dev/',
    ...rest,
  };
}
