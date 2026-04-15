/**
 * `repeat()` — keyed list directive.
 *
 * Usage in a template:
 * ```js
 * import { html, repeat } from 'webjs';
 * html`<ul>${repeat(items, (it) => it.id, (it) => html`<li>${it.title}</li>`)}</ul>`;
 * ```
 *
 * Without `repeat()`, an array re-render rebuilds every child (losing focus,
 * selection, and scroll). With `repeat()`, the client renderer maintains a
 * `Map<key, TemplateInstance>` — matched items update in place, new items
 * mount fresh, removed items unmount, and the surviving DOM nodes are moved
 * (not recreated) when the order changes.
 *
 * Keys must be stable and unique within the call. Bad keys (array indices)
 * defeat the purpose; prefer a stable id from the data.
 *
 * On the server this marker is just iterated: order matters, keys don't.
 */

const REPEAT = Symbol.for('webjs.repeat');

/**
 * @template T
 * @param {Iterable<T>} items
 * @param {(item: T, i: number) => string | number} keyFn
 * @param {(item: T, i: number) => unknown} templateFn
 */
export function repeat(items, keyFn, templateFn) {
  return { [REPEAT]: true, items: [...items], keyFn, templateFn };
}

/** @param {unknown} x */
export function isRepeat(x) {
  return !!x && typeof x === 'object' && /** @type any */ (x)[REPEAT] === true;
}
