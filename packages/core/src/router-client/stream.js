/**
 * Client router: stream.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { warnDropped } from './diagnostics.js';
import { _swapCommit } from './swap.js';
import { upgradeTree } from './upgrade.js';

/**
 * Forward streamed Suspense resolver templates from the fetched body to
 * the live body. Needed when the new page emits a Suspense boundary that
 * resolves later.
 *
 * @param {HTMLElement} fetchedBody
 */
export function forwardSuspenseResolvers(fetchedBody) {
  for (const tpl of fetchedBody.querySelectorAll('template[data-webjs-resolve]')) {
    const clone = /** @type {HTMLTemplateElement} */ (tpl.cloneNode(true));
    document.body.appendChild(clone);
    // Resolve SYNCHRONOUSLY against the just-swapped DOM instead of relying on
    // the inline MutationObserver. The observer fires on a microtask, which
    // races an async `startViewTransition` swap: with view transitions on, the
    // swap that places the `#<id>` placeholder is deferred a frame, so the
    // observer ran first, found no placeholder, and the skeleton stuck (#1048).
    // Called from INSIDE the swap thunk (below), the placeholder is already in
    // the DOM here, so this replaces it within the same commit (and inside any
    // wrapping view transition, so the transition captures the resolved
    // content, not the fallback). Falls back to the observer if the page-level
    // resolver global is somehow absent.
    const id = clone.getAttribute('data-webjs-resolve');
    const resolve = /** @type {any} */ (window).__webjsResolve;
    if (id && typeof resolve === 'function') resolve(id);
  }
}

/**
 * Read a navigation response body progressively (#473). Returns the SHELL
 * (the HTML up to the first streamed Suspense boundary template) as soon as it
 * is available, so the router can swap it in immediately and the user sees the
 * fallbacks without waiting for the slow boundary. When the body carries
 * streamed boundaries it also returns the still-open `reader` + leftover buffer
 * so the caller applies each boundary progressively AFTER the shell swap. A body
 * with no boundaries reads to completion and returns the whole thing, so a
 * non-streaming navigation is behaviourally identical to `resp.text()`.
 *
 * @param {Response} resp
 * @returns {Promise<{ shell: string, streaming: boolean, reader?: ReadableStreamDefaultReader<Uint8Array>, dec?: TextDecoder, rest?: string }>}
 */
export async function readStreamedShell(resp) {
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    return { shell: await resp.text(), streaming: false };
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const MARK = '<template data-webjs-resolve';
  // The SSR stream flushes the whole shell (prefix + body with fallbacks)
  // followed by a `<!--wj-stream-shell-->` sentinel in the SAME chunk, then
  // PAUSES for the slow data before streaming each boundary template and the
  // `</body></html>` closer. The sentinel is what lets the shell swap in
  // immediately instead of blocking until the slow boundary arrives. Fallbacks
  // for robustness: an already-buffered boundary marker (a fast boundary), or
  // `</html>` (a fully-buffered response that happens to carry boundaries).
  const SHELL = '<!--wj-stream-shell-->';
  const HTML_CLOSE = /<\/html\s*>/i;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    if (done) buf += dec.decode();
    const si = buf.indexOf(SHELL);
    if (si !== -1) {
      return { shell: buf.slice(0, si), streaming: true, reader: done ? null : reader, dec, rest: buf.slice(si + SHELL.length) };
    }
    const mi = buf.indexOf(MARK);
    if (mi !== -1) {
      return { shell: buf.slice(0, mi), streaming: true, reader: done ? null : reader, dec, rest: buf.slice(mi) };
    }
    if (done) {
      // Stream ended with no streaming markers: the whole body is the shell.
      return { shell: buf, streaming: false };
    }
    const hm = HTML_CLOSE.exec(buf);
    if (hm) {
      const end = hm.index + hm[0].length;
      return { shell: buf.slice(0, end), streaming: true, reader, dec, rest: buf.slice(end) };
    }
  }
}

/**
 * Extract the next complete top-level
 * `<template data-webjs-resolve="ID">...</template>` unit from `buf`,
 * depth-tracking NESTED `<template>` tags (a streamed shadow component carries a
 * `<template shadowrootmode>` inside). Returns `{ id, content, rest }` for the
 * first complete unit, or null when the closing tag has not streamed in yet.
 *
 * @param {string} buf
 * @returns {{ id: string, content: string, rest: string } | null}
 */
