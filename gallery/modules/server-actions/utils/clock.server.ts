// A server-only utility (no 'use server'), like format.server.ts next to it: the
// tiny bit of state the cached GET read and the mutation that invalidates it
// share. Not RPC-callable, so a browser import would throw at load. A real app
// keeps this in the database.
//
// Two counters, because they show different things. `reading` is the domain
// value the mutation changes. `servings` counts how many times the read actually
// EXECUTED on the server, which is what makes a browser-cache hit visible: a
// response served from cache does not run this function, so the number does not
// move.
//
// Both are per-PROCESS and shared by every visitor, which is fine for a demo but
// is exactly why a real app puts this in the database. On a deployed gallery
// someone else's bump moves your reading, and your first read opens at whatever
// serving number the process is on.
let reading = 1;
let servings = 0;

export function serveReading(): { reading: number; serving: number } {
  servings += 1;
  return { reading, serving: servings };
}

export function bumpReading(): number {
  reading += 1;
  return reading;
}
