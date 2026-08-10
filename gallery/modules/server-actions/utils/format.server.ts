// A server-only utility: a `.server.ts` file with NO 'use server' directive.
// Its browser import is a throw-at-load stub, so NEVER import this into a page
// or component. Reach it only from a 'use server' action / route.ts / middleware.
// (See the server-actions section in this app's AGENTS.md for the .server.ts
// vs 'use server' rule.)
export function shout(s: string): string {
  return s.trim().toUpperCase() + '!';
}
