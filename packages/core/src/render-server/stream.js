import { cspNonce } from '../csp-nonce.js';
import { escapeAttr } from '../escape.js';
import { render, defaultSSRErrorTemplate } from './template-renderer.js';
import { injectDSD } from './dsd.js';

/**
 * Render a TemplateResult (or any renderable value) to an HTML string.
 *
 * Async by design: template holes may be Promises, components' `render()`
 * methods may be async, and data-fetching inside nested components is
 * awaited before the final string is emitted.
 *
 * If `opts.suspenseCtx` is provided, Suspense boundaries encountered during
 * the render will push `{ id, promise }` into `opts.suspenseCtx.pending`
 * and their fallback HTML is emitted immediately. The caller is responsible
 * for streaming each resolved promise afterwards. Without a suspenseCtx,
 * Suspense still works but we fall back to emitting only the fallback
 * (the promise is dropped: appropriate for static pre-render).
 *
 * @typedef {{ pending: {id: string, promise: Promise<unknown>}[], nextId: number }} SuspenseCtx
 *
 * A boundary's enclosing form scope used to be recorded here and threaded back
 * in (#1207), because the page pipeline in `@webjsdev/server` drains
 * `ctx.pending` and re-renders each resolved child through a FRESH scan with no
 * view of the shell it belongs to, so a `<button formaction=${fn}>` inside a
 * bound form's Suspense boundary read as form-less and was refused. Gone with
 * #1307: a bound submitter carries its own `formmethod` and enctype, so no
 * renderer needs to know what encloses it and there is nothing left to thread.
 *
 * @param {unknown} value
 * @param {{ ssr?: boolean, suspenseCtx?: SuspenseCtx, dev?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function renderToString(value, opts = { ssr: true }) {
  const ctx = opts && opts.suspenseCtx;
  // The server `dev` flag drives prod-silence of SSR error states (#483).
  // `opts.dev` wins; else inherit a `dev` already stamped on the ctx (so a
  // streamed sub-context inherits it); back-fill the ctx so downstream renders
  // sharing it see the same flag. Undefined stays undefined (NODE_ENV fallback).
  const dev = opts && opts.dev !== undefined ? opts.dev : ctx && ctx.dev;
  if (ctx && ctx.dev === undefined && dev !== undefined) ctx.dev = dev;
  const html = await render(value, ctx);
  return opts && opts.ssr === false ? html : await injectDSD(html, ctx, [], dev);
}

/**
 * Render a TemplateResult (or any renderable value) to a `ReadableStream`
 * that yields HTML chunks as strings.
 *
 * Works identically to {@link renderToString} but streams partial HTML as
 * it is rendered: avoiding buffering the entire page in memory. For
 * Suspense boundaries, the fallback is yielded immediately and resolved
 * content is streamed afterwards at the end of the response.
 *
 * **AI hint:** Use `renderToStream` when you want to pipe SSR output
 * directly into a `Response` for streaming delivery (e.g. HTTP chunked
 * transfer). It accepts the same arguments as `renderToString`.
 *
 * @param {unknown} value  A TemplateResult, string, array, or any renderable.
 * @param {{ ssr?: boolean, suspenseCtx?: SuspenseCtx }} [opts]
 * @returns {ReadableStream<string>}
 */
export function renderToStream(value, opts = { ssr: true }) {
  const ctx = opts && opts.suspenseCtx;
  // Server dev flag for prod-silence of SSR error states (#483), same sourcing
  // as renderToString: opts.dev wins, else inherit from the ctx, else undefined
  // (NODE_ENV fallback). Back-fill the ctx so the streamed sub-renders share it.
  const dev = opts && opts.dev !== undefined ? opts.dev : ctx && ctx.dev;
  if (ctx && ctx.dev === undefined && dev !== undefined) ctx.dev = dev;
  return new ReadableStream({
    async start(controller) {
      try {
        if (opts && opts.ssr === false) {
          // No DSD injection: just stream the raw rendered chunks.
          const { streamRender } = await import('./template-renderer.js');
          await streamRender(value, ctx, controller);
        } else {
          // Render to string first to run DSD injection (which operates on
          // the full HTML), then enqueue the result. This matches the
          // semantics of renderToString but still gives us a stream.
          const html = await render(value, ctx);
          const full = await injectDSD(html, ctx, [], dev);
          controller.enqueue(full);
        }

        // Stream resolved Suspense boundaries after the main content.
        if (ctx && ctx.pending.length) {
          await streamSuspenseBoundaries(ctx, controller, dev);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * After the main HTML has been streamed, resolve pending Suspense promises
 * and stream their replacement content as out-of-order `<template>` tags
 * with tiny inline scripts that swap the fallback for the resolved HTML.
 *
 * @param {SuspenseCtx} ctx
 * @param {ReadableStreamDefaultController<string>} controller
 * @param {boolean} [dev]  server dev flag for prod-silence of a rejected
 *   streamed boundary (#483); undefined falls back to NODE_ENV
 */
async function streamSuspenseBoundaries(ctx, controller, dev) {
  // Resolve the per-request nonce once per call. The provider in
  // @webjsdev/server sources it from AsyncLocalStorage; outside a
  // request scope (or in the browser) the helper returns '' and we
  // emit the script unnonced, which is fine on documents not under
  // strict CSP and matches the no-nonce case for the rest of the
  // SSR pipeline.
  const nonce = cspNonce();
  const nonceAttr = nonce ? ` nonce="${escapeAttr(nonce)}"` : '';
  while (ctx.pending.length) {
    const batch = ctx.pending.splice(0);
    await Promise.all(
      batch.map(async ({ id, promise }) => {
        try {
          const resolved = await promise;
          const html = await render(resolved, ctx);
          const full = await injectDSD(html, ctx, [], dev);
          controller.enqueue(
            `<template data-webjs-resolve="${id}">${full}</template>` +
            `<script${nonceAttr}>` +
            `(function(){` +
            `var t=document.currentScript.previousElementSibling;` +
            `var b=document.getElementById("${id}");` +
            `if(b&&t){b.replaceWith(t.content.cloneNode(true));t.remove()}` +
            `document.currentScript.remove()` +
            `})()` +
            `</script>`
          );
        } catch (err) {
          console.error(`[webjs] Suspense boundary "${id}" rejected:`, err);
          // Render a boundary-scoped error state rather than leaving the
          // fallback stuck forever (#471). Dev surfaces the message; prod
          // renders a silent empty element (no leak). A failure HERE (the
          // error render itself throwing) leaves the fallback in place.
          try {
            const e = err instanceof Error ? err : new Error(String(err));
            const errHtml = await injectDSD(await render(defaultSSRErrorTemplate('webjs-suspense', e, dev), ctx), ctx, [], dev);
            controller.enqueue(
              `<template data-webjs-resolve="${id}">${errHtml}</template>` +
              `<script${nonceAttr}>` +
              `(function(){` +
              `var t=document.currentScript.previousElementSibling;` +
              `var b=document.getElementById("${id}");` +
              `if(b&&t){b.replaceWith(t.content.cloneNode(true));t.remove()}` +
              `document.currentScript.remove()` +
              `})()` +
              `</script>`
            );
          } catch (errorRenderThrew) {
            console.error(`[webjs] Suspense boundary "${id}" error render also threw:`, errorRenderThrew);
          }
        }
      })
    );
  }
}
