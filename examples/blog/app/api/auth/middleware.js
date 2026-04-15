import { rateLimit } from '@webjs/server';

/**
 * Tight rate limit on any auth endpoint — demonstrates per-segment
 * middleware. Trips at 5 requests per 10s per IP, regardless of which
 * auth route is hit. Well below legitimate UX thresholds, well above
 * typing-retry budgets, hostile to password-spray.
 */
export default rateLimit({ window: '10s', max: 5 });
