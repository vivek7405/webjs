// Per-segment middleware. It sits in the ping/ folder, so it applies ONLY to
// /features/rate-limit/ping (its route.ts), not to the demo page one level up.
// rateLimit() returns a standard webjs middleware: return a Response to
// short-circuit (the 429), or call next() to continue. Keyed by client IP by
// default; pass `key` to key by user id, API key, etc.
import { rateLimit } from '@webjsdev/server';

export default rateLimit({ window: '10s', max: 5, message: 'Slow down: five requests per ten seconds.' });
