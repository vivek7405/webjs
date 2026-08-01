/**
 * Server-side stream-action helpers (#248) that build the `<webjs-stream>` HTML
 * the client applier (`renderStream` / the `webjs-stream` element) applies
 * surgically.
 *
 * The payload is plain HTML, a `<webjs-stream action target>` wrapping one
 * `<template>`. These helpers compose that string for the two delivery paths,
 * a content-negotiated HTTP form response and a `broadcast()` / WS message, so
 * an app never hand-writes the markup. A form-bound action or a `route` handler
 * branches on `acceptsStream(request)`, returning `streamResponse(...)` when the
 * router asked for a stream and a normal render otherwise (the JS-off degrade).
 *
 * The helpers do NOT escape the CONTENT (it is server-authored HTML, like a
 * template result). Escape any user-supplied substring yourself, the same way
 * you would inside an `html` template hole.
 */

/** The content type that negotiates and carries a stream-action response. */
export const STREAM_MIME = 'text/vnd.webjs-stream.html';

/**
 * Report whether a request opted into a stream-action response. The client
 * router adds the stream MIME to `Accept` on a form submission. With JS off the
 * browser sends no such Accept, so this returns false and the app returns a
 * normal render (the progressive-enhancement degrade).
 *
 * @param {Request | { headers?: Headers }} req
 * @returns {boolean}
 */
export function acceptsStream(req) {
  const accept = req && req.headers && req.headers.get ? (req.headers.get('accept') || '') : '';
  return accept.toLowerCase().includes(STREAM_MIME);
}

/** Escape the target id for safe placement in a double-quoted attribute. */
function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Build one `<webjs-stream>` action element.
 * @param {string} action  One of append, prepend, before, after, replace, update, remove.
 * @param {string} target  The target element id.
 * @param {string} [content]  Inner HTML for the insert actions (ignored by remove).
 * @returns {string}
 */
function build(action, target, content) {
  const t = escapeAttr(target);
  if (action === 'remove') {
    return `<webjs-stream action="remove" target="${t}"></webjs-stream>`;
  }
  const inner = content == null ? '' : String(content);
  return `<webjs-stream action="${action}" target="${t}"><template>${inner}</template></webjs-stream>`;
}

/**
 * The stream-action builder. Each method returns one `<webjs-stream>` HTML
 * string. Concatenate several and pass them to `streamResponse` or a
 * `broadcast()`.
 */
export const stream = {
  /** @param {string} target @param {string} content @returns {string} */
  append: (target, content) => build('append', target, content),
  /** @param {string} target @param {string} content @returns {string} */
  prepend: (target, content) => build('prepend', target, content),
  /** @param {string} target @param {string} content @returns {string} */
  before: (target, content) => build('before', target, content),
  /** @param {string} target @param {string} content @returns {string} */
  after: (target, content) => build('after', target, content),
  /** @param {string} target @param {string} content @returns {string} */
  replace: (target, content) => build('replace', target, content),
  /** @param {string} target @param {string} content @returns {string} */
  update: (target, content) => build('update', target, content),
  /** @param {string} target @returns {string} */
  remove: (target) => build('remove', target),
};

/**
 * Wrap one or more stream-action strings in a `Response` carrying the stream
 * content type, so the client router applies it surgically. A non-200 status is
 * fine (the router applies a stream body of any status).
 *
 * @param {...string} parts  `<webjs-stream>` HTML strings from `stream.*`.
 * @returns {Response}
 */
export function streamResponse(...parts) {
  return new Response(parts.join('\n'), {
    status: 200,
    headers: { 'content-type': STREAM_MIME + '; charset=utf-8' },
  });
}
