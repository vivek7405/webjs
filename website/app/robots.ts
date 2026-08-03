import { siteUrl } from '#lib/env.ts';
/**
 * /robots.txt
 *
 * Metadata route (default-exports a function returning a string, served
 * as text/plain at /robots.txt). Allows all crawlers and points them at
 * the sitemap, which enumerates every page, blog post, and comparison.
 * There is nothing private on the marketing site, so a blanket
 * allow is correct; the internal `/__webjs/*` action endpoints are POST
 * RPC routes with no crawlable GET surface, so they need no disallow.
 *
 * The AI crawlers are named explicitly rather than left to the wildcard.
 * WebJs is a framework people increasingly ask an assistant about instead of
 * a search engine, so being readable by the answer engines is a real
 * distribution channel. Naming each agent also states the intent
 * unambiguously for tooling that reads per-agent groups.
 *
 * IMPORTANT, and not fixable from this file alone: Cloudflare sits in front of
 * this app and can INJECT a managed robots.txt block ahead of this output, one
 * that sets `Content-Signal: ai-train=no` and `Disallow: /` for ClaudeBot,
 * GPTBot, CCBot, Google-Extended and others. That managed block wins at the
 * edge, and it also emits a second `User-agent: *` group, so a crawler taking
 * the first matching group never reaches ours. If
 * `curl https://webjs.dev/robots.txt` shows a `Content-Signal:` line, the
 * managed setting is still on and has to be turned off in the Cloudflare
 * dashboard for the zone, under Security then Settings then "Manage
 * robots.txt" (AI Scrapers and Crawlers). It applies to docs.webjs.dev and
 * ui.webjs.dev too.
 *
 * `SITE_URL` mirrors app/sitemap.ts so the two agree on the origin.
 */
const SITE_URL = siteUrl();

// Answer-engine and AI crawlers we explicitly welcome. These are the agents
// that put a citation in front of a developer who asks an assistant what
// WebJs is, which is the same question this site answers at /what-is-webjs.
const AI_CRAWLERS = [
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Amazonbot',
  'meta-externalagent',
  'cohere-ai',
  'YouBot',
];

export default function Robots(): string {
  const lines = ['User-agent: *', 'Allow: /', ''];

  for (const agent of AI_CRAWLERS) {
    lines.push(`User-agent: ${agent}`, 'Allow: /', '');
  }

  lines.push(`Sitemap: ${SITE_URL}/sitemap.xml`, '');
  return lines.join('\n');
}
