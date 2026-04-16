import { readFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

// Build search index lazily on first request, cache in memory.
let index: SearchEntry[] | null = null;

type SearchEntry = {
  path: string;
  title: string;
  headings: string[];
  text: string; // plain text, lowercase, for matching
};

async function buildIndex(): Promise<SearchEntry[]> {
  if (index) return index;

  const { walk } = await import('../../../../packages/server/src/fs-walk.js');
  const docsRoot = join(process.cwd(), 'app', 'docs');
  const entries: SearchEntry[] = [];

  for await (const file of walk(docsRoot)) {
    if (!file.endsWith('page.ts') && !file.endsWith('page.js')) continue;
    const raw = await readFile(file, 'utf8');

    // Extract title from metadata
    const titleMatch = raw.match(/title:\s*['"]([^'"]+)['"]/);
    const title = titleMatch?.[1] || basename(dirname(file));

    // Extract headings from html template
    const headings: string[] = [];
    for (const m of raw.matchAll(/<h[123][^>]*>([^<]+)</g)) {
      headings.push(m[1].trim());
    }

    // Strip HTML tags + template syntax for plain text
    const text = raw
      .replace(/import\s+.*?from\s+['"][^'"]+['"];?/g, '')
      .replace(/export\s+(const|default|async|function|type)\s+/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/html`|css`|`/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();

    // Derive URL path from file path
    const rel = file.slice(docsRoot.length).replace(/\/page\.(ts|js)$/, '');
    const path = '/docs' + (rel || '');

    entries.push({ path, title, headings, text });
  }

  index = entries;
  return entries;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!q || q.length < 2) {
    return Response.json([]);
  }

  const entries = await buildIndex();
  const terms = q.split(/\s+/);

  const results = entries
    .map(entry => {
      let score = 0;
      for (const term of terms) {
        if (entry.title.toLowerCase().includes(term)) score += 10;
        for (const h of entry.headings) {
          if (h.toLowerCase().includes(term)) score += 5;
        }
        if (entry.text.includes(term)) score += 1;
      }
      // Extract a snippet around the first match
      let snippet = '';
      const idx = entry.text.indexOf(terms[0]);
      if (idx >= 0) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(entry.text.length, idx + 120);
        snippet = (start > 0 ? '…' : '') + entry.text.slice(start, end).trim() + (end < entry.text.length ? '…' : '');
      }
      return { path: entry.path, title: entry.title, score, snippet };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return Response.json(results);
}
