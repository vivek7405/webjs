/**
 * Server-side navigation helpers, modelled after NextJs.
 *
 * Usage (inside a server-only module: page, layout, API route, server action):
 *
 *   import { notFound, redirect } from '@webjs/core';
 *   if (!post) notFound();
 *   if (user.banned) redirect('/goodbye');
 *
 * Both throw a sentinel that the SSR pipeline catches. Never catch them
 * yourself — let them propagate.
 */

const NOT_FOUND = Symbol.for('webjs.notFound');
const REDIRECT = Symbol.for('webjs.redirect');

/** @returns {never} */
export function notFound() {
  const err = new Error('webjs: notFound()');
  /** @type any */ (err).__webjs = NOT_FOUND;
  throw err;
}

/**
 * @param {string} url
 * @param {number} [status] 307 (temp) by default; pass 308 for permanent
 * @returns {never}
 */
export function redirect(url, status = 307) {
  const err = new Error(`webjs: redirect(${url})`);
  /** @type any */ (err).__webjs = REDIRECT;
  /** @type any */ (err).url = url;
  /** @type any */ (err).status = status;
  throw err;
}

/** @param {unknown} e */
export function isNotFound(e) {
  return !!e && /** @type any */ (e).__webjs === NOT_FOUND;
}

/** @param {unknown} e */
export function isRedirect(e) {
  return !!e && /** @type any */ (e).__webjs === REDIRECT;
}
