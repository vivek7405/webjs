'use server';

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '#lib/utils/frontmatter.ts';
import type { Comparison } from '#modules/compare/types.ts';

// website/modules/compare/queries/list-comparisons.server.ts is 4 levels
// deep from the repo root (website/modules/compare/queries/...).
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const COMPARE_DIR = resolve(REPO_ROOT, 'compare');

/**
 * Read every `compare/<slug>.md` at the repo root, parse frontmatter,
 * and return the metadata (not the body) so the index page can render
 * compact cards. Sorted alphabetically by competitor so the list is
 * stable regardless of file dates.
 *
 * Each file requires `title`, `competitor`, and `tagline`; files
 * missing those are dropped silently (lets a draft sit in the dir).
 *
 * Declared as a GET server action (#488): a public, cacheable read of
 * repo content identical for every visitor, so `public: true` is safe.
 * Content only changes on redeploy, so a 5-minute max-age is fine; the
 * `compare` tag lets a future write path evict it.
 */
export const method = 'GET';
export const cache = { maxAge: 300, public: true };
export const tags = () => ['compare'];
export async function listComparisons(): Promise<Comparison[]> {
  let files: string[];
  try { files = await readdir(COMPARE_DIR); } catch { return []; }
  const comparisons: Comparison[] = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const raw = await readFile(join(COMPARE_DIR, f), 'utf8');
    const { fm } = parseFrontmatter(raw);
    if (!fm.title || !fm.competitor || !fm.tagline) continue;
    comparisons.push({
      slug: f.replace(/\.md$/, ''),
      title: fm.title,
      date: fm.date || '',
      description: fm.description || '',
      competitor: fm.competitor,
      link: fm.link || '',
      tagline: fm.tagline,
      tags: (fm.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      author: fm.author || 'Vivek',
    });
  }
  comparisons.sort((a, b) => a.competitor.localeCompare(b.competitor));
  return comparisons;
}
