import { redirect } from '@webjsdev/core';

/**
 * Unreachable in practice: middleware.ts catches every request to this host
 * and 301s it to webjs.dev. This page exists so the app still has a route
 * (and so a bare visit is handled if the middleware is ever bypassed), not
 * because anything is expected to render it.
 */
export default function DocsHostRoot() {
  redirect('https://webjs.dev/docs', 301);
}
