/**
 * GET /docs/<topic>/llms.txt
 *
 * The per-page raw markdown variant (llmstxt.org convention: append the
 * markdown URL to any doc page). `<topic>` is the dynamic segment, so
 * EVERY doc page gets a markdown variant for free, including the core
 * API pages (getting-started, components, server-actions, ...). The
 * /llms.txt index links each page to this URL.
 *
 * An unknown topic returns 404 (text/plain). The static
 * `app/docs/<topic>/page.ts` folders still serve the human page at
 * `/docs/<topic>`; this dynamic `[topic]/llms.txt` only catches the
 * `.../llms.txt` child, so the two never collide.
 */
import { renderPageMarkdown, textResponse } from '#lib/docs-llms.server.ts';

export async function GET(req: Request, { params }: { params: { topic: string } }) {
  const md = await renderPageMarkdown(params.topic, req);
  if (md == null) return textResponse(`# Not found\n\nNo doc page named "${params.topic}".\n`, 404);
  return textResponse(md);
}