export function takeResolveUnit(buf) {
  const m = /<template\s+data-webjs-resolve="([^"]+)"\s*>/i.exec(buf);
  if (!m) return null;
  const id = m[1];
  const contentStart = m.index + m[0].length;
  const tagRe = /<(\/?)template\b[^>]*>/gi;
  tagRe.lastIndex = contentStart;
  let depth = 1;
  let mm;
  while ((mm = tagRe.exec(buf))) {
    if (mm[1] === '/') {
      depth--;
      if (depth === 0) {
        return { id, content: buf.slice(contentStart, mm.index), rest: buf.slice(mm.index + mm[0].length) };
      }
    } else {
      depth++;
    }
  }
  return null;
}

/**
 * Apply one streamed Suspense resolution to the live DOM (#473). REPLACES the
 * boundary element (its fallback) with the resolved content and upgrades any
 * custom elements inside. This mirrors the initial-load boot resolver
 * (`b.replaceWith(template.content)`) and the prefetched-buffered path exactly,
 * so a streamed boundary settles to the SAME DOM shape (the transient
 * `<webjs-boundary>` / `<webjs-suspense>` wrapper removed) however the page was
 * reached, in JS so a soft-nav apply does not depend on the inline swap script.
 *
 * @param {string} id
 * @param {string} content
 */
export function applyStreamedResolve(id, content) {
  const boundary = document.getElementById(id);
  // A missing boundary is dropped (non-destructive), exactly as before. The
  // async-view-transition race that USED to drop a still-valid boundary (#1048)
  // is handled upstream: `streamBoundariesProgressively` is gated on the swap
  // COMMIT (`_swapCommit`), so the placeholder is already live by the time any
  // resolve is applied. A retry here would run OUTSIDE the streamer's
  // `isCurrent()` nav-token fence and could splice a superseded nav's content
  // into a recycled boundary id, so it is deliberately not attempted.
  if (!boundary) {
    // Dev-only diagnostic (#1051): the drop is benign for the normal reasons (a
    // superseded / degraded / discarded nav), but a stuck skeleton that ISN'T
    // one of those is otherwise silent, which is exactly what made #1048 hard to
    // find. Surface the dropped boundary so a future regression is one glance
    // away. Never in production, never throws, once per id.
    warnDropped(id);
    return;
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = content;
  const inserted = [...tpl.content.childNodes];
  boundary.replaceWith(tpl.content);
  // Upgrade any custom elements now that they are connected (belt-and-braces:
  // a connected, defined element upgrades on insertion, but a fragment that was
  // built before its module loaded would not).
  for (const n of inserted) if (n.nodeType === 1) upgradeTree(/** @type {Element} */ (n));
}

/**
 * Progressively apply streamed Suspense boundaries from an open response reader
 * to the live DOM AFTER the shell has been swapped in (#473). Runs detached
 * (fire-and-forget); each apply is guarded by `isCurrent` so a newer navigation
 * stops it (and cancels the reader). A mid-stream transport failure leaves the
 * already-applied boundaries in place and the rest showing their fallback,
 * which is non-destructive.
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {TextDecoder} dec
 * @param {string} initialBuf
 * @param {() => boolean} isCurrent
 */
export async function streamBoundariesProgressively(reader, dec, initialBuf, isCurrent) {
  let buf = initialBuf;
  const flush = () => {
    let unit;
    while ((unit = takeResolveUnit(buf))) {
      if (!isCurrent()) return false;
      applyStreamedResolve(unit.id, unit.content);
      buf = unit.rest;
    }
    return true;
  };
  // The whole response was already buffered (the stream ended before the shell
  // delimiter): just apply whatever boundaries are in hand.
  if (!reader) { flush(); return; }
  try {
    for (;;) {
      if (!flush()) { try { await reader.cancel(); } catch { /* ignore */ } return; }
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      if (done) {
        buf += dec.decode();
        flush();
        return;
      }
    }
  } catch {
    /* transport drop mid-stream: leave applied boundaries + remaining fallbacks */
  }
}
