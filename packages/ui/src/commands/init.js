import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import prompts from 'prompts';
import { writeConfig, CONFIG_FILE } from '../utils/get-config.js';
import { logger } from '../utils/logger.js';
import { getRegistryItem, DEFAULT_REGISTRY_URL } from '../registry/fetcher.js';
import { ensureTheme } from '../utils/theme.js';

const BASE_COLORS = ['neutral', 'stone', 'zinc', 'mauve', 'olive', 'mist', 'taupe'];

/**
 * The stylesheet `init` defaults to. It is `styles/globals.css`, NOT
 * `app/globals.css`, because in WebJs `app/` is routing-only, so a
 * non-routing stylesheet lives outside it.
 *
 * Exported so `webjs create` can be checked against it rather than against a
 * hand-copied literal (`test/scaffolds/scaffold-ui-integration.test.js`).
 */
export const DEFAULT_TAILWIND_CSS = 'styles/globals.css';

/**
 * The alias map `init` writes into `components.json`. These are the paths a
 * WebJs app uses, and they match byte for byte what `webjs create` scaffolds
 * (see `packages/cli/lib/create.js`), so `init` on a bare app and a freshly
 * scaffolded one land on the same layout.
 *
 * `utils` is `lib/utils/cn`, not `lib/utils`: `get-config.js` appends `'.ts'`
 * when resolving the alias, so this resolves to `lib/utils/cn.ts`. Writing
 * the helper into the `lib/utils/` DIRECTORY is what lets the client-only
 * `onBeforeCache()` helper sit beside it at `lib/utils/dom.ts` (#819), which
 * is where `add` rewrites the registry's `'../lib/dom.ts'` import to point.
 *
 * Exported for the same drift check as {@link DEFAULT_TAILWIND_CSS}. The two
 * generators used to disagree here (init said `lib/utils`, the scaffold said
 * `lib/utils/cn`) with only a comment claiming they matched, so the agreement
 * is asserted now rather than described.
 */
export const DEFAULT_ALIASES = {
  components: 'components',
  utils: 'lib/utils/cn',
  ui: 'components/ui',
  lib: 'lib',
};

export const init = new Command()
  .name('init')
  .description('Initialize @webjsdev/ui in a project: writes components.json, theme CSS, lib/utils/cn.ts')
  .option('-c, --cwd <cwd>', 'the working directory', process.cwd())
  .option('-y, --yes', 'skip confirmation prompts', false)
  .option('--base-color <color>', `base color (${BASE_COLORS.join('|')})`)
  .option('--css <path>', 'path to the project Tailwind CSS file')
  .option('-o, --overwrite', 'replace an existing alias map and existing helper files', false)
  .option('--registry <url>', 'registry base URL', DEFAULT_REGISTRY_URL)
  .action(async (opts) => {
    const cwd = opts.cwd;

    // Re-running `init` on a project that already has one must not RELOCATE it.
    // The alias map decides where cn() lives and what every already-added
    // component imports, and `tailwind.css` decides which stylesheet the app
    // actually builds, so adopting the current defaults over an existing
    // project's values would strand those imports and append the tokens to a
    // file nothing compiles. Keep what the project declared; `--overwrite`
    // opts into replacing it.
    //
    // Read the RAW json rather than going through `getConfig`: its schema is
    // `.strict()`, so a config carrying any unknown key (a shadcn-shaped one
    // with `rsc` / `tsx`, or a hand-added field) throws, and treating that as
    // "no config" is exactly what would relocate a real project and then
    // overwrite the file. Only a file we cannot parse AT ALL is a refusal,
    // because silently replacing unreadable config is the same data loss.
    const cfgPath = join(cwd, CONFIG_FILE);
    /** @type {any} */
    let existing = null;
    if (existsSync(cfgPath)) {
      try {
        existing = JSON.parse(readFileSync(cfgPath, 'utf8'));
      } catch {
        if (!opts.overwrite) {
          logger.error(`${CONFIG_FILE} exists but is not valid JSON, so its settings cannot be preserved.`);
          logger.info('Fix or delete it, or re-run with --overwrite to replace it.');
          process.exit(1);
        }
      }
    }
    const keep = existing && !opts.overwrite;
    if (keep) {
      logger.info(`${CONFIG_FILE} already exists: keeping its settings (use --overwrite to reset them).`);
    }
    // Layer over the defaults rather than replacing them: the schema gives
    // several alias keys defaults, so a hand-written map may legitimately omit
    // one, and reading it raw (above) skips that default-filling. Taking the
    // map wholesale left `utils` undefined and crashed on the write.
    const aliases = { ...DEFAULT_ALIASES, ...((keep && existing.aliases) || null) };
    const initialCss = (keep && existing.tailwind && existing.tailwind.css) || DEFAULT_TAILWIND_CSS;
    const initialBaseColor = (keep && existing.tailwind && existing.tailwind.baseColor) || 'neutral';

    /** @type {{ baseColor: string, css: string }} */
    let answers = {
      baseColor: opts.baseColor || initialBaseColor,
      css: opts.css || initialCss,
    };

    if (!opts.yes) {
      const r = await prompts(
        [
          {
            type: opts.baseColor ? null : 'select',
            name: 'baseColor',
            message: 'Base color?',
            choices: BASE_COLORS.map((c) => ({ title: c, value: c })),
            initial: Math.max(0, BASE_COLORS.indexOf(initialBaseColor)),
          },
          {
            type: opts.css ? null : 'text',
            name: 'css',
            message: 'Tailwind CSS file path?',
            initial: initialCss,
          },
        ],
        { onCancel: () => process.exit(1) },
      );
      answers = { ...answers, ...r };
    }

    // Built from KNOWN keys only. The schema is `.strict()`, so carrying an
    // unrecognised key through here would write a file that `getConfig` (and
    // therefore `add` / `diff` / `info`) throws on. Preserving a project's
    // settings means its VALUES, not arbitrary extra fields.
    const config = {
      $schema: 'https://ui.webjs.dev/schema.json',
      style: (keep && existing.style) || 'default',
      tailwind: {
        css: answers.css,
        baseColor: answers.baseColor,
        cssVariables: keep && existing.tailwind && existing.tailwind.cssVariables !== undefined
          ? existing.tailwind.cssVariables
          : true,
      },
      aliases,
      iconLibrary: (keep && existing.iconLibrary) || 'lucide',
    };

    writeConfig(cwd, config);
    logger.success(`Wrote ${CONFIG_FILE}`);

    // Pull lib/utils + the chosen theme from the registry and write them in.
    await writeLibUtils(cwd, aliases.utils, opts.registry, opts.overwrite);

    // The theme tokens are what the class helpers render against. A silent
    // failure here (the old behaviour) left an unstyled install with a clean
    // exit code, the exact trap for an autonomous agent, so hard-fail (#983).
    const theme = await ensureTheme(cwd, answers.baseColor, answers.css, opts.registry);
    if (theme.status === 'failed') {
      logger.error(`Could not write theme tokens into ${answers.css}: ${theme.error}`);
      logger.info('The class helpers render against these tokens, so this must succeed.');
      process.exit(1);
    }
    if (theme.status === 'written') logger.success(`Wrote theme into ${answers.css}`);
    else logger.info(`Theme already present in ${answers.css}: skipping.`);

    logger.break();
    logger.success('Done.');
    logger.info('');
    logger.info(`Add components with:  ${logger.cyan('npx @webjsdev/ui add button card dialog')}`);
  });

