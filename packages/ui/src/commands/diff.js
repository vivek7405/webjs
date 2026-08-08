import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getConfig } from '../utils/get-config.js';
import { fetchRegistryItem, fetchRegistryIndex, DEFAULT_REGISTRY_URL } from '../registry/fetcher.js';
import { transformForProject } from './add.js';
import { logger } from '../utils/logger.js';

export const diff = new Command()
  .name('diff')
  .description('Show differences between local components and the registry')
  .argument('[name]', 'component to diff (omit to show all out-of-date)')
  .option('-c, --cwd <cwd>', 'the working directory', process.cwd())
  .option('--registry <url>', 'registry base URL', DEFAULT_REGISTRY_URL)
  .action(async (name, opts) => {
    const config = getConfig(opts.cwd);
    if (!config) {
      logger.error('No components.json. Run `npx @webjsdev/ui init` first.');
      process.exit(1);
    }

    // diff compares local files against the LIVE upstream, so it stays on the
    // network path (NOT local-first): local-first would compare the package
    // against itself. Resolve the names to compare, then fetch each item's full
    // content (the index is metadata-only).
    let names;
    if (name) {
      names = [name];
    } else {
      const index = await fetchRegistryIndex(opts.registry);
      names = index.filter((i) => i.type === 'registry:ui').map((i) => i.name);
    }

    const uiDir = config.resolvedPaths.ui;
    let changed = 0;

    for (const n of names) {
      const item = await fetchRegistryItem(n, opts.registry);
      for (const file of item.files || []) {
        const target = join(uiDir, basename(file.path));
        if (!existsSync(target)) continue;
        const local = readFileSync(target, 'utf8');
        // Compare against what `add` WOULD write (import-rewrite + example
        // strip), not the raw registry content: otherwise a pristine install
        // reports every import-rewritten component as differing (#983).
        const expected = transformForProject(file.content || '', target, config, item);
        if (local !== expected) {
          logger.info(`${logger.bold(item.name)}: ${basename(file.path)} differs from registry`);
          changed++;
        }
      }
    }

    if (changed === 0) logger.success('All local components match the registry.');
    else logger.info(`\n${changed} file${changed === 1 ? '' : 's'} differ. Re-add with ${logger.cyan('npx @webjsdev/ui add <name> -o')} to overwrite.`);
  });
