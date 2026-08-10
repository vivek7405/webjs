import { cspNonce } from '../csp-nonce.js';
import { escapeAttr } from '../escape.js';
import { render, defaultSSRErrorTemplate } from './template-renderer.js';
import { injectDSD } from './dsd.js';

export async function renderToString(value, opts = { ssr: true }) {
  const ctx = opts && opts.suspenseCtx;
  const dev = opts && opts.dev !== undefined ? opts.dev : ctx && ctx.dev;
  if (ctx && ctx.dev === undefined && dev !== undefined) ctx.dev = dev;
  const html = await render(value, ctx);
  return opts && opts.ssr === false ? html : await injectDSD(html, ctx, [], dev);
}

export function renderToStream(value, opts = { ssr: true }) {
  const ctx = opts && opts.suspenseCtx;
  const dev = opts && opts.dev !== undefined ? opts.dev : ctx && ctx.dev;
  if (ctx && ctx.dev === undefined && dev !== undefined) ctx.dev = dev;
  return new ReadableStream({
    async start(controller) {
      try {
        if (opts && opts.ssr === false) {
          const { streamRender } = await import('./template-renderer.js');
          await streamRender(value, ctx, controller);
        } else {
          const html = await render(value, ctx);
          const full = await injectDSD(html, ctx, [], dev);
          controller.enqueue(full);
        }

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

async function streamSuspenseBoundaries(ctx, controller, dev) {
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
