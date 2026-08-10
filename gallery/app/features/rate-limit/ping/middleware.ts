// Per-segment middleware. It sits in the ping/ folder, so it applies ONLY to
// /features/rate-limit/ping (its route.ts), not to the demo page one level up.
// rateLimit() returns a standard WebJs middleware: return a Response to
// short-circuit (the 429), or call next() to continue. Pass `key` to bucket by
// user id, API key, or anything else instead of by IP.
//
// `trustProxy: true` is the load-bearing option here, and it is why this demo
// works on the deployed site. WITHOUT it the bucket key is the socket peer,
// which is correct only when the visitor's browser is the thing connecting.
// Behind a CDN or a platform router the peer is that proxy, so every visitor
// sharing one proxy shares one bucket, and (worse for a limiter) a proxy POOL
// hands out one bucket per proxy, which multiplies the real limit by the pool
// size. WITH it the key comes from the forwarded client address instead.
//
// The tradeoff is real and worth knowing before copying this line: the proxy
// in front of you MUST strip an inbound X-Forwarded-For before adding its own,
// or a client can forge the header and pick its own bucket. WEBJS_NO_TRUST_PROXY=1
// also outranks this option and puts the limiter back on the socket peer.
// /docs/rate-limiting has the full threat model.
import { rateLimit } from '@webjsdev/server';

export default rateLimit({
  window: '10s',
  max: 5,
  trustProxy: true,
  message: 'Slow down: five requests per ten seconds.',
});
