import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Recursively walk a directory, yielding absolute file paths.
 *
 * @param {string} dir
 * @param {(path: string) => boolean} [filter]
 * @returns {AsyncGenerator<string>}
 */
export async function* walk(dir, filter) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, filter);
    } else if (entry.isFile()) {
      if (!filter || filter(full)) yield full;
    }
  }
}
