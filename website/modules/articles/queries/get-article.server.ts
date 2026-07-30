'use server';

import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '#lib/utils/frontmatter.ts';
import type { ArticleWithBody } from '#modules/articles/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ARTICLES_DIR = resolve(REPO_ROOT, 'articles');

/**
 * Read a single `articles/<slug>.md` and return its metadata + body.
 * Returns `null` if the slug is invalid or the file does not exist; the
 * route handler turns that into a 404 via `notFound()`.
 *
 * Slug validation is `[a-z0-9-]+`, which also blocks path traversal
 * before touching the filesystem. Mirrors the compare module
 * (get-comparison).
 *
 * A GET server action (#488): a public, cacheable per-slug read,
 * identical for every visitor, so `public: true` is safe. The cache key
 * includes the `slug` arg; the per-page `article:` tag (plus the shared
 * `articles` tag) lets a future write path evict it.
 */
export const method = 'GET';
export const cache = { maxAge: 300, public: true };
export const tags = (slug: string) => ['articles', `article:${slug}`];
export async function getArticle(slug: string): Promise<ArticleWithBody | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  let raw: string;
  try { raw = await readFile(join(ARTICLES_DIR, slug + '.md'), 'utf8'); }
  catch { return null; }
  const { fm, body } = parseFrontmatter(raw);
  if (!fm.title || !fm.tagline || !fm.keyword) return null;
  return {
    slug,
    title: fm.title,
    date: fm.date || '',
    description: fm.description || '',
    tagline: fm.tagline,
    keyword: fm.keyword,
    tags: (fm.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    author: fm.author || 'Vivek',
    body: body.trim(),
  };
}
