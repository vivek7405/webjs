/**
 * `Suspense({ fallback, children })` — deferred boundary for streaming SSR.
 *
 * ```js
 * import { html, Suspense } from 'webjs';
 *
 * export default function Page() {
 *   return html`
 *     <h1>Catalogue</h1>
 *     ${Suspense({ fallback: html`<p>Loading…</p>`, children: fetchExpensive() })}
 *   `;
 * }
 *
 * async function fetchExpensive() {
 *   const items = await db.item.findMany();
 *   return html`<ul>${items.map(i => html`<li>${i.name}</li>`)}</ul>`;
 * }
 * ```
 *
 * The server emits the fallback immediately, closes no tags, and keeps the
 * response stream open. When the children promise resolves, the resolved
 * HTML streams as a `<template data-webjs-resolve="ID">…</template>` plus
 * a tiny inline script that swaps the fallback for the real content. No
 * hydration runtime required — just a `replaceWith` call.
 *
 * Nested Suspense works: a resolved template can itself contain Suspense,
 * whose fallback is emitted inside the template until its own promise lands.
 */
const SUSPENSE = Symbol.for('webjs.suspense');

/**
 * @typedef {{ _$webjsSuspense: true, fallback: unknown, children: unknown }} SuspenseBoundary
 *
 * @param {{ fallback: unknown, children: unknown | Promise<unknown> }} props
 * @returns {SuspenseBoundary}
 */
export function Suspense(props) {
  return { _$webjsSuspense: true, fallback: props.fallback, children: props.children };
}

/** @param {unknown} x */
export function isSuspense(x) {
  return !!x && typeof x === 'object' && /** @type any */ (x)._$webjsSuspense === true;
}

export { SUSPENSE };