/**
 * Write the two shared helpers, WITHOUT clobbering a copy the project already
 * has. The kit is source-copied and you-own-it, so `lib/utils/cn.ts` is a file
 * users are told to edit ("change one helper to retune the entire app"), and
 * `webjs create` puts its own copy there. An unguarded write was harmless while
 * init targeted `lib/utils.ts`, a path nothing else owned, but the moment it
 * writes where the scaffold and the user's edits live it becomes silent data
 * loss, and re-running init is the documented fix for an unstyled install. So
 * an existing file is kept unless `--overwrite` says otherwise. `add` keeps
 * the same two files on the same terms (its `--yes` skips prompts but does not
 * license replacing them), and the theme is idempotent, so every path into a
 * project leaves an edited helper alone.
 */
async function writeLibUtils(cwd, utilsAlias, registryUrl, overwrite) {
  // The `utils` alias omits the extension ("lib/utils/cn"), matching how
  // get-config.js resolves it, so append '.ts' to get the target path.
  const utilsRel = utilsAlias.replace(/^@\//, '') + '.ts';
  const utilsTarget = join(cwd, utilsRel);
  try {
    if (existsSync(utilsTarget) && !overwrite) {
      logger.info(`${utilsRel} already exists: keeping it.`);
    } else {
      const item = await getRegistryItem('lib-utils', registryUrl);
      if (item.files) {
        for (const f of item.files) {
          ensureDir(dirname(utilsTarget));
          writeFileSync(utilsTarget, f.content || '', 'utf8');
          logger.success(`Wrote ${utilsRel}`);
        }
      }
    }
  } catch (e) {
    logger.warn(`Could not fetch lib-utils from registry (${e.message}). You may need to write ${utilsRel} manually.`);
  }

  // The onBeforeCache() DOM helper lives in a SEPARATE module (#819) because
  // it references `document`, so keeping it out of cn()'s file prevents the
  // elision analyzer pinning every page that imports cn to the browser.
  // Overlay components import it from `../lib/dom.ts`, so write it as a
  // sibling of the utils file, which lands it at lib/utils/dom.ts next to
  // cn.ts. `add` reads that same adjacency when it rewrites the import.
  const domTarget = join(dirname(utilsTarget), 'dom.ts');
  try {
    if (existsSync(domTarget) && !overwrite) {
      logger.info(`${relative(cwd, domTarget)} already exists: keeping it.`);
      return;
    }
    const item = await getRegistryItem('lib-dom', registryUrl);
    if (!item.files) return;
    for (const f of item.files) {
      ensureDir(dirname(domTarget));
      writeFileSync(domTarget, f.content || '', 'utf8');
      logger.success(`Wrote ${relative(cwd, domTarget)}`);
    }
  } catch (e) {
    logger.warn(`Could not fetch lib-dom from registry (${e.message}). You may need to write ${relative(cwd, domTarget)} manually.`);
  }
}

function relative(cwd, p) {
  return p.startsWith(cwd) ? p.slice(cwd.length + 1) : p;
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}
