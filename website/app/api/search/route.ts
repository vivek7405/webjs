/**
 * GET /api/search?q=<query>
 *
 * Powers the `<doc-search>` box in the docs sidebar. Ranks doc pages by
 * where the query terms hit (title beats heading beats body) and returns
 * the top matches with a snippet around the first body match.
 *
 * The index is the SAME extraction the llms.txt routes use
 * (`lib/docs-llms.server.ts`), so search and the machine-readable corpus can
 * never disagree about what a page is called or what is on it. That module
 * anchors its file reads to import.meta.url rather than process.cwd(), which
 * is what makes this work identically under `webjs start`, in the
 * createRequestHandler test harness, and in a deployed app.
 */
import { getDocPages } from '#lib/docs-llms.server.ts';

type SearchEntry = {
  path: string;
  title: string;
  headings: string[];
  /** Plain lowercase text, for matching. */
  text: string;
};

/** Built lazily on first request, cached in memory. */
let index: SearchEntry[] | null = null;

async function buildIndex(): Promise<SearchEntry[]> {
  if (index) return index;

  index = (await getDocPages()).map((page) => ({
    path: page.path,
    title: page.title,
    // The markdown rendering already turned headings into leading-hash
    // lines, so they are recoverable without a second parse of the source.
    headings: page.markdown
      .split('\n')
      .filter((line) => line.startsWith('#'))
      .map((line) => line.replace(/^#+\s*/, '').trim()),
    text: (page.title + '\n' + page.description + '\n' + page.markdown).toLowerCase(),
  }));
  return index;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!q || q.length < 2) return Response.json([]);

  const entries = await buildIndex();
  const terms = q.split(/\s+/);

  const results = entries
    .map((entry) => {
      let score = 0;
      for (const term of terms) {
        if (entry.title.toLowerCase().includes(term)) score += 10;
        for (const h of entry.headings) {
          if (h.toLowerCase().includes(term)) score += 5;
        }
        if (entry.text.includes(term)) score += 1;
      }
      // A snippet around the first match, so the result explains itself.
      let snippet = '';
      const idx = entry.text.indexOf(terms[0]);
      if (idx >= 0) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(entry.text.length, idx + 120);
        snippet =
          (start > 0 ? '…' : '') +
          entry.text.slice(start, end).replace(/\s+/g, ' ').trim() +
          (end < entry.text.length ? '…' : '');
      }
      return { path: entry.path, title: entry.title, score, snippet };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return Response.json(results);
}
