'use server';

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '#lib/utils/frontmatter.ts';
import type { Entry } from '#modules/changelog/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const CHANGELOG_DIR = resolve(REPO_ROOT, 'changelog');

/**
 * Read every `changelog/<pkg>/<version>.md`, parse frontmatter, sort
 * by date DESC.
 *
 * Sort: by full commit timestamp DESC. Entries that share an exact
 * timestamp (multiple packages bumped in one PR) keep their stable
 * readdir order, which is typically alphabetical on every common
 * filesystem. Matches the GitHub Releases page (the workflow publishes
 * oldest-first so GH's `created_at DESC` sort ends up with the same
 * order).
 *
 * A GET server action (#488): a public, cacheable read of the release
 * feed, identical for every visitor, so `public: true` is safe. The
 * `changelog` tag lets a future write path evict it; entries change
 * only on a release deploy, so a 5-minute max-age is comfortable.
 */
export const method = 'GET';
export const cache = { maxAge: 300, public: true };
export const tags = () => ['changelog'];
export async function listEntries(): Promise<Entry[]> {
  const entries: Entry[] = [];
  let pkgs: string[];
  try {
    pkgs = await readdir(CHANGELOG_DIR, { withFileTypes: true })
      .then((es) => es.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch { return []; }
  for (const pkg of pkgs) {
    const dir = join(CHANGELOG_DIR, pkg);
    let files: string[];
    try { files = await readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const raw = await readFile(join(dir, f), 'utf8');
      const { fm, body } = parseFrontmatter(raw);
      if (!fm.version || !fm.date) continue;
      entries.push({
        package: fm.package || `@webjsdev/${pkg}`,
        shortPkg: pkg,
        version: fm.version,
        date: fm.date,
        commitCount: Number(fm.commit_count || 0),
        body: body.trim(),
      });
    }
  }
  entries.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return entries;
}
