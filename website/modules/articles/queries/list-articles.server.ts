'use server';

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '#lib/utils/frontmatter.ts';
import type { Article } from '#modules/articles/types.ts';

// website/modules/articles/queries/list-articles.server.ts is 4 levels deep
// from the repo root (website/modules/articles/queries/...).
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ARTICLES_DIR = resolve(REPO_ROOT, 'articles');

/**
 * Read every `articles/<slug>.md` at the repo root, parse frontmatter, and
 * return the metadata (not the body) for the `/articles` index cards.
 *
 * Mirrors the compare module (list-comparisons). Each file requires
 * `title`, `tagline`, and `keyword`; files missing those are dropped
 * silently (lets a draft sit in the directory). Sorted newest first for a
 * stable order, though the evergreen hub does not surface dates.
 *
 * Declared as a GET server action (#488): a public, cacheable read of
 * repo content identical for every visitor, so `public: true` is safe.
 * The `articles` tag lets a future write path evict it.
 */
export const method = 'GET';
export const cache = { maxAge: 300, public: true };
export const tags = () => ['articles'];
export async function listArticles(): Promise<Article[]> {
  let files: string[];
  try { files = await readdir(ARTICLES_DIR); } catch { return []; }
  const articles: Article[] = [];
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const raw = await readFile(join(ARTICLES_DIR, f), 'utf8');
    const { fm } = parseFrontmatter(raw);
    if (!fm.title || !fm.tagline || !fm.keyword) continue;
    articles.push({
      slug: f.replace(/\.md$/, ''),
      title: fm.title,
      date: fm.date || '',
      description: fm.description || '',
      tagline: fm.tagline,
      keyword: fm.keyword,
      tags: (fm.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      author: fm.author || 'Vivek',
    });
  }
  articles.sort((a, b) => Date.parse(b.date || '0') - Date.parse(a.date || '0'));
  return articles;
}
