// A server-only utility (no 'use server'), like format.server.ts next to it: a
// tiny in-process counter shared by the cached GET read and the mutation that
// invalidates it. Not RPC-callable, so a browser import would throw at load.
// A real app keeps this state in the database.
let reading = 1;

export function currentReading(): number {
  return reading;
}

export function bumpReading(): void {
  reading += 1;
}
