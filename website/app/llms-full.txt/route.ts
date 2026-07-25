/**
 * GET /llms-full.txt
 *
 * The full prose corpus (llmstxt.org standard): every doc page
 * concatenated as readable markdown, plus optional skill
 * enrichment when running inside the monorepo. Served as text/plain and
 * generated live from the doc pages (no build step, never drifts).
 */
import { renderLlmsFull, textResponse } from '#lib/docs-llms.server.ts';

export async function GET(req: Request) {
  return textResponse(await renderLlmsFull(req));
}
