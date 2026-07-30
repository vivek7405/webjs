'use server';

import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '#lib/utils/frontmatter.ts';
import type { PostWithBody } from '#modules/blog/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const BLOG_DIR = resolve(REPO_ROOT, 'blog');

/**
 * Read a single `blog/<slug>.md` and return its metadata + body.
 * Returns `null` if the slug is invalid or the file does not exist;
 * the route handler turns that into a 404 via the framework's
 * `notFound()` sentinel.
 *
 * Slug validation is `[a-z0-9-]+` (the same alphabet the filename
 * uses). Anything else returns null before we hit the filesystem,
 * which also blocks path-traversal attempts like `../../etc/passwd`.
 */
// A GET server action (#488): a public, cacheable read of a single
// post, identical for every visitor, so `public: true` is safe. The
// cache key already includes the `slug` argument; the per-post `blog:`
// tag (plus the shared `blog` tag) lets a future write path evict it.
export const method = 'GET';
export const cache = { maxAge: 300, public: true };
export const tags = (slug: string) => ['blog', `blog:${slug}`];
export async function getPost(slug: string): Promise<PostWithBody | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  let raw: string;
  try { raw = await readFile(join(BLOG_DIR, slug + '.md'), 'utf8'); }
  catch { return null; }
  const { fm, body } = parseFrontmatter(raw);
  if (!fm.title || !fm.date) return null;
  return {
    slug,
    title: fm.title,
    date: fm.date,
    description: fm.description || '',
    tags: (fm.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    author: fm.author || 'Vivek',
    body: body.trim(),
  };
}
