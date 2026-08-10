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
// `clientIpHeader` then says WHICH forwarded header carries the visitor, and on
// this deployment it is load-bearing too. Without it the default chain takes the
// leftmost X-Forwarded-For entry, which behind Cloudflare is Cloudflare's EGRESS
// address rather than yours. Cloudflare pins an egress IP per connection, so the
// limiter hands out one bucket per connection: the count descends convincingly
// while you hold one connection open and resets the moment a new one opens,
// which is a limiter that limits nobody. Your address is in CF-Connecting-IP, so
// that is the header this app names.
//
// Copying this into your own app? Name the header YOUR proxy sets, and only
// after checking it cannot be forged past that proxy. Cloudflare overwrites
// CF-Connecting-IP, which is what makes it safe HERE and unsafe on a deploy that
// Cloudflare is not in front of. The same precondition applies to the default
// chain: the proxy MUST strip an inbound X-Forwarded-For before adding its own.
// Serving with nothing in front? Drop both options, since then the socket peer
// IS the visitor. WEBJS_NO_TRUST_PROXY=1 outranks all of it.
// /docs/rate-limiting has the full threat model.
import { rateLimit } from '@webjsdev/server';

export default rateLimit({
  window: '10s',
  max: 5,
  trustProxy: true,
  clientIpHeader: 'cf-connecting-ip',
  message: 'Slow down: five requests per ten seconds.',
});
