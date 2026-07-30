'use server';

import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '#lib/utils/frontmatter.ts';
import type { ComparisonWithBody } from '#modules/compare/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const COMPARE_DIR = resolve(REPO_ROOT, 'compare');

/**
 * Read a single `compare/<slug>.md` and return its metadata + body.
 * Returns `null` if the slug is invalid or the file does not exist;
 * the route handler turns that into a 404 via `notFound()`.
 *
 * Slug validation is `[a-z0-9-]+`, which also blocks path traversal
 * (`../../etc/passwd`) before touching the filesystem.
 *
 * A GET server action (#488): a public, cacheable per-slug read,
 * identical for every visitor, so `public: true` is safe. The cache
 * key includes the `slug` arg; the per-page `compare:` tag (plus the
 * shared `compare` tag) lets a future write path evict it.
 */
export const method = 'GET';
export const cache = { maxAge: 300, public: true };
export const tags = (slug: string) => ['compare', `compare:${slug}`];
export async function getComparison(slug: string): Promise<ComparisonWithBody | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  let raw: string;
  try { raw = await readFile(join(COMPARE_DIR, slug + '.md'), 'utf8'); }
  catch { return null; }
  const { fm, body } = parseFrontmatter(raw);
  if (!fm.title || !fm.competitor || !fm.tagline) return null;
  return {
    slug,
    title: fm.title,
    date: fm.date || '',
    description: fm.description || '',
    competitor: fm.competitor,
    link: fm.link || '',
    tagline: fm.tagline,
    tags: (fm.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    author: fm.author || 'Vivek',
    body: body.trim(),
  };
}
