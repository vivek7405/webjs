// A redirect: throw redirect(url) from a page to short-circuit the render into
// a redirect response. This route always sends you to the routing index, the
// pattern for a moved or renamed URL. The status is convention-picked at the
// catching site (302 for a GET page-render gate, 307 for a server-action
// redirect); pass redirect(url, 308) for a permanent one, or an absolute URL
// for an external redirect. NEVER throw redirect() from a route.ts handler,
// which must return Response.redirect(url, 303) instead.
import { redirect } from '@webjsdev/core';

export default function LegacyRoute() {
  redirect('/features/routing');
}
